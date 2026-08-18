// Дым BRO. Канвас, а не CSS-пятна: у настоящего дыма частица рождается
// плотной, растёт, теряет плотность и умирает прозрачной — это жизненный
// цикл, который нельзя изобразить зацикленным блюром. Мультяшность
// убивают три вещи, и все три здесь запрещены: одинаковые клубы
// (у нас у каждой частицы свой размер, срок жизни и характер дрейфа),
// резкие края (спрайт — мягкий радиальный градиент, отрисованный один
// раз) и равномерное движение (снос по псевдо-курлу из двух синусов
// с разными частотами — дым «дышит», а не едет).
//
// Цена для телефона выучена на этой неделе: полноэкранные фильтры и
// тени на анимации роняют iPhone. Поэтому: один канвас, пиксельная
// плотность не выше 1.5, тридцать частиц, отрисовка стоит, когда
// вкладка скрыта, и не запускается вовсе при reduced-motion — там
// рисуем один неподвижный кадр атмосферы.
import { useEffect, useRef } from "react";

type Puff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // текущий радиус
  r1: number; // радиус к концу жизни
  life: number; // 0..1
  rate: number; // скорость жизни
  spin: number;
  a: number; // угол для дрейфа
  red: boolean; // красная подсветка или тёмная сажа
};

const COUNT = 30;

// Спрайт клуба: рисуется один раз. Двухслойный градиент даёт плотное
// ядро и длинный мягкий хвост — то самое рассеивание по краю.
const makeSprite = (tint: [number, number, number]) => {
  const s = document.createElement("canvas");
  s.width = s.height = 128;
  const c = s.getContext("2d");
  if (!c) return s;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  const [r, gr, b] = tint;
  g.addColorStop(0, `rgba(${r},${gr},${b},0.55)`);
  g.addColorStop(0.35, `rgba(${r},${gr},${b},0.22)`);
  g.addColorStop(0.7, `rgba(${r},${gr},${b},0.07)`);
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return s;
};

const spawn = (w: number, h: number, seedY?: boolean): Puff => {
  // Очаги — как на референсе: правая кромка и левый нижний угол.
  // seedY раскидывает первый кадр по всей жизни, чтобы дым существовал
  // сразу, а не «включался» на глазах.
  const side = Math.random() < 0.62;
  const x = side ? w * (0.86 + Math.random() * 0.2) : w * (Math.random() * 0.24 - 0.04);
  const y = side ? h * Math.random() : h * (0.72 + Math.random() * 0.3);
  const r0 = 26 + Math.random() * 34;
  return {
    x,
    y,
    vx: (side ? -1 : 1) * (0.02 + Math.random() * 0.05),
    vy: -(0.03 + Math.random() * 0.06),
    r: r0,
    r1: r0 * (2.2 + Math.random() * 1.4),
    life: seedY ? Math.random() : 0,
    rate: 1 / (9000 + Math.random() * 9000), // жизнь 9–18 секунд
    spin: (Math.random() - 0.5) * 0.0004,
    a: Math.random() * Math.PI * 2,
    red: Math.random() < 0.45,
  };
};

export function BroSmoke() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const red = makeSprite([196, 34, 26]);
    const soot = makeSprite([16, 13, 14]);

    let w = 0;
    let h = 0;
    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const puffs = Array.from({ length: COUNT }, () => spawn(w, h, true));

    let raf = 0;
    let prev = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - prev, 50);
      prev = now;
      ctx.clearRect(0, 0, w, h);
      const t = now * 0.001;
      for (let i = 0; i < puffs.length; i++) {
        let p = puffs[i];
        p.life += p.rate * dt;
        if (p.life >= 1) p = puffs[i] = spawn(w, h);
        // псевдо-курл: две несоизмеримые частоты — дым вьётся, не плывёт
        const sway = Math.sin(t * 0.4 + p.a) * 0.35 + Math.sin(t * 0.13 + p.a * 2.7) * 0.65;
        p.x += (p.vx + sway * 0.028) * dt;
        p.y += p.vy * dt;
        p.a += p.spin * dt;
        const grow = p.r + (p.r1 - p.r) * p.life * 0.02;
        p.r = grow;
        // плотность: быстрый вдох (0→0.18 жизни), долгий выдох до нуля
        const alpha =
          p.life < 0.18 ? (p.life / 0.18) * 0.5 : 0.5 * (1 - (p.life - 0.18) / 0.82);
        ctx.globalAlpha = Math.max(alpha, 0) * (p.red ? 0.34 : 0.5);
        ctx.globalCompositeOperation = p.red ? "screen" : "source-over";
        const d = p.r * 2;
        ctx.drawImage(p.red ? red : soot, p.x - p.r, p.y - p.r, d, d);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };

    const drawStill = () => {
      // reduced-motion: один спокойный кадр вместо анимации
      ctx.clearRect(0, 0, w, h);
      for (const p of puffs) {
        ctx.globalAlpha = 0.22;
        const d = p.r * 2.4;
        ctx.drawImage(p.red ? red : soot, p.x - p.r, p.y - p.r, d, d);
      }
      ctx.globalAlpha = 1;
    };

    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) {
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (still) drawStill();
    });
    ro.observe(host);

    if (still) drawStill();
    else raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="gtr-bro-smoke" aria-hidden />;
}
