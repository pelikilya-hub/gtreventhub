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

// Репертуар: базовый грув плюс четыре сменных движения. Каждые 16 битов
// танцовщица меняет фигуру случайно — живой танец, а не заевший гиф.
// Сами кадры остаются из видео BOSS; движения — работа корпуса поверх
// (проходка, шимми, волна, подскок, разворот), темп — от --gtr-beat.
const MOVES = ["groove", "shimmy", "wave", "hop", "spin"] as const;

export function GtrDancer() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef(0);
  const drawRef = useRef(0);

  // Утащили за край экрана — возвращаем в видимую зону. Без этого одно
  // неудачное перетаскивание прятало танцовщицу навсегда: позиция
  // запоминается, а границ у неё не было («верни танцора» — отсюда).
  const ensureVisible = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (r.right < 28) dx = 28 - r.right;
    if (r.left > vw - 28) dx = vw - 28 - r.left;
    if (r.bottom < 28) dy = 28 - r.bottom;
    if (r.top > vh - 28) dy = vh - 28 - r.top;
    if (dx || dy) {
      posRef.current = { x: posRef.current.x + dx, y: posRef.current.y + dy };
      paint();
      try {
        localStorage.setItem(SPOT, JSON.stringify(posRef.current));
      } catch {
        /* приватный режим */
      }
    }
  };

  // где стояла в прошлый раз
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SPOT);
      if (raw) posRef.current = JSON.parse(raw) as { x: number; y: number };
    } catch {
      /* место не вспомнилось — встанет по умолчанию */
    }
    paint();
    ensureVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Флаг «цикл жив» отдельно от состояния видео. Первый урок этой
    // фичи: цикл, который выходит при «кадров ещё нет» и планирует
    // следующий тик только после удачной отрисовки, умирает на старте
    // навсегда — видео грузится асинхронно, и первый тик всегда пустой.
    let running = false;

    const draw = () => {
      if (!running) return;
      if (v.readyState >= 2 && !v.paused && v.videoWidth > 0) {
        g.drawImage(v, 0, 0, W, H);
        const img = g.getImageData(0, 0, W, H);
        const d = img.data;
        // белый — в прозрачность, край — в полупрозрачность: мягкий
        // кеинг без ореола. Порог 232 оставляет блики на самой фигуре.
        for (let i = 0; i < d.length; i += 4) {
          const m = Math.min(d[i], d[i + 1], d[i + 2]);
          if (m > 232) d[i + 3] = Math.max(0, 255 - (m - 232) * 12);
        }
        g.putImageData(img, 0, 0);
      }
      drawRef.current = requestAnimationFrame(draw);
    };

    // Видео не сыграло (старый кодек, странный WebView) — рисуем прежний
    // спрайт: пустая тень вместо танцовщицы хуже статичной фигуры.
    const fallback = () => {
      const img = new Image();
      img.onload = () => {
        g.clearRect(0, 0, W, H);
        const k = Math.min(W / img.width, H / img.height);
        const dw = img.width * k;
        const dh = img.height * k;
        g.drawImage(img, (W - dw) / 2, H - dh, dw, dh);
      };
      img.src = "/brand/dancer.png";
    };
    v.addEventListener("error", fallback);

    // Смена фигуры каждые 16 битов: длительность шага считается от
    // текущего темпа, сама фигура — случайная из репертуара (кроме той,
    // что танцуется сейчас — заметная смена, а не «может повторюсь»).
    let beatMs = 60000 / BASE_BPM;
    let moveTimer = 0;
    const nextMove = () => {
      const el = rootRef.current;
      if (el) {
        const cur = el.dataset.move ?? "groove";
        const pool = MOVES.filter((m) => m !== cur);
        el.dataset.move = pool[Math.floor(Math.random() * pool.length)];
      }
      moveTimer = window.setTimeout(nextMove, beatMs * 16);
    };

    const start = () => {
      if (still) return; // системное «меньше движения» — стоим смирно
      if (!v.src) v.src = SRC; // первый запуск музыки — первый байт видео
      void v.play().catch(fallback);
      running = true;
      cancelAnimationFrame(drawRef.current);
      drawRef.current = requestAnimationFrame(draw);
      clearTimeout(moveTimer);
      moveTimer = window.setTimeout(nextMove, beatMs * 16);
    };
    const halt = () => {
      running = false;
      v.pause();
      cancelAnimationFrame(drawRef.current);
      clearTimeout(moveTimer);
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
      // темп ведёт и CSS-движения корпуса: длительность шага в переменной
      beatMs = 60000 / Math.max(70, Math.min(180, bpm));
      rootRef.current?.style.setProperty("--gtr-beat", `${Math.round(beatMs)}ms`);
    };
    window.addEventListener("gtr:bpm", onBpm);

    // вкладка в фоне — кадры не рисуем, батарею не жжём
    const onVis = () => {
      if (document.hidden) halt();
      else sync();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      mo.disconnect();
      v.removeEventListener("error", fallback);
      window.removeEventListener("gtr:bpm", onBpm);
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(drawRef.current);
      clearTimeout(moveTimer);
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
    // за край можно спрятать почти всю — но угол остаётся, чтобы вернуть
    ensureVisible();
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
