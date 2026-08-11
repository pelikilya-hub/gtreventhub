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
}: {
  children: ReactNode;
  hover?: boolean;
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
}) => (
  <div
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
        <div className="gtr-eyebrow" style={{ fontSize: 8.5, marginTop: 5 }}>
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
