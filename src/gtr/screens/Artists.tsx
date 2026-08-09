import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AMBER, GREEN, loadArtists, RIDERS, type Artist, type ArtistBase } from "../data/app-data";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

const KIND_LABEL: Record<string, string> = {
  all: "Все записи",
  artist: "Артисты и DJ",
  live: "Лайв-составы",
  agency: "Агентства и промо",
  team: "Лейблы и менеджмент",
  venue: "Маршруты площадок",
  community: "Комьюнити",
};

const POOL_LABEL: Record<string, string> = {
  all: "Все пулы",
  "Phuket Priority": "Пхукет · приоритет",
  "Phuket Community": "Локальная сцена",
  "Phuket Venue Acts": "Гости площадок",
  "Thailand Artists": "Таиланд",
  "CIS Bookable": "СНГ",
  "Producers & Managers": "Продюсеры и менеджмент",
};

const LINKS: [keyof Artist, string][] = [
  ["sp", "Spotify"],
  ["sc", "SoundCloud"],
  ["yt", "YouTube"],
  ["bp", "Beatport"],
  ["ig", "Instagram"],
  ["web", "Сайт"],
];

export function ArtistsScreen({ artistId }: { artistId?: string }) {
  const [base, setBase] = useState<ArtistBase | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [pool, setPool] = useState("all");
  const [style, setStyle] = useState("all");
  const navigate = useNavigate();
  const { shared, setLineup } = useGtr();

  useEffect(() => {
    loadArtists().then(setBase);
  }, []);

  const openArtist = (id?: string) =>
    navigate({
      to: "/gtr/$screen",
      params: { screen: "artists" },
      search: id ? { artist: id } : {},
    });

  const filtered = useMemo(() => {
    if (!base) return [];
    const qq = q.toLowerCase().trim();
    const rank = (p: string) => (p === "A" ? 0 : p === "B" ? 1 : 2);
    return base.artists
      .filter((a) => {
        if (kind !== "all" && a.kind !== kind) return false;
        if (pool !== "all" && a.group !== pool) return false;
        if (style !== "all" && !(a.styles || []).includes(style)) return false;
        if (qq && !`${a.name} ${a.role} ${(a.styles || []).join(" ")}`.toLowerCase().includes(qq))
          return false;
        return true;
      })
      .sort((a, b) => rank(a.prio) - rank(b.prio) || a.name.localeCompare(b.name, "ru"));
  }, [base, q, kind, pool, style]);

  if (!base)
    return (
      <div
        className="gtr-mono"
        style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,.4)" }}
      >
        Загрузка базы артистов…
      </div>
    );

  const selected = artistId ? base.artists.find((a) => a.id === artistId) : null;
  if (selected) return <ArtistCard a={selected} onBack={() => openArtist()} />;

  const topStyles = base.meta.styles.slice(0, 14);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h1 className="gtr-oswald" style={{ font: "700 22px/1 Oswald,sans-serif", margin: 0 }}>
          Артисты и диджеи
        </h1>
        <span
          className="gtr-mono"
          style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {filtered.length} / {base.meta.total}
        </span>
        {shared.lineup.length ? (
          <Chip color="#7B4DFF">В ЛАЙНАПЕ: {shared.lineup.length}</Chip>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input
          className="gtr-input"
          style={{ maxWidth: 260 }}
          placeholder="Поиск по имени и стилю…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="gtr-input"
          style={{ maxWidth: 190 }}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="gtr-input"
          style={{ maxWidth: 210 }}
          value={pool}
          onChange={(e) => setPool(e.target.value)}
        >
          {Object.entries(POOL_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l} {k !== "all" && base.meta.byGroup[k] ? `· ${base.meta.byGroup[k]}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[["all", filtered.length] as [string, number], ...topStyles].map(([s, n]) => (
          <button
            key={s}
            onClick={() => setStyle(String(s))}
            style={{
              border: `1px solid ${style === s ? "#E5231B" : "rgba(255,255,255,.12)"}`,
              background: style === s ? "rgba(229,35,27,.14)" : "transparent",
              color: style === s ? "#fff" : "rgba(255,255,255,.55)",
              borderRadius: 7,
              padding: "6px 10px",
              cursor: "pointer",
              font: "500 10.5px/1 'Golos Text',sans-serif",
            }}
          >
            {s === "all" ? "Все стили" : `${s} · ${n}`}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))",
          gap: 11,
        }}
      >
        {filtered.slice(0, 90).map((a) => (
          <Card key={a.id} hover style={{ padding: "14px 16px" }} onClick={() => openArtist(a.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ font: "600 13px/1.25 'Golos Text',sans-serif", flex: 1, minWidth: 0 }}>
                {a.name}
              </span>
              <Chip
                color={a.prio === "A" ? GREEN : a.prio === "B" ? AMBER : "rgba(255,255,255,.4)"}
              >
                {a.prio || "—"}
              </Chip>
            </div>
            <div
              style={{
                margin: "6px 0",
                font: "500 10.5px/1.4 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {(a.styles || []).slice(0, 3).join(" · ") || a.role}
            </div>
            <div
              className="gtr-mono"
              style={{ font: "500 9.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              {a.tier || a.cat} · {a.base || "—"}
            </div>
          </Card>
        ))}
      </div>
      {filtered.length > 90 ? (
        <div
          className="gtr-mono"
          style={{ marginTop: 14, textAlign: "center", color: "var(--gtr-t3)", fontSize: 11 }}
        >
          Показаны первые 90 — уточните фильтры
        </div>
      ) : null}
    </div>
  );
}

function ArtistCard({ a, onBack }: { a: Artist; onBack: () => void }) {
  const { shared, setLineup } = useGtr();
  const inLineup = shared.lineup.includes(a.id);
  const rider = a.rider ? RIDERS[a.rider] : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button className="gtr-btn" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Ко всем артистам
      </button>

      <Card
        style={{ position: "relative", overflow: "hidden", padding: "24px 26px", marginBottom: 16 }}
      >
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>{a.catRu ? String(a.catRu) : a.cat}</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <h1
              className="gtr-oswald"
              style={{ font: "700 28px/1.05 Oswald,sans-serif", margin: 0 }}
            >
              {a.name}
            </h1>
            <Chip color={a.prio === "A" ? GREEN : a.prio === "B" ? AMBER : "rgba(255,255,255,.4)"}>
              ПРИОРИТЕТ {a.prio || "—"}
            </Chip>
            {a.tier ? <Chip color="#7B4DFF">{a.tier.toUpperCase()}</Chip> : null}
          </div>
          <div
            style={{
              marginTop: 9,
              font: "500 12px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {a.role}
          </div>
          {a.rel ? (
            <div
              className="gtr-mono"
              style={{
                marginTop: 6,
                font: "500 10.5px/1.4 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              {String(a.relRu || a.rel)}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            {(a.styles || []).map((s) => (
              <Chip key={s} color="rgba(255,255,255,.55)">
                {s}
              </Chip>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button
              className={`gtr-btn ${inLineup ? "" : "gtr-btn-red"}`}
              onClick={() =>
                setLineup((ids) => (inLineup ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
              }
            >
              {inLineup ? "Убрать из лайнапа" : "+ В лайнап события"}
            </button>
            {LINKS.filter(([k]) => a[k]).map(([k, label]) => (
              <a
                key={String(k)}
                className="gtr-btn"
                style={{ textDecoration: "none" }}
                href={String(a[k])}
                target="_blank"
                rel="noreferrer"
              >
                {label} ↗
              </a>
            ))}
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>КОНТАКТ И БУКИНГ</Eyebrow>
          {[
            ["Статус", String(a.statusRu || a.status || "—")],
            ["Менеджмент", String(a.mgmtRu || a.mgmt || "—")],
            ["База", String(a.baseRu || a.base || "—")],
            ["Телефон", a.phone || "—"],
            ["Email", a.email || "—"],
            ["Верифицировано", a.verified || "—"],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                gap: 10,
                padding: "7px 0",
                borderBottom: "1px solid rgba(255,255,255,.05)",
              }}
            >
              <span className="gtr-eyebrow" style={{ width: 120, flex: "none", paddingTop: 2 }}>
                {k}
              </span>
              <span
                style={{
                  font: "500 11.5px/1.5 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                  wordBreak: "break-word",
                }}
              >
                {v}
              </span>
            </div>
          ))}
          {a.evidence ? (
            <div
              style={{
                marginTop: 10,
                font: "500 10.5px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              {String(a.evidenceRu || a.evidence)}
            </div>
          ) : null}
        </Card>

        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>
            РАЙДЕР · {rider ? rider.label.toUpperCase() : "НЕ ПРИМЕНЯЕТСЯ"}
          </Eyebrow>
          {rider ? (
            <>
              <div className="gtr-eyebrow" style={{ margin: "8px 0 6px", color: "#22D3C7" }}>
                ТЕХНИЧЕСКИЙ
              </div>
              {rider.tech.map((t) => (
                <div
                  key={t}
                  style={{
                    font: "500 10.5px/1.55 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                    padding: "2px 0",
                  }}
                >
                  · {t}
                </div>
              ))}
              <div className="gtr-eyebrow" style={{ margin: "12px 0 6px", color: "#FFD166" }}>
                ГОСТЕПРИИМСТВО
              </div>
              {rider.hosp.map((t) => (
                <div
                  key={t}
                  style={{
                    font: "500 10.5px/1.55 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                    padding: "2px 0",
                  }}
                >
                  · {t}
                </div>
              ))}
            </>
          ) : (
            <div style={{ font: "500 11px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              Для этой записи шаблон райдера GTR не назначен.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
