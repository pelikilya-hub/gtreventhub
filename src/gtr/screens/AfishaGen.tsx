// Генератор афиш: бриф (площадка, артист, дата) → готовый постер в
// стилистике площадки. Палитра берётся из профиля стиля (корпус реальных
// афиш площадки), фон — наши кэшированные медиа: hero артиста, постеры
// корпуса или чистая палитра. Рендер — canvas, экспорт — PNG.
// Доступ: BOSS и организаторы/продюсер.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadArtists, PH, type Artist } from "../data/app-data";
import mediaRaw from "../data/artist-media.json";
import { listAfishaFn, styleProfileFn, type StyleProfile } from "../kv-api";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

type ArtistMedia = { heroPoster?: string; heroVideo?: string };
const MEDIA = (mediaRaw as unknown as { media: Record<string, ArtistMedia> }).media;

const SIZES = {
  post: { w: 1080, h: 1350, label: "Пост 4:5" },
  story: { w: 1080, h: 1920, label: "Сторис 9:16" },
} as const;
type SizeId = keyof typeof SIZES;

const VARIANTS = ["Импакт", "Афиша", "Минимал"] as const;

// ---------- цветовые помощники ----------
const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const lumOf = (hex: string) => {
  const [r, g, b] = hexRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const satOf = (hex: string) => {
  const [r, g, b] = hexRgb(hex);
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  return mx === 0 ? 0 : (mx - mn) / mx;
};
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// Акцент из палитры площадки: самый насыщенный не-тёмный цвет, иначе бренд
const accentOf = (colors: string[]) => {
  const c = [...colors]
    .filter((x) => lumOf(x) > 0.18 && lumOf(x) < 0.9)
    .sort((a, b) => satOf(b) - satOf(a))[0];
  return c ?? "#E5231B";
};
const darkOf = (colors: string[]) => {
  const c = [...colors].sort((a, b) => lumOf(a) - lumOf(b))[0];
  return c && lumOf(c) < 0.16 ? c : "#0A0B0D";
};

const loadImg = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });

// перенос заголовка по ширине
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(probe).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = probe;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
};

export function AfishaGenScreen() {
  const { user } = useGtr();
  const allowed = Boolean(user.boss) || user.role === "organizer";

  const [vid, setVid] = useState("VEN-0002");
  const [artistId, setArtistId] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [aq, setAq] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [dateIso, setDateIso] = useState("");
  const [time, setTime] = useState("22:00");
  const [size, setSize] = useState<SizeId>("post");
  const [variant, setVariant] = useState(0);
  const [bg, setBg] = useState<string>(""); // "" = палитра
  const [style, setStyle] = useState<StyleProfile | null>(null);
  const [corpus, setCorpus] = useState<{ id: string; poster: string; title: string }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    loadArtists().then((b) => setArtists(b.artists));
  }, []);
  useEffect(() => {
    if (!allowed) return;
    styleProfileFn({ data: { vid } })
      .then((r) => setStyle(r.profile))
      .catch(() => setStyle(null));
    listAfishaFn({ data: { vid } })
      .then((r) =>
        setCorpus(
          (r.events ?? [])
            .filter((e) => e.poster?.startsWith("/api/"))
            .map((e) => ({ id: e.id, poster: e.poster as string, title: e.title })),
        ),
      )
      .catch(() => setCorpus([]));
  }, [vid, allowed]);

  const venue = PH.venues.find((v) => v.id === vid);
  const artist = artists.find((a) => a.id === artistId);
  const artistHero = artistId ? MEDIA[artistId]?.heroPoster : undefined;

  const palette = style?.colors?.length ? style.colors : ["#0A0B0D", "#E5231B", "#FFFFFF"];
  const accent = accentOf(palette);
  const dark = darkOf(palette);

  const found = useMemo(
    () =>
      aq.trim()
        ? artists
            .filter((a) => a.name.toLowerCase().includes(aq.trim().toLowerCase()))
            .slice(0, 6)
        : [],
    [aq, artists],
  );

  const dateLabel = useMemo(() => {
    if (!dateIso) return "";
    const d = new Date(dateIso + "T00:00:00");
    const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
    const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
      d.getMonth()
    ];
    return `${wd} · ${String(d.getDate()).padStart(2, "0")} ${mon}${time ? ` · ${time}` : ""}`;
  }, [dateIso, time]);

  // ---------- рендер ----------
  const draw = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    setRendering(true);
    const { w, h } = SIZES[size];
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    try {
      await Promise.all([
        document.fonts.load("700 120px Oswald"),
        document.fonts.load("600 34px 'JetBrains Mono'"),
        document.fonts.load("500 36px 'Golos Text'"),
      ]);
    } catch {
      // шрифты подтянутся из системных — рендер не блокируем
    }

    // фон
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, w, h);
    const img = bg ? await loadImg(bg) : null;
    if (img) {
      const sc = Math.max(w / img.width, h / img.height);
      const dw = img.width * sc;
      const dh = img.height * sc;
      ctx.filter = "saturate(0.94) contrast(1.03)";
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.filter = "none";
    } else {
      // палитра: диагональные поля цветов корпуса
      palette.slice(0, 4).forEach((c, i) => {
        ctx.save();
        ctx.globalAlpha = 0.16 + 0.08 * (4 - i);
        ctx.fillStyle = c;
        ctx.beginPath();
        const off = (i / 4) * w * 1.6 - w * 0.3;
        ctx.moveTo(off, h);
        ctx.lineTo(off + w * 0.55, 0);
        ctx.lineTo(off + w * 0.95, 0);
        ctx.lineTo(off + w * 0.4, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }

    // затемнение к низу — текст всегда читается
    const grad = ctx.createLinearGradient(0, h * 0.28, 0, h);
    grad.addColorStop(0, "rgba(6,7,9,0)");
    grad.addColorStop(0.62, rgba(dark, 0.55));
    grad.addColorStop(1, rgba(dark, 0.96));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // фирменная текстура: тонкие диагонали
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
      ctx.stroke();
    }
    ctx.restore();

    // акцентная кромка слева
    const edge = ctx.createLinearGradient(0, 0, 0, h);
    edge.addColorStop(0, accent);
    edge.addColorStop(0.8, rgba(accent, 0));
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, 10, h);

    const M = 72; // поле
    const white = "#FFFFFF";
    const artistName = (artist?.name ?? "").toUpperCase();
    const evTitle = (title || "").toUpperCase();
    const big = artistName || evTitle || "GTR EVENT";
    const small = artistName && evTitle ? evTitle : "";

    // шапка: GTR EVENT + площадка
    ctx.textBaseline = "top";
    ctx.font = "700 30px 'JetBrains Mono', monospace";
    ctx.fillStyle = white;
    ctx.fillText("GTR", M, M);
    const gtrW = ctx.measureText("GTR").width;
    ctx.fillStyle = accent;
    ctx.fillText(" EVENT", M + gtrW, M);
    ctx.font = "600 26px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255,255,255,.66)";
    const vn = (venue?.name ?? "").toUpperCase();
    ctx.fillText(vn, w - M - ctx.measureText(vn).width, M + 3);

    const centerY = variant === 2;
    const anchorY = centerY ? h * 0.42 : size === "story" ? h * 0.62 : h * 0.56;
    let y = anchorY;

    // дата-чип
    if (dateLabel) {
      ctx.font = "700 34px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(dateLabel).width;
      const chX = variant === 0 ? M : variant === 1 ? M : (w - tw - 56) / 2;
      ctx.fillStyle = accent;
      ctx.fillRect(chX, y, tw + 56, 62);
      ctx.fillStyle = lumOf(accent) > 0.62 ? "#101114" : "#FFFFFF";
      ctx.fillText(dateLabel, chX + 28, y + 15);
      y += 62 + 34;
    }

    // главный заголовок
    let fs = size === "story" ? 128 : 116;
    ctx.font = `700 ${fs}px Oswald, sans-serif`;
    let lines = wrap(ctx, big, w - M * 2);
    while (lines.length > 2 && fs > 72) {
      fs -= 10;
      ctx.font = `700 ${fs}px Oswald, sans-serif`;
      lines = wrap(ctx, big, w - M * 2);
    }
    ctx.fillStyle = white;
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 26;
    for (const ln of lines) {
      const lw = ctx.measureText(ln).width;
      const lx = variant === 2 ? (w - lw) / 2 : M;
      ctx.fillText(ln, lx, y);
      y += fs * 1.06;
    }
    ctx.shadowBlur = 0;
    y += 10;

    // подзаголовок (название события при выбранном артисте)
    if (small) {
      ctx.font = "600 44px Oswald, sans-serif";
      ctx.fillStyle = accent;
      const lw = ctx.measureText(small).width;
      ctx.fillText(small, variant === 2 ? (w - lw) / 2 : M, y);
      y += 62;
    }
    if (subtitle.trim()) {
      ctx.font = "500 32px 'Golos Text', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,.78)";
      const st = subtitle.trim();
      const lw = ctx.measureText(st).width;
      ctx.fillText(st, variant === 2 ? (w - lw) / 2 : M, y);
      y += 48;
    }

    // подвал: площадка · район + линия
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fillRect(M, h - M - 58, 54, 6);
    ctx.font = "600 27px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    const foot = [venue?.name, venue?.area].filter(Boolean).join(" · ").toUpperCase();
    ctx.fillText(foot, M, h - M - 34);

    setRendering(false);
  }, [size, bg, palette, accent, dark, artist, title, subtitle, dateLabel, variant, venue]);

  useEffect(() => {
    if (allowed) void draw();
  }, [draw, allowed]);

  const download = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `gtr-afisha-${vid}-${dateIso || "draft"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  if (!allowed)
    return (
      <div
        className="gtr-mono"
        style={{ padding: 60, textAlign: "center", color: "var(--gtr-t3)" }}
      >
        Генератор афиш доступен BOSS, организаторам и продюсеру.
      </div>
    );

  const bgOptions: { key: string; src: string; label: string }[] = [
    ...(artistHero ? [{ key: "artist", src: artistHero, label: "Hero артиста" }] : []),
    ...corpus.map((c) => ({ key: c.id, src: c.poster, label: c.title })),
  ];

  const label = (s: string) => (
    <span
      className="gtr-mono"
      style={{
        display: "block",
        margin: "0 0 5px",
        font: "600 9.5px/1 'JetBrains Mono',monospace",
        color: "rgba(255,255,255,.5)",
        letterSpacing: ".08em",
        textTransform: "uppercase",
      }}
    >
      {s}
    </span>
  );

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 className="gtr-oswald gtr-h1">Генератор афиш</h1>
        {style ? (
          <span
            title={`Корпус стиля: ${style.posters} афиш`}
            style={{ display: "flex", gap: 3, alignItems: "center" }}
          >
            {palette.slice(0, 6).map((c) => (
              <span key={c} style={{ width: 11, height: 11, background: c }} />
            ))}
          </span>
        ) : (
          <Chip color="rgba(255,255,255,.4)">СТИЛЬ: БРЕНД GTR (корпуса площадки пока нет)</Chip>
        )}
      </div>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "minmax(300px,380px) 1fr", gap: 18 }}
      >
        {/* -------- бриф -------- */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
            <Eyebrow>БРИФ</Eyebrow>
            <div>
              {label("Площадка")}
              <select
                className="gtr-input"
                value={vid}
                onChange={(e) => {
                  setVid(e.target.value);
                  setBg("");
                }}
              >
                {[...PH.venues]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              {label("Артист")}
              <input
                className="gtr-input"
                placeholder="Поиск по 312…"
                value={artist ? artist.name : aq}
                onChange={(e) => {
                  setArtistId("");
                  setAq(e.target.value);
                }}
              />
              {found.length && !artist ? (
                <div style={{ border: "1px solid rgba(255,255,255,.12)", borderTop: "none" }}>
                  {found.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setArtistId(a.id);
                        setAq("");
                        if (MEDIA[a.id]?.heroPoster) setBg(MEDIA[a.id].heroPoster as string);
                      }}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        width: "100%",
                        padding: "8px 11px",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid rgba(255,255,255,.05)",
                        color: "#fff",
                        cursor: "pointer",
                        font: "500 11.5px/1.2 'Golos Text',sans-serif",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ flex: 1 }}>{a.name}</span>
                      {MEDIA[a.id]?.heroPoster ? (
                        <span
                          className="gtr-mono"
                          style={{ font: "600 8.5px/1 'JetBrains Mono',monospace", color: "#2ECC71" }}
                        >
                          МЕДИА
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {artist ? (
                <button
                  className="gtr-btn"
                  style={{ marginTop: 6, padding: "4px 8px", fontSize: 10 }}
                  onClick={() => {
                    setArtistId("");
                    setBg("");
                  }}
                >
                  ✕ {artist.name}
                </button>
              ) : null}
            </div>
            <div>
              {label("Название события")}
              <input
                className="gtr-input"
                placeholder="Full Moon Party"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                {label("Дата")}
                <input
                  className="gtr-input"
                  type="date"
                  value={dateIso}
                  onChange={(e) => setDateIso(e.target.value)}
                />
              </div>
              <div>
                {label("Время")}
                <input
                  className="gtr-input"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            <div>
              {label("Строка лайнапа / формат")}
              <input
                className="gtr-input"
                placeholder="Support: DJ … · Dress code: white"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </div>
          </Card>

          <Card style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
            <Eyebrow>ОФОРМЛЕНИЕ</Eyebrow>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(Object.keys(SIZES) as SizeId[]).map((s) => (
                <button
                  key={s}
                  className="gtr-btn"
                  style={{
                    borderColor: size === s ? "#E5231B" : undefined,
                    background: size === s ? "rgba(229,35,27,.14)" : undefined,
                  }}
                  onClick={() => setSize(s)}
                >
                  {SIZES[s].label}
                </button>
              ))}
              {VARIANTS.map((v, i) => (
                <button
                  key={v}
                  className="gtr-btn"
                  style={{
                    borderColor: variant === i ? "#E5231B" : undefined,
                    background: variant === i ? "rgba(229,35,27,.14)" : undefined,
                  }}
                  onClick={() => setVariant(i)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div>
              {label("Фон")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  onClick={() => setBg("")}
                  title="Палитра площадки"
                  style={{
                    width: 64,
                    height: 80,
                    cursor: "pointer",
                    border: `2px solid ${bg === "" ? "#E5231B" : "rgba(255,255,255,.15)"}`,
                    background: `linear-gradient(150deg, ${palette.slice(0, 4).join(",")})`,
                  }}
                />
                {bgOptions.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setBg(o.src)}
                    title={o.label}
                    style={{
                      width: 64,
                      height: 80,
                      padding: 0,
                      cursor: "pointer",
                      border: `2px solid ${bg === o.src ? "#E5231B" : "rgba(255,255,255,.15)"}`,
                      overflow: "hidden",
                      background: "#000",
                    }}
                  >
                    <img
                      src={o.src}
                      alt=""
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </button>
                ))}
              </div>
              {!bgOptions.length ? (
                <div
                  style={{
                    marginTop: 6,
                    font: "500 10px/1.5 'Golos Text',sans-serif",
                    color: "var(--gtr-t3)",
                  }}
                >
                  У площадки пока нет корпуса афиш — фон соберётся из палитры.
                  Выберите артиста с меткой «МЕДИА», чтобы взять его hero-кадр.
                </div>
              ) : null}
            </div>
            <button className="gtr-btn gtr-btn-red" onClick={download} disabled={rendering}>
              Скачать PNG · {SIZES[size].w}×{SIZES[size].h}
            </button>
          </Card>
        </div>

        {/* -------- предпросмотр -------- */}
        <Card style={{ padding: 14, alignSelf: "start" }}>
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              maxWidth: size === "story" ? 420 : 520,
              display: "block",
              margin: "0 auto",
              border: "1px solid rgba(255,255,255,.09)",
            }}
          />
        </Card>
      </div>
    </div>
  );
}
