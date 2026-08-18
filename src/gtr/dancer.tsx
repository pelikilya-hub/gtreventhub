// Танцовщица GTR — видео-скин от BOSS вместо статичного спрайта.
//
// Выходит сбоку, когда включают плеер, и уходит за край, когда его
// останавливают. Скорость её движений следует темпу трека: плеер
// считает BPM из баса и шлёт его событием, мы переводим темп в
// playbackRate видео. Клип снят примерно под 120 ударов — от него
// и масштабируем.
//
// Исходник пришёл на белом фоне, а прозрачное видео iPhone не носит.
// Поэтому кеинг живёт у нас: видео рисуется в маленький канвас, и
// белый выбивается в прозрачность попиксельно. На размере фигуры
// (176×294) это ~52 тысячи пикселей на кадр — дёшево даже для старого
// телефона, а результат — честная прозрачность поверх любого фона.
//
// Видео в 447 КБ грузится только в момент первого включения музыки:
// до этого у элемента нет src, и трафик не тратится.
import { useEffect, useRef } from "react";

const SPOT = "gtr-dancer-spot";
const SRC = "/brand/dancer-live.mp4";
const W = 176;
const H = 294; // пропорция исходника 368×616
const BASE_BPM = 120;

export function GtrDancer() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef(0);
  const drawRef = useRef(0);

  // где стояла в прошлый раз
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SPOT);
      if (raw) posRef.current = JSON.parse(raw) as { x: number; y: number };
    } catch {
      /* место не вспомнилось — встанет по умолчанию */
    }
    paint();
  }, []);

  // жизнь видео: play/pause от атрибута data-gtr-playing на корне,
  // темп — от события gtr:bpm из плеера
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      if (v.paused || v.videoWidth === 0) return;
      g.drawImage(v, 0, 0, W, H);
      const img = g.getImageData(0, 0, W, H);
      const d = img.data;
      // белый — в прозрачность, край — в полупрозрачность: мягкий кеинг
      // без ореола. Порог 232 оставляет светлые блики на самой фигуре.
      for (let i = 0; i < d.length; i += 4) {
        const m = Math.min(d[i], d[i + 1], d[i + 2]);
        if (m > 232) d[i + 3] = Math.max(0, 255 - (m - 232) * 12);
      }
      g.putImageData(img, 0, 0);
      drawRef.current = requestAnimationFrame(draw);
    };

    const start = () => {
      if (still) return; // системное «меньше движения» — стоим смирно
      if (!v.src) v.src = SRC; // первый запуск музыки — первый байт видео
      void v.play().catch(() => {});
      cancelAnimationFrame(drawRef.current);
      drawRef.current = requestAnimationFrame(draw);
    };
    const halt = () => {
      v.pause();
      cancelAnimationFrame(drawRef.current);
    };

    const sync = () => {
      const on = document.documentElement.getAttribute("data-gtr-playing") === "1";
      if (on) start();
      else halt();
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-gtr-playing"] });
    sync();

    const onBpm = (e: Event) => {
      const bpm = Number((e as CustomEvent).detail) || BASE_BPM;
      v.playbackRate = Math.max(0.6, Math.min(1.6, bpm / BASE_BPM));
    };
    window.addEventListener("gtr:bpm", onBpm);

    // вкладка в фоне — кадры не рисуем, батарею не жжём
    const onVis = () => {
      if (document.hidden) halt();
      else sync();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mo.disconnect();
      window.removeEventListener("gtr:bpm", onBpm);
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(drawRef.current);
    };
  }, []);

  const paint = () => {
    const el = rootRef.current;
    if (!el) return;
    const { x, y } = posRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const onDown = (e: React.PointerEvent) => {
    const el = rootRef.current;
    if (!el) return;
    dragRef.current = { id: e.pointerId, ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    posRef.current = { x: e.clientX - d.ox, y: e.clientY - d.oy };
    if (!rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        paint();
      });
  };

  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    rootRef.current?.classList.remove("dragging");
    try {
      localStorage.setItem(SPOT, JSON.stringify(posRef.current));
    } catch {
      /* приватный режим — просто не запомним */
    }
  };

  return (
    <div
      ref={rootRef}
      className="gtr-dancer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-hidden
    >
      <div className="gtr-dancer-slide">
        <div className="gtr-dancer-pulse">
          {/* скрытый источник кадров; на экране — канвас с кеингом */}
          <video ref={videoRef} muted loop playsInline preload="none" style={{ display: "none" }} />
          <canvas ref={canvasRef} width={W} height={H} className="gtr-dancer-img" />
        </div>
      </div>
    </div>
  );
}
