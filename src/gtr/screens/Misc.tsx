import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { can, PERMISSIONS } from "../auth";
import {
  deleteUserFn,
  inviteUserFn,
  listManagersFn,
  listUsersFn,
  createInviteFn,
  tgLinkFn,
  tgStatusFn,
  type PublicUser,
} from "../kv-api";
import { notifyAssignFn } from "../notify";
import { openAppLink } from "../applink";
import {
  AMBER,
  finBlockerOf,
  finKpiOf,
  fmtThb,
  GREEN,
  inqOf,
  PH,
  RED,
  richOf,
  ROLES,
  SPACES,
  SPACES_TECH,
  V,
} from "../data/app-data";
import { useVenueContacts } from "../work-contacts";
import { useGtr } from "../store";
import { Card, Chip, Dot, Eyebrow, tint } from "../ui";

const Title = ({ children }: { children: string }) => (
  <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 16 }}>
    {children}
  </h1>
);

const NoAccess = ({ what }: { what: string }) => (
  <Card style={{ maxWidth: 520, margin: "60px auto", padding: 28, textAlign: "center" }}>
    <div
      className="gtr-oswald"
      style={{ font: "600 18px/1.2 Oswald,sans-serif", marginBottom: 10 }}
    >
      Доступ ограничен
    </div>
    <div style={{ font: "500 12px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
      Для вашей роли раздел «{what}» закрыт матрицей прав. Запросите доступ у GTR-админа — раздел
      «Доступы и роли».
    </div>
  </Card>
);

// ---------- заявки организаторов ----------
export function InquiriesScreen() {
  const { user, shared, updateRequest, setDraftGraph, draftsOf } = useGtr();
  const vid = user.venueId || "VEN-0013";
  const rows = inqOf(vid);
  const [replied, setReplied] = useState<number[]>([]);

  // Входящие запросы организаторов (собраны на витрине, падают со сметой).
  // GTR-админ видит все по сети, роль площадки — свои и назначенные на себя.
  const incoming = (
    user.role === "gtr"
      ? shared.requests
      : shared.requests.filter((r) => r.venueId === vid || r.assignee === user.email)
  ).sort((a, b) => b.ts - a.ts);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  // Принять запрос: помечаем и переводим в «Утверждено» именно то событие, из
  // которого заявка собрана. У заявок старого формата draftId нет — тогда
  // берём последнее событие площадки.
  const acceptRequest = (id: string, name: string) => {
    updateRequest(id, { status: "accepted" });
    const req = shared.requests.find((r) => r.id === id);
    const targetId = req?.draftId ?? draftsOf(req?.venueId || vid)[0]?.id;
    if (!targetId) return;
    setDraftGraph(targetId, (gr) => ({
      ...gr,
      stage: "approved",
      log: [
        { ts: Date.now(), actor: user.roleLabel, action: `Запрос принят: ${name}` },
        ...(gr.log ?? []),
      ].slice(0, 40),
    }));
  };

  const blockers =
    user.role === "owner"
      ? [
          [
            "Живой календарь",
            "Доступность подтверждается вручную — организатор ждёт ответа",
            AMBER,
          ],
          ["Депозит и отмена", "Условия не зафиксированы в кабинете", RED],
          ["Комиссия", "Не согласована с GTR", RED],
        ]
      : user.role === "sales"
        ? [
            ["Матрица вместимости", "Полная матрица сетапов по залам не загружена", RED],
            ["Net-ставки", "Нетто-ставки и пакеты не получены", RED],
            ["AV и тех-райдер", "Свет, звук, экраны — нет структурированных данных", AMBER],
          ]
        : [
            [
              "Прайс-лист",
              "Нет в «Готовности к бронированию» — расчёт для организатора невозможен",
              RED,
            ],
            [
              "Презентация приватной аренды",
              "P0 по Illuzion Group: презентация, комиссия, правила промоутеров",
              RED,
            ],
            [
              "Вместимость Empire и Shelter",
              "Публично не заявлена — нужны цифры от площадки",
              AMBER,
            ],
          ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 className="gtr-oswald gtr-h1">
          Заявки организаторов
        </h1>
        {incoming.length ? (
          <Chip color="#2ECC71" style={{ animation: "gtrpulse 2s ease-out infinite" }}>
            +{incoming.length} ЧЕРЕЗ GTR
          </Chip>
        ) : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(
            [
              ["kanban", "Канбан"],
              ["list", "Список"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                borderRadius: 0,
                padding: "7px 12px",
                cursor: "pointer",
                font: `${view === v ? 600 : 500} 10.5px/1 'JetBrains Mono',monospace`,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                border: `1px solid ${view === v ? "#E5231B" : "rgba(255,255,255,.14)"}`,
                background: view === v ? "rgba(229,35,27,.14)" : "transparent",
                color: view === v ? "#fff" : "rgba(255,255,255,.55)",
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {view === "kanban" ? (
        <RequestsKanban
          requests={incoming}
          isAdmin={user.role === "gtr"}
          onMove={(r, status) => {
            if (status === r.status) return;
            if (status === "accepted") acceptRequest(r.id, r.title);
            else updateRequest(r.id, { status });
          }}
        />
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(270px,320px)", gap: 16 }}>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {view === "list" && incoming.length ? (
            <Card style={{ borderColor: "rgba(46,204,113,.3)" }}>
              <div
                className="gtr-oswald"
                style={{
                  font: "600 13px/1 Oswald,sans-serif",
                  padding: "13px 20px",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  color: "#2ECC71",
                }}
              >
                Входящие через GTR · {incoming.length}
              </div>
              {incoming.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                    borderLeft: "2px solid #2ECC71",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{ display: "block", font: "600 13px/1.3 'Golos Text',sans-serif" }}
                      >
                        {r.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 4,
                          font: "500 10.5px/1.4 'Golos Text',sans-serif",
                          color: "var(--gtr-t2)",
                        }}
                      >
                        {r.organizerName} · {r.date} · {r.guests} гостей · {r.organizerContact}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", flex: "none" }}>
                      <span
                        className="gtr-mono"
                        style={{
                          display: "block",
                          font: "700 14px/1 'JetBrains Mono',monospace",
                          color: "#2ECC71",
                        }}
                      >
                        {fmtThb(r.quoteTotal)}
                      </span>
                      <span className="gtr-eyebrow" style={{ fontSize: 8 }}>
                        КОМ. GTR {fmtThb(r.quoteCommission)}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 9,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    {r.lines.slice(0, 5).map((l, j) => (
                      <Chip key={j} color="rgba(255,255,255,.5)">
                        {l.label}
                      </Chip>
                    ))}
                    <AssignControl r={r} />
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <Chip
                        color={
                          r.status === "accepted"
                            ? GREEN
                            : r.status === "declined"
                              ? RED
                              : r.status === "seen"
                                ? AMBER
                                : "#2ECC71"
                        }
                      >
                        {r.status === "accepted"
                          ? "ПРИНЯТО"
                          : r.status === "declined"
                            ? "ОТКЛОНЕНО"
                            : r.status === "seen"
                              ? "ПРОСМОТРЕНО"
                              : "НОВЫЙ"}
                      </Chip>
                      {r.status !== "accepted" && r.status !== "declined" ? (
                        <>
                          <button
                            className="gtr-btn gtr-btn-red"
                            style={{ padding: "5px 10px", fontSize: 10 }}
                            disabled={!can(user.role, "inquiries.reply")}
                            onClick={() => acceptRequest(r.id, r.title)}
                          >
                            Принять
                          </button>
                          <button
                            className="gtr-btn"
                            style={{ padding: "5px 10px", fontSize: 10 }}
                            disabled={!can(user.role, "inquiries.reply")}
                            onClick={() => updateRequest(r.id, { status: "declined" })}
                          >
                            Отклонить
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          ) : null}

          <Card>
            {/* Архивных заявок по площадке может не быть — это нормальное
                состояние, а не повод показывать чужие */}
            {!rows.length ? (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  font: "500 12px/1.6 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                История заявок по этой площадке пока не собрана.
                <br />
                Новые запросы с витрины появятся здесь сразу.
              </div>
            ) : null}
            {rows.map(([day, mon, title, meta, budget, sla, status, c, cta], i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "15px 20px",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  borderLeft: `2px solid ${c}`,
                }}
              >
                <span style={{ textAlign: "center", flex: "none", width: 40 }}>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", font: "700 17px/1 'JetBrains Mono',monospace" }}
                  >
                    {day}
                  </span>
                  <span className="gtr-eyebrow" style={{ fontSize: 8.5 }}>
                    {mon}
                  </span>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}
                  >
                    {title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      font: "500 10.5px/1.4 'Golos Text',sans-serif",
                      color: "var(--gtr-t2)",
                    }}
                  >
                    {meta}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      display: "block",
                      marginTop: 4,
                      font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    Бюджет: {budget} · {sla}
                  </span>
                </span>
                <Chip color={c} style={{ width: 108, textAlign: "center" }}>
                  {replied.includes(i) ? "ОТВЕЧЕНО" : status}
                </Chip>
                <button
                  className={`gtr-btn ${cta === "Ответить" && !replied.includes(i) ? "gtr-btn-red" : ""}`}
                  disabled={!can(user.role, "inquiries.reply")}
                  onClick={() => setReplied((r) => (r.includes(i) ? r : [...r, i]))}
                >
                  {replied.includes(i) ? "Открыть" : cta}
                </button>
              </div>
            ))}
          </Card>
        </div>
        <Card style={{ alignSelf: "start", padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ЧТО БЛОКИРУЕТ БЫСТРЫЙ ОТВЕТ</Eyebrow>
          <div style={{ display: "grid", gap: 10 }}>
            {blockers.map(([t, d, c]) => (
              <div key={String(t)} style={{ display: "flex", gap: 9 }}>
                <Dot color={String(c)} />
                <div>
                  <div style={{ font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>{t}</div>
                  <div
                    style={{
                      marginTop: 3,
                      font: "500 10.5px/1.45 'Golos Text',sans-serif",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------- залы и прайс ----------
// Ссылки-приглашения: человек сам заводит аккаунт на /gtr/join.
// Быстрее, чем вводить пароль за него: одна ссылка — до 10 вступлений.
function InviteLinks() {
  const [role, setRole] = useState<"organizer" | "sales" | "artist">("organizer");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  const make = async () => {
    setMsg("");
    try {
      const r = await createInviteFn({ data: { role } });
      if (r.ok) {
        const full = `${location.origin}${r.link}`;
        setLink(full);
        try {
          await navigator.clipboard.writeText(full);
          setMsg("Скопирована");
        } catch {
          setMsg("Скопируйте вручную");
        }
      } else setMsg(r.error ?? "Не получилось");
    } catch {
      setMsg("Сервер недоступен");
    }
  };
  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,.07)" }}>
      <Eyebrow style={{ fontSize: 8.5 }}>ССЫЛКА-ПРИГЛАШЕНИЕ (АККАУНТ ЗАВОДИТ САМ ЧЕЛОВЕК)</Eyebrow>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        {(
          [
            ["organizer", "Организатор"],
            ["sales", "Менеджер"],
            ["artist", "Артист"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            style={{
              borderRadius: 0,
              padding: "7px 11px",
              cursor: "pointer",
              font: `${role === r ? 600 : 500} 10.5px/1 'Golos Text',sans-serif`,
              border: `1px solid ${role === r ? "#E5231B" : "rgba(255,255,255,.14)"}`,
              background: role === r ? "rgba(229,35,27,.14)" : "transparent",
              color: role === r ? "#fff" : "rgba(255,255,255,.6)",
            }}
          >
            {label}
          </button>
        ))}
        <button className="gtr-btn" style={{ padding: "8px 12px" }} onClick={make}>
          Создать ссылку
        </button>
        {msg ? <span style={{ font: "500 10px/1.3 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>{msg}</span> : null}
      </div>
      {link ? (
        <input
          className="gtr-input"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          style={{ padding: "7px 9px", fontSize: 10.5, maxWidth: 460 }}
        />
      ) : null}
    </div>
  );
}

// ---------- канбан заявок ----------
// Четыре стадии, перетаскивание карточек мышью + стрелки для тач-экранов.
// Перенос в «Приняты» дополнительно утверждает событие заявки.
const KANBAN_COLS: [import("../data/app-data").OrgRequestStatus, string, string][] = [
  ["new", "Новые", "#2ECC71"],
  ["seen", "В работе", AMBER],
  ["accepted", "Приняты", GREEN],
  ["declined", "Отклонены", RED],
];

function RequestsKanban({
  requests,
  isAdmin,
  onMove,
}: {
  requests: import("../data/app-data").OrgRequest[];
  isAdmin: boolean;
  onMove: (
    r: import("../data/app-data").OrgRequest,
    status: import("../data/app-data").OrgRequestStatus,
  ) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  if (!requests.length)
    return (
      <Card style={{ padding: "26px 24px", marginBottom: 16, textAlign: "center" }}>
        <div style={{ font: "500 12.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          Заявок пока нет. Они появляются, когда организатор отправляет запрос с витрины —
          и сразу встают в колонку «Новые».
        </div>
      </Card>
    );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(230px, 1fr))",
        gap: 12,
        marginBottom: 18,
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {KANBAN_COLS.map(([st, label, color]) => {
        const cards = requests.filter((r) => r.status === st);
        const hot = overCol === st && dragId;
        return (
          <div
            key={st}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(st);
            }}
            onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              const r = requests.find((x) => x.id === dragId);
              if (r) onMove(r, st);
              setDragId(null);
              setOverCol(null);
            }}
            style={{
              display: "grid",
              gap: 8,
              alignContent: "start",
              padding: 10,
              minHeight: 160,
              background: hot ? tint(color, 0.08) : "rgba(255,255,255,.02)",
              border: `1px ${hot ? "dashed" : "solid"} ${hot ? color : "rgba(255,255,255,.07)"}`,
              borderTop: `2px solid ${color}`,
              transition: "background .15s, border-color .15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Dot color={color} />
              <span
                className="gtr-oswald"
                style={{
                  font: "600 12px/1 Oswald,sans-serif",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                }}
              >
                {label}
              </span>
              <span
                className="gtr-mono"
                style={{ marginLeft: "auto", font: "700 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
              >
                {cards.length}
              </span>
            </div>
            {cards.map((r) => (
              <KanbanCard
                key={r.id}
                r={r}
                col={st}
                color={color}
                isAdmin={isAdmin}
                dragging={dragId === r.id}
                onDragStart={() => setDragId(r.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverCol(null);
                }}
                onMove={onMove}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  r,
  col,
  color,
  isAdmin,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  r: import("../data/app-data").OrgRequest;
  col: import("../data/app-data").OrgRequestStatus;
  color: string;
  isAdmin: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (
    r: import("../data/app-data").OrgRequest,
    status: import("../data/app-data").OrgRequestStatus,
  ) => void;
}) {
  const idx = KANBAN_COLS.findIndex(([sName]) => sName === col);
  const prev = KANBAN_COLS[idx - 1]?.[0];
  const next = KANBAN_COLS[idx + 1]?.[0];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        display: "grid",
        gap: 7,
        padding: "10px 11px",
        cursor: "grab",
        background: "var(--gtr-card2)",
        border: "1px solid rgba(255,255,255,.09)",
        borderLeft: `2px solid ${color}`,
        opacity: dragging ? 0.4 : 1,
        clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
      }}
    >
      <div style={{ font: "600 12px/1.35 'Golos Text',sans-serif" }}>{r.title || "Заявка"}</div>
      <div
        className="gtr-mono"
        style={{ font: "500 9px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
      >
        {isAdmin ? `${r.venueName} · ` : ""}
        {r.organizerName || "организатор"}
        {r.date ? ` · ${r.date}` : ""}
        {r.guests ? ` · ${r.guests} гостей` : ""}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          className="gtr-mono"
          style={{ font: "700 12px/1 'JetBrains Mono',monospace", color: "#fff" }}
        >
          {fmtThb(r.quoteTotal)}
        </span>
        <span
          className="gtr-mono"
          style={{ font: "500 8.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          ком. {fmtThb(r.quoteCommission)}
        </span>
        {r.assignee ? (
          <span
            className="gtr-mono"
            style={{
              marginLeft: "auto",
              font: "600 8.5px/1 'JetBrains Mono',monospace",
              color: "#7B9EFF",
              border: "1px solid rgba(123,158,255,.4)",
              padding: "3px 6px",
            }}
          >
            {(r.assigneeName || r.assignee).toUpperCase()}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {prev ? (
          <button
            className="gtr-btn"
            style={{ padding: "4px 9px", fontSize: 11 }}
            title={`В «${KANBAN_COLS[idx - 1][1]}»`}
            onClick={() => onMove(r, prev)}
          >
            ←
          </button>
        ) : null}
        {next ? (
          <button
            className="gtr-btn"
            style={{ padding: "4px 9px", fontSize: 11 }}
            title={`В «${KANBAN_COLS[idx + 1][1]}»`}
            onClick={() => onMove(r, next)}
          >
            →
          </button>
        ) : null}
        <span style={{ marginLeft: "auto" }}>
          <AssignControl r={r} />
        </span>
      </div>
    </div>
  );
}

// Кто ведёт заявку: менеджер берёт на себя, GTR-админ может назначить любого
// из приглашённых. Назначение уходит уведомлением в Telegram-канал GTR.
function AssignControl({ r }: { r: import("../data/app-data").OrgRequest }) {
  const { user, updateRequest } = useGtr();
  const [pick, setPick] = useState(false);
  const [managers, setManagers] = useState<{ email: string; name: string }[]>([]);

  const assign = (email: string, name: string) => {
    updateRequest(r.id, { assignee: email, assigneeName: name, status: r.status === "new" ? "seen" : r.status });
    setPick(false);
    notifyAssignFn({
      data: {
        title: r.title,
        venueName: r.venueName,
        date: r.date,
        guests: r.guests,
        assigneeName: name,
        assigneeEmail: email,
        byName: user.name,
      },
    }).catch(() => {});
  };

  if (r.assignee)
    return (
      <Chip color="#7B9EFF">
        ВЕДЁТ: {(r.assigneeName || r.assignee).toUpperCase()}
      </Chip>
    );

  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="gtr-btn"
        style={{ padding: "5px 10px", fontSize: 10 }}
        onClick={() => assign(user.email, user.name)}
      >
        Взять на себя
      </button>
      {user.role === "gtr" ? (
        <button
          className="gtr-btn"
          style={{ padding: "5px 10px", fontSize: 10 }}
          onClick={() => {
            setPick((x) => !x);
            if (!managers.length)
              listManagersFn().then((res) => setManagers(res.managers)).catch(() => {});
          }}
        >
          Назначить…
        </button>
      ) : null}
      {pick
        ? managers.map((m) => (
            <button
              key={m.email}
              className="gtr-btn"
              style={{ padding: "5px 10px", fontSize: 10, color: "#7B9EFF" }}
              onClick={() => assign(m.email, m.name)}
            >
              {m.name}
            </button>
          ))
        : null}
      {pick && !managers.length ? (
        <span style={{ font: "500 10px/1.3 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          приглашённых пока нет
        </span>
      ) : null}
    </span>
  );
}

export function SpacesScreen() {
  const { user } = useGtr();
  const vid = user.venueId || "VEN-0013";
  const sp = SPACES(vid);
  const v = V(vid);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Title>Залы и прайс</Title>
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1.4fr",
            gap: 10,
            padding: "12px 20px",
            borderBottom: "1px solid rgba(255,255,255,.07)",
          }}
        >
          {["ЗАЛ", "ПЛОЩАДЬ", "ВМЕСТИМОСТЬ", "СТАТУС"].map((h) => (
            <span key={h} className="gtr-eyebrow">
              {h}
            </span>
          ))}
        </div>
        {(sp.length
          ? sp
          : [
              {
                id: "none",
                name: "Залы не нормализованы",
                type: "—",
                sqm: "",
                capTheatre: "",
                capCocktail: "",
                notes: "Импорт залов в очереди исследований",
                bookable: "Требует данных",
              },
            ]
        ).map((x) => (
          <div
            key={x.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1.4fr",
              gap: 10,
              padding: "13px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
              alignItems: "center",
            }}
          >
            <span>
              <span style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>
                {x.name}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  font: "500 10px/1.4 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                }}
              >
                {[x.type, x.notes].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace" }}>
              {x.sqm ? `${x.sqm} м²` : "—"}
            </span>
            <span
              className="gtr-mono"
              style={{ font: "500 10.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
            >
              {x.capCocktail
                ? `${x.capCocktail} коктейль`
                : x.capTheatre
                  ? `${x.capTheatre} театр`
                  : "—"}
            </span>
            <span>
              <Chip
                color={
                  /Published/i.test(String(x.bookable || ""))
                    ? GREEN
                    : /Inquiry|request/i.test(String(x.bookable || ""))
                      ? AMBER
                      : RED
                }
              >
                {String(x.bookable || "—").toUpperCase()}
              </Chip>
            </span>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20 }}>
        <Eyebrow style={{ marginBottom: 10 }}>ТЕХНИКА И ИНФРАСТРУКТУРА</Eyebrow>
        <div style={{ font: "500 12px/1.7 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {SPACES_TECH[vid] ?? v.facilities ?? "Данные уточняются у площадки."}
        </div>
      </Card>
    </div>
  );
}

// ---------- паспорт площадки ----------
export function VenueScreen() {
  const { user } = useGtr();
  const navigate = useNavigate();
  const vid = user.venueId || "VEN-0013";
  const v = V(vid);
  const ct = useVenueContacts()(vid);
  const rich = richOf(vid);
  const R = v.readiness;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Title>Паспорт площадки</Title>

      <Card
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 26px",
          marginBottom: 16,
          minHeight: 150,
        }}
      >
        {rich.hero ? (
          <>
            <img
              src={rich.hero}
              alt={v.name}
              loading="lazy"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(90deg,#0A0B0Dee,#0A0B0D55)",
              }}
            />
          </>
        ) : null}
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>{v.id}</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <h2
              className="gtr-oswald"
              style={{ font: "700 26px/1.05 Oswald,sans-serif", margin: 0 }}
            >
              {v.name}
            </h2>
            <Chip color={v.verified ? GREEN : AMBER}>
              {v.verified ? `ПРОВЕРЕНО ${v.verified}` : "НЕ ВЕРИФИЦИРОВАНО"}
            </Chip>
            {rich.badge ? <Chip color="#FFD166">{rich.badge}</Chip> : null}
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
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 16 }}>
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ДАННЫЕ ПЛОЩАДКИ</Eyebrow>
          {[
            ["ФОРМАТЫ СОБЫТИЙ", v.events],
            ["ЗОНЫ И ИНФРАСТРУКТУРА", v.facilities],
            ["ВМЕСТИМОСТЬ", v.capacity],
            ["МУЗЫКА / РАЗВЛЕЧЕНИЯ", v.music],
            ["ИНТЕГРАЦИОННЫЕ ЗАМЕТКИ", v.notes],
          ]
            .filter(([, val]) => val)
            .map(([k, val]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                }}
              >
                <span className="gtr-eyebrow" style={{ width: 150, flex: "none", paddingTop: 2 }}>
                  {k}
                </span>
                <span
                  style={{
                    font: "500 11.5px/1.55 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {String(val)}
                </span>
              </div>
            ))}
        </Card>

        <Card style={{ padding: 18, alignSelf: "start" }}>
          <Eyebrow style={{ marginBottom: 10 }}>ИСТОЧНИКИ</Eyebrow>
          {[
            ["Официальный сайт", v.website || v.source || "—", v.website || v.source ? GREEN : RED],
            ["Галерея / фото", "только официальная галерея", AMBER],
            ["Instagram", v.social || "не указан", v.social ? AMBER : "rgba(255,255,255,.3)"],
            [
              "Telegram",
              v.telegram ? (
                <a href={v.telegram} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                  {v.telegram.replace(/^https:\/\/t\.me\//, "@")}
                </a>
              ) : (
                "не указан"
              ),
              v.telegram ? GREEN : "rgba(255,255,255,.3)",
            ],
            ["Телефон", v.phone || ct?.phone || "—", v.phone || ct?.phone ? GREEN : RED],
          ].map(([k, val, c]) => (
            <div
              key={String(k)}
              style={{
                display: "flex",
                gap: 9,
                padding: "7px 0",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  flex: "none",
                  borderRadius: 0,
                  background: String(c),
                  position: "relative",
                  top: 1,
                }}
              />
              <span className="gtr-eyebrow" style={{ width: 110, flex: "none" }}>
                {k}
              </span>
              <span
                style={{
                  font: "500 10.5px/1.5 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                  wordBreak: "break-all",
                }}
              >
                {String(val)}
              </span>
            </div>
          ))}
          {R ? (
            <>
              <Eyebrow style={{ margin: "14px 0 8px" }}>ЧЕК-ЛИСТ · {R.score}/100</Eyebrow>
              {[
                ["Контакт подтверждён", R.contactVerified === "Yes" ? GREEN : AMBER],
                ["Прайс-лист", /Missing/i.test(R.rate) ? RED : GREEN],
                ["Договор / комиссия", /Missing/i.test(R.contract) ? RED : GREEN],
                ["Права на фото", AMBER],
              ].map(([k, c]) => (
                <div
                  key={String(k)}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0" }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: 0, background: String(c) }}
                  />
                  <span
                    style={{ font: "500 11px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
                  >
                    {k}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </Card>
      </div>

      {rich.gallery?.length ? (
        <Card style={{ padding: 18, marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ ГАЛЕРЕЯ · {rich.credit}</Eyebrow>
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

      {rich.afisha?.length ? (
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ АФИША · {rich.src}</Eyebrow>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
              gap: 10,
            }}
          >
            {rich.afisha.map(([date, title, meta, img, badge]) => (
              <Card
                key={title + date}
                hover
                style={{ background: "var(--gtr-card2)", overflow: "hidden" }}
              >
                {img ? (
                  <img
                    src={img}
                    alt={title}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover" }}
                  />
                ) : null}
                <div style={{ padding: "10px 12px" }}>
                  <div
                    className="gtr-mono"
                    style={{
                      font: "700 9.5px/1 'JetBrains Mono',monospace",
                      color: "#E5231B",
                      marginBottom: 5,
                    }}
                  >
                    {date}
                  </div>
                  <div style={{ font: "600 12px/1.3 'Golos Text',sans-serif" }}>{title}</div>
                  <div
                    style={{
                      margin: "4px 0 6px",
                      font: "500 9.5px/1.4 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {meta}
                  </div>
                  {badge ? <Chip color={GREEN}>{badge}</Chip> : null}
                </div>
              </Card>
            ))}
          </div>
          {rich.artistsNote ? (
            <div
              style={{
                marginTop: 12,
                font: "500 11px/1.6 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {rich.artistsNote}
            </div>
          ) : null}
        </Card>
      ) : null}

      {user.role === "gtr" ? (
        <button
          className="gtr-btn"
          style={{ marginTop: 14 }}
          onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
        >
          ← К базе Пхукета
        </button>
      ) : null}
    </div>
  );
}

// ---------- финансы ----------
export function FinanceScreen() {
  const { user } = useGtr();
  if (!can(user.role, "finance.view")) return <NoAccess what="Финансы" />;

  const vid = user.venueId || "VEN-0013";
  const v = V(vid);
  const R = v.readiness;
  const rateMissing = !R || /Missing/i.test(R.rate || "Missing");

  const terms: [string, string, string, string][] = [
    [
      "Прайс-лист",
      rateMissing
        ? "Не опубликован — организатор не видит расчёт"
        : "Опубликован в источнике площадки",
      rateMissing ? "НЕТ" : "OK",
      rateMissing ? RED : GREEN,
    ],
    [
      "Договор с платформой",
      R && !/Missing/i.test(R.contract) ? "Согласован" : "Не согласован — блокирует «подтверждено»",
      R && !/Missing/i.test(R.contract) ? "ОК" : "НЕТ",
      R && !/Missing/i.test(R.contract) ? GREEN : RED,
    ],
    [
      "Условия оплаты",
      R && !/Missing/i.test(R.payment) ? "Определены" : "Не определены",
      R && !/Missing/i.test(R.payment) ? "ОК" : "НЕТ",
      R && !/Missing/i.test(R.payment) ? GREEN : RED,
    ],
    [
      "Метод доступности",
      R?.avail || "Ручной запрос",
      /Manual|Proposal|enquiry/i.test(R?.avail || "Вручную") ? "ВРУЧНУЮ" : "ОК",
      /Manual|Proposal|enquiry/i.test(R?.avail || "Вручную") ? AMBER : GREEN,
    ],
    ["Права на фото", R?.photo || "Только официальная галерея", "ОГРАНИЧЕНО", AMBER],
    [
      "Тех-райдер",
      R?.rider || "Не опубликован",
      /Published/i.test(R?.rider || "") ? "ОК" : "ЧАСТИЧНО",
      /Published/i.test(R?.rider || "") ? GREEN : AMBER,
    ],
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Title>Финансы</Title>
      {!finKpiOf(vid).length ? (
        <Card style={{ padding: "22px 20px", marginBottom: 16 }}>
          <div
            style={{
              font: "500 12px/1.6 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            Финансовые показатели по этой площадке ещё не заведены. Чтобы они появились, нужны
            ставка аренды, условия оплаты и договор — их заполняют в паспорте площадки.
          </div>
        </Card>
      ) : null}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}
      >
        {finKpiOf(vid).map(([label, value, color, note]) => (
          <Card
            key={label}
            style={{
              padding: "18px 20px",
              borderColor: color === RED ? "rgba(229,35,27,.35)" : undefined,
            }}
          >
            <Eyebrow>{label}</Eyebrow>
            <div
              className="gtr-mono"
              style={{
                margin: "10px 0 8px",
                font: "700 17px/1.1 'JetBrains Mono',monospace",
                color,
              }}
            >
              {value}
            </div>
            <div style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {note}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div
          className="gtr-oswald"
          style={{
            font: "600 14px/1 Oswald,sans-serif",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,.05)",
          }}
        >
          Коммерческие условия
        </div>
        {terms.map(([label, desc, status, c]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            <Dot color={c} top={0} />
            <span
              style={{ flex: "none", width: 190, font: "600 12px/1.3 'Golos Text',sans-serif" }}
            >
              {label}
            </span>
            <span
              style={{
                flex: 1,
                font: "500 11px/1.4 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {desc}
            </span>
            <Chip color={c}>{status}</Chip>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20, borderColor: "rgba(229,35,27,.3)" }}>
        <Eyebrow style={{ marginBottom: 8, color: "#E5231B" }}>ГЛАВНЫЙ БЛОКЕР</Eyebrow>
        <div style={{ font: "500 12px/1.7 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {finBlockerOf(vid)}
        </div>
      </Card>
    </div>
  );
}

// ---------- доступы и роли ----------
export function AccessScreen() {
  const { user } = useGtr();
  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <Title>Доступы и роли</Title>
      <Card style={{ overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr repeat(6, minmax(76px,1fr))",
            gap: 8,
            padding: "13px 20px",
            borderBottom: "1px solid rgba(255,255,255,.08)",
            minWidth: 640,
          }}
        >
          <span className="gtr-eyebrow">ПРАВО</span>
          {ROLES.map(([id, label]) => (
            <span
              key={id}
              className="gtr-eyebrow"
              style={{ textAlign: "center", color: id === user.role ? "#E5231B" : undefined }}
            >
              {label}
            </span>
          ))}
        </div>
        {PERMISSIONS.map((p) => (
          <div
            key={p.key}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr repeat(6, minmax(76px,1fr))",
              gap: 8,
              padding: "11px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
              alignItems: "center",
              minWidth: 640,
            }}
          >
            <span style={{ font: "500 11.5px/1.4 'Golos Text',sans-serif" }}>{p.label}</span>
            {ROLES.map(([id]) => (
              <span key={id} style={{ textAlign: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 20,
                    height: 20,
                    borderRadius: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    font: "700 10px/1 'JetBrains Mono',monospace",
                    background: p.roles[id] ? "rgba(46,204,113,.14)" : "rgba(255,255,255,.05)",
                    color: p.roles[id] ? GREEN : "rgba(255,255,255,.25)",
                    border: `1px solid ${p.roles[id] ? "rgba(46,204,113,.4)" : "rgba(255,255,255,.08)"}`,
                  }}
                >
                  {p.roles[id] ? "✓" : "—"}
                </span>
              </span>
            ))}
          </div>
        ))}
      </Card>
      <TgPanel />
      {user.role === "gtr" ? <TeamPanel /> : null}
      <div
        className="gtr-mono"
        style={{
          marginTop: 12,
          font: "500 10.5px/1.6 'JetBrains Mono',monospace",
          color: "var(--gtr-t3)",
        }}
      >
        Права применяются на сервере при входе и в интерфейсе (кнопки/разделы). Ваша роль:{" "}
        {user.roleLabel}.
      </div>
    </div>
  );
}

// ---------- привязка Telegram (все роли) ----------
// Предложения, заявки и /guest работают в личном чате с ботом GTR.
function TgPanel() {
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean; bot: string } | null>(null);
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    tgStatusFn().then(setTg).catch(() => {});
  }, []);
  const getLink = async () => {
    setMsg("");
    try {
      const r = await tgLinkFn();
      if (r.ok) setLink(r.link);
      else setMsg(r.error ?? "Не получилось");
    } catch {
      setMsg("Сервер недоступен");
    }
  };
  return (
    <Card style={{ marginTop: 16, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Eyebrow>TELEGRAM</Eyebrow>
      {tg?.linked ? (
        <Chip color={GREEN}>ПРИВЯЗАН · УВЕДОМЛЕНИЯ ИДУТ В ЧАТ</Chip>
      ) : tg?.bot ? (
        <>
          <span style={{ font: "500 11.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            Бот @{tg.bot}: предложения, заявки и команда /guest — в личном чате.
          </span>
          {link ? (
            <a
              className="gtr-btn gtr-btn-red"
              style={{ textDecoration: "none" }}
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openAppLink(link);
              }}
            >
              Открыть @{tg.bot} и привязать ↗
            </a>
          ) : (
            <button className="gtr-btn" onClick={getLink}>
              Привязать Telegram
            </button>
          )}
        </>
      ) : (
        <span style={{ font: "500 11px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          {tg ? "Бот не активирован." : "Проверяем статус…"}
        </span>
      )}
      {msg ? <span style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "#FF5B4D" }}>{msg}</span> : null}
    </Card>
  );
}

// ---------- команда: приглашения менеджеров (только GTR-админ) ----------
// Аккаунты живут в общей базе (Workers KV): у каждого менеджера свой пароль
// и свой кабинет. В локальном dev-режиме база недоступна — панель скажет об этом.
function TeamPanel() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [storeOk, setStoreOk] = useState(true);
  const [role, setRole] = useState<"sales" | "artist" | "owner" | "organizer">("sales");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [venueQ, setVenueQ] = useState("");
  const [venueId, setVenueId] = useState("");
  const [artQ, setArtQ] = useState("");
  const [artistId, setArtistId] = useState("");
  const [artistName, setArtistName] = useState("");
  const [artBase, setArtBase] = useState<{ id: string; name: string; role?: string }[] | null>(null);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listUsersFn()
      .then((r) => {
        setStoreOk(r.ok);
        setUsers(r.users);
      })
      .catch(() => setStoreOk(false));
  useEffect(() => {
    refresh();
  }, []);

  const genPassword = () => {
    const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += abc[Math.floor(Math.random() * abc.length)];
    setPassword(out);
  };

  const artHits =
    role === "artist" && artQ.trim() && artBase
      ? artBase
          .filter((a) => a.name.toLowerCase().includes(artQ.toLowerCase()))
          .slice(0, 5)
      : [];
  const loadArts = () => {
    if (!artBase)
      import("../data/artists.public.json").then((m) => {
        const arts = (m.default as unknown as { artists: { id: string; name: string; kind?: string; role?: string }[] }).artists;
        setArtBase(arts.filter((a) => a.kind === "artist").map(({ id, name, role: r }) => ({ id, name, role: r })));
      });
  };

  const venueHits = venueQ.trim()
    ? PH.venues
        .filter((v) => `${v.name} ${v.id}`.toLowerCase().includes(venueQ.toLowerCase()))
        .slice(0, 5)
    : [];
  const pickedVenue = venueId ? V(venueId) : null;

  const invite = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await inviteUserFn({
        data: {
          name: role === "artist" && !name.trim() ? artistName : name,
          email,
          role,
          venueId: role === "artist" ? "" : venueId,
          artistId: role === "artist" ? artistId : "",
          password,
        },
      });
      if (r.ok) {
        setMsg({
          ok: true,
          text: `Менеджер приглашён. Вход: ${r.user.email} / пароль, который вы задали.`,
        });
        setName("");
        setEmail("");
        setPassword("");
        setVenueId("");
        setVenueQ("");
        setArtistId("");
        setArtistName("");
        setArtQ("");
        refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "Не получилось" });
      }
    } catch {
      setMsg({ ok: false, text: "Сервер недоступен" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginTop: 16, padding: "18px 20px", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Eyebrow>КОМАНДА · ПРИГЛАШЕНИЯ МЕНЕДЖЕРОВ</Eyebrow>
        {!storeOk ? <Chip color={AMBER}>ЛОКАЛЬНЫЙ РЕЖИМ — БАЗА НЕДОСТУПНА</Chip> : null}
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {(
          [
            ["sales", "Менеджер GTR"],
            ["artist", "Артист / диджей"],
            ["owner", "Площадка (владелец)"],
            ["organizer", "Организатор"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            onClick={() => {
              setRole(r);
              if (r === "artist") loadArts();
            }}
            style={{
              borderRadius: 0,
              padding: "8px 13px",
              cursor: "pointer",
              font: `${role === r ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
              border: `1px solid ${role === r ? "#E5231B" : "rgba(255,255,255,.14)"}`,
              background: role === r ? "rgba(229,35,27,.14)" : "transparent",
              color: role === r ? "#fff" : "rgba(255,255,255,.6)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {role === "artist" ? (
        <div style={{ display: "grid", gap: 6 }}>
          {artistId ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Chip color="#7B4DFF">{artistId}</Chip>
              <span style={{ font: "500 11.5px/1.3 'Golos Text',sans-serif" }}>{artistName}</span>
              <button
                className="gtr-btn"
                style={{ padding: "4px 9px", fontSize: 10 }}
                onClick={() => {
                  setArtistId("");
                  setArtistName("");
                }}
              >
                Убрать
              </button>
            </div>
          ) : (
            <>
              <input
                className="gtr-input"
                style={{ maxWidth: 360, padding: "8px 11px", fontSize: 12 }}
                placeholder={artBase ? "Карточка артиста в базе — поиск по имени…" : "Загрузка базы артистов…"}
                value={artQ}
                onChange={(e) => setArtQ(e.target.value)}
              />
              {artHits.map((a) => (
                <button
                  key={a.id}
                  className="gtr-pal-btn"
                  style={{ padding: "7px 10px", maxWidth: 360 }}
                  onClick={() => {
                    setArtistId(a.id);
                    setArtistName(a.name);
                    setArtQ("");
                  }}
                >
                  <span style={{ flex: 1, textAlign: "left", fontSize: 11.5 }}>
                    {a.name}
                    <span
                      className="gtr-mono"
                      style={{ marginLeft: 8, fontSize: 9, color: "rgba(255,255,255,.4)" }}
                    >
                      {a.id}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}
      >
        <input
          className="gtr-input"
          style={{ padding: "8px 11px", fontSize: 12 }}
          placeholder="Имя и фамилия"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ padding: "8px 11px", fontSize: 12 }}
          placeholder="email@gtr.events"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="gtr-input"
            style={{ flex: 1, padding: "8px 11px", fontSize: 12 }}
            placeholder="Пароль (от 6 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="gtr-btn" style={{ padding: "8px 10px", fontSize: 10.5 }} onClick={genPassword}>
            Сгенерировать
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {role === "artist" ? null : pickedVenue ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Chip color="#E5231B">{pickedVenue.id}</Chip>
            <span style={{ font: "500 11.5px/1.3 'Golos Text',sans-serif" }}>{pickedVenue.name}</span>
            <button
              className="gtr-btn"
              style={{ padding: "4px 9px", fontSize: 10 }}
              onClick={() => setVenueId("")}
            >
              Убрать
            </button>
          </div>
        ) : (
          <>
            <input
              className="gtr-input"
              style={{ maxWidth: 360, padding: "8px 11px", fontSize: 12 }}
              placeholder="Площадка менеджера (необязательно) — поиск…"
              value={venueQ}
              onChange={(e) => setVenueQ(e.target.value)}
            />
            {venueHits.map((v) => (
              <button
                key={v.id}
                className="gtr-pal-btn"
                style={{ padding: "7px 10px", maxWidth: 360 }}
                onClick={() => {
                  setVenueId(v.id);
                  setVenueQ("");
                }}
              >
                <span style={{ flex: 1, textAlign: "left", fontSize: 11.5 }}>
                  {v.name}
                  <span className="gtr-mono" style={{ marginLeft: 8, fontSize: 9, color: "rgba(255,255,255,.4)" }}>
                    {v.id}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          className="gtr-btn gtr-btn-red"
          style={{ padding: "9px 15px", opacity: busy ? 0.5 : 1 }}
          disabled={
            busy ||
            (!name.trim() && !(role === "artist" && artistName)) ||
            !email.trim() ||
            password.length < 6 ||
            (role === "artist" && !artistId) ||
            !storeOk
          }
          onClick={invite}
        >
          {role === "artist"
            ? "Пригласить артиста"
            : role === "owner"
              ? "Пригласить площадку"
              : role === "organizer"
                ? "Пригласить организатора"
                : "Пригласить менеджера"}
        </button>
        {msg ? (
          <span
            style={{
              font: "500 11px/1.4 'Golos Text',sans-serif",
              color: msg.ok ? GREEN : "#FF5B4D",
            }}
          >
            {msg.text}
          </span>
        ) : null}
      </div>

      <InviteLinks />

      {users?.length ? (
        <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
          <Eyebrow style={{ fontSize: 8.5 }}>ПРИГЛАШЁННЫЕ · {users.length}</Eyebrow>
          {users.map((u) => (
            <div
              key={u.email}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid rgba(255,255,255,.08)",
                background: "var(--gtr-card2)",
              }}
            >
              <span className="gtr-lettermark" style={{ width: 30, height: 30, fontSize: 13 }}>
                {u.initials}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>
                  {u.name}
                </span>
                <span
                  className="gtr-mono"
                  style={{ display: "block", font: "500 9px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                >
                  {u.email} · {u.roleLabel}
                  {u.artistId ? (
                    <a
                      href={`/gtr/artists?artist=${u.artistId}`}
                      style={{ color: "#7B4DFF", marginLeft: 6, textDecoration: "none" }}
                    >
                      карточка {u.artistId} ↗
                    </a>
                  ) : u.venueId ? (
                    ` · ${V(u.venueId).name ?? u.venueId}`
                  ) : (
                    " · вся сеть"
                  )}
                </span>
              </span>
              <button
                className="gtr-btn"
                style={{ padding: "5px 9px", fontSize: 10, color: "#E5231B" }}
                onClick={() => {
                  if (confirm(`Удалить доступ ${u.email}?`))
                    deleteUserFn({ data: { email: u.email } }).then(refresh);
                }}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// ---------- GTR-админ ----------
export function AdminScreen() {
  const { user } = useGtr();
  const navigate = useNavigate();
  if (!can(user.role, "network.manage")) return <NoAccess what="GTR-админ" />;

  const quar = PH.venues.filter(
    (x) => x.confidence === "Low" || /verify|Closed/i.test(x.status || ""),
  );
  const ready = PH.venues
    .filter((x) => x.readiness)
    .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Title>GTR-админ · консоль сети</Title>

      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}
      >
        {[
          ["ПЛОЩАДОК", PH.meta.total, "#fff"],
          ["ЗАЛОВ", PH.meta.spaces, "#fff"],
          ["КОНТАКТОВ P0/P1", PH.meta.contacts, AMBER],
          ["КАРАНТИН", quar.length, RED],
        ].map(([l, v2, c]) => (
          <Card key={String(l)} style={{ padding: "16px 18px" }}>
            <Eyebrow>{l}</Eyebrow>
            <div
              className="gtr-mono"
              style={{
                marginTop: 10,
                font: "700 26px/1 'JetBrains Mono',monospace",
                color: String(c),
              }}
            >
              {v2}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "15px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            Пайплайн онбординга
          </div>
          {ready.slice(0, 8).map((x) => (
            <div
              key={x.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 20px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                cursor: "pointer",
              }}
              onClick={() =>
                navigate({
                  to: "/gtr/$screen",
                  params: { screen: "venueCard" },
                  search: { vid: x.id },
                })
              }
            >
              <span
                className="gtr-mono"
                style={{
                  font: "700 14px/1 'JetBrains Mono',monospace",
                  width: 30,
                  color: (x.readiness?.score ?? 0) >= 70 ? GREEN : AMBER,
                }}
              >
                {x.readiness?.score}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                  {x.name}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {x.readiness?.state} · {x.area}
                </span>
              </span>
              <Chip color={x.readiness?.state === "Бронируемая" ? GREEN : AMBER}>
                {(x.readiness?.state ?? "").toUpperCase()}
              </Chip>
            </div>
          ))}
        </Card>

        <Card style={{ alignSelf: "start" }}>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "15px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            Карантин источников · {quar.length}
          </div>
          {quar.slice(0, 8).map((x) => (
            <div
              key={x.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 20px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
              }}
            >
              <Dot color={RED} top={0} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                  {x.name}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {x.status} · confidence {x.confidence}
                </span>
              </span>
            </div>
          ))}
          <div style={{ padding: "13px 20px" }}>
            <Eyebrow style={{ marginBottom: 8 }}>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ</Eyebrow>
            {PH.research.map((r) => (
              <div key={r.task} style={{ display: "flex", gap: 9, padding: "6px 0" }}>
                <Dot color={r.priority === "P0" ? RED : AMBER} />
                <span
                  style={{
                    flex: 1,
                    font: "500 10.5px/1.5 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {r.cluster} — {r.task}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 9.5px/1 'JetBrains Mono',monospace",
                    color: r.priority === "P0" ? RED : AMBER,
                  }}
                >
                  {r.priority}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
