// Список событий и создание нового с нуля.
// До этого экрана событие было намертво привязано к площадке в единственном
// экземпляре — создать второе или начать с чистого листа было нечем.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";

import {
  computeQuote,
  draftTitle,
  eventAlerts,
  fmtThb,
  graphHealth,
  genreLabel,
  PH,
  RATE_COLOR,
  rateOf,
  richOf,
  STAGE_COLOR,
  STAGE_LABEL,
  STATUS_COLOR,
  SPACES,
  V,
  venueGraph,
  zonesOf,
  type EventDraft,
  type EventStage,
  type Graph,
} from "../data/app-data";
import { BRIEF, vibeOf, vibeQuestionFor, type BriefAnswers } from "../data/brief";
import { buildPresetDraft, EVENT_PRESETS, presetBlockCount } from "../data/presets";
import { useGtr } from "../store";
import { Card, Icon } from "../ui";
import { GtrCalendar, GtrCapacity, humanDate } from "../pickers";
import { ImpulseArt } from "../impulse";
import { venueConfirmsFn, type VenueConfirm } from "../kv-api";
import { fillT, genreLang, useBriefLabel, useTrData } from "./Constructor";

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
  const { t, i18n } = useTranslation();
  const tr = useTrData();
  const briefLabel = useBriefLabel();
  const { user, myDrafts, createDraft, deleteDraft } = useGtr();
  const navigate = useNavigate();
  const lang = i18n.language || "ru";

  // Личный кабинет: менеджер видит только свои события, GTR-админ — все
  const isAdmin = user.role === "gtr";
  // Код площадки и наш балл готовности — внутренняя кухня команды. В
  // визарде выбора площадки его видит и организатор-клиент, поэтому эти
  // подписи гейтим по команде GTR, а не показываем всем.
  const isTeam = ["gtr", "sales", "owner", "pr"].includes(user.role);
  const scoped = myDrafts;

  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | EventStage>("all");
  // Паспорт площадки открывает мастер с выбранной площадкой;
  // vid="new" (кнопка кабинета) — мастер сразу, без преселекта
  const [creating, setCreating] = useState(Boolean(newForVenue));
  const presetVenue = newForVenue === "new" ? "" : newForVenue;

  // Список делится по времени: что впереди — по дате от ближайшего,
  // без даты — по свежести правки, прошедшие — в конце, от недавних.
  const groups = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const today = isoToday();
    const hit = scoped.filter((d) => {
      if (stage !== "all" && (d.graph.stage ?? "draft") !== stage) return false;
      if (!needle) return true;
      const v = V(d.venueId);
      return `${draftTitle(d)} ${tr(draftTitle(d))} ${d.format} ${tr(d.format)} ${v.name ?? ""} ${d.venueId}`
        .toLowerCase()
        .includes(needle);
    });
    const upcoming = hit
      .filter((d) => d.dateIso && d.dateIso >= today)
      .sort((a, b) => a.dateIso!.localeCompare(b.dateIso!));
    const undated = hit.filter((d) => !d.dateIso).sort((a, b) => b.updated - a.updated);
    const past = hit
      .filter((d) => d.dateIso && d.dateIso < today)
      .sort((a, b) => b.dateIso!.localeCompare(a.dateIso!));
    return [
      { id: "up", title: t("Ближайшие"), items: upcoming },
      { id: "nodate", title: t("Без даты"), items: undated },
      { id: "past", title: t("Прошедшие"), items: past },
    ].filter((g) => g.items.length);
  }, [scoped, q, stage, tr, t]);

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

  const duplicate = (d: EventDraft) =>
    createDraft({
      venueId: d.venueId,
      format: d.format,
      // название копии — на языке того, кто её создаёт
      title: fillT(t, "{{name}} — копия", { name: tr(draftTitle(d)) }),
      guests: d.guests,
      graph: structuredClone(d.graph),
      brief: { ...d.brief },
    });
  const remove = (d: EventDraft) => {
    if (
      confirm(
        fillT(t, "Удалить событие «{{name}}»? Отменить будет нельзя.", {
          name: tr(draftTitle(d)),
        }),
      )
    )
      deleteDraft(d.id);
  };

  return (
    <div className="gtr-ev" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div className="gtr-ev-head">
        <h1 className="gtr-oswald gtr-h1">{t("События")}</h1>
        {!creating ? (
          <button
            className="gtr-btn gtr-btn-red"
            style={{ marginLeft: "auto", padding: "10px 16px" }}
            onClick={() => setCreating(true)}
          >
            {t("+ Новое событие")}
          </button>
        ) : null}
      </div>

      {creating ? (
        <NewEvent
          isAdmin={isAdmin}
          isTeam={isTeam}
          ownVenue={presetVenue || user.venueId}
          onCancel={() => setCreating(false)}
          onCreate={(init) => {
            const id = createDraft(init);
            setCreating(false);
            open(id);
          }}
        />
      ) : (
        <>
          {/* ---------- статусы: цифры как на дашборде, они же фильтр ---------- */}
          <div className="gtr-stats gtr-ev-stats" role="tablist" aria-label={t("Статус события")}>
            {(["all", "draft", "sent", "approved"] as const).map((s) => {
              const on = stage === s;
              const color = s === "all" ? "var(--gtr-t1)" : STAGE_COLOR[s];
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className="gtr-stat gtr-ev-stat"
                  data-on={on || undefined}
                  style={{ "--c": color } as React.CSSProperties}
                  onClick={() => setStage(s)}
                >
                  <b>{counts[s] ?? 0}</b>
                  <span>{s === "all" ? t("Все") : t(STAGE_LABEL[s])}</span>
                </button>
              );
            })}
          </div>

          <input
            className="gtr-input gtr-ev-search"
            type="search"
            placeholder={t("Событие, формат или площадка…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {/* ---------- список ---------- */}
          {!groups.length ? (
            <Card style={{ padding: "30px 24px", textAlign: "center" }}>
              <div style={{ font: "500 14px/1.6 var(--text)", color: "var(--gtr-t2)" }}>
                {scoped.length
                  ? t("Под фильтр ничего не подошло.")
                  : t("Событий пока нет. Создайте первое — площадка, зал и слот подставятся из базы.")}
              </div>
              {!scoped.length ? (
                <button
                  className="gtr-btn gtr-btn-red"
                  style={{ marginTop: 16, padding: "10px 16px" }}
                  onClick={() => setCreating(true)}
                >
                  {t("+ Новое событие")}
                </button>
              ) : null}
            </Card>
          ) : (
            groups.map((grp) => (
              <section key={grp.id} className="gtr-ev-group">
                <h2 className="gtr-ev-group-h">
                  {grp.title}
                  <span>{grp.items.length}</span>
                </h2>
                <div className="gtr-ev-grid gtr-seq">
                  {grp.items.map((d) => (
                    <EventCard
                      key={d.id}
                      d={d}
                      lang={lang}
                      past={grp.id === "past"}
                      author={
                        (d.author || "GTR") + (isAdmin && d.owner ? ` (${d.owner})` : "")
                      }
                      vibeLabel={(l, le) => briefLabel(l, le)}
                      onOpen={() => open(d.id)}
                      onDuplicate={() => duplicate(d)}
                      onDelete={() => remove(d)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

const isoToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

// иконки карточки события: 24×24, обводка
const EV_IC = {
  pin: "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  room: "M3 21V8l9-5 9 5v13 M9 21v-7h6v7",
  artist: "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  vendor: "M11 5L6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 0 1 0 7",
  guests: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 21v-1a6 6 0 0 1 12 0v1 M16 11a3 3 0 1 0 0-6 M22 21v-1a6 6 0 0 0-4-5.7",
  copy: "M8 8h12v12H8z M16 8V4H4v12h4",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
};

// Карточка события: снимок площадки, дата плиткой, название крупно,
// состав значками, здоровье и смета внизу. Нажатие — в конструктор.
function EventCard({
  d,
  lang,
  past,
  author,
  vibeLabel,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  d: EventDraft;
  lang: string;
  past: boolean;
  author: string;
  vibeLabel: (label: string, labelEn?: string) => string;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tr = useTrData();
  const [noPhoto, setNoPhoto] = useState(false);
  const v = V(d.venueId);
  const st = d.graph.stage ?? "draft";
  const quote = computeQuote(d.graph, d.venueId);
  const nodes = d.graph.nodes;
  const rooms = nodes.filter((n) => n.kind === "room").length;
  const artists = nodes.filter((n) => n.kind === "artist").length;
  const vendors = nodes.filter((n) => ["sound", "light", "decor", "content"].includes(n.kind)).length;
  const health = graphHealth(eventAlerts(d.graph, v, { guests: d.guests, quoteTotal: quote.total }));
  const vibe = vibeOf(d.format, d.brief ?? {});
  const cover = richOf(d.venueId).hero || `/venues/${d.venueId}-hero.jpg`;
  const date = d.dateIso ? new Date(`${d.dateIso}T12:00:00`) : null;
  const loc = lang.startsWith("th") ? "th-TH" : lang.startsWith("en") ? "en-GB" : "ru-RU";
  const time = d.date.includes(" · ") ? d.date.split(" · ").pop() : "";
  const issues = health.problems + health.delays;
  const facts: [string, number | string, string][] = [
    [EV_IC.room, rooms, t("Залы")],
    [EV_IC.artist, artists, t("Артисты")],
    [EV_IC.vendor, vendors, t("Подрядчики")],
  ];
  if (d.guests) facts.push([EV_IC.guests, tr(d.guests), t("Гости")]);

  return (
    <article
      className="gtr-ev-card"
      data-past={past || undefined}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="gtr-ev-cover">
        {!noPhoto ? (
          <img src={cover} alt="" loading="lazy" onError={() => setNoPhoto(true)} />
        ) : (
          <div className="gtr-ev-cover-art" aria-hidden="true">
            <ImpulseArt seed={d.id} density={0.5} />
          </div>
        )}
        {vibe?.colors ? (
          <span
            className="gtr-ev-vibe"
            style={{ background: `linear-gradient(90deg, ${vibe.colors[0]}, ${vibe.colors[1]})` }}
          />
        ) : null}
        {date ? (
          <div className="gtr-ev-date">
            <b>{date.getDate()}</b>
            <span>{date.toLocaleDateString(loc, { month: "short" }).replace(".", "")}</span>
          </div>
        ) : null}
        <span
          className="gtr-ev-stage"
          style={{ "--c": STAGE_COLOR[st] } as React.CSSProperties}
        >
          {t(STAGE_LABEL[st])}
        </span>
      </div>

      <div className="gtr-ev-body">
        <h3 className="gtr-ev-title">{tr(draftTitle(d))}</h3>
        <div className="gtr-ev-venue">
          <Icon d={EV_IC.pin} size={14} />
          <span>
            {v.name ?? d.venueId}
            {d.format && d.title ? ` · ${tr(d.format)}` : ""}
          </span>
        </div>
        {time || vibe ? (
          <div className="gtr-ev-venue">
            {time ? (
              <>
                <Icon d={EV_IC.clock} size={14} />
                <span>{time}</span>
              </>
            ) : null}
            {vibe ? (
              <span className="gtr-ev-vibe-tag">{vibeLabel(vibe.label, vibe.labelEn)}</span>
            ) : null}
          </div>
        ) : null}

        <ul className="gtr-ev-facts">
          {facts.map(([ic, n, label]) => (
            <li key={label} title={label}>
              <Icon d={ic} size={15} />
              <b>{n}</b>
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="gtr-ev-foot">
          <span
            className="gtr-ev-health"
            style={{ "--c": STATUS_COLOR[health.verdict] } as React.CSSProperties}
          >
            {health.clean
              ? t("В порядке")
              : issues
                ? fillT(t, "Проблем: {{n}}", { n: issues })
                : fillT(t, "Внимание: {{n}}", { n: health.warns })}
          </span>
          <span className="gtr-ev-sum" data-empty={!quote.total || undefined}>
            {quote.total ? fmtThb(quote.total) : t("смета пуста")}
          </span>
        </div>

        <div className="gtr-ev-meta">
          <span>
            {author}
            {d.updated ? ` · ${t("изменено")} ${new Date(d.updated).toLocaleDateString(loc)}` : ""}
          </span>
          <button
            type="button"
            className="gtr-ev-act"
            aria-label={t("Дублировать")}
            title={t("Дублировать")}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Icon d={EV_IC.copy} size={16} />
          </button>
          <button
            type="button"
            className="gtr-ev-act gtr-ev-act-del"
            aria-label={t("Удалить")}
            title={t("Удалить")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Icon d={EV_IC.trash} size={16} />
          </button>
        </div>
      </div>
    </article>
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
    <h3 className="gtr-ev-step">
      <span className="gtr-ev-step-n">{String(n).padStart(2, "0")}</span>
      <span className="gtr-ev-step-t">{title}</span>
      {note ? <span className="gtr-ev-step-note">{note}</span> : null}
    </h3>
  );
}

function NewEvent({
  isAdmin,
  isTeam,
  ownVenue,
  onCancel,
  onCreate,
}: {
  isAdmin: boolean;
  isTeam: boolean;
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
  const { t, i18n } = useTranslation();
  const tr = useTrData();
  const briefLabel = useBriefLabel();
  const gl = genreLang(i18n.language || "ru");
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
  // сводка выбора в нижней панели: видно, что уже собрано, не листая вверх
  const summary = [
    preset ? tr(preset.title) : presetId === "blank" && format ? tr(format) : "",
    dateIso ? `${humanDate(dateIso)}${time ? " · " + time : ""}` : "",
    guests ? fillT(t, "{{n}} гостей", { n: guests }) : "",
    picked?.name ?? "",
  ].filter(Boolean);

  return (
    <div className="gtr-ev-new">
      {/* сценарий: готовый каркас или пустое событие */}
      <section className="gtr-ev-sec">
        <Step n={next()} title={t("Сценарий")} note={t("готовый каркас или с нуля")} />
        <div className="gtr-ev-opts">
          {EVENT_PRESETS.map((p) => {
            const on = presetId === p.id;
            const blocks = presetBlockCount(p);
            return (
              <button
                key={p.id}
                type="button"
                className="gtr-ev-opt"
                data-on={on || undefined}
                aria-pressed={on}
                onClick={() => {
                  setPresetId(on ? "" : p.id);
                  setVibeId("");
                }}
              >
                <span className="gtr-ev-opt-ic">
                  <Icon d={FORMAT_IC[p.format] ?? FORMAT_IC.default} size={20} />
                </span>
                <span className="gtr-ev-opt-txt">
                  <span className="gtr-ev-opt-t">{tr(p.title)}</span>
                  <span className="gtr-ev-opt-d">{tr(p.desc)}</span>
                  <span className="gtr-ev-opt-m">
                    {fillT(t, "{{n}} блоков готово", { n: blocks + 2 })}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="gtr-ev-opt"
            data-dashed
            data-on={presetId === "blank" || undefined}
            aria-pressed={presetId === "blank"}
            onClick={() => {
              setPresetId(presetId === "blank" ? "" : "blank");
              setVibeId("");
            }}
          >
            <span className="gtr-ev-opt-ic">
              <Icon d="M12 5v14 M5 12h14" size={20} />
            </span>
            <span className="gtr-ev-opt-txt">
              <span className="gtr-ev-opt-t">{t("Пустое событие")}</span>
              <span className="gtr-ev-opt-d">
                {t("Только площадка, залы и слот — состав собираете сами")}
              </span>
            </span>
          </button>
        </div>
        {presetId === "blank" ? (
          <div className="gtr-ev-pills">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className="gtr-ev-pill"
                data-on={format === f || undefined}
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
              >
                {tr(f)}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* дата и время: полноценный календарь вместо текстового поля */}
      <div className="gtr-md-stack gtr-ev-pair">
        <section className="gtr-ev-sec">
          <Step n={next()} title={t("Дата")} note={dateIso ? humanDate(dateIso) : t("необязательно")} />
          <GtrCalendar value={dateIso} onChange={setDateIso} />
          <div className="gtr-ev-pills" style={{ maxWidth: 360 }}>
            {TIME_SLOTS.map((ts) => (
              <button
                key={ts}
                type="button"
                className="gtr-ev-pill gtr-ev-pill-num"
                data-on={time === ts || undefined}
                aria-pressed={time === ts}
                onClick={() => setTime(time === ts ? "" : ts)}
              >
                {ts}
              </button>
            ))}
          </div>
        </section>

        {/* вместимость: регулятор вместо свободного текста */}
        <section className="gtr-ev-sec" style={{ minWidth: 0 }}>
          <Step n={next()} title={t("Вместимость")} note={t("фильтрует подбор площадки")} />
          <GtrCapacity value={guests} onChange={setGuests} />
        </section>
      </div>

      {/* площадка: поиск + район + автофит под вместимость */}
      <section className="gtr-ev-sec">
        <Step
          n={next()}
          title={t("Площадка")}
          note={
            canChoose
              ? fillT(t, "{{n}} подходит", { n: venues.length })
              : t("закреплена за кабинетом")
          }
        />
        {picked ? (
          <div className="gtr-ev-picked">
            <span className="gtr-ev-opt-ic">
              <Icon d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" size={20} />
            </span>
            <span className="gtr-ev-opt-txt">
              <span className="gtr-ev-opt-t">
                {picked.name}
                {isTeam ? <span className="gtr-ev-id">{picked.id}</span> : null}
              </span>
              <span className="gtr-ev-opt-d">
                {[picked.type, picked.area].filter(Boolean).join(" · ")}
                {picked.capacity
                  ? ` · ${fillT(t, "до {{n}} гостей", { n: capOf(picked.capacity) })}`
                  : ""}
              </span>
              {pickedCapShort ? (
                <span className="gtr-ev-opt-m" style={{ color: "var(--gtr-amber)" }}>
                  {t("МАЛА ДЛЯ")} {guests}
                </span>
              ) : null}
            </span>
            {canChoose ? (
              <button
                type="button"
                className="gtr-btn"
                style={{ flex: "none", padding: "8px 12px" }}
                onClick={() => setVenueId("")}
              >
                {t("Изменить")}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <input
              className="gtr-input gtr-ev-search"
              style={{ marginBottom: 0 }}
              type="search"
              placeholder={t("Название, район, ID…")}
              value={vq}
              onChange={(e) => setVq(e.target.value)}
            />
            <div className="gtr-ev-pills gtr-ev-pills-scroll">
              {clusters.map(([c, cnt]) => (
                <button
                  key={c}
                  type="button"
                  className="gtr-ev-pill"
                  data-on={cluster === c || undefined}
                  aria-pressed={cluster === c}
                  onClick={() => setCluster(cluster === c ? "" : c)}
                >
                  {c}
                  <span>{cnt}</span>
                </button>
              ))}
            </div>
            <div className="gtr-ev-venues">
              {venues.slice(0, 24).map((v) => {
                const cap = capOf(v.capacity);
                const score = v.readiness?.score;
                const rate = rateOf(v.id);
                const cf = confirms[v.id];
                const cRate = cf?.status === "confirmed" ? cf.rate : undefined;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className="gtr-ev-venue-btn"
                    onClick={() => setVenueId(v.id)}
                  >
                    <span className="gtr-ev-opt-txt">
                      <span className="gtr-ev-opt-t">{v.name}</span>
                      <span className="gtr-ev-opt-d">
                        {isTeam ? `${v.id} · ` : ""}
                        {v.type || "—"} · {v.cluster || v.area}
                        {cap ? ` · ${fillT(t, "до {{n}}", { n: cap })}` : ""}
                      </span>
                      {cRate?.amount ? (
                        <span className="gtr-ev-opt-m" style={{ color: "var(--gtr-green)" }}>
                          ✓ {fmtThb(cRate.amount)}
                          {cRate.unit !== "событие" ? ` / ${t(cRate.unit)}` : ""} {t("· площадка")}
                        </span>
                      ) : rate ? (
                        <span className="gtr-ev-opt-m" style={{ color: RATE_COLOR[rate.kind] }}>
                          {fmtThb(rate.amount)}
                          {rate.unit !== "событие" ? ` / ${t(rate.unit)}` : ""}
                          {rate.kind === "gtr-estimate" ? " ~" : ""}
                        </span>
                      ) : null}
                    </span>
                    {guests && cap ? (
                      <span className="gtr-ev-fit">✓ {guests}</span>
                    ) : isTeam && score ? (
                      <span className="gtr-ev-score">{score}/100</span>
                    ) : null}
                  </button>
                );
              })}
              {!venues.length ? (
                <span className="gtr-ev-hint">
                  {t("Под фильтры ничего не подошло — снимите район или уменьшите вместимость.")}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* залы и зоны: что арендуем и где ставим программу */}
      {picked ? (
        <section className="gtr-ev-sec">
          <Step
            n={next()}
            title={t("Залы и зоны")}
            note={t("сюда будут закрепляться артисты, интерактив и оборудование")}
          />
          {venueRooms.length ? (
            <div className="gtr-ev-opts">
              {venueRooms.map((r) => {
                const on = roomsSel.includes(r.name);
                return (
                  <button
                    key={r.name}
                    type="button"
                    className="gtr-ev-opt"
                    data-on={on || undefined}
                    aria-pressed={on}
                    onClick={() =>
                      setRoomsSel((cur) =>
                        on ? cur.filter((x) => x !== r.name) : [...cur, r.name],
                      )
                    }
                  >
                    <span className="gtr-ev-opt-ic">
                      <Icon d={on ? "M5 12.5l4.5 4.5L19 7.5" : "M3 21V8l9-5 9 5v13 M9 21v-7h6v7"} size={20} />
                    </span>
                    <span className="gtr-ev-opt-txt">
                      <span className="gtr-ev-opt-t">{r.name}</span>
                      <span className="gtr-ev-opt-d">{tr(r.sub)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="gtr-ev-hint">
              {t("У площадки пока нет отдельных залов — событие соберётся на всю площадку, зоны можно включить ниже.")}
            </span>
          )}
          <div className="gtr-ev-pills">
            {zonesOf(venueId).map((z) => {
              const on = zonesSel.includes(z);
              return (
                <button
                  key={z}
                  type="button"
                  className="gtr-ev-pill"
                  data-dashed={!on || undefined}
                  data-on={on || undefined}
                  aria-pressed={on}
                  onClick={() =>
                    setZonesSel((cur) => (on ? cur.filter((x) => x !== z) : [...cur, z]))
                  }
                >
                  {on ? "✓ " : "+ "}
                  {tr(z)}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* вайб пресета: направление и музыкальные стили */}
      {preset && vibeQ ? (
        <section className="gtr-ev-sec">
          <Step
            n={next()}
            title={briefLabel(vibeQ.q, vibeQ.qEn)}
            note={t("задаёт палитру и музыкальные стили")}
          />
          <div className="gtr-ev-opts">
            {vibeQ.options.map((o) => {
              const on = vibeId === o.id;
              const [c1, c2] = o.colors ?? ["#E5231B", "#F5A623"];
              return (
                <button
                  key={o.id}
                  type="button"
                  className="gtr-ev-opt"
                  data-on={on || undefined}
                  aria-pressed={on}
                  style={on ? { borderColor: c1, background: `linear-gradient(120deg, ${c1}26, ${c2}26)` } : undefined}
                  onClick={() => setVibeId(on ? "" : o.id)}
                >
                  <span
                    className="gtr-ev-opt-ic"
                    style={{ background: `linear-gradient(120deg, ${c1}, ${c2})` }}
                  />
                  <span className="gtr-ev-opt-txt">
                    <span className="gtr-ev-opt-t">{briefLabel(o.label, o.labelEn)}</span>
                    <span className="gtr-ev-opt-d">
                      {(o.styles ?? []).slice(0, 3).map((st) => genreLabel(st, gl)).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* название */}
      <section className="gtr-ev-sec">
        <Step n={next()} title={t("Название")} note={t("необязательно")} />
        <input
          className="gtr-input"
          style={{ padding: "12px 13px", fontSize: 15 }}
          placeholder={
            preset
              ? `${tr(preset.title)} · ${picked?.name ?? ""}`
              : format
                ? `${tr(format)} · ${picked?.name ?? ""}`
                : t("Например: Открытие сезона")
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </section>

      {/* итог прилипает к низу экрана: кнопка всегда под пальцем */}
      <div className="gtr-ev-submit">
        <div className="gtr-ev-submit-sum">
          {ready ? (
            <span>{summary.join(" · ")}</span>
          ) : (
            <small>
              {!presetId || (presetId === "blank" && !format)
                ? t("Выберите сценарий или формат")
                : !venueId
                  ? t("Выберите площадку")
                  : t("Выберите вайб")}
            </small>
          )}
        </div>
        <button type="button" className="gtr-btn" style={{ padding: "11px 14px" }} onClick={onCancel}>
          {t("Отмена")}
        </button>
        <button
          type="button"
          className="gtr-btn gtr-btn-red"
          style={{ padding: "11px 16px", opacity: ready ? 1 : 0.4 }}
          disabled={!ready}
          onClick={create}
        >
          {t("Создать →")}
        </button>
      </div>
    </div>
  );
}

// значки сценариев: формат события с одного взгляда
const FORMAT_IC: Record<string, string> = {
  "Клубная ночь": "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "Свадьба": "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  "Корпоратив": "M4 8h16v12H4z M9 8V5h6v3 M4 13h16",
  "Конференция": "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
  "Частная вечеринка": "M8 3h8l-4 7z M12 10v9 M8 21h8",
  "Бренд-активация": "M12 3l2.2 5.6L20 10.4l-5.8 1.8L12 18l-2.2-5.8L4 10.4l5.8-1.8z",
  default: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};
