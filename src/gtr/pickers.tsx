// Пикеры мастера заявки: календарь даты и регулятор вместимости.
// Нативный input[type=date] в тёмной теме выглядит инородно и ведёт себя
// по-разному в iOS/Android — рисуем свой месячный календарь в геометрии
// дизайн-системы (90°, моно-подписи, красный выбор).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// «21 авг 2026» — так дата пишется в списках и слоте графа
export const humanDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
};

export function GtrCalendar({
  value,
  onChange,
}: {
  value: string; // ISO YYYY-MM-DD или ""
  onChange: (isoDate: string) => void;
}) {
  const { t } = useTranslation();
  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const start = value ? new Date(`${value}T12:00:00`) : today;
  const [ym, setYm] = useState<[number, number]>([start.getFullYear(), start.getMonth()]);
  const [y, m] = ym;

  const cells = useMemo(() => {
    const first = new Date(y, m, 1);
    const shift = (first.getDay() + 6) % 7; // неделя с понедельника
    const days = new Date(y, m + 1, 0).getDate();
    const list: (number | null)[] = Array.from({ length: shift }, () => null);
    for (let d = 1; d <= days; d++) list.push(d);
    return list;
  }, [y, m]);

  const nav = (dir: -1 | 1) => {
    const next = new Date(y, m + dir, 1);
    setYm([next.getFullYear(), next.getMonth()]);
  };
  const atPast = y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth());

  return (
    <div className="gtr-cal">
      <div className="gtr-cal-head">
        <button
          type="button"
          className="gtr-cal-nav"
          onClick={() => nav(-1)}
          disabled={atPast}
          aria-label={t("Предыдущий месяц")}
        >
          ‹
        </button>
        <span className="gtr-cal-title">
          {MONTHS[m]} <b>{y}</b>
        </span>
        <button type="button" className="gtr-cal-nav" onClick={() => nav(1)} aria-label={t("Следующий месяц")}>
          ›
        </button>
      </div>
      <div className="gtr-cal-grid gtr-cal-week">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="gtr-cal-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const dIso = iso(y, m, d);
          const past = dIso < todayIso;
          const on = dIso === value;
          return (
            <button
              key={dIso}
              type="button"
              className={`gtr-cal-day${on ? " on" : ""}${dIso === todayIso ? " today" : ""}`}
              disabled={past}
              onClick={() => onChange(on ? "" : dIso)}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Регулятор вместимости: чипы типовых размеров + плавный ползунок.
// Значение — число гостей; 0 значит «не задано».
const CAP_STOPS = [50, 100, 200, 300, 500, 800, 1200];

export function GtrCapacity({
  value,
  onChange,
  max = 1500,
}: {
  value: number;
  onChange: (guests: number) => void;
  max?: number;
}) {
  const pct = Math.min(100, Math.max(0, ((value - 10) / (max - 10)) * 100));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          className="gtr-mono"
          style={{
            font: "700 26px/1 'JetBrains Mono',monospace",
            color: value ? "#fff" : "var(--gtr-t3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value || "—"}
        </span>
        <span style={{ font: "500 13px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          {value ? "гостей — под это число подберутся площадки и залы" : "гостей: сдвиньте регулятор"}
        </span>
      </div>
      <input
        type="range"
        className="gtr-range"
        min={10}
        max={max}
        step={10}
        value={value || 10}
        style={{ ["--gtr-pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CAP_STOPS.map((s) => {
          const on = value === s;
          return (
            <button
              key={s}
              type="button"
              className="gtr-mono"
              onClick={() => onChange(on ? 0 : s)}
              style={{
                borderRadius: 0,
                padding: "5px 10px",
                cursor: "pointer",
                font: `${on ? 700 : 500} 10px/1 'JetBrains Mono',monospace`,
                border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.14)"}`,
                background: on ? "rgba(229,35,27,.16)" : "transparent",
                color: on ? "#fff" : "rgba(255,255,255,.55)",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
