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
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: "none" }}
  >
    {d.split(" M").map((p, i) => (
      <path key={i} d={(i ? "M" : "") + p} />
    ))}
  </svg>
);

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

export const Dot = ({ color, top = 4 }: { color: string; top?: number }) => (
  <span
    style={{
      width: 7,
      height: 7,
      borderRadius: "50%",
      flex: "none",
      marginTop: top,
      background: color,
      display: "inline-block",
    }}
  />
);

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="gtr-eyebrow" style={style}>
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

// Кольцо готовности каталога
export const Ring = ({ value, size = 118 }: { value: number; size?: number }) => {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 70 ? GREEN : value >= 45 ? AMBER : RED;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,.08)"
          strokeWidth={9}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          style={{
            transition: "stroke-dashoffset .8s ease",
            filter: `drop-shadow(0 0 6px ${color}66)`,
          }}
        />
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
        <div className="gtr-mono" style={{ font: "700 26px/1 'JetBrains Mono',monospace", color }}>
          {value}
        </div>
        <div className="gtr-eyebrow" style={{ fontSize: 8.5, marginTop: 4 }}>
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
      padding: "16px 20px",
      borderBottom: "1px solid rgba(255,255,255,.05)",
    }}
  >
    <div
      className="gtr-oswald"
      style={{ font: "600 14px/1 Oswald,sans-serif", letterSpacing: ".04em" }}
    >
      {title}
    </div>
    {cta ? (
      <button className="gtr-btn" onClick={onCta}>
        {cta}
      </button>
    ) : null}
  </div>
);

export const statusColor = (c: string) => ({ borderColor: chipBorder(c), color: c });
