import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AMBER,
  computeQuote,
  CX_PALETTE,
  eventAlerts,
  EVENT_QUESTIONS,
  fmtThb,
  graphHealth,
  GREEN,
  isPerformer,
  KINDS,
  linkStatus,
  loadArtists,
  NODE_W,
  nodeStatus,
  packagePrice,
  packagesOf,
  presetsFor,
  RATE_COLOR,
  RATE_LABEL,
  STAGE_COLOR,
  STAGE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  V,
  VENDOR_CATALOG,
  type Artist,
  type ArtistBase,
  type EventStage,
  type Graph,
  type GraphNode,
  type LogEntry,
  type NodeKind,
  type NodeStatus,
} from "../data/app-data";
import {
  briefProgress,
  modulesFromBrief,
  visibleQuestions,
  vibeOf,
  type BriefAnswers,
  type BriefLang,
  type ModuleSpec,
} from "../data/brief";
import { notifyRequestFn } from "../notify";
import { quoteDocument } from "../quote-doc";
import { useGtr } from "../store";
import { Card, Chip, Dot, Eyebrow, Icon } from "../ui";

const NODE_H = 104;
const VENDOR_KINDS: NodeKind[] = ["sound", "light", "decor", "content"];
const RIDER_LABEL: Record<string, string> = {
  dj: "DJ-сет",
  headliner: "Хедлайнер",
  band: "Лайв-состав",
  show: "Шоу-программа",
};

// первый свободный слот сетки 196×104, чтобы новые узлы не накладывались
const freeSlot = (nodes: GraphNode[]) => {
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 30 + col * (NODE_W + 50);
      const y = 26 + row * (NODE_H + 46);
      const busy = nodes.some((n) => Math.abs(n.x - x) < NODE_W && Math.abs(n.y - y) < NODE_H);
      if (!busy) return { x, y };
    }
  }
  return { x: 30, y: 26 };
};

const parseThb = (str?: string) => {
  if (!str) return 0;
  const m = String(str).match(/[\d][\d\s]*/);
  return m ? parseInt(m[0].replace(/\s/g, ""), 10) : 0;
};

export type EventIntake = {
  title?: string;
  date?: string;
  guests?: string;
  budget?: string;
};

const EMPTY_GRAPH: Graph = { nodes: [], links: [] };

export function ConstructorScreen({
  draftId,
  venueId,
  organizer,
  intake,
  onSubmitted,
}: {
  draftId?: string;
  venueId?: string;
  organizer?: boolean;
  intake?: EventIntake;
  onSubmitted?: (requestId: string) => void;
} = {}) {
  const { user, peers, shared, draftOf, draftsOf, createDraft, setDraftGraph, updateDraft, addRequest } =
    useGtr();
  const navigate = useNavigate();
  // Площадку задаёт само событие. У GTR-админа своей площадки нет, и раньше
  // vid падал на дефолтную VEN-0013 — смета, пресеты и проверки считались по
  // чужой площадке, хотя на канвасе была площадка события.
  const explicitDraft = draftId ? draftOf(draftId) : undefined;
  const vid = explicitDraft?.venueId || venueId || user.venueId || "VEN-0013";
  const v = V(vid);
  const R = v.readiness;

  // Без явного id открываем последнее событие площадки, а если событий нет —
  // предлагаем создать, а не подсовываем единственный вечный граф.
  const draft = explicitDraft ?? draftsOf(vid)[0];
  const g = draft?.graph ?? EMPTY_GRAPH;

  const [sel, setSel] = useState("n1");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<NodeKind | null>(null);
  const [artBase, setArtBase] = useState<ArtistBase | null>(null);
  const [artQ, setArtQ] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  // Форма организатора (режим organizer): контакт и параметры запроса.
  // Предзаполняется ответами визарда (intake), если он был пройден.
  const [org, setOrg] = useState(() => ({
    name: "",
    contact: "",
    title: intake?.title ?? "",
    date: intake?.date ?? "",
    guests: intake?.guests ?? "",
    budget: intake?.budget ?? "",
    note: "",
  }));
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  // Ленивая загрузка базы артистов при первом раскрытии категории «Артист»
  useEffect(() => {
    if (openCat === "artist" && !artBase) loadArtists().then(setArtBase);
  }, [openCat, artBase]);

  const mutate = (fn: (gr: Graph) => Graph) => draft && setDraftGraph(draft.id, fn);
  const nodeById = (id: string) => g.nodes.find((n) => n.id === id);

  const actor = organizer ? "Организатор" : user.roleLabel;
  const stage: EventStage = g.stage ?? "draft";
  // Добавить запись в историю события (последние 40 хранится)
  const pushLog = (gr: Graph, action: string): LogEntry[] =>
    [{ ts: Date.now(), actor, action }, ...(gr.log ?? [])].slice(0, 40);
  const setStage = (next: EventStage, action: string) =>
    mutate((gr) => ({ ...gr, stage: next, log: pushLog(gr, action) }));

  const addNode = (
    kind: NodeKind,
    title: string,
    sub: string,
    badge: string,
    fields: [string, string][],
    linkFromVenue = false,
  ) => {
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    mutate((gr) => {
      const { x, y } = freeSlot(gr.nodes);
      const venue = gr.nodes.find((n) => n.kind === "venue");
      return {
        nodes: [...gr.nodes, { id, kind, x, y, title, sub, badge, fields }],
        links: linkFromVenue && venue ? [...gr.links, { from: venue.id, to: id }] : gr.links,
        log: pushLog(gr, `Добавлен блок «${title}»`),
      };
    });
    setSel(id); // сразу выделяем добавленный блок — инспектор показывает его поля
    return id;
  };

  // Добавить артиста из базы/лайнапа узлом графа с авто-связью к площадке.
  // Артист не дублируется: если уже в графе — просто выделяем его.
  const addArtistNode = (a: Artist) => {
    const existing = g.nodes.find(
      (n) => n.kind === "artist" && n.fields.some((f) => f[0] === "КАРТОЧКА" && f[1] === a.id),
    );
    if (existing) {
      setSel(existing.id);
      return;
    }
    addNode(
      "artist",
      a.name,
      [(a.styles || []).slice(0, 2).join(" · "), a.tier].filter(Boolean).join(" · ") || a.role,
      a.prio ? `ПРИО ${a.prio}` : "АРТИСТ",
      [
        ["СТИЛИ", (a.styles || []).join(", ") || "—"],
        ["УРОВЕНЬ", a.tier || a.cat || "—"],
        ["РАЙДЕР", a.rider ? RIDER_LABEL[a.rider] || a.rider : "—"],
        ["КОНТАКТ", a.email || a.wa || a.phone || a.mgmt || "по запросу"],
        ["КАРТОЧКА", a.id],
      ],
      true,
    );
  };

  // ---------- бриф ----------
  const briefAnswers: BriefAnswers = draft?.brief ?? {};
  const briefFormat = draft?.format ?? "";
  const eventVibe = vibeOf(briefFormat, briefAnswers);
  const setAnswer = (qid: string, ids: string[]) =>
    draft && updateDraft(draft.id, { brief: { ...briefAnswers, [qid]: ids } });

  // Ответы превращаются в блоки события. Совпадением считаем пару вид+название:
  // чужой блок с похожим именем не должен глушить модуль из брифа.
  const sameModule = (n: GraphNode, m: ModuleSpec) => n.kind === m.kind && n.title === m.title;

  // Все блоки добавляются одной правкой графа. Цикл из addNode здесь не годится:
  // каждый вызов считает состояние от одного и того же снимка, и до графа
  // доходит только последний блок, хотя тост рапортует про все.
  const buildFromBrief = () => {
    const specs = modulesFromBrief(briefFormat, briefAnswers);
    const fresh = specs.filter((m) => !g.nodes.some((n) => sameModule(n, m)));
    if (!fresh.length) {
      toast("Все блоки из брифа уже в событии");
      return;
    }
    mutate((gr) => {
      const nodes = [...gr.nodes];
      const links = [...gr.links];
      const venue = gr.nodes.find((n) => n.kind === "venue");
      fresh.forEach((m, i) => {
        const { x, y } = freeSlot(nodes); // считается по растущему списку — блоки не наложатся
        const id = `nb${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`;
        nodes.push({ id, kind: m.kind, x, y, title: m.title, sub: m.sub, badge: m.badge, fields: m.fields });
        if (venue) links.push({ from: venue.id, to: id });
      });
      return {
        ...gr,
        nodes,
        links,
        log: pushLog(gr, `Из брифа добавлено блоков: ${fresh.length}`),
      };
    });
    toast(`Добавлено блоков: ${fresh.length}`, {
      description: "Заполните подрядчиков и цены — блоки помечены как черновые",
    });
  };

  // Артисты для палитры: лайнап + результаты поиска по базе
  const lineupArtists = useMemo(
    () =>
      artBase
        ? (shared.lineup
            .map((id) => artBase.artists.find((a) => a.id === id))
            .filter((a): a is Artist => Boolean(a) && isPerformer(a as Artist)))
        : [],
    [artBase, shared.lineup],
  );
  const artSearch = useMemo(() => {
    if (!artBase) return [];
    const q = artQ.toLowerCase().trim();
    if (!q) return [];
    const rank = (p: string) => (p === "A" ? 0 : p === "B" ? 1 : 2);
    // Только те, кто действительно выступает. Лейблы, агентства и
    // площадки-промоутеры в событие артистом не добавляются — иначе им
    // начисляется гонорар по тиру, и смета врёт.
    return artBase.artists
      .filter(isPerformer)
      .filter((a) => `${a.name} ${(a.styles || []).join(" ")} ${a.role}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a.prio) - rank(b.prio))
      .slice(0, 8);
  }, [artBase, artQ]);

  // Событий у площадки ещё нет — предлагаем создать. Все хуки выше уже
  // отработали, поэтому ранний возврат здесь безопасен.
  if (!draft) {
    return (
      <div style={{ maxWidth: 620, margin: "60px auto" }}>
        <Card style={{ padding: "34px 32px", display: "grid", gap: 14 }}>
          <Eyebrow>КОНСТРУКТОР СОБЫТИЯ</Eyebrow>
          <h1 className="gtr-oswald" style={{ font: "700 24px/1.2 Oswald,sans-serif", margin: 0 }}>
            На площадке «{v.name ?? vid}» пока нет событий
          </h1>
          <p style={{ margin: 0, color: "var(--gtr-t2)", font: "500 13px/1.6 'Golos Text',sans-serif" }}>
            Событие больше не привязано к площадке намертво: их может быть сколько угодно, каждое со
            своим составом, сметой и историей.
          </p>
          <button
            className="gtr-btn gtr-btn-red"
            style={{ justifySelf: "start", padding: "10px 16px" }}
            onClick={() => {
              const id = createDraft({ venueId: vid, format: "" });
              navigate({ to: "/gtr/$screen", params: { screen: "constructor" }, search: { draft: id } });
            }}
          >
            Создать событие →
          </button>
        </Card>
      </div>
    );
  }

  const onPointerDown = (e: React.PointerEvent, n: GraphNode) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { id: n.id, dx: e.clientX - r.left - n.x, dy: e.clientY - r.top - n.y };
    setSel(n.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const r = canvasRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    const x = Math.max(0, Math.round(e.clientX - r.left - d.dx));
    const y = Math.max(0, Math.round(e.clientY - r.top - d.dy));
    mutate((gr) => ({ ...gr, nodes: gr.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const selNode = nodeById(sel) ?? g.nodes[0];
  const selKind = selNode ? KINDS[selNode.kind] : KINDS.room;

  const updateSel = (patch: Partial<GraphNode>) =>
    selNode &&
    mutate((gr) => ({
      ...gr,
      nodes: gr.nodes.map((n) => (n.id === selNode.id ? { ...n, ...patch } : n)),
    }));

  const vendorNodes = g.nodes.filter((n) => VENDOR_KINDS.includes(n.kind));
  // Точная цена пакета важнее строки-вилки — как и в смете
  const budget = vendorNodes.reduce(
    (sum, n) =>
      sum +
      (parseThb(n.fields.find((f) => f[0] === "ЦЕНА_THB")?.[1]) ||
        parseThb(n.fields.find((f) => f[0] === "ЦЕНА")?.[1])),
    0,
  );

  const canvasH = Math.max(560, ...g.nodes.map((n) => n.y + NODE_H + 60));

  // Смета события из графа: площадка + артисты + подрядчики + комиссия GTR
  const quote = computeQuote(g, vid);

  // Живое здоровье события: статусы узлов + казус-проверки
  const budgetNum = parseThb(org.budget);
  const alerts = eventAlerts(g, v, {
    guests: org.guests,
    quoteTotal: quote.total,
    budget: budgetNum || undefined,
  });
  const health = graphHealth(alerts);
  const questions = EVENT_QUESTIONS.map((qq) => ({ ...qq, ok: qq.satisfied(g) }));
  const openQuestions = questions.filter((qq) => qq.required && !qq.ok);
  // Экспорт сметы: печатный документ, из которого браузер делает PDF.
  // Если попапы заблокированы — не молчим, а отдаём текстовый файл.
  const exportQuote = () => {
    const when = g.nodes.find((n) => n.kind === "slot")?.sub || "дата уточняется";
    const rooms =
      g.nodes
        .filter((n) => n.kind === "room")
        .map((n) => n.title)
        .join(", ") || "—";
    const no = `GTR-${vid.replace("VEN-", "")}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    const win = window.open("", "_blank", "width=900,height=1100");

    if (!win) {
      const body = [
        `GTR EVENT · Предложение по событию № ${no}`,
        `Площадка: ${v.name} (${vid})`,
        `Залы: ${rooms}`,
        `Когда: ${when}`,
        ``,
        ...quote.lines.map(
          (l) =>
            `  ${l.label} — ${l.amount ? fmtThb(l.amount) : "по запросу"}  (${l.note}; ${RATE_LABEL[l.kind]})`,
        ),
        ``,
        `Подытог: ${fmtThb(quote.subtotal)}`,
        `Комиссия GTR ${quote.commissionPct}%: ${fmtThb(quote.commission)}`,
        `ИТОГО: ${fmtThb(quote.total)}`,
        quote.missing.length
          ? `\nТребует уточнения:\n${quote.missing.map((m) => "  · " + m).join("\n")}`
          : ``,
        `\nОценка, THB. Точные ставки подтверждаются площадкой и подрядчиками.`,
      ].join("\n");
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${no}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Печать заблокирована браузером — смета скачана текстом", {
        description: "Разрешите всплывающие окна, чтобы получить PDF.",
      });
      return;
    }

    win.document.write(quoteDocument({ no, venue: v.name, vid, rooms, when, quote }));
    win.document.close();
    win.focus();
    // Даём странице отрисовать шрифты перед вызовом печати
    win.setTimeout(() => win.print(), 250);
  };

  // Организатор: отправка собранного события запросом в кабинет площадки
  const submitRequest = () => {
    const when = g.nodes.find((n) => n.kind === "slot")?.sub || org.date || "дата уточняется";
    const id = `REQ-${Date.now().toString(36)}`;
    addRequest({
      id,
      draftId: draft.id,
      venueId: vid,
      venueName: v.name || vid,
      organizerName: org.name.trim() || "Организатор",
      organizerContact: org.contact.trim() || "—",
      title: org.title.trim() || g.nodes.find((n) => n.kind === "artist")?.title || "Событие",
      date: when,
      guests: org.guests.trim() || "—",
      note: org.note.trim(),
      quoteSubtotal: quote.subtotal,
      quoteCommission: quote.commission,
      quoteTotal: quote.total,
      lines: quote.lines.map((l) => ({ label: l.label, note: l.note, amount: l.amount })),
      status: "new",
      ts: Date.now(),
    });
    setStage("sent", `Отправлено площадке · смета ${fmtThb(quote.total)}`);
    onSubmitted?.(id);

    // Уведомление менеджера GTR — доставка, а не условие приёма заявки:
    // заявка уже сохранена и видна площадке, что бы ни ответил Telegram.
    notifyRequestFn({
      data: {
        venueName: v.name || vid,
        venueId: vid,
        organizerName: org.name.trim() || "Организатор",
        organizerContact: org.contact.trim() || "—",
        title: org.title.trim() || "Событие",
        date: when,
        guests: org.guests.trim() || "—",
        note: org.note.trim(),
        total: quote.total,
        commission: quote.commission,
        lineCount: quote.lines.length,
      },
    })
      .then((r) => {
        if (r.ok) {
          toast("Менеджер GTR уведомлён в Telegram");
        } else if (r.reason === "not-configured") {
          toast("Заявка принята, Telegram не подключён", {
            description: "Уведомление не ушло: " + r.detail,
          });
        } else {
          toast("Заявка принята, уведомление не доставлено", { description: r.detail });
        }
      })
      .catch(() =>
        toast("Заявка принята, уведомление не доставлено", {
          description: "Сервер уведомлений недоступен",
        }),
      );
  };

  return (
    <div style={{ maxWidth: 1420, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h1 className="gtr-oswald" style={{ font: "700 22px/1 Oswald,sans-serif", margin: 0 }}>
          Конструктор события
        </h1>
        <Chip color="rgba(255,255,255,.5)">{v.name ?? vid}</Chip>
        <Chip color={STAGE_COLOR[stage]}>{STAGE_LABEL[stage].toUpperCase()}</Chip>
        {eventVibe?.colors ? (
          <span
            className="gtr-mono"
            title="Вайб события из брифа"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 99,
              padding: "5px 10px",
              font: "600 9.5px/1 'JetBrains Mono',monospace",
              letterSpacing: ".06em",
              color: "#fff",
              border: "1px solid rgba(255,255,255,.14)",
              background: `linear-gradient(120deg, ${eventVibe.colors[0]}44, ${eventVibe.colors[1]}44)`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: `linear-gradient(120deg, ${eventVibe.colors[0]}, ${eventVibe.colors[1]})`,
              }}
            />
            {eventVibe.label.toUpperCase()}
          </span>
        ) : null}
        <Chip
          color={STATUS_COLOR[health.verdict]}
          style={health.clean ? undefined : { animation: "gtrpulse 2s ease-out infinite" }}
        >
          {health.clean
            ? "СОБЫТИЕ В ПОРЯДКЕ"
            : `${health.problems + health.delays} ПРОБЛЕМ · ${health.warns} ВНИМАНИЕ`}
        </Chip>
        {linkFrom ? <Chip color={GREEN}>СВЯЗЬ: выберите левый порт целевого блока</Chip> : null}
        <button
          className={briefOpen ? "gtr-btn gtr-btn-red" : "gtr-btn"}
          style={{ padding: "6px 12px", fontSize: 11 }}
          onClick={() => setBriefOpen((x) => !x)}
        >
          Бриф · {briefProgress(briefFormat, briefAnswers).done}/
          {briefProgress(briefFormat, briefAnswers).total}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Eyebrow>УЧАСТНИКИ ОНЛАЙН</Eyebrow>
          <div style={{ display: "flex", gap: 5 }}>
            <span
              className="gtr-presence"
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "700 8px/1 Oswald,sans-serif",
                background: "rgba(229,35,27,.2)",
                border: "1px solid rgba(229,35,27,.6)",
              }}
            >
              {user.initials}
            </span>
            {peers.map((p) => (
              <span
                key={p.id}
                title={`${p.roleLabel} · ${p.name}`}
                className="gtr-presence"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "700 8px/1 Oswald,sans-serif",
                  background: "rgba(46,204,113,.16)",
                  border: "1px solid rgba(46,204,113,.5)",
                  color: "#2ECC71",
                }}
              >
                {p.initials}
              </span>
            ))}
          </div>
        </div>
      </div>

      {organizer ? (
        <Card style={{ padding: "14px 16px", marginBottom: 14, borderColor: "rgba(229,35,27,.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Eyebrow style={{ color: "#E5231B" }}>ЗАПРОС ПЛОЩАДКЕ · {v.name}</Eyebrow>
            <span
              className="gtr-mono"
              style={{
                font: "700 13px/1 'JetBrains Mono',monospace",
                color: "#2ECC71",
                marginLeft: "auto",
              }}
            >
              Смета: {fmtThb(quote.total)}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Формат события *"
              value={org.title}
              onChange={(e) => setOrg({ ...org, title: e.target.value })}
            />
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Дата / слот"
              value={org.date}
              onChange={(e) => setOrg({ ...org, date: e.target.value })}
            />
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Гостей"
              value={org.guests}
              onChange={(e) => setOrg({ ...org, guests: e.target.value })}
            />
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Бюджет, ฿"
              value={org.budget}
              onChange={(e) => setOrg({ ...org, budget: e.target.value })}
            />
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Ваше имя / компания *"
              value={org.name}
              onChange={(e) => setOrg({ ...org, name: e.target.value })}
            />
            <input
              className="gtr-input"
              style={{ fontSize: 11 }}
              placeholder="Контакт (email / телефон) *"
              value={org.contact}
              onChange={(e) => setOrg({ ...org, contact: e.target.value })}
            />
            <button
              className="gtr-btn gtr-btn-red"
              disabled={
                !org.title.trim() || !org.name.trim() || !org.contact.trim() || !quote.lines.length
              }
              onClick={submitRequest}
            >
              Отправить площадке →
            </button>
          </div>
        </Card>
      ) : null}

      {briefOpen ? (
        <BriefPanel
          format={briefFormat}
          answers={briefAnswers}
          onAnswer={setAnswer}
          onBuild={buildFromBrief}
          onClose={() => setBriefOpen(false)}
        />
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "230px 1fr 290px",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* ---------- палитра ---------- */}
        <Card
          style={{
            padding: 12,
            position: "sticky",
            top: 16,
            maxHeight: "calc(100vh - 40px)",
            overflowY: "auto",
          }}
        >
          <Eyebrow style={{ marginBottom: 10 }}>БЛОКИ СОБЫТИЯ</Eyebrow>
          <div style={{ display: "grid", gap: 6 }}>
            {CX_PALETTE.map(([kind, label]) => {
              const K = KINDS[kind];
              const vendors = VENDOR_CATALOG[kind] ?? [];
              const open = openCat === kind;
              const addBlank = () =>
                addNode(
                  kind,
                  label,
                  "Заполните данные блока",
                  "НОВОЕ",
                  [
                    ["ТИП", K[0]],
                    ["СТАТУС", "Черновик"],
                    ["ИСТОЧНИК", "—"],
                  ],
                  VENDOR_KINDS.includes(kind),
                );
              const isArtist = kind === "artist";
              const presets = presetsFor(kind, vid);
              const expandable = vendors.length > 0 || isArtist || presets.length > 0;
              return (
                <div key={kind}>
                  <button
                    className="gtr-pal-btn"
                    onClick={() => (expandable ? setOpenCat(open ? null : kind) : addBlank())}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        flex: "none",
                        borderRadius: 7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: K[2],
                        color: K[1],
                      }}
                    >
                      <Icon d={K[3]} size={13} />
                    </span>
                    <span style={{ flex: 1 }}>{label}</span>
                    <span
                      className="gtr-mono"
                      style={{
                        font: "700 12px/1 'JetBrains Mono',monospace",
                        color: "rgba(255,255,255,.3)",
                        transition: "transform .15s",
                        transform: open ? "rotate(90deg)" : "none",
                      }}
                    >
                      {expandable ? "›" : "+"}
                    </span>
                  </button>
                  {open && isArtist ? (
                    <div style={{ display: "grid", gap: 6, padding: "6px 0 4px 10px" }}>
                      <input
                        className="gtr-input"
                        style={{ padding: "7px 9px", fontSize: 11 }}
                        placeholder={artBase ? "Поиск по 312 артистам…" : "Загрузка базы…"}
                        value={artQ}
                        onChange={(e) => setArtQ(e.target.value)}
                      />
                      {lineupArtists.length ? (
                        <div className="gtr-eyebrow" style={{ fontSize: 8.5, marginTop: 2 }}>
                          ИЗ ЛАЙНАПА · {lineupArtists.length}
                        </div>
                      ) : null}
                      {lineupArtists.map((a) => (
                        <ArtistPick key={a.id} a={a} color={K[1]} onAdd={() => addArtistNode(a)} />
                      ))}
                      {artQ.trim() ? (
                        <div className="gtr-eyebrow" style={{ fontSize: 8.5, marginTop: 2 }}>
                          НАЙДЕНО · {artSearch.length}
                        </div>
                      ) : null}
                      {artSearch.map((a) => (
                        <ArtistPick key={a.id} a={a} color={K[1]} onAdd={() => addArtistNode(a)} />
                      ))}
                      {!lineupArtists.length && !artQ.trim() ? (
                        <div
                          style={{
                            font: "500 10px/1.5 'Golos Text',sans-serif",
                            color: "rgba(255,255,255,.4)",
                          }}
                        >
                          Добавьте артистов в лайнап на экране «Артисты и диджеи» или найдите по
                          имени.
                        </div>
                      ) : null}
                      <button
                        className="gtr-pal-btn"
                        style={{ padding: "7px 9px", color: "rgba(255,255,255,.55)" }}
                        onClick={() =>
                          navigate({ to: "/gtr/$screen", params: { screen: "artists" } })
                        }
                      >
                        Открыть базу артистов →
                      </button>
                    </div>
                  ) : null}
                  {/* Категории без подрядчиков: готовые варианты блока.
                      Залы, слоты и бюджет — из данных площадки, остальное —
                      типовой набор GTR. */}
                  {open && !isArtist && !vendors.length ? (
                    <div style={{ display: "grid", gap: 5, padding: "6px 0 4px 10px" }}>
                      {presets.map((p) => {
                        const added = g.nodes.some((n) => n.title === p.title);
                        return (
                          <button
                            key={p.key}
                            className="gtr-pal-btn"
                            style={{ padding: "7px 9px", opacity: added ? 0.45 : 1 }}
                            onClick={() =>
                              added
                                ? setSel(g.nodes.find((n) => n.title === p.title)!.id)
                                : addNode(kind, p.title, p.sub, p.badge, p.fields, true)
                            }
                          >
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: "block", fontWeight: 600, fontSize: 11 }}>
                                {p.title}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 2,
                                  font: "500 9px/1.3 'JetBrains Mono',monospace",
                                  color: "rgba(255,255,255,.4)",
                                }}
                              >
                                {added ? "уже в графе" : p.sub}
                              </span>
                            </span>
                            {p.fromBase ? (
                              <span
                                title="Из данных площадки"
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: "50%",
                                  background: GREEN,
                                  flex: "none",
                                }}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                      <button
                        className="gtr-pal-btn"
                        style={{ padding: "7px 9px", color: "rgba(255,255,255,.55)" }}
                        onClick={addBlank}
                      >
                        + Свой блок
                      </button>
                    </div>
                  ) : null}
                  {open && !isArtist && vendors.length ? (
                    <div style={{ display: "grid", gap: 5, padding: "6px 0 4px 10px" }}>
                      {vendors.map((vd) => {
                        const packs = packagesOf(vd.name);
                        return (
                          <div key={vd.name} style={{ display: "grid", gap: 4 }}>
                            <div
                              className="gtr-eyebrow"
                              style={{ fontSize: 8.5, marginTop: 2, color: "rgba(255,255,255,.45)" }}
                            >
                              {vd.name}
                            </div>
                            {/* Пакет с точной ценой — считается в смете как есть.
                                Без пакетов остаётся запрос цены у подрядчика. */}
                            {packs.map((p) => (
                              <button
                                key={p.package}
                                className="gtr-pal-btn"
                                style={{ padding: "7px 9px" }}
                                onClick={() =>
                                  addNode(
                                    kind,
                                    p.package,
                                    `${vd.name} · ${p.system}`,
                                    "ПАКЕТ",
                                    [
                                      ["ПОДРЯДЧИК", vd.name],
                                      ["ЦЕНА", packagePrice(p)],
                                      ["ЦЕНА_THB", String(p.price)],
                                      ["ПРОВЕРЕНО", p.verified || "не подтверждена"],
                                      ["КОНТАКТ", p.contact || vd.contact || "—"],
                                      ["ИСТОЧНИК", p.source || vd.source || "—"],
                                    ],
                                    true,
                                  )
                                }
                              >
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "block", fontWeight: 600, fontSize: 11 }}>
                                    {p.package}
                                  </span>
                                  <span
                                    style={{
                                      display: "block",
                                      marginTop: 2,
                                      font: "700 9.5px/1.3 'JetBrains Mono',monospace",
                                      color: K[1],
                                    }}
                                  >
                                    {packagePrice(p)}
                                    {p.verified ? (
                                      <span style={{ color: GREEN, marginLeft: 6 }}>
                                        ✓ {p.verified}
                                      </span>
                                    ) : null}
                                  </span>
                                  {p.note ? (
                                    <span
                                      style={{
                                        display: "block",
                                        marginTop: 2,
                                        font: "500 9px/1.35 'Golos Text',sans-serif",
                                        color: "rgba(255,255,255,.4)",
                                      }}
                                    >
                                      {p.note}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                            {!packs.length ? (
                              <button
                                className="gtr-pal-btn"
                                style={{ padding: "7px 9px" }}
                                onClick={() =>
                                  addNode(
                                    kind,
                                    vd.name,
                                    vd.meta,
                                    "ЗАПРОС",
                                    [
                                      ["ПОДРЯДЧИК", vd.name],
                                      ["ЦЕНА", vd.price || "по запросу"],
                                      ["КОНТАКТ", vd.contact || "—"],
                                      ["ИСТОЧНИК", vd.source || "—"],
                                    ],
                                    true,
                                  )
                                }
                              >
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "block", fontWeight: 600, fontSize: 11 }}>
                                    {vd.meta}
                                  </span>
                                  <span
                                    style={{
                                      display: "block",
                                      marginTop: 2,
                                      font: "600 9px/1.3 'JetBrains Mono',monospace",
                                      color: "rgba(255,255,255,.4)",
                                    }}
                                  >
                                    {vd.price || "цена по запросу"}
                                  </span>
                                </span>
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                      <button
                        className="gtr-pal-btn"
                        style={{ padding: "7px 9px", color: "rgba(255,255,255,.55)" }}
                        onClick={addBlank}
                      >
                        + Свой подрядчик
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

        {/* ---------- канвас ---------- */}
        <Card
          style={{
            overflow: "auto",
            background: "radial-gradient(circle at 30% 10%, #101116, #0A0B0D 70%)",
          }}
        >
          <div
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "relative",
              minWidth: 1030,
              height: canvasH,
              backgroundImage: "radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          >
            <svg
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {g.links.map((l, i) => {
                const a = nodeById(l.from);
                const b = nodeById(l.to);
                if (!a || !b) return null;
                const x1 = a.x + NODE_W;
                const y1 = a.y + 46;
                const x2 = b.x;
                const y2 = b.y + 46;
                const mx = (x1 + x2) / 2;
                const ls = linkStatus(a, b);
                const healthy = ls === "ok";
                return (
                  <path
                    key={i}
                    d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                    stroke={STATUS_COLOR[ls]}
                    strokeWidth={healthy ? 2 : 2.4}
                    fill="none"
                    opacity={healthy ? 0.85 : 0.95}
                    strokeDasharray={ls === "problem" || ls === "delay" ? "5 4" : undefined}
                    style={{ filter: healthy ? `drop-shadow(0 0 4px ${GREEN}66)` : undefined }}
                  >
                    {ls !== "ok" ? (
                      <animate
                        attributeName="opacity"
                        values="0.4;1;0.4"
                        dur="1.4s"
                        repeatCount="indefinite"
                      />
                    ) : null}
                  </path>
                );
              })}
            </svg>

            {g.nodes.map((n) => {
              const K = KINDS[n.kind];
              const on = sel === n.id;
              const linking = linkFrom === n.id;
              const st = nodeStatus(n);
              const healthy = st.status === "ok";
              const sc = STATUS_COLOR[st.status];
              return (
                <div
                  key={n.id}
                  className="gtr-node"
                  onPointerDown={(e) => onPointerDown(e, n)}
                  style={{
                    left: n.x,
                    top: n.y,
                    border: `1px solid ${on ? K[1] : linking ? GREEN : healthy ? "rgba(255,255,255,.11)" : sc}`,
                    boxShadow: on
                      ? "0 14px 34px rgba(229,35,27,.22)"
                      : healthy
                        ? "0 10px 26px rgba(0,0,0,.45)"
                        : `0 0 18px -2px ${sc}88, 0 10px 26px rgba(0,0,0,.45)`,
                  }}
                >
                  {/* индикатор статуса узла */}
                  <span
                    title={`${STATUS_LABEL[st.status]}${st.reason ? " · " + st.reason : ""}`}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: sc,
                      border: "2px solid #0A0B0D",
                      animation: healthy ? undefined : "gtrpulse 1.6s ease-out infinite",
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        flex: "none",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: K[2],
                        color: K[1],
                      }}
                    >
                      <Icon d={K[3]} size={11} />
                    </span>
                    <span
                      className="gtr-mono"
                      style={{
                        font: "600 8px/1 'JetBrains Mono',monospace",
                        letterSpacing: ".08em",
                        color: K[1],
                      }}
                    >
                      {K[0]}
                    </span>
                    {n.badge ? (
                      <span
                        className="gtr-mono"
                        style={{
                          marginLeft: "auto",
                          font: "600 8.5px/1 'JetBrains Mono',monospace",
                          color: "rgba(255,255,255,.5)",
                          background: "rgba(255,255,255,.07)",
                          borderRadius: 4,
                          padding: "3px 5px",
                        }}
                      >
                        {n.badge}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ font: "600 12px/1.25 'Golos Text',sans-serif" }}>{n.title}</div>
                  <div
                    style={{
                      marginTop: 4,
                      font: "500 9.5px/1.35 'Golos Text',sans-serif",
                      color: "rgba(255,255,255,.45)",
                    }}
                  >
                    {n.sub}
                  </div>

                  {/* порты */}
                  <span
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (linkFrom && linkFrom !== n.id) {
                        mutate((gr) =>
                          gr.links.some((l) => l.from === linkFrom && l.to === n.id)
                            ? gr
                            : { ...gr, links: [...gr.links, { from: linkFrom, to: n.id }] },
                        );
                        setLinkFrom(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: -7,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: "#0A0B0D",
                      border: `2px solid ${linkFrom && linkFrom !== n.id ? GREEN : "rgba(255,255,255,.28)"}`,
                      cursor: "crosshair",
                    }}
                  />
                  <span
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkFrom(linkFrom === n.id ? null : n.id);
                    }}
                    style={{
                      position: "absolute",
                      right: -7,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: linking ? GREEN : "#0A0B0D",
                      border: `2px solid ${linking ? GREEN : K[1]}`,
                      cursor: "crosshair",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        {/* ---------- инспектор ---------- */}
        <div
          style={{
            display: "grid",
            gap: 12,
            position: "sticky",
            top: 16,
            maxHeight: "calc(100vh - 40px)",
            overflowY: "auto",
          }}
        >
          {selNode ? (
            <Card style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 8.5px/1 'JetBrains Mono',monospace",
                    letterSpacing: ".08em",
                    color: selKind[1],
                  }}
                >
                  {selKind[0]}
                </span>
                <button
                  className="gtr-btn"
                  style={{
                    marginLeft: "auto",
                    padding: "4px 8px",
                    fontSize: 9.5,
                    color: "#E5231B",
                    borderColor: "rgba(229,35,27,.4)",
                  }}
                  onClick={() => {
                    if (selNode.kind === "venue") return;
                    mutate((gr) => ({
                      nodes: gr.nodes.filter((n) => n.id !== selNode.id),
                      links: gr.links.filter((l) => l.from !== selNode.id && l.to !== selNode.id),
                    }));
                    setSel(g.nodes[0]?.id ?? "n1");
                  }}
                  disabled={selNode.kind === "venue"}
                >
                  Удалить блок
                </button>
              </div>
              <input
                className="gtr-input"
                value={selNode.title}
                onChange={(e) => updateSel({ title: e.target.value })}
                style={{ marginBottom: 7 }}
              />
              <input
                className="gtr-input"
                value={selNode.sub}
                onChange={(e) => updateSel({ sub: e.target.value })}
                style={{ marginBottom: 10 }}
              />
              <div style={{ display: "grid", gap: 6 }}>
                {/* ЦЕНА_THB — служебное числовое поле для сметы, рядом с
                    человекочитаемой ЦЕНА его показывать незачем */}
                {selNode.fields.map(([k, val], i) =>
                  k === "ЦЕНА_THB" ? null : (
                  <div key={`${k}-${i}`}>
                    <Eyebrow style={{ fontSize: 8.5, marginBottom: 3 }}>{k}</Eyebrow>
                    <input
                      className="gtr-input"
                      style={{ padding: "7px 10px", fontSize: 11 }}
                      value={val}
                      onChange={(e) =>
                        updateSel({
                          fields: selNode.fields.map((f, j) =>
                            j === i ? [f[0], e.target.value] : f,
                          ),
                        })
                      }
                    />
                  </div>
                  ),
                )}
              </div>
              {selNode.kind === "artist" && selNode.fields.find((f) => f[0] === "КАРТОЧКА")?.[1] ? (
                <button
                  className="gtr-btn"
                  style={{ marginTop: 10, width: "100%" }}
                  onClick={() =>
                    navigate({
                      to: "/gtr/$screen",
                      params: { screen: "artists" },
                      search: { artist: selNode.fields.find((f) => f[0] === "КАРТОЧКА")![1] },
                    })
                  }
                >
                  Открыть карточку артиста →
                </button>
              ) : null}

              {/* Статус узла: участник может отметить задержку/проблему */}
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 11,
                  borderTop: "1px solid rgba(255,255,255,.07)",
                }}
              >
                <Eyebrow style={{ marginBottom: 7 }}>СТАТУС БЛОКА</Eyebrow>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {(["ok", "warn", "delay", "problem"] as NodeStatus[]).map((s) => {
                    const active = selNode.status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          const next = active ? undefined : s;
                          mutate((gr) => ({
                            ...gr,
                            nodes: gr.nodes.map((n) =>
                              n.id === selNode.id ? { ...n, status: next } : n,
                            ),
                            log:
                              next && next !== "ok"
                                ? pushLog(gr, `«${selNode.title}»: ${STATUS_LABEL[next]}`)
                                : gr.log,
                          }));
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 8px",
                          borderRadius: 7,
                          cursor: "pointer",
                          font: "600 9.5px/1 'Golos Text',sans-serif",
                          border: `1px solid ${active ? STATUS_COLOR[s] : "rgba(255,255,255,.12)"}`,
                          background: active ? `${STATUS_COLOR[s]}22` : "transparent",
                          color: active ? STATUS_COLOR[s] : "rgba(255,255,255,.6)",
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: STATUS_COLOR[s],
                            flex: "none",
                          }}
                        />
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                {selNode.status && selNode.status !== "ok" ? (
                  <input
                    className="gtr-input"
                    style={{ marginTop: 7, padding: "7px 10px", fontSize: 11 }}
                    placeholder="Что случилось? (виден всем участникам)"
                    value={selNode.note ?? ""}
                    onChange={(e) => updateSel({ note: e.target.value })}
                  />
                ) : (
                  <div
                    style={{
                      marginTop: 7,
                      font: "500 9.5px/1.4 'Golos Text',sans-serif",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    Авто: {nodeStatus(selNode).reason || "—"}
                  </div>
                )}
              </div>
            </Card>
          ) : null}

          <Card style={{ padding: 14 }}>
            <Eyebrow style={{ marginBottom: 9 }}>ПОДРЯДЧИКИ СОБЫТИЯ</Eyebrow>
            <div style={{ display: "grid", gap: 7 }}>
              {VENDOR_KINDS.map((k) => {
                const nodes = g.nodes.filter((n) => n.kind === k);
                const K = KINDS[k];
                return (
                  <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <Dot color={nodes.length ? GREEN : "rgba(255,255,255,.22)"} />
                    <span
                      className="gtr-mono"
                      style={{
                        font: "600 9px/1.4 'JetBrains Mono',monospace",
                        color: K[1],
                        width: 58,
                        flex: "none",
                      }}
                    >
                      {K[0]}
                    </span>
                    <span
                      style={{
                        font: "500 10.5px/1.4 'Golos Text',sans-serif",
                        color: nodes.length ? "#fff" : "rgba(255,255,255,.35)",
                      }}
                    >
                      {nodes.length ? nodes.map((n) => n.title).join(", ") : "Не назначен"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 11,
                paddingTop: 10,
                borderTop: "1px solid rgba(255,255,255,.06)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <Eyebrow>БЮДЖЕТ ПОДРЯДЧИКОВ</Eyebrow>
              <span
                className="gtr-mono"
                style={{
                  font: "700 13px/1 'JetBrains Mono',monospace",
                  color: budget ? "#FFD166" : "var(--gtr-t3)",
                }}
              >
                {budget ? `≈ ฿${budget.toLocaleString("ru-RU")} и выше` : "—"}
              </span>
            </div>
          </Card>

          {/* ---------- смета события ---------- */}
          <Card style={{ padding: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <Eyebrow>СМЕТА СОБЫТИЯ</Eyebrow>
              <button
                className="gtr-btn"
                style={{ padding: "4px 8px", fontSize: 9.5 }}
                onClick={exportQuote}
                disabled={!quote.lines.length}
              >
                Экспорт
              </button>
            </div>
            {quote.lines.length ? (
              <>
                <div style={{ display: "grid", gap: 6 }}>
                  {quote.lines.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            font: "600 11px/1.3 'Golos Text',sans-serif",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.label}
                        </span>
                        <span
                          className="gtr-mono"
                          style={{
                            font: "500 8.5px/1.3 'JetBrains Mono',monospace",
                            color: "var(--gtr-t3)",
                          }}
                        >
                          {l.note}
                        </span>
                      </span>
                      <span
                        style={{
                          flex: "none",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {/* Точка провенанса: подтверждённая цена, ориентир
                            или запрос — видно прямо в строке сметы */}
                        <span
                          title={RATE_LABEL[l.kind]}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: RATE_COLOR[l.kind],
                            flex: "none",
                          }}
                        />
                        <span
                          className="gtr-mono"
                          style={{
                            font: "600 10.5px/1 'JetBrains Mono',monospace",
                            color: l.amount ? "#fff" : "var(--gtr-t3)",
                          }}
                        >
                          {l.amount ? fmtThb(l.amount) : "по запросу"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 11,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,.08)",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <Row label="Подытог" value={fmtThb(quote.subtotal)} />
                  <Row
                    label={`Комиссия GTR · ${quote.commissionPct}%`}
                    value={fmtThb(quote.commission)}
                    accent="#FFD166"
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginTop: 4,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(255,255,255,.08)",
                    }}
                  >
                    <span className="gtr-oswald" style={{ font: "700 13px/1 Oswald,sans-serif" }}>
                      ИТОГО
                    </span>
                    <span
                      className="gtr-mono"
                      style={{ font: "700 15px/1 'JetBrains Mono',monospace", color: "#2ECC71" }}
                    >
                      {fmtThb(quote.total)}
                    </span>
                  </div>
                </div>
                {quote.hasEstimates ? (
                  <div
                    style={{
                      marginTop: 9,
                      font: "500 9px/1.4 'Golos Text',sans-serif",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    Оценка (THB). Точные ставки подтверждает площадка и подрядчики
                    {quote.missing.length ? ` · уточнить: ${quote.missing.length}` : ""}.
                  </div>
                ) : null}
              </>
            ) : (
              <div
                style={{ font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}
              >
                Добавьте площадку, артистов и подрядчиков — смета соберётся автоматически.
              </div>
            )}
          </Card>

          <Card style={{ padding: 14 }}>
            <Eyebrow style={{ marginBottom: 9 }}>СВЯЗИ · {g.links.length}</Eyebrow>
            <div style={{ display: "grid", gap: 5, maxHeight: 150, overflowY: "auto" }}>
              {g.links.map((l, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    font: "500 10px/1.3 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nodeById(l.from)?.title ?? "?"} → {nodeById(l.to)?.title ?? "?"}
                  </span>
                  <button
                    className="gtr-btn"
                    style={{ padding: "2px 7px", fontSize: 9 }}
                    onClick={() =>
                      mutate((gr) => ({ ...gr, links: gr.links.filter((_, j) => j !== i) }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Card>

          {/* Живые оповещения: статусы узлов + казус-проверки */}
          <Card
            style={{
              padding: 14,
              borderColor: health.clean
                ? "rgba(46,204,113,.3)"
                : `${STATUS_COLOR[health.verdict]}55`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Eyebrow>КОНТРОЛЬ СОБЫТИЯ</Eyebrow>
              {!health.clean ? (
                <span
                  className="gtr-mono"
                  style={{
                    marginLeft: "auto",
                    font: "700 9px/1 'JetBrains Mono',monospace",
                    color: STATUS_COLOR[health.verdict],
                  }}
                >
                  {health.problems ? `${health.problems} ПРОБ` : ""}{" "}
                  {health.delays ? `${health.delays} ЗАДЕРЖ` : ""}{" "}
                  {health.warns ? `${health.warns} ВНИМ` : ""}
                </span>
              ) : (
                <span
                  className="gtr-mono"
                  style={{
                    marginLeft: "auto",
                    font: "700 9px/1 'JetBrains Mono',monospace",
                    color: GREEN,
                  }}
                >
                  ВСЁ ЗЕЛЁНОЕ
                </span>
              )}
            </div>

            {health.clean ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 9,
                  background: "rgba(46,204,113,.1)",
                  border: "1px solid rgba(46,204,113,.3)",
                }}
              >
                <Dot color={GREEN} top={0} />
                <span style={{ font: "600 11px/1.4 'Golos Text',sans-serif", color: "#fff" }}>
                  Все связки зелёные — событие идёт по плану.
                </span>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                {alerts.map((a, i) => (
                  <div
                    key={i}
                    onClick={() => a.nodeId && setSel(a.nodeId)}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "9px 10px",
                      borderRadius: 8,
                      cursor: a.nodeId ? "pointer" : "default",
                      background: `${STATUS_COLOR[a.severity]}14`,
                      border: `1px solid ${STATUS_COLOR[a.severity]}44`,
                    }}
                  >
                    <Dot color={STATUS_COLOR[a.severity]} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ font: "600 11px/1.3 'Golos Text',sans-serif" }}>
                        {a.title}
                        {a.nodeId ? (
                          <span style={{ color: STATUS_COLOR[a.severity], fontWeight: 600 }}>
                            {" "}
                            · перейти →
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          font: "500 9.5px/1.4 'Golos Text',sans-serif",
                          color: "var(--gtr-t2)",
                        }}
                      >
                        {a.reason}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Умные вопросы — чтобы событие собралось без казусов */}
          <Card style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
              <Eyebrow>ВОПРОСЫ ПО СОБЫТИЮ</Eyebrow>
              <span
                className="gtr-mono"
                style={{
                  marginLeft: "auto",
                  font: "700 9px/1 'JetBrains Mono',monospace",
                  color: openQuestions.length ? AMBER : GREEN,
                }}
              >
                {questions.filter((q) => q.ok).length}/{questions.length}
              </span>
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              {questions.map((qq) => (
                <div key={qq.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      flex: "none",
                      borderRadius: "50%",
                      marginTop: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "700 9px/1 'JetBrains Mono',monospace",
                      background: qq.ok
                        ? "rgba(46,204,113,.16)"
                        : qq.required
                          ? "rgba(245,166,35,.14)"
                          : "rgba(255,255,255,.06)",
                      color: qq.ok ? GREEN : qq.required ? AMBER : "rgba(255,255,255,.4)",
                      border: `1px solid ${qq.ok ? "rgba(46,204,113,.4)" : qq.required ? "rgba(245,166,35,.4)" : "rgba(255,255,255,.1)"}`,
                    }}
                  >
                    {qq.ok ? "✓" : qq.required ? "!" : "?"}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        font: "600 11px/1.3 'Golos Text',sans-serif",
                        color: qq.ok ? "var(--gtr-t2)" : "#fff",
                        textDecoration: qq.ok ? "line-through" : "none",
                      }}
                    >
                      {qq.q}
                      {!qq.required ? (
                        <span style={{ color: "var(--gtr-t3)", fontWeight: 500 }}> · опц.</span>
                      ) : null}
                    </div>
                    {!qq.ok ? (
                      <div
                        style={{
                          marginTop: 2,
                          font: "500 9.5px/1.4 'Golos Text',sans-serif",
                          color: "var(--gtr-t3)",
                        }}
                      >
                        {qq.hint}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Статус события и короткая история изменений */}
          <Card style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Eyebrow>СТАТУС И ИСТОРИЯ</Eyebrow>
              <Chip color={STAGE_COLOR[stage]} style={{ marginLeft: "auto" }}>
                {STAGE_LABEL[stage].toUpperCase()}
              </Chip>
            </div>

            {!organizer ? (
              <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                {stage !== "approved" ? (
                  <button
                    className="gtr-btn gtr-btn-red"
                    style={{ flex: 1 }}
                    onClick={() => setStage("approved", "Событие утверждено")}
                  >
                    Утвердить событие
                  </button>
                ) : (
                  <button
                    className="gtr-btn"
                    style={{ flex: 1 }}
                    onClick={() => setStage("draft", "Возвращено в черновик")}
                  >
                    Вернуть в черновик
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  font: "500 10px/1.5 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                  marginBottom: 6,
                }}
              >
                {stage === "draft"
                  ? "Соберите событие и отправьте площадке для утверждения."
                  : "Запрос у площадки. Событие можно продолжать редактировать."}
              </div>
            )}
            {stage === "approved" ? (
              <div
                style={{
                  font: "500 9.5px/1.4 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                  marginBottom: 6,
                }}
              >
                Утверждено, но открыто для правок — изменения фиксируются в истории.
              </div>
            ) : null}

            <div
              style={{ marginTop: 8, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,.07)" }}
            >
              {g.log && g.log.length ? (
                <div style={{ display: "grid", gap: 6, maxHeight: 168, overflowY: "auto" }}>
                  {g.log.slice(0, 12).map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 8 }}>
                      <span
                        className="gtr-mono"
                        style={{
                          font: "500 8.5px/1.5 'JetBrains Mono',monospace",
                          color: "var(--gtr-t3)",
                          flex: "none",
                          width: 34,
                        }}
                      >
                        {new Date(e.ts).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        style={{
                          font: "500 10px/1.4 'Golos Text',sans-serif",
                          color: "var(--gtr-t2)",
                          minWidth: 0,
                        }}
                      >
                        <b style={{ color: "#fff", fontWeight: 600 }}>{e.actor}</b> · {e.action}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{ font: "500 10px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}
                >
                  История появится по мере сборки события.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Строка суммы в смете
function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ font: "500 10.5px/1.3 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
        {label}
      </span>
      <span
        className="gtr-mono"
        style={{ font: "600 11px/1 'JetBrains Mono',monospace", color: accent || "#fff" }}
      >
        {value}
      </span>
    </div>
  );
}

// Кнопка-артист в палитре конструктора: добавляет узел артиста в граф
function ArtistPick({ a, color, onAdd }: { a: Artist; color: string; onAdd: () => void }) {
  return (
    <button className="gtr-pal-btn" style={{ padding: "7px 9px" }} onClick={onAdd}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 11 }}>{a.name}</span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            font: "500 9px/1.3 'JetBrains Mono',monospace",
            color: "rgba(255,255,255,.4)",
          }}
        >
          {(a.styles || []).slice(0, 2).join(" · ") || a.role}
        </span>
        {a.tier ? (
          <span
            style={{
              display: "block",
              marginTop: 2,
              font: "600 9px/1.3 'JetBrains Mono',monospace",
              color,
            }}
          >
            {a.tier}
          </span>
        ) : null}
      </span>
      <span style={{ color: "rgba(255,255,255,.4)", fontWeight: 700 }}>+</span>
    </button>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// ---------- панель брифа ----------
// Вайб рендерится карточками с палитрой-градиентом, остальные вопросы —
// чипами. Панель двуязычная: организаторы на Пхукете часто англоязычные.
function BriefPanel({
  format,
  answers,
  onAnswer,
  onBuild,
  onClose,
}: {
  format: string;
  answers: BriefAnswers;
  onAnswer: (qid: string, ids: string[]) => void;
  onBuild: () => void;
  onClose: () => void;
}) {
  const [lang, setLang] = useState<BriefLang>(() => {
    try {
      return window.localStorage.getItem("gtr-brief-lang") === "en" ? "en" : "ru";
    } catch {
      return "ru";
    }
  });
  const switchLang = (l: BriefLang) => {
    setLang(l);
    try {
      window.localStorage.setItem("gtr-brief-lang", l);
    } catch {
      // приватный режим — язык просто не сохранится
    }
  };
  const t = (ru: string, en?: string) => (lang === "en" && en ? en : ru);

  const qs = visibleQuestions(format, answers);
  const prog = briefProgress(format, answers);
  const pending = modulesFromBrief(format, answers);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <Card style={{ padding: "20px 22px", marginBottom: 14, display: "grid", gap: 15 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Eyebrow>{t("БРИФ СОБЫТИЯ", "EVENT BRIEF")}</Eyebrow>
        <Chip color={prog.missing.length ? AMBER : GREEN}>
          {prog.done} / {prog.total}
        </Chip>
        <span
          className="gtr-mono"
          style={{ font: "500 10px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {format || t("формат не задан", "format not set")} ·{" "}
          {t("вопросы подстраиваются под ответы", "questions adapt to your answers")}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {(["ru", "en"] as BriefLang[]).map((l) => (
            <button
              key={l}
              onClick={() => switchLang(l)}
              style={{
                borderRadius: 6,
                padding: "5px 9px",
                cursor: "pointer",
                font: `700 9.5px/1 'JetBrains Mono',monospace`,
                letterSpacing: ".08em",
                border: `1px solid ${lang === l ? "#E5231B" : "rgba(255,255,255,.14)"}`,
                background: lang === l ? "rgba(229,35,27,.14)" : "transparent",
                color: lang === l ? "#fff" : "rgba(255,255,255,.5)",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <button
            className="gtr-btn"
            style={{ padding: "6px 12px", fontSize: 11 }}
            onClick={onClose}
          >
            {t("Свернуть", "Hide")}
          </button>
        </div>
      </div>

      {/* прогресс брифа */}
      <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,.07)" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 99,
            background: "linear-gradient(90deg,#E5231B,#F5A623)",
            transition: "width .35s cubic-bezier(.2,.7,.3,1)",
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 18 }}>
        {qs.map((qq, qi) => {
          const picked = answers[qq.id] ?? [];
          return (
            <div
              key={qq.id}
              className="gtr-brief-q"
              style={{ display: "grid", gap: 8, animationDelay: `${Math.min(qi * 45, 320)}ms` }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                <span style={{ font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>
                  {t(qq.q, qq.qEn)}
                </span>
                {qq.required ? (
                  <span
                    className="gtr-mono"
                    style={{ font: "600 8.5px/1 'JetBrains Mono',monospace", color: AMBER }}
                  >
                    {t("ОБЯЗАТЕЛЬНО", "REQUIRED")}
                  </span>
                ) : null}
                {qq.multi ? (
                  <span
                    className="gtr-mono"
                    style={{ font: "500 8.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {t("НЕСКОЛЬКО", "MULTI")}
                  </span>
                ) : null}
              </div>
              {qq.hint ? (
                <span
                  style={{
                    font: "500 10.5px/1.4 'Golos Text',sans-serif",
                    color: "var(--gtr-t3)",
                    marginTop: -3,
                  }}
                >
                  {t(qq.hint, qq.hintEn)}
                </span>
              ) : null}

              {qq.kind === "vibe" ? (
                /* вайб: карточки направления с палитрой */
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
                    gap: 9,
                  }}
                >
                  {qq.options.map((o) => {
                    const on = picked.includes(o.id);
                    const [c1, c2] = o.colors ?? ["#E5231B", "#F5A623"];
                    return (
                      <button
                        key={o.id}
                        className="gtr-vibe-card"
                        onClick={() => onAnswer(qq.id, on ? [] : [o.id])}
                        style={{
                          borderRadius: 12,
                          overflow: "hidden",
                          padding: 0,
                          textAlign: "left",
                          background: "var(--gtr-card2)",
                          border: `1px solid ${on ? c1 : "rgba(255,255,255,.1)"}`,
                          boxShadow: on ? `0 0 0 1px ${c1}, 0 8px 24px -12px ${c1}88` : "none",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: 44,
                            position: "relative",
                            background: `linear-gradient(120deg, ${c1}, ${c2})`,
                            opacity: on ? 1 : 0.55,
                            transition: "opacity .2s",
                          }}
                        >
                          {on ? (
                            <span
                              style={{
                                position: "absolute",
                                top: 8,
                                right: 8,
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: "rgba(10,11,13,.75)",
                                color: "#fff",
                                font: "700 10px/18px 'JetBrains Mono',monospace",
                                textAlign: "center",
                              }}
                            >
                              ✓
                            </span>
                          ) : null}
                        </span>
                        <span style={{ display: "block", padding: "10px 12px 12px" }}>
                          <span
                            style={{
                              display: "block",
                              font: "600 12px/1.3 'Golos Text',sans-serif",
                              color: on ? "#fff" : "rgba(255,255,255,.82)",
                            }}
                          >
                            {t(o.label, o.labelEn)}
                          </span>
                          <span
                            style={{
                              display: "block",
                              marginTop: 4,
                              font: "500 10px/1.45 'Golos Text',sans-serif",
                              color: "var(--gtr-t3)",
                            }}
                          >
                            {t(o.hint ?? "", o.hintEn)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {qq.options.map((o) => {
                    const on = picked.includes(o.id);
                    const adds = (o.modules ?? []).length;
                    return (
                      <button
                        key={o.id}
                        onClick={() =>
                          onAnswer(
                            qq.id,
                            qq.multi
                              ? on
                                ? picked.filter((x) => x !== o.id)
                                : [...picked, o.id]
                              : on
                                ? []
                                : [o.id],
                          )
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          borderRadius: 8,
                          padding: "8px 13px",
                          cursor: "pointer",
                          textAlign: "left",
                          font: `${on ? 600 : 500} 11.5px/1.3 'Golos Text',sans-serif`,
                          border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                          background: on ? "rgba(229,35,27,.14)" : "transparent",
                          color: on ? "#fff" : "rgba(255,255,255,.62)",
                          transition: "border-color .15s, background .15s, color .15s",
                        }}
                      >
                        <span
                          style={{
                            width: 13,
                            height: 13,
                            flex: "none",
                            borderRadius: qq.multi ? 4 : "50%",
                            border: `1px solid ${on ? "#E5231B" : "rgba(255,255,255,.25)"}`,
                            background: on ? "#E5231B" : "transparent",
                            transition: "background .15s, border-color .15s",
                          }}
                        />
                        <span>
                          {t(o.label, o.labelEn)}
                          {o.hint ? (
                            <span
                              style={{
                                display: "block",
                                marginTop: 2,
                                font: "500 9px/1.3 'JetBrains Mono',monospace",
                                color: "rgba(255,255,255,.4)",
                              }}
                            >
                              {t(o.hint, o.hintEn)}
                            </span>
                          ) : null}
                        </span>
                        {adds ? (
                          <span
                            className="gtr-mono"
                            title={t(`Добавит блоков: ${adds}`, `Adds ${adds} block(s)`)}
                            style={{
                              font: "600 8.5px/1 'JetBrains Mono',monospace",
                              color: on ? GREEN : "rgba(255,255,255,.3)",
                            }}
                          >
                            +{adds}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          borderTop: "1px solid rgba(255,255,255,.08)",
          paddingTop: 13,
        }}
      >
        <span
          style={{ font: "500 11.5px/1.45 'Golos Text',sans-serif", color: "var(--gtr-t2)", flex: 1 }}
        >
          {pending.length
            ? t(
                `Ответы дают ${pending.length} ${plural(pending.length, "блок", "блока", "блоков")} события. Уже добавленные не дублируются.`,
                `Your answers produce ${pending.length} event ${pending.length === 1 ? "block" : "blocks"}. Existing ones are not duplicated.`,
              )
            : t(
                "Ответьте на вопросы — из них соберутся блоки события.",
                "Answer the questions — they turn into event blocks.",
              )}
          {prog.missing.length ? (
            <span style={{ color: AMBER }}>
              {" "}
              {t("Без ответа обязательных:", "Required unanswered:")}{" "}
              {prog.missing.map((m) => t(m.q, m.qEn)).join(", ")}
            </span>
          ) : null}
        </span>
        <button
          className="gtr-btn gtr-btn-red"
          style={{ padding: "9px 15px", opacity: pending.length ? 1 : 0.4 }}
          disabled={!pending.length}
          onClick={onBuild}
        >
          {t("Собрать блоки из брифа →", "Build event blocks →")}
        </button>
      </div>
    </Card>
  );
}
