import type { CSSProperties, ReactNode } from "react";
import { AMBER, GREEN, RED } from "./data/app-data";

export const Icon = ({
  d,
  size = 16,
  color = "currentColor",
}: {
  d: string;
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.7}
    strokeLinecap="square"
    strokeLinejoin="miter"
    style={{ flex: "none" }}
  >
    {d.split(" M").map((p, i) => (
      <path key={i} d={(i ? "M" : "") + p} />
    ))}
  </svg>
);

// Разбавить любой цвет альфой. Строковая склейка `${color}22` ломалась
// на "#fff" и на rgba(...) — получался невалидный цвет и фон молча пропадал.
export const tint = (c: string, a: number) => {
  if (c.startsWith("rgba")) return c.replace(/[\d.]+\s*\)$/, `${a})`);
  if (c.startsWith("rgb(")) return c.replace("rgb(", "rgba(").replace(")", `, ${a})`);
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const chipBorder = (c: string) =>
  c === RED
    ? "rgba(229,35,27,.45)"
    : c === AMBER
      ? "rgba(245,166,35,.4)"
      : c === GREEN
        ? "rgba(46,204,113,.4)"
        : "rgba(255,255,255,.14)";

export const Chip = ({
  color,
  children,
  style,
}: {
  color: string;
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <span className="gtr-chip" style={{ color, border: `1px solid ${chipBorder(color)}`, ...style }}>
    {children}
  </span>
);

// Квадратный маркер — круглые точки читаются как чужой UI-кит
export const Dot = ({ color, top = 4 }: { color: string; top?: number }) => (
  <span
    style={{
      width: 7,
      height: 7,
      flex: "none",
      marginTop: top,
      background: color,
      display: "inline-block",
      boxShadow: `0 0 6px -1px ${color}`,
    }}
  />
);

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="gtr-eyebrow" style={style}>
    {children}
  </div>
);

// Поле «лейбл — значение»: на десктопе в строку, на телефоне столбиком.
// mono — для телефонов, дат и идентификаторов.
export const Field = ({
  k,
  v,
  mono,
  color,
}: {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
  color?: string;
}) => (
  <div className="gtr-field">
    <span className="gtr-eyebrow gtr-field-k">{k}</span>
    <span className={`gtr-field-v ${mono ? "mono" : ""}`} style={color ? { color } : undefined}>
      {v}
    </span>
  </div>
);

// Трэш-заголовок: заглавная буква каждого слова — красная.
// CSS ::first-letter красит только первую букву блока, поэтому слова
// размечаются здесь.
export const TrashTitle = ({
  text,
  size = 29,
  style,
}: {
  text: string;
  size?: number;
  style?: CSSProperties;
}) => (
  // Размер отдаём переменной, а не жёстким инлайном: инлайн не слышит
  // ни одного брейкпоинта, и на телефоне набок заголовок оставался
  // портретным. Переменную же любой @media переопределит.
  <h1
    className="gtr-trash"
    style={{ ["--gtr-trash" as string]: `${size}px`, fontSize: "var(--gtr-trash)", lineHeight: 1.05, margin: 0, ...style }}
  >
    {text.split(/(\s+)/).map((w, i) => {
      if (!w || /^\s+$/.test(w)) return w;
      const first = w[0];
      const isUpper = first !== first.toLowerCase() && first === first.toUpperCase();
      return isUpper ? (
        <span key={i}>
          <span style={{ color: "var(--gtr-red)" }}>{first}</span>
          {w.slice(1)}
        </span>
      ) : (
        <span key={i}>{w}</span>
      );
    })}
  </h1>
);

// Буква-значок вместо фото: рваная панк-буква на красной подложке.
// Латиницу рисует All Ages, кириллицу подхватывает Trashed из стека.
export const LetterMark = ({
  name,
  size = 34,
  cut = 6,
}: {
  name: string;
  size?: number;
  cut?: number;
}) => (
  <span
    className="gtr-lettermark"
    aria-hidden="true"
    style={{
      width: size,
      height: size,
      fontSize: Math.round(size * 0.56),
      clipPath: `polygon(0 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% 100%, 0 100%)`,
    }}
  >
    {(name.trim()[0] || "?")}
  </span>
);

// Пункт списка с квадратным маркером в цвет секции
export const Li = ({ children, color }: { children: ReactNode; color?: string }) => (
  <div className="gtr-li">
    <i style={color ? { background: color } : undefined} />
    <span style={{ minWidth: 0 }}>{children}</span>
  </div>
);

// Подзаголовок внутри карточки
export const SubHead = ({ children, color, style }: { children: ReactNode; color?: string; style?: CSSProperties }) => (
  <div className="gtr-subhead" style={style}>
    <i style={color ? { background: color } : undefined} />
    {children}
  </div>
);

export const Card = ({
  children,
  hover,
  style,
  className = "",
  onClick,
  id,
}: {
  children: ReactNode;
  hover?: boolean;
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
  /** Якорь для прокрутки: «покажи мне бронь» должно куда-то вести. */
  id?: string;
}) => (
  <div
    id={id}
    className={`gtr-card ${hover ? "gtr-card-hover" : ""} ${className}`}
    style={{ ...(onClick ? { cursor: "pointer" } : {}), ...style }}
    onClick={onClick}
  >
    {children}
  </div>
);

// Готовность каталога — сегментная шкала вместо гладкого кольца
const RING_SEGMENTS = 44;

export const Ring = ({ value, size = 118 }: { value: number; size?: number }) => {
  const r = (size - 14) / 2;
  const color = value >= 70 ? GREEN : value >= 45 ? AMBER : RED;
  const lit = Math.round((Math.max(0, Math.min(100, value)) / 100) * RING_SEGMENTS);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        {Array.from({ length: RING_SEGMENTS }, (_, i) => {
          const a = (i / RING_SEGMENTS) * Math.PI * 2;
          const on = i < lit;
          const inner = on ? r - 7 : r - 4;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * inner}
              y1={cy + Math.sin(a) * inner}
              x2={cx + Math.cos(a) * r}
              y2={cy + Math.sin(a) * r}
              stroke={on ? color : "rgba(255,255,255,.10)"}
              strokeWidth={on ? 3 : 2}
              strokeLinecap="butt"
              style={{
                transition: "stroke .5s ease, stroke-width .5s ease",
                filter: on ? `drop-shadow(0 0 4px ${color}88)` : undefined,
              }}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="gtr-mono"
          style={{
            font: "700 27px/1 'JetBrains Mono',monospace",
            color,
            letterSpacing: "-.04em",
          }}
        >
          {value}
        </div>
        <div className="gtr-eyebrow" style={{ fontSize: 10, marginTop: 5 }}>
          / 100
        </div>
      </div>
    </div>
  );
};

export const SectionHead = ({
  title,
  cta,
  onCta,
}: {
  title: string;
  cta?: string;
  onCta?: () => void;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "15px 20px",
      borderBottom: "1px solid rgba(255,255,255,.07)",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{ width: 3, height: 15, background: "var(--gtr-red)", flex: "none" }}
      />
      <div
        className="gtr-oswald"
        style={{ font: "600 14px/1 Oswald,sans-serif", letterSpacing: ".05em" }}
      >
        {title}
      </div>
    </div>
    {cta ? (
      <button className="gtr-btn" onClick={onCta}>
        {cta}
      </button>
    ) : null}
  </div>
);

export const statusColor = (c: string) => ({ borderColor: chipBorder(c), color: c });

// ---------- фирменные знаки вместо системных эмодзи ----------
// Системный эмодзи рисовала Apple, а не мы: в продукте с собственной
// графикой он читается вставкой из чужого набора. Здесь один источник —
// наш пак, и там, где знак несёт действие, он же и есть кнопка.
export const STK = {
  check: "/brand/emoji4/check-256.png",
  live: "/brand/emoji4/live-256.png",
  speaker: "/brand/emoji4/speaker-256.png",
  calendar: "/brand/emoji4/calendar-256.png",
  ticket: "/brand/emoji4/ticket-256.png",
  pin: "/brand/emoji4/pin-256.png",
  star: "/brand/emoji4/star-256.png",
  gift: "/brand/emoji4/gift-256.png",
  trophy: "/brand/emoji4/trophy-256.png",
  crown: "/brand/emoji4/crown2-256.png",
  handshake: "/brand/emoji4/handshake-256.png",
  rocket: "/brand/emoji4/rocket-256.png",
  camera: "/brand/emoji4/camera-256.png",
  mic: "/brand/emoji4/mic-256.png",
  headphones: "/brand/emoji4/headphones2-256.png",
  champagne: "/brand/emoji4/champagne2-256.png",
  map: "/brand/emoji4/islandmap-256.png",
  door: "/brand/emoji4/door-256.png",
  clock: "/brand/emoji4/clock-256.png",
  medal: "/brand/emoji4/medal-256.png",
  cocktail: "/brand/emoji4/cocktail-256.png",
  dance: "/brand/emoji4/dance-256.png",
  disco: "/brand/emoji4/discoball2-256.png",
  palm: "/brand/emoji4/palm-256.png",
  sunset: "/brand/emoji4/sunset-256.png",
  moon: "/brand/emoji4/moon-256.png",
  notes: "/brand/emoji4/notes-256.png",
  vinyl: "/brand/emoji4/vinyl-256.png",
  equalizer: "/brand/emoji4/equalizer-256.png",
  fader: "/brand/emoji4/fader-256.png",
  hundred: "/brand/emoji4/hundred-256.png",
  bomb: "/brand/emoji4/bomb-256.png",
} as const;

export type StkName = keyof typeof STK;

export const Stk = ({
  name,
  size,
  x2,
  alt = "",
}: {
  name: StkName;
  size?: number;
  /** двойной размер: знак несёт вес наравне с подписью, а не сопровождает её */
  x2?: boolean;
  alt?: string;
}) => (
  <img
    className={`gtr-stk${x2 ? " gtr-stk-2x" : ""}`}
    src={STK[name]}
    alt={alt}
    aria-hidden={alt ? undefined : true}
    loading="lazy"
    style={size ? { width: size, height: size } : undefined}
  />
);

/** Кнопка, которой и является сам знак: подложки нет, есть отклик и свечение. */
export const StkBtn = ({
  name,
  children,
  onClick,
  tone,
  disabled,
  title,
}: {
  name: StkName;
  children: ReactNode;
  onClick?: () => void;
  tone?: "ok";
  disabled?: boolean;
  title?: string;
}) => (
  <button
    type="button"
    className={`gtr-stk-btn${tone ? ` ${tone}` : ""}`}
    onClick={onClick}
    disabled={disabled}
    title={title}
  >
    <Stk name={name} />
    <span>{children}</span>
  </button>
);

// ---------- знак площадки ----------
// Логотипы собраны с официальных сайтов заведений (scripts/venue-logos.py),
// паспорт каждого лежит в venue-logos.json. Ставить их «как есть» нельзя:
// половина знаков нарисована тёмным по светлому и на нашем фоне просто
// исчезнет. Поэтому знак сам решает, на чём ему лежать:
//
//   light  — светлый, ложится прямо на тёмный фон продукта;
//   dark   — тёмный, получает светлую плашку, иначе не виден;
//   mixed  — двухцветный (у NORA рисунок оранжевый, надпись чёрная),
//            тоже на светлую плашку — иначе пропадает половина;
//   plate  — знак пришёл со своей сплошной подложкой, её и держим.
import LOGOS_RAW from "./data/venue-logos.json";

type LogoRec = {
  file: string;
  w: number;
  h: number;
  plate: string | null;
  tone: string;
  onDark: boolean;
  name: string;
  own: boolean;
};
const LOGOS = LOGOS_RAW as unknown as Record<string, LogoRec>;

export const hasVenueLogo = (vid: string): boolean => Boolean(LOGOS[vid]);

export const VenueLogo = ({
  vid,
  h = 26,
  title,
  style,
}: {
  vid: string;
  /** высота знака в точках; ширина считается из пропорций файла */
  h?: number;
  title?: string;
  style?: CSSProperties;
}) => {
  const L = LOGOS[vid];
  if (!L) return null;
  const pad = Math.round(h * 0.22);
  const needsPlate = L.tone !== "light";
  const bg = L.plate ?? (needsPlate ? "rgba(255,255,255,.94)" : undefined);
  return (
    <span
      title={title ?? L.name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        padding: bg ? `${Math.round(pad * 0.7)}px ${pad}px` : 0,
        // Тень нужна только тому знаку, что лежит прямо на фоне: плашка
        // и так отделяет его от подложки.
        filter: bg ? undefined : "drop-shadow(0 1px 5px rgba(0,0,0,.7))",
        ...style,
      }}
    >
      <img
        src={L.file}
        alt={L.name}
        loading="lazy"
        style={{ height: h, width: "auto", maxWidth: h * 4.2, objectFit: "contain", display: "block" }}
      />
    </span>
  );
};
