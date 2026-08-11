import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AMBER, CONTACT, GREEN, PH, RED, richOf, SPACES, V } from "../data/app-data";
import { EditableImage } from "../EditableImage";
import { Card, Chip, Eyebrow, Field } from "../ui";

const confColor = (c: string) => (c === "High" ? GREEN : c === "Medium" ? AMBER : RED);
const isQuar = (x: { confidence: string; status?: string }) =>
  x.confidence === "Low" || /verify|Closed/i.test(x.status || "");

export function BaseScreen() {
  const navigate = useNavigate();
  const [cluster, setCluster] = useState("Все");
  const [tag, setTag] = useState("Все");
  const [q, setQ] = useState("");

  const { clusters, tags } = useMemo(() => {
    const c: Record<string, number> = {};
    const t: Record<string, number> = {};
    for (const x of PH.venues) {
      c[x.cluster] = (c[x.cluster] || 0) + 1;
      t[x.tag] = (t[x.tag] || 0) + 1;
    }
    return {
      clusters: Object.entries(c).sort((a, b) => b[1] - a[1]),
      tags: Object.entries(t).sort((a, b) => b[1] - a[1]),
    };
  }, []);

  const rows = PH.venues
    .filter(
      (x) =>
        !isQuar(x) &&
        (cluster === "Все" || x.cluster === cluster) &&
        (tag === "Все" || x.tag === tag) &&
        (!q.trim() ||
          `${x.name} ${x.area} ${x.type}`.toLowerCase().includes(q.toLowerCase().trim())),
    )
    .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));

  const FilterRow = ({
    items,
    value,
    onPick,
  }: {
    items: [string, number][];
    value: string;
    onPick: (v: string) => void;
  }) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[["Все", PH.venues.length] as [string, number], ...items].map(([label, n]) => (
        <button
          key={label}
          onClick={() => onPick(label)}
          style={{
            border: `1px solid ${value === label ? "#E5231B" : "rgba(255,255,255,.12)"}`,
            background: value === label ? "#E5231B" : "transparent",
            color: value === label ? "#fff" : "rgba(255,255,255,.6)",
            borderRadius: 0,
            padding: "7px 11px",
            cursor: "pointer",
            font: `${value === label ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
          }}
        >
          {label} · {n}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h1 className="gtr-oswald gtr-h1">
          База · Пхукет
        </h1>
        <span
          className="gtr-mono"
          style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {rows.length} / {PH.meta.total} · обновлено {PH.meta.updated}
        </span>
      </div>
      <div style={{ margin: "12px 0 8px" }}>
        <FilterRow items={clusters} value={cluster} onPick={setCluster} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <FilterRow items={tags} value={tag} onPick={setTag} />
      </div>
      <input
        className="gtr-input"
        style={{ maxWidth: 300, marginBottom: 16 }}
        placeholder="Поиск по названию и району…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        {rows.map((x) => (
          <Card
            key={x.id}
            hover
            style={{ padding: "15px 17px" }}
            onClick={() =>
              navigate({
                to: "/gtr/$screen",
                params: { screen: "venueCard" },
                search: { vid: x.id },
              })
            }
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span
                style={{ flex: 1, minWidth: 0, font: "600 13.5px/1.3 'Golos Text',sans-serif" }}
              >
                {x.name}
              </span>
              {x.readiness ? (
                <span
                  className="gtr-mono"
                  style={{
                    font: "700 14px/1 'JetBrains Mono',monospace",
                    color:
                      x.readiness.score >= 70
                        ? GREEN
                        : x.readiness.score >= 55
                          ? AMBER
                          : "var(--gtr-t3)",
                  }}
                >
                  {x.readiness.score}
                </span>
              ) : null}
            </div>
            <div
              style={{
                margin: "6px 0 8px",
                font: "500 10.5px/1.45 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {x.type} · {x.area}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip color="rgba(255,255,255,.5)">{x.tag.toUpperCase()}</Chip>
              <Chip color={confColor(x.confidence)}>{x.confidence.toUpperCase()}</Chip>
              {x.readiness?.state === "Бронируемая" ? <Chip color={GREEN}>БРОНИРУЕМАЯ</Chip> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function VenueCardScreen({ vid }: { vid?: string }) {
  const navigate = useNavigate();
  const v = vid ? V(vid) : undefined;
  if (!v?.id)
    return (
      <div
        className="gtr-mono"
        style={{ padding: 60, textAlign: "center", color: "var(--gtr-t3)" }}
      >
        Площадка не найдена.{" "}
        <button
          className="gtr-btn"
          onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
        >
          К базе
        </button>
      </div>
    );

  const rich = richOf(v.id);
  const sp = SPACES(v.id);
  const ct = CONTACT(v.id);
  const R = v.readiness;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <button
        className="gtr-btn"
        style={{ marginBottom: 14 }}
        onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
      >
        ← К базе Пхукета
      </button>

      <Card
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 26px",
          marginBottom: 16,
          minHeight: 140,
        }}
      >
        <EditableImage
          vid={v.id}
          fallback={rich.hero}
          alt={v.name}
          overlay="linear-gradient(90deg,#0A0B0Df2,#0A0B0D66)"
        />
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>
            {v.id} · {v.cluster.toUpperCase()}
          </Eyebrow>
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
              style={{ font: "700 27px/1.05 Oswald,sans-serif", margin: 0 }}
            >
              {v.name}
            </h1>
            <Chip color={confColor(v.confidence)}>ДОСТОВЕРНОСТЬ: {v.confidence.toUpperCase()}</Chip>
            {R ? (
              <Chip color={R.state === "Бронируемая" ? GREEN : AMBER}>{R.state.toUpperCase()}</Chip>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 9,
              font: "500 12px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {v.type} · {v.area} · {v.district}
          </div>
          {rich.credit ? (
            <div
              className="gtr-mono"
              style={{
                marginTop: 6,
                font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              фото: {rich.credit}
            </div>
          ) : null}
        </div>
      </Card>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}
      >
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 10 }}>ПРОФИЛЬ ПЛОЩАДКИ</Eyebrow>
            {[
              ["КОНЦЕПЦИЯ", v.concept],
              ["ФОРМАТЫ СОБЫТИЙ", v.events],
              ["ИНФРАСТРУКТУРА", v.facilities],
              ["ВМЕСТИМОСТЬ", v.capacity],
              ["МУЗЫКА", v.music],
              ["КЕЙТЕРИНГ", v.catering],
              ["ЗАМЕТКИ", v.notes],
            ]
              .filter(([, val]) => val)
              .map(([k, val]) => (
                <Field key={k} k={k} v={String(val)} />
              ))}
          </Card>

          {sp.length ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>НОРМАЛИЗОВАННЫЕ ЗАЛЫ · {sp.length}</Eyebrow>
              {sp.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "7px 0",
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                  }}
                >
                  <span style={{ flex: 1, font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                    {s.name}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "500 10px/1.3 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {[
                      s.sqm && `${s.sqm} м²`,
                      s.capTheatre && `${s.capTheatre} театр`,
                      s.capCocktail && `${s.capCocktail} коктейль`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}

          {rich.gallery?.length ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ ГАЛЕРЕЯ</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                {rich.gallery.slice(0, 8).map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    style={{
                      width: "100%",
                      aspectRatio: "3/2",
                      objectFit: "cover",
                      borderRadius: 0,
                      border: "1px solid rgba(255,255,255,.08)",
                    }}
                  />
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 10 }}>ИСТОЧНИКИ И КОНТАКТ</Eyebrow>
            {[
              [
                "Официальный сайт",
                v.website || v.source || "—",
                v.website || v.source ? GREEN : RED,
              ],
              ["Instagram", v.social || "не указан", v.social ? AMBER : "rgba(255,255,255,.3)"],
              ["Телефон", v.phone || ct?.phone || "—", v.phone || ct?.phone ? GREEN : RED],
              [
                "Email",
                v.email || ct?.email || "—",
                v.email || ct?.email ? GREEN : "rgba(255,255,255,.3)",
              ],
              ["Тип источника", v.sourceType, GREEN],
              ["Верифицировано", v.verified || "—", v.verified ? GREEN : RED],
            ].map(([k, val, c]) => (
              <Field
                key={String(k)}
                mono
                k={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 8, height: 8, flex: "none", background: String(c) }} />
                    {k}
                  </span>
                }
                v={String(val)}
              />
            ))}
          </Card>

          {R ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>
                ГОТОВНОСТЬ К БРОНИРОВАНИЮ · {R.score}/100
              </Eyebrow>
              {[
                ["Прайс-лист", R.rate, /Missing/i.test(R.rate) ? RED : GREEN],
                ["Доступность", R.avail, /Manual|enquiry|Proposal/i.test(R.avail) ? AMBER : GREEN],
                ["Договор", R.contract, /Missing/i.test(R.contract) ? RED : GREEN],
                ["Оплата", R.payment, /Missing/i.test(R.payment) ? RED : GREEN],
                ["Права на фото", R.photo, AMBER],
                ["Райдер", R.rider, /Published/i.test(R.rider) ? GREEN : AMBER],
                [
                  "Контакт подтверждён",
                  R.contactVerified,
                  R.contactVerified === "Yes" ? GREEN : AMBER,
                ],
              ].map(([k, val, c]) => (
                <div
                  key={String(k)}
                  style={{
                    display: "flex",
                    gap: 9,
                    padding: "7px 0",
                    alignItems: "baseline",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      flex: "none",
                      background: String(c),
                      boxShadow: `0 0 6px -1px ${String(c)}`,
                    }}
                  />
                  <span style={{ flex: 1, font: "500 11.5px/1.4 'Golos Text',sans-serif" }}>
                    {k}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 10px/1.4 'JetBrains Mono',monospace",
                      color: String(c),
                      textAlign: "right",
                      maxWidth: "46%",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {String(val)}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}

          {rich.afisha?.length ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ АФИША</Eyebrow>
              <div style={{ display: "grid", gap: 8 }}>
                {rich.afisha.map(([date, title, meta]) => (
                  <div
                    key={title + date}
                    style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                  >
                    <span
                      className="gtr-mono"
                      style={{
                        font: "700 10px/1.3 'JetBrains Mono',monospace",
                        color: "#E5231B",
                        width: 46,
                        flex: "none",
                      }}
                    >
                      {date}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span
                        style={{ display: "block", font: "600 11.5px/1.3 'Golos Text',sans-serif" }}
                      >
                        {title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "500 9.5px/1.4 'JetBrains Mono',monospace",
                          color: "var(--gtr-t3)",
                        }}
                      >
                        {meta}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
