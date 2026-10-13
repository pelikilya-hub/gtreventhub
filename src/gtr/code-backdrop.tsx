// Живой фон с кодом — продолжение bangtaostyle.com (live-hub
// components/fx/StoryBackdrop.tsx). Под всем приложением лежит одна сцена:
// фотография площадки, «проявленная» из матрицы красно-белых глифов, и при
// смене раздела она растворяется в следующую.
//
// Дёшево по замыслу, а не по обещанию:
//  · десктоп — один canvas на весь вьюпорт, ~20 кадров в секунду, в
//    покое перерисовываются лишь ~2 % ячеек (мерцание), полный проход
//    идёт только пока одна сцена растворяется в другую; подложка (фон +
//    приглушённое фото) кэшируется на отдельном холсте;
//  · телефон — никакого живого canvas: фиксированный холст во весь экран
//    заставляет браузер собирать страницу из десятков слоёв, и iOS убивает
//    вкладку. Сцена рисуется один раз при смене, превращается в картинку и
//    лежит обычным фоном; смена сцены — кроссфейд двух слоёв по opacity;
//  · ничего не пишется на :root; пульс баса (--gtr-pulse) приходит от
//    плеера на сам элемент и двигает только opacity красного ореола.
import { useEffect, useRef, useState } from "react";

const GLYPHS = "กขคงจฉชซญฎฐณดตถทธนบปผพฟภมยรลวศษสหอฮ0123456789ABCDEF#%&$";

interface Sampled {
  cols: number;
  rows: number;
  lum: Float32Array;
  img: HTMLImageElement;
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
const load = (src: string) => {
  if (!imgCache.has(src))
    imgCache.set(
      src,
      new Promise((res, rej) => {
        const i = new Image();
        i.decoding = "async";
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      }),
    );
  return imgCache.get(src)!;
};

/** Яркость каждой ячейки сетки: фото вписывается по cover, остаётся только
 *  серый — по нему решается, где глиф и какого цвета. */
const sample = (img: HTMLImageElement, cols: number, rows: number): Sampled => {
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const o = off.getContext("2d")!;
  const s = Math.max(cols / img.width, rows / img.height);
  const w = img.width * s;
  const h = img.height * s;
  o.drawImage(img, (cols - w) / 2, (rows - h) / 2, w, h);
  const d = o.getImageData(0, 0, cols, rows).data;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++)
    lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return { cols, rows, lum, img };
};

const glyphColor = (l: number, edge: boolean) => {
  const a = edge ? 0.9 : Math.min(0.55, (l - 0.15) * 0.75);
  return edge
    ? `rgba(255,52,39,${a})`
    : l > 0.62
      ? `rgba(255,255,255,${a})`
      : `rgba(229,35,27,${a * 0.9})`;
};

/** Один статичный кадр сцены — для телефона. Возвращает data-URL. */
function renderStill(img: HTMLImageElement, W: number, H: number): string {
  const cell = 13;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#0a0b0d";
  ctx.fillRect(0, 0, W, H);
  const s = Math.max(W / img.width, H / img.height);
  ctx.globalAlpha = 0.16;
  ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  ctx.globalAlpha = 1;
  const smp = sample(img, cols, rows);
  ctx.font = `${cell - 3}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "top";
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const l = smp.lum[y * cols + x];
      if (l < 0.18) continue;
      ctx.fillStyle = glyphColor(l, false);
      ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x * cell, y * cell);
    }
  return cv.toDataURL("image/jpeg", 0.72);
}

export function GtrCodeBackdrop({ src }: { src: string }) {
  const cv = useRef<HTMLCanvasElement | null>(null);
  // Сервер не знает, телефон это или десктоп: первый рендер всегда
  // десктопный (пустой холст), телефон переключается после монтирования —
  // иначе разметка сервера и клиента расходятся и React пересобирает дерево.
  const [lite, setLite] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(hover: none), (max-width: 760px)").matches) setLite(true);
  }, []);
  // телефон: две картинки-слоя, кроссфейд по opacity
  const [stills, setStills] = useState<{ a: string; b: string; top: "a" | "b" }>({ a: "", b: "", top: "a" });

  // ---------- телефон: один кадр на сцену ----------
  useEffect(() => {
    if (!lite || typeof window === "undefined") return;
    let alive = true;
    load(src)
      .then((img) => {
        if (!alive) return;
        const url = renderStill(img, window.innerWidth, window.innerHeight);
        setStills((s) => (s.top === "a" ? { ...s, b: url, top: "b" } : { ...s, a: url, top: "a" }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lite, src]);

  // ---------- десктоп: живой холст ----------
  const srcRef = useRef(src);
  srcRef.current = src;
  useEffect(() => {
    const canvas = cv.current;
    if (lite || !canvas) return;
    // на телефоне холст не запускаем даже на первый кадр: сейчас придёт lite
    if (window.matchMedia("(hover: none), (max-width: 760px)").matches) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const interval = reduce ? 1000 : 50;

    let W = 0;
    let H = 0;
    let cell = 16;
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let cur: Sampled | null = null;
    let next: Sampled | null = null;
    let mix = 1;
    let seed = new Float32Array(0);
    let chars = new Uint16Array(0);
    let curKey = "";
    let raf = 0;
    let lastT = 0;
    let visible = true;

    // подложка (фон + приглушённое фото) — кэш на сцену
    const under = document.createElement("canvas");
    const uctx = under.getContext("2d", { alpha: false })!;
    let underFor: Sampled | null = null;
    let dirty = true;

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cell = W < 600 ? 13 : 16;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      cols = Math.ceil(W / cell);
      rows = Math.ceil(H / cell);
      seed = new Float32Array(cols * rows).map(() => Math.random());
      chars = new Uint16Array(cols * rows).map(() => Math.floor(Math.random() * GLYPHS.length));
      dirty = true;
      underFor = null;
      if (cur) cur = sample(cur.img, cols, rows);
      if (next) next = sample(next.img, cols, rows);
    };

    const go = (key: string) => {
      if (!key || key === curKey) return;
      curKey = key;
      load(key)
        .then((img) => {
          if (curKey !== key) return;
          const s = sample(img, cols, rows);
          if (!cur) {
            cur = s;
            mix = 1;
          } else {
            if (next) cur = next;
            next = s;
            mix = 0;
          }
        })
        .catch(() => {});
    };

    const paintUnder = (base: Sampled) => {
      under.width = canvas.width;
      under.height = canvas.height;
      uctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      uctx.fillStyle = "#0a0b0d";
      uctx.fillRect(0, 0, W, H);
      const s = Math.max(W / base.img.width, H / base.img.height);
      uctx.globalAlpha = 0.16;
      uctx.drawImage(
        base.img,
        (W - base.img.width * s) / 2,
        (H - base.img.height * s) / 2,
        base.img.width * s,
        base.img.height * s,
      );
      uctx.globalAlpha = 1;
      underFor = base;
    };
    const glyph = (i: number, x: number, y: number, l: number, edge: boolean) => {
      ctx.fillStyle = glyphColor(l, edge);
      ctx.fillText(GLYPHS[chars[i]], x * cell, y * cell);
    };

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || t - lastT < interval) return;
      const dt = Math.min(200, t - lastT);
      lastT = t;
      if (next) {
        mix = Math.min(1, mix + dt / 1400);
        if (mix >= 1) {
          cur = next;
          next = null;
          mix = 1;
          dirty = true;
        }
      }
      if (!cur) return;
      const base = next && mix > 0.5 ? next : cur;
      if (underFor !== base || under.width !== canvas.width) {
        paintUnder(base);
        dirty = true;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cell - 3}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      const flick = reduce ? 0 : 0.02;

      if (next || dirty) {
        // полный проход: растворение сцены или новая сетка
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(under, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const from = next && seed[i] < mix ? next : cur;
            const l = from.lum[i];
            const edge = !!next && Math.abs(seed[i] - mix) < 0.06;
            if (l < 0.18 && !edge) continue;
            if (Math.random() < flick) chars[i] = Math.floor(Math.random() * GLYPHS.length);
            glyph(i, x, y, l, edge);
          }
        }
        dirty = false;
        return;
      }
      // покой: мерцают лишь несколько ячеек — остальное не трогаем
      const n = Math.ceil(cols * rows * flick);
      const cd = cell * dpr;
      for (let k = 0; k < n; k++) {
        const i = Math.floor(Math.random() * cols * rows);
        const l = cur.lum[i];
        if (l < 0.18) continue;
        const x = i % cols;
        const y = (i - x) / cols;
        chars[i] = Math.floor(Math.random() * GLYPHS.length);
        ctx.drawImage(under, x * cd, y * cd, cd, cd, x * cell, y * cell, cell, cell);
        glyph(i, x, y, l, false);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    const onVis = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    go(srcRef.current);
    // смена сцены приходит пропсом; опрос дешёвый и не трогает DOM
    const tick = window.setInterval(() => go(srcRef.current), 300);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tick);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [lite]);

  return (
    <div className="gtr-codebg" aria-hidden>
      {lite ? (
        <>
          <div
            className={`gtr-codebg-still${stills.top === "a" ? " on" : ""}`}
            style={stills.a ? { backgroundImage: `url(${stills.a})` } : undefined}
          />
          <div
            className={`gtr-codebg-still${stills.top === "b" ? " on" : ""}`}
            style={stills.b ? { backgroundImage: `url(${stills.b})` } : undefined}
          />
        </>
      ) : (
        <canvas ref={cv} />
      )}
      <div className="gtr-codebg-shade" />
      <div className="gtr-codebg-kick" />
    </div>
  );
}

/** Сцена фона для раздела: кабинет площадки живёт на её собственном снимке,
 *  сетевые разделы — на ночных площадках острова. */
const NIGHT: string[] = ["VEN-0002", "VEN-0001", "VEN-0004", "VEN-0051", "VEN-0076", "VEN-0080", "VEN-0003", "VEN-0046"];
const CABINET = new Set(["dash", "calendar", "events", "constructor", "inquiries", "spaces", "venue", "finance", "access"]);
const hero = (vid: string) => `/venues/${vid}-hero.jpg`;

export function sceneFor(screen: string, venueId?: string | null, vid?: string): string {
  if (vid) return hero(vid);
  if (venueId && CABINET.has(screen)) return hero(venueId);
  let h = 0;
  for (const ch of screen) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hero(NIGHT[h % NIGHT.length]);
}
