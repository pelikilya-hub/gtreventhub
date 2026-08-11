import { useEffect, useRef } from "react";

// ИМПУЛЬС — генеративный арт GTR (движение описано в /art/IMPULSE.md).
// Портирован с p5-версии (/art/index.html) на чистый canvas, чтобы не тащить
// мегабайт p5 в бандл ради фонов. Сид — строковый ID сущности: одна площадка
// или событие всегда получает один и тот же кадр.

// FNV-1a: строковый ID → 32-битный сид
const hashSeed = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// mulberry32 — быстрый детерминированный PRNG
const prng = (seed: number) => {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const VOID = "#0a0b0d";
const RED = "#e5231b";
const PULSE = "#ff3427";
const WHITE = "#eaeaea";
const TILT = (24 * Math.PI) / 180; // ДНК дизайн-системы: наклон служебных линий

export function drawImpulse(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seedStr: string,
  opts: { density?: number } = {},
) {
  const rnd = prng(hashSeed(seedStr));
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const density = opts.density ?? 1;

  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, w, h);

  // структурные полосы: счёт по модулю 97 — числу площадок сети
  ctx.strokeStyle = "rgba(255,255,255,.028)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 97; i++) {
    const x = (i * w) / 97 + R(-1.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // импульсы: вертикали-носители энергии
  const impulses = 1 + Math.floor(rnd() * 3);
  const anchors: { x: number; y: number; main: boolean }[] = [];
  for (let k = 0; k < impulses; k++) {
    const x0 = w * R(0.15, 0.85);
    const iw = R(3, 18) * (k === 0 ? 1.6 : 1);
    const col = k === 0 || rnd() < 0.5 ? RED : PULSE;
    let y = 0;
    while (y < h) {
      const seg = R(20, h * 0.22);
      const dx = rnd() < 0.45 ? R(-iw * 2.2, iw * 2.2) : 0;
      ctx.globalAlpha = R(0.75, 1);
      ctx.fillStyle = col;
      ctx.fillRect(x0 + dx - iw / 2, y, iw * R(0.55, 1), seg);
      if (rnd() < 0.22) {
        ctx.globalAlpha = R(0.16, 0.42);
        ctx.fillStyle = WHITE;
        ctx.fillRect(x0 + dx + iw, y + R(0, seg), Math.max(1, iw * 0.12), seg * R(0.3, 0.9));
      }
      y += seg + (rnd() < 0.45 ? R(6, 40) : 0);
    }
    anchors.push({ x: x0, y: h * R(0.25, 0.75), main: k === 0 });
  }
  ctx.globalAlpha = 1;

  // разряды: рекурсивные молнии из точек пробоя
  const bolt = (x: number, y: number, ang: number, depth: number, lw: number) => {
    if (depth <= 0 || lw < 0.4) return;
    let px = x,
      py = y,
      pa = ang;
    const segs = 4 + Math.floor(rnd() * 5);
    for (let s = 0; s < segs; s++) {
      const len = R(16, Math.min(w, h) * 0.12) * (depth / 4);
      pa += rnd() < 0.45 ? R(-1.15, 1.15) : R(-0.28, 0.28);
      const nx = px + Math.cos(pa) * len;
      const ny = py + Math.sin(pa) * len;
      if (rnd() < 0.5) {
        ctx.strokeStyle = "rgba(255,52,39,.22)";
        ctx.lineWidth = lw * 2.4;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
      ctx.strokeStyle = lw > 2.2 ? RED : WHITE;
      ctx.lineWidth = lw * R(0.7, 1.1);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      if (rnd() < 0.33) bolt(nx, ny, pa + R(-1.3, 1.3), depth - 1, lw * R(0.4, 0.62));
      px = nx;
      py = ny;
    }
  };
  for (const a of anchors) {
    if (a.main) {
      bolt(a.x, a.y, R(-0.4, 0.4), 4, R(3.5, 5.5));
      bolt(a.x, a.y, Math.PI + R(-0.4, 0.4), 4, R(3.5, 5.5));
    } else bolt(a.x, a.y, rnd() * Math.PI * 2, 3, R(2, 3.5));
  }

  // сейсмолиния баса
  const yBase = h * R(0.6, 0.85);
  ctx.strokeStyle = "rgba(234,234,234,.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let phase = rnd() * 100;
  for (let x = 0; x < w; x += 3) {
    const calm = Math.sin(x * 0.01 + phase) * 6 + Math.sin(x * 0.037 + phase * 2) * 3;
    const burst = rnd() < 0.012 ? R(14, 90) : 0;
    ctx.lineTo(x, yBase + x * Math.tan(TILT) * 0.02 + calm - burst);
  }
  ctx.stroke();

  // осадок: брызги со степенным распределением, сгущение у пробоев
  const drops = Math.floor(220 * density * (w * h) / (900 * 500));
  for (let i = 0; i < drops; i++) {
    const a = anchors[Math.floor(rnd() * anchors.length)];
    const spread = Math.pow(rnd(), 2.2) * w * 0.38;
    const ang = rnd() * Math.PI * 2;
    const x = a.x + Math.cos(ang) * spread;
    const y = a.y + Math.sin(ang) * spread * R(0.5, 1.4);
    const r = Math.pow(rnd(), 3.2) * 8 + 0.6;
    const roll = rnd();
    ctx.globalAlpha = R(0.3, 0.85);
    ctx.fillStyle = roll < 0.52 ? RED : roll < 0.8 ? PULSE : WHITE;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 5 && rnd() < 0.7) ctx.fillRect(x - r * 0.12, y, r * 0.24, R(6, 30));
  }
  ctx.globalAlpha = 1;

  // глифы-шрамы
  const glyphs = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < glyphs; i++) {
    const x = R(w * 0.08, w * 0.92);
    const y = R(h * 0.1, h * 0.9);
    const s = R(6, 18);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() < 0.6 ? -TILT : R(-0.3, 0.3));
    ctx.strokeStyle = rnd() < 0.4 ? RED : WHITE;
    ctx.lineWidth = R(1, 2);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    if (rnd() < 0.5) {
      ctx.moveTo(-s, 0);
      ctx.lineTo(s, 0);
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
    } else {
      for (let t = -s; t < s; t += 5) {
        ctx.moveTo(t, -s * 0.4);
        ctx.lineTo(t + 4, s * 0.4);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // развёртка ЭЛТ
  ctx.fillStyle = "rgba(0,0,0,.13)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

// Кэш кадров: один сид+размер рисуется однажды за сессию
const cache = new Map<string, string>();

export function ImpulseArt({
  seed,
  className,
  style,
  density,
}: {
  seed: string;
  className?: string;
  style?: React.CSSProperties;
  density?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(64, Math.round(rect.width));
    const h = Math.max(64, Math.round(rect.height));
    const key = `${seed}|${w}x${h}|${density ?? 1}`;
    cv.width = w * 2; // ретина
    cv.height = h * 2;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);
    const cached = cache.get(key);
    if (cached) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, h);
      img.src = cached;
      return;
    }
    drawImpulse(ctx, w, h, seed, { density });
    try {
      cache.set(key, cv.toDataURL("image/png"));
    } catch {
      /* приватный режим — рисуем без кэша */
    }
  }, [seed, density]);

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%", ...style }}
    />
  );
}
