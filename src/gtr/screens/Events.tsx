// Список событий и создание нового с нуля.
// До этого экрана событие было намертво привязано к площадке в единственном
// экземпляре — создать второе или начать с чистого листа было нечем.
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  computeQuote,
  draftTitle,
  fmtThb,
  PH,
  STAGE_COLOR,
  STAGE_LABEL,
  V,
  venueGraph,
  type EventStage,
} from "../data/app-data";
import { vibeOf } from "../data/brief";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

const FORMATS = [
  "Клубная ночь",
  "Концерт / шоу",
  "Свадьба",
  "Корпоратив",
  "Конференция",
  "Частная вечеринка",
  "Бренд-активация",
];

export function EventsScreen() {
  const { user, drafts, createDraft, deleteDraft } = useGtr();
  const navigate = useNavigate();

  // GTR-админ видит и создаёт события по всей сети, роль площадки — только свои
  const isAdmin = user.role === "gtr";
  const scoped = useMemo(
    () => (isAdmin ? drafts : drafts.filter((d) => d.venueId === user.venueId)),
    [drafts, isAdmin, user.venueId],
  );

  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | EventStage>("all");
  const [creating, setCreating] = useState(false);

  const list = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return scoped
      .filter((d) => {
        if (stage !== "all" && (d.graph.stage ?? "draft") !== stage) return false;
        if (!needle) return true;
        const v = V(d.venueId);
        return `${draftTitle(d)} ${d.format} ${v.name ?? ""} ${d.venueId}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.updated - a.updated);
  }, [scoped, q, stage]);

  const open = (id: string) =>
    navigate({
      to: "/gtr/$screen",
      params: { screen: "constructor" },
      search: { draft: id },
    });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: scoped.length };
    for (const d of scoped) {
      const s = d.graph.stage ?? "draft";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [scoped]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <h1 className="gtr-oswald" style={{ font: "700 22px/1 Oswald,sans-serif", margin: 0 }}>
          События
        </h1>
        <Chip color="rgba(255,255,255,.5)">{scoped.length}</Chip>
        <button
          className="gtr-btn gtr-btn-red"
          style={{ marginLeft: "auto", padding: "9px 15px" }}
          onClick={() => setCreating((x) => !x)}
        >
          {creating ? "Отмена" : "+ Новое событие"}
        </button>
      </div>

      {creating ? (
        <NewEvent
          isAdmin={isAdmin}
          ownVenue={user.venueId}
          onCancel={() => setCreating(false)}
          onCreate={(venueId, format, title) => {
            const id = createDraft({
              venueId,
              format,
              title,
              graph: venueGraph(venueId),
            });
            setCreating(false);
            open(id);
          }}
        />
      ) : null}

      {/* ---------- фильтры ---------- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input
          className="gtr-input"
          style={{ maxWidth: 300, padding: "8px 11px", fontSize: 12 }}
          placeholder="Событие, формат или площадка…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", "draft", "sent", "approved"] as const).map((s) => {
          const on = stage === s;
          const color = s === "all" ? "#fff" : STAGE_COLOR[s];
          return (
            <button
              key={s}
              onClick={() => setStage(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                borderRadius: 7,
                padding: "7px 12px",
                cursor: "pointer",
                font: `${on ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
                border: `1px solid ${on ? color : "rgba(255,255,255,.12)"}`,
                background: on ? `${color}22` : "transparent",
                color: on ? "#fff" : "rgba(255,255,255,.6)",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
              {s === "all" ? "Все" : STAGE_LABEL[s]}
              <span className="gtr-mono" style={{ fontSize: 9.5, opacity: 0.6 }}>
                {counts[s] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------- список ---------- */}
      {!list.length ? (
        <Card style={{ padding: "30px 24px", textAlign: "center" }}>
          <div style={{ font: "500 12.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {scoped.length
              ? "Под фильтр ничего не подошло."
              : "Событий пока нет. Создайте первое — площадка, зал и слот подставятся из базы."}
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.map((d) => {
            const v = V(d.venueId);
            const st = d.graph.stage ?? "draft";
            const quote = computeQuote(d.graph, d.venueId);
            const rooms = d.graph.nodes.filter((n) => n.kind === "room").length;
            const artists = d.graph.nodes.filter((n) => n.kind === "artist").length;
            const vendors = d.graph.nodes.filter((n) =>
              ["sound", "light", "decor", "content"].includes(n.kind),
            ).length;
            const vibe = vibeOf(d.format, d.brief ?? {});
            return (
              <Card
                key={d.id}
                hover
                onClick={() => open(d.id)}
                style={{
                  padding: "16px 18px",
                  display: "grid",
                  gap: 9,
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* полоса вайба: направление события видно в списке с одного взгляда */}
                {vibe?.colors ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      background: `linear-gradient(90deg, ${vibe.colors[0]}, ${vibe.colors[1]})`,
                    }}
                  />
                ) : null}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                >
                  <span style={{ font: "600 14px/1.3 'Golos Text',sans-serif" }}>
                    {draftTitle(d)}
                  </span>
                  <Chip color={STAGE_COLOR[st]}>{STAGE_LABEL[st].toUpperCase()}</Chip>
                  {vibe?.colors ? (
                    <span
                      className="gtr-mono"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        borderRadius: 99,
                        padding: "4px 9px",
                        font: "600 9px/1 'JetBrains Mono',monospace",
                        letterSpacing: ".05em",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,.12)",
                        background: `linear-gradient(120deg, ${vibe.colors[0]}44, ${vibe.colors[1]}44)`,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: `linear-gradient(120deg, ${vibe.colors[0]}, ${vibe.colors[1]})`,
                        }}
                      />
                      {vibe.label.toUpperCase()}
                    </span>
                  ) : null}
                  <span
                    className="gtr-mono"
                    style={{
                      marginLeft: "auto",
                      font: "700 13px/1 'JetBrains Mono',monospace",
                      color: quote.total ? "#fff" : "var(--gtr-t3)",
                    }}
                  >
                    {quote.total ? fmtThb(quote.total) : "смета пуста"}
                  </span>
                </div>

                <div
                  className="gtr-mono"
                  style={{
                    font: "500 10px/1.5 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                    display: "flex",
                    gap: 14,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {v.name ?? d.venueId} · {d.venueId}
                  </span>
                  <span>залов: {rooms}</span>
                  <span>артистов: {artists}</span>
                  <span>подрядчиков: {vendors}</span>
                  {d.date ? <span>{d.date}</span> : null}
                  {d.guests ? <span>{d.guests} гостей</span> : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    borderTop: "1px solid rgba(255,255,255,.06)",
                    paddingTop: 9,
                  }}
                >
                  <span
                    className="gtr-mono"
                    style={{ font: "500 9.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {d.author || "GTR"}
                    {d.updated ? ` · изменено ${new Date(d.updated).toLocaleDateString("ru-RU")}` : ""}
                  </span>
                  <button
                    className="gtr-btn"
                    style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 10.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      createDraft({
                        venueId: d.venueId,
                        format: d.format,
                        title: `${draftTitle(d)} — копия`,
                        guests: d.guests,
                        graph: structuredClone(d.graph),
                        brief: { ...d.brief },
                      });
                    }}
                  >
                    Дублировать
                  </button>
                  <button
                    className="gtr-btn"
                    style={{ padding: "5px 10px", fontSize: 10.5, color: "#E5231B" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Удалить событие «${draftTitle(d)}»? Отменить будет нельзя.`))
                        deleteDraft(d.id);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- создание события ----------
function NewEvent({
  isAdmin,
  ownVenue,
  onCancel,
  onCreate,
}: {
  isAdmin: boolean;
  ownVenue: string;
  onCancel: () => void;
  onCreate: (venueId: string, format: string, title: string) => void;
}) {
  const [venueId, setVenueId] = useState(isAdmin ? "" : ownVenue);
  const [format, setFormat] = useState("");
  const [title, setTitle] = useState("");
  const [vq, setVq] = useState("");

  // Админ выбирает любую из 97 площадок, роль площадки — только свою
  const venues = useMemo(() => {
    const needle = vq.toLowerCase().trim();
    const all = isAdmin ? PH.venues : PH.venues.filter((v) => v.id === ownVenue);
    if (!needle) return all.slice(0, 8);
    return all
      .filter((v) => `${v.name} ${v.id} ${v.area} ${v.cluster}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [vq, isAdmin, ownVenue]);

  const picked = venueId ? V(venueId) : null;
  const ready = Boolean(venueId && format);

  return (
    <Card style={{ padding: "20px 22px", marginBottom: 16, display: "grid", gap: 16 }}>
      <Eyebrow>НОВОЕ СОБЫТИЕ</Eyebrow>

      {/* шаг 1 — площадка */}
      <div style={{ display: "grid", gap: 7 }}>
        <span style={{ font: "600 11.5px/1 'Golos Text',sans-serif" }}>1. Площадка</span>
        {picked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Chip color="#E5231B">{picked.id}</Chip>
            <span style={{ font: "500 12.5px/1.3 'Golos Text',sans-serif" }}>{picked.name}</span>
            <span
              className="gtr-mono"
              style={{ font: "500 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              {picked.type} · {picked.area}
            </span>
            {isAdmin ? (
              <button
                className="gtr-btn"
                style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 10.5 }}
                onClick={() => setVenueId("")}
              >
                Изменить
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <input
              className="gtr-input"
              style={{ padding: "8px 11px", fontSize: 12 }}
              placeholder="Поиск по 97 площадкам: название, район, ID…"
              value={vq}
              onChange={(e) => setVq(e.target.value)}
            />
            <div style={{ display: "grid", gap: 5 }}>
              {venues.map((v) => (
                <button
                  key={v.id}
                  className="gtr-pal-btn"
                  style={{ padding: "8px 10px" }}
                  onClick={() => setVenueId(v.id)}
                >
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 11.5 }}>
                      {v.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        font: "500 9px/1.3 'JetBrains Mono',monospace",
                        color: "rgba(255,255,255,.4)",
                      }}
                    >
                      {v.id} · {v.type} · {v.cluster}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* шаг 2 — формат */}
      <div style={{ display: "grid", gap: 7 }}>
        <span style={{ font: "600 11.5px/1 'Golos Text',sans-serif" }}>2. Формат события</span>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {FORMATS.map((f) => {
            const on = format === f;
            return (
              <button
                key={f}
                onClick={() => setFormat(f)}
                style={{
                  borderRadius: 7,
                  padding: "7px 12px",
                  cursor: "pointer",
                  font: `${on ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
                  border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                  background: on ? "rgba(229,35,27,.14)" : "transparent",
                  color: on ? "#fff" : "rgba(255,255,255,.6)",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* шаг 3 — название */}
      <div style={{ display: "grid", gap: 7 }}>
        <span style={{ font: "600 11.5px/1 'Golos Text',sans-serif" }}>
          3. Название <span style={{ color: "var(--gtr-t3)", fontWeight: 500 }}>— необязательно</span>
        </span>
        <input
          className="gtr-input"
          style={{ padding: "8px 11px", fontSize: 12 }}
          placeholder={format ? `${format} · ${picked?.name ?? ""}` : "Например: Открытие сезона"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="gtr-btn gtr-btn-red"
          style={{ padding: "9px 16px", opacity: ready ? 1 : 0.4 }}
          disabled={!ready}
          onClick={() => onCreate(venueId, format, title.trim())}
        >
          Создать и открыть конструктор →
        </button>
        <button className="gtr-btn" style={{ padding: "9px 14px" }} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </Card>
  );
}
