// Список событий и создание нового с нуля.
// До этого экрана событие было намертво привязано к площадке в единственном
// экземпляре — создать второе или начать с чистого листа было нечем.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  computeQuote,
  draftTitle,
  fmtThb,
  PH,
  RATE_COLOR,
  rateOf,
  STAGE_COLOR,
  STAGE_LABEL,
  SPACES,
  V,
  venueGraph,
  zonesOf,
  type EventStage,
  type Graph,
} from "../data/app-data";
import { BRIEF, vibeOf, vibeQuestionFor, type BriefAnswers } from "../data/brief";
import { buildPresetDraft, EVENT_PRESETS, presetBlockCount } from "../data/presets";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow, tint } from "../ui";
import { GtrCalendar, GtrCapacity, humanDate } from "../pickers";
import { ImpulseArt } from "../impulse";
import { venueConfirmsFn, type VenueConfirm } from "../kv-api";

const FORMATS = [
  "Клубная ночь",
  "Концерт / шоу",
  "Свадьба",
  "Корпоратив",
  "Конференция",
  "Частная вечеринка",
  "Бренд-активация",
];

export function EventsScreen({ newForVenue }: { newForVenue?: string } = {}) {
  const { user, myDrafts, createDraft, deleteDraft } = useGtr();
  const navigate = useNavigate();

  // Личный кабинет: менеджер видит только свои события, GTR-админ — все
  const isAdmin = user.role === "gtr";
  const scoped = myDrafts;

  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | EventStage>("all");
  // Паспорт площадки открывает мастер с выбранной площадкой;
  // vid="new" (кнопка кабинета) — мастер сразу, без преселекта
  const [creating, setCreating] = useState(Boolean(newForVenue));
  const presetVenue = newForVenue === "new" ? "" : newForVenue;

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
        <h1 className="gtr-oswald gtr-h1">
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
          ownVenue={presetVenue || user.venueId}
          onCancel={() => setCreating(false)}
          onCreate={(init) => {
            const id = createDraft(init);
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
                borderRadius: 0,
                padding: "7px 12px",
                cursor: "pointer",
                font: `${on ? 600 : 500} 10.5px/1 'JetBrains Mono',monospace`,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                border: `1px solid ${on ? tint(color, 0.55) : "rgba(255,255,255,.12)"}`,
                borderTop: `2px solid ${on ? color : "transparent"}`,
                background: on ? tint(color, 0.12) : "transparent",
                color: on ? "#fff" : "rgba(234,234,234,.55)",
                transition: "border-color .15s, background .15s, color .15s",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 0, background: color }} />
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
        <div className="gtr-seq" style={{ display: "grid", gap: 10 }}>
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
                  paddingLeft: 26,
                  display: "grid",
                  gap: 9,
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14 }}
                >
                  <ImpulseArt seed={d.id} density={0.4} />
                </div>
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
                        borderRadius: 0,
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
                          borderRadius: 0,
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
                    {isAdmin && d.owner ? ` (${d.owner})` : ""}
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
// Мастер заявки: сценарий → дата и время → вместимость → площадка → вайб →
// название. Дата и гости уходят в слот-узел графа, вместимость фильтрует
// подбор площадки.
const TIME_SLOTS = ["12:00", "16:00", "18:00", "19:00", "20:00", "22:00", "23:00"];

const spaceMeta = (sp: Record<string, unknown>) =>
  [sp.sqm && `${sp.sqm} м²`, sp.capTheatre && `${sp.capTheatre} театр`, sp.capCocktail && `${sp.capCocktail} коктейль`]
    .filter(Boolean)
    .join(" · ") || String(sp.type ?? "зал");

// Залы события = выбранные в брифе; остальные узлы-залы убираются, их связи
// переезжают на первый оставшийся зал. Зоны добавляются узлами с меткой ЗОНА.
const applyRooms = (g: Graph, keepNames: string[], zones: string[]): Graph => {
  const venue = g.nodes.find((n) => n.kind === "venue");
  if (keepNames.length) {
    const removed = g.nodes.filter((n) => n.kind === "room" && !keepNames.includes(n.title));
    const removedIds = new Set(removed.map((r) => r.id));
    if (removedIds.size) {
      g.nodes = g.nodes.filter((n) => !removedIds.has(n.id));
      const kept = g.nodes.filter((n) => n.kind === "room");
      const fallback = kept[0]?.id ?? venue?.id;
      g.links = g.links.flatMap((l) => {
        if (removedIds.has(l.from))
          return fallback && l.to !== fallback ? [{ from: fallback, to: l.to }] : [];
        if (removedIds.has(l.to)) return [];
        return [l];
      });
    }
  }
  const baseCount = g.nodes.filter((n) => n.kind === "room").length;
  zones.forEach((z, i) => {
    const id = `z${i + 1}`;
    g.nodes.push({
      id,
      kind: "room",
      x: 276,
      y: 26 + (baseCount + i) * 150,
      title: z,
      sub: "Зона площадки",
      badge: "ЗОНА",
      fields: [
        ["ТИП", "Зона"],
        ["ГДЕ", z],
      ],
    });
    if (venue) g.links.push({ from: venue.id, to: id });
  });

  // Блоки пресета (артисты, декор, промо-интерактив…) закрепляются за первым
  // залом события — или зоной, если залы площадки не нормализованы.
  // «Висящих в воздухе» блоков не остаётся.
  const firstRoom = g.nodes.find((n) => n.kind === "room");
  if (firstRoom) {
    const PLACEABLE = ["artist", "sound", "light", "decor", "content", "gear", "interactive"];
    for (const n of g.nodes) {
      if (!PLACEABLE.includes(n.kind)) continue;
      const hasRoomLink = g.links.some(
        (l) => l.to === n.id && g.nodes.find((x) => x.id === l.from)?.kind === "room",
      );
      if (!hasRoomLink) {
        g.links = g.links.filter((l) => l.to !== n.id);
        g.links.push({ from: firstRoom.id, to: n.id });
      }
      if (!n.fields.some((f) => f[0] === "ЗАЛ")) n.fields.push(["ЗАЛ", firstRoom.title]);
    }
  }
  return g;
};

const capOf = (s?: string) => {
  const m = String(s || "").match(/(\d[\d\s]*)/);
  return m ? parseInt(m[1].replace(/\s/g, ""), 10) : 0;
};

// Дата и время события записываются прямо в слот-узел графа
const stampSlot = (g: Graph, dateH: string, time: string): Graph => {
  if (!dateH && !time) return g;
  const n = g.nodes.find((x) => x.kind === "slot");
  if (!n) return g;
  n.title = dateH ? `${dateH}${time ? " · " + time : ""}` : n.title;
  n.sub = time ? `Начало в ${time}` : "Дата выбрана в заявке";
  n.badge = "СЛОТ";
  let seen = { d: false, t: false, st: false };
  n.fields = n.fields.map(([k, v]) => {
    if (k === "ДАТА") { seen.d = true; return ["ДАТА", dateH || v] as [string, string]; }
    if (k === "ВРЕМЯ") { seen.t = true; return ["ВРЕМЯ", time || v] as [string, string]; }
    if (k === "СТАТУС") { seen.st = true; return ["СТАТУС", "Выбран"] as [string, string]; }
    return [k, v] as [string, string];
  });
  if (!seen.d) n.fields.push(["ДАТА", dateH || "—"]);
  if (!seen.t) n.fields.push(["ВРЕМЯ", time || "—"]);
  return g;
};

function Step({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        className="gtr-mono"
        style={{
          font: "700 10px/1 'JetBrains Mono',monospace",
          color: "var(--gtr-red)",
          letterSpacing: ".08em",
        }}
      >
        {String(n).padStart(2, "0")}
      </span>
      <span style={{ font: "600 11.5px/1 'Golos Text',sans-serif" }}>{title}</span>
      {note ? (
        <span style={{ font: "500 10.5px/1.3 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          — {note}
        </span>
      ) : null}
    </span>
  );
}

function NewEvent({
  isAdmin,
  ownVenue,
  onCancel,
  onCreate,
}: {
  isAdmin: boolean;
  ownVenue: string;
  onCancel: () => void;
  onCreate: (init: {
    venueId: string;
    format: string;
    title: string;
    guests?: string;
    date?: string;
    dateIso?: string;
    graph: Graph;
    brief?: BriefAnswers;
  }) => void;
}) {
  // ownVenue приходит и из паспорта площадки — тогда он есть и у админа
  const [venueId, setVenueId] = useState(ownVenue || "");
  const [presetId, setPresetId] = useState<string | "blank" | "">("");
  const [vibeId, setVibeId] = useState("");
  const [format, setFormat] = useState(""); // для пустого события
  const [title, setTitle] = useState("");
  const [dateIso, setDateIso] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(0);
  const [vq, setVq] = useState("");
  const [cluster, setCluster] = useState("");
  const [roomsSel, setRoomsSel] = useState<string[]>([]);
  const [zonesSel, setZonesSel] = useState<string[]>([]);
  // Подтверждённые площадками прайсы — важнее наших оценок в подборе
  const [confirms, setConfirms] = useState<Record<string, VenueConfirm>>({});
  useEffect(() => {
    venueConfirmsFn().then((r) => setConfirms(r.confirms)).catch(() => {});
  }, []);

  const preset = EVENT_PRESETS.find((x) => x.id === presetId);
  const vibeQ = preset ? vibeQuestionFor(preset.format) : undefined;

  // Кластеры для фильтра подбора: топ районов сети по числу площадок
  const clusters = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const v of PH.venues) {
      const c = (v.cluster || v.area || "").trim();
      if (c) cnt.set(c, (cnt.get(c) ?? 0) + 1);
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, []);

  // Подбор площадки: поиск + район + автофит под вместимость.
  // Выбирать может любой кабинет — своя площадка лишь преселект
  // (раньше «пустое событие» намертво запирало площадку — это был баг).
  const canChoose = true;
  const venues = useMemo(() => {
    const needle = vq.toLowerCase().trim();
    const all = canChoose ? PH.venues : PH.venues.filter((v) => v.id === ownVenue);
    return all
      .filter((v) => {
        if (cluster && (v.cluster || v.area || "").trim() !== cluster) return false;
        if (guests) {
          const cap = capOf(v.capacity);
          if (cap && cap < guests) return false;
        }
        if (!needle) return true;
        return `${v.name} ${v.id} ${v.area} ${v.cluster} ${v.type}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));
  }, [vq, cluster, guests, canChoose, ownVenue]);

  const picked = venueId ? V(venueId) : null;
  const venueRooms = useMemo(
    () => (venueId ? SPACES(venueId).map((sp) => ({ name: String(sp.name), sub: spaceMeta(sp) })) : []),
    [venueId],
  );
  // при смене площадки залы выбираются заново: по умолчанию — первый зал
  useEffect(() => {
    setRoomsSel(venueRooms.length ? [venueRooms[0].name] : []);
    setZonesSel([]);
  }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickedCapShort = picked && guests && capOf(picked.capacity) && capOf(picked.capacity) < guests;
  const ready = Boolean(
    venueId && (preset ? (vibeQ ? vibeId : true) : presetId === "blank" && format),
  );

  const create = () => {
    if (!venueId) return;
    const dateH = dateIso ? humanDate(dateIso) : "";
    const dateFull = dateH ? `${dateH}${time ? " · " + time : ""}` : "";
    const guestsStr = guests ? String(guests) : "";
    if (preset) {
      const built = buildPresetDraft(venueId, preset, vibeId);
      const guestsLabel =
        BRIEF.find((qq) => qq.id === "guests")?.options.find((o) => o.id === preset.guests)
          ?.label ?? "";
      onCreate({
        venueId,
        format: preset.format,
        title: title.trim(),
        guests: guestsStr || guestsLabel,
        date: dateFull,
        dateIso,
        graph: stampSlot(applyRooms(built.graph, roomsSel, zonesSel), dateH, time),
        brief: built.brief,
      });
    } else {
      onCreate({
        venueId,
        format,
        title: title.trim(),
        guests: guestsStr,
        date: dateFull,
        dateIso,
        graph: stampSlot(applyRooms(venueGraph(venueId), roomsSel, zonesSel), dateH, time),
      });
    }
  };

  let step = 0;
  const next = () => ++step;

  return (
    <Card style={{ padding: "20px 22px", marginBottom: 16, display: "grid", gap: 18 }}>
      <Eyebrow>НОВОЕ СОБЫТИЕ</Eyebrow>

      {/* сценарий: готовый каркас или пустое событие */}
      <div style={{ display: "grid", gap: 8 }}>
        <Step n={next()} title="Сценарий" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(215px,1fr))",
            gap: 8,
          }}
        >
          {EVENT_PRESETS.map((p) => {
            const on = presetId === p.id;
            const blocks = presetBlockCount(p);
            return (
              <button
                key={p.id}
                onClick={() => {
                  setPresetId(on ? "" : p.id);
                  setVibeId("");
                }}
                style={{
                  borderRadius: 0,
                  padding: "11px 13px",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "grid",
                  gap: 5,
                  border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.1)"}`,
                  background: on ? "rgba(229,35,27,.12)" : "var(--gtr-card2)",
                }}
              >
                <span
                  style={{
                    font: "600 12px/1.3 'Golos Text',sans-serif",
                    color: on ? "#fff" : "rgba(255,255,255,.85)",
                  }}
                >
                  {p.title}
                </span>
                <span
                  style={{ font: "500 10px/1.45 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}
                >
                  {p.desc}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 9px/1 'JetBrains Mono',monospace",
                    color: on ? "#2ECC71" : "rgba(255,255,255,.35)",
                  }}
                >
                  {p.format} · зал + слот + {blocks} блоков
                </span>
              </button>
            );
          })}
          <button
            onClick={() => {
              setPresetId(presetId === "blank" ? "" : "blank");
              setVibeId("");
            }}
            style={{
              borderRadius: 0,
              padding: "11px 13px",
              cursor: "pointer",
              textAlign: "left",
              display: "grid",
              gap: 5,
              alignContent: "start",
              border: `1px dashed ${presetId === "blank" ? "#E5231B" : "rgba(255,255,255,.18)"}`,
              background: presetId === "blank" ? "rgba(229,35,27,.12)" : "transparent",
            }}
          >
            <span
              style={{ font: "600 12px/1.3 'Golos Text',sans-serif", color: "rgba(255,255,255,.75)" }}
            >
              Пустое событие
            </span>
            <span style={{ font: "500 10px/1.45 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              Только площадка, залы и слот — состав собираете сами
            </span>
          </button>
        </div>
        {presetId === "blank" ? (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 3 }}>
            {FORMATS.map((f) => {
              const on = format === f;
              return (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  style={{
                    borderRadius: 0,
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
        ) : null}
      </div>

      {/* дата и время: полноценный календарь вместо текстового поля */}
      <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18 }}>
        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <Step n={next()} title="Дата" note={dateIso ? humanDate(dateIso) : "необязательно"} />
          <GtrCalendar value={dateIso} onChange={setDateIso} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 340 }}>
            {TIME_SLOTS.map((t) => {
              const on = time === t;
              return (
                <button
                  key={t}
                  className="gtr-mono"
                  onClick={() => setTime(on ? "" : t)}
                  style={{
                    borderRadius: 0,
                    padding: "6px 10px",
                    cursor: "pointer",
                    font: `${on ? 700 : 500} 10.5px/1 'JetBrains Mono',monospace`,
                    border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.14)"}`,
                    background: on ? "rgba(229,35,27,.16)" : "transparent",
                    color: on ? "#fff" : "rgba(255,255,255,.55)",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* вместимость: регулятор вместо свободного текста */}
        <div style={{ display: "grid", gap: 8, alignContent: "start", minWidth: 0 }}>
          <Step n={next()} title="Вместимость" note="фильтрует подбор площадки" />
          <GtrCapacity value={guests} onChange={setGuests} />
        </div>
      </div>

      {/* площадка: поиск + район + автофит под вместимость */}
      <div style={{ display: "grid", gap: 8 }}>
        <Step
          n={next()}
          title="Площадка"
          note={canChoose ? `${venues.length} подходит` : "закреплена за кабинетом"}
        />
        {picked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Chip color="#E5231B">{picked.id}</Chip>
            <span style={{ font: "500 12.5px/1.3 'Golos Text',sans-serif" }}>{picked.name}</span>
            <span
              className="gtr-mono"
              style={{ font: "500 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              {picked.type} · {picked.area}
              {picked.capacity ? ` · до ${capOf(picked.capacity)} гостей` : ""}
            </span>
            {pickedCapShort ? (
              <Chip color="#F5A623">МАЛА ДЛЯ {guests}</Chip>
            ) : null}
            {canChoose ? (
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
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <input
                className="gtr-input"
                style={{ flex: "1 1 220px", maxWidth: 320, padding: "8px 11px", fontSize: 12 }}
                placeholder="Название, район, ID…"
                value={vq}
                onChange={(e) => setVq(e.target.value)}
              />
              {clusters.map(([c, cnt]) => {
                const on = cluster === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCluster(on ? "" : c)}
                    style={{
                      borderRadius: 0,
                      padding: "7px 11px",
                      cursor: "pointer",
                      font: `${on ? 600 : 500} 10.5px/1 'Golos Text',sans-serif`,
                      border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                      background: on ? "rgba(229,35,27,.14)" : "transparent",
                      color: on ? "#fff" : "rgba(255,255,255,.55)",
                    }}
                  >
                    {c}
                    <span className="gtr-mono" style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>
                      {cnt}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))",
                gap: 6,
                maxHeight: 330,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {venues.slice(0, 24).map((v) => {
                const cap = capOf(v.capacity);
                const score = v.readiness?.score;
                const rate = rateOf(v.id);
                const cf = confirms[v.id];
                const cRate = cf?.status === "confirmed" ? cf.rate : undefined;
                return (
                  <button
                    key={v.id}
                    className="gtr-pal-btn"
                    style={{ padding: "9px 11px" }}
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
                        {v.id} · {v.type || "—"} · {v.cluster || v.area}
                        {cap ? ` · до ${cap}` : ""}
                      </span>
                      {cRate?.amount ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            font: "600 9px/1.3 'JetBrains Mono',monospace",
                            color: "#2ECC71",
                          }}
                        >
                          ✓ {fmtThb(cRate.amount)}
                          {cRate.unit !== "событие" ? ` / ${cRate.unit}` : ""} · площадка
                        </span>
                      ) : rate ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            font: "600 9px/1.3 'JetBrains Mono',monospace",
                            color: RATE_COLOR[rate.kind],
                          }}
                        >
                          {fmtThb(rate.amount)}
                          {rate.unit !== "событие" ? ` / ${rate.unit}` : ""}
                          {rate.kind === "gtr-estimate" ? " ~" : ""}
                        </span>
                      ) : null}
                    </span>
                    {guests && cap ? (
                      <span
                        className="gtr-mono"
                        style={{
                          flex: "none",
                          font: "700 8.5px/1 'JetBrains Mono',monospace",
                          color: "#2ECC71",
                          border: "1px solid rgba(46,204,113,.4)",
                          padding: "3px 6px",
                        }}
                      >
                        ✓ {guests}
                      </span>
                    ) : score ? (
                      <span
                        className="gtr-mono"
                        style={{
                          flex: "none",
                          font: "600 8.5px/1 'JetBrains Mono',monospace",
                          color: "rgba(255,255,255,.35)",
                        }}
                      >
                        {score}/100
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {!venues.length ? (
                <span
                  style={{
                    font: "500 11px/1.5 'Golos Text',sans-serif",
                    color: "var(--gtr-t3)",
                    padding: "8px 2px",
                  }}
                >
                  Под фильтры ничего не подошло — снимите район или уменьшите вместимость.
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* залы и зоны: что арендуем и где ставим программу */}
      {picked ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Step
            n={next()}
            title="Залы и зоны"
            note="сюда будут закрепляться артисты, интерактив и оборудование"
          />
          {venueRooms.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(215px,1fr))",
                gap: 7,
              }}
            >
              {venueRooms.map((r) => {
                const on = roomsSel.includes(r.name);
                return (
                  <button
                    key={r.name}
                    onClick={() =>
                      setRoomsSel((cur) =>
                        on ? cur.filter((x) => x !== r.name) : [...cur, r.name],
                      )
                    }
                    style={{
                      borderRadius: 0,
                      padding: "10px 12px",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "grid",
                      gap: 4,
                      border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                      background: on ? "rgba(229,35,27,.12)" : "var(--gtr-card2)",
                    }}
                  >
                    <span style={{ font: "600 12px/1.3 'Golos Text',sans-serif", color: on ? "#fff" : "rgba(255,255,255,.8)" }}>
                      {on ? "✓ " : ""}
                      {r.name}
                    </span>
                    <span className="gtr-mono" style={{ font: "500 9px/1.3 'JetBrains Mono',monospace", color: "rgba(255,255,255,.4)" }}>
                      {r.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span style={{ font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              Залы этой площадки ещё не нормализованы в базе — событие соберётся по площадке
              целиком, зоны можно включить ниже.
            </span>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {zonesOf(venueId).map((z) => {
              const on = zonesSel.includes(z);
              return (
                <button
                  key={z}
                  onClick={() =>
                    setZonesSel((cur) => (on ? cur.filter((x) => x !== z) : [...cur, z]))
                  }
                  style={{
                    borderRadius: 0,
                    padding: "7px 12px",
                    cursor: "pointer",
                    font: `${on ? 600 : 500} 10.5px/1 'Golos Text',sans-serif`,
                    border: `1px ${on ? "solid #E5231B" : "dashed rgba(255,255,255,.2)"}`,
                    background: on ? "rgba(229,35,27,.14)" : "transparent",
                    color: on ? "#fff" : "rgba(255,255,255,.55)",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {z}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* вайб пресета: направление и музыкальные стили */}
      {preset && vibeQ ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Step n={next()} title={vibeQ.q} note="задаёт палитру и музыкальные стили" />
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {vibeQ.options.map((o) => {
              const on = vibeId === o.id;
              const [c1, c2] = o.colors ?? ["#E5231B", "#F5A623"];
              return (
                <button
                  key={o.id}
                  onClick={() => setVibeId(on ? "" : o.id)}
                  title={(o.styles ?? []).join(" · ")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 0,
                    padding: "7px 12px 7px 8px",
                    cursor: "pointer",
                    font: `${on ? 600 : 500} 11.5px/1.2 'Golos Text',sans-serif`,
                    border: `1px solid ${on ? c1 : "rgba(255,255,255,.12)"}`,
                    background: on ? `linear-gradient(120deg, ${c1}33, ${c2}33)` : "transparent",
                    color: on ? "#fff" : "rgba(255,255,255,.65)",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      flex: "none",
                      borderRadius: 0,
                      background: `linear-gradient(120deg, ${c1}, ${c2})`,
                    }}
                  />
                  <span>
                    {o.label}
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        font: "500 8.5px/1.2 'JetBrains Mono',monospace",
                        color: on ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.35)",
                      }}
                    >
                      {(o.styles ?? []).slice(0, 3).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* название */}
      <div style={{ display: "grid", gap: 8 }}>
        <Step n={next()} title="Название" note="необязательно" />
        <input
          className="gtr-input"
          style={{ padding: "8px 11px", fontSize: 12 }}
          placeholder={
            preset
              ? `${preset.title} · ${picked?.name ?? ""}`
              : format
                ? `${format} · ${picked?.name ?? ""}`
                : "Например: Открытие сезона"
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="gtr-btn gtr-btn-red"
          style={{ padding: "9px 16px", opacity: ready ? 1 : 0.4 }}
          disabled={!ready}
          onClick={create}
        >
          Создать и открыть конструктор →
        </button>
        <button className="gtr-btn" style={{ padding: "9px 14px" }} onClick={onCancel}>
          Отмена
        </button>
        {!ready ? (
          <span style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
            {!venueId
              ? "Выберите площадку"
              : preset && vibeQ && !vibeId
                ? "Выберите вайб"
                : "Выберите сценарий или формат"}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
