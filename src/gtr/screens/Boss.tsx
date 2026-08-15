// Кабинет BOSS: дашборд контроля всей операции GTR Event — деньги, заявки,
// события, команда, задачи, связь и уведомления. Компактно, без дублей:
// каждый блок — живые данные и переход в свой раздел одним тапом.
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AMBER,
  computeQuote,
  draftTitle,
  fmtThb,
  GREEN,
  RED,
  STAGE_COLOR,
  STAGE_LABEL,
  V,
  type ScreenId,
} from "../data/app-data";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";
import { Card, Chip, Dot, Eyebrow, tint } from "../ui";
import {
  broadcastFn,
  communityInviteTextFn,
  communityPostFn,
  deleteTaskFn,
  metaCfgFn,
  metaExchangeFn,
  metaFeedFn,
  metaSyncFn,
  communityCfgFn,
  promptpayCfgFn,
  setCommunityCfgFn,
  setMetaCfgFn,
  setPromptpayCfgFn,
  listUsersFn,
  pendingDecideFn,
  pendingListFn,
  pullTasksFn,
  pushStatusFn,
  pushSubscribeFn,
  pushTaskFn,
  pushTestFn,
  tgActivateFn,
  tgLinkFn,
  tgStatusFn,
  venueConfirmsFn,
  type GtrTask,
  type PendingApp,
  type PublicUser,
  type VenueConfirm,
} from "../kv-api";
import { VAPID_PUBLIC_KEY } from "../push";

const mono = (s: number, w = 500) => `${w} ${s}px/1.3 'JetBrains Mono',monospace`;
const golos = (s: number, w = 500) => `${w} ${s}px/1.4 'Golos Text',sans-serif`;

// ---------- 3D-эмблема: вращающееся ядро импульса ----------
function Boss3D() {
  return (
    <div className="boss3d" aria-hidden>
      <div className="boss3d-spin">
        <span className="boss3d-plane p1" />
        <span className="boss3d-plane p2" />
        <span className="boss3d-plane p3" />
        <span className="boss3d-ring" />
        <span className="boss3d-core" />
      </div>
    </div>
  );
}

const b64ToU8 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

// ---------- Push-панель: разрешение → подписка → тест ----------
export function PushPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "busy" | "on" | "err">("idle");
  const [devices, setDevices] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    pushStatusFn().then((r) => {
      setDevices(r.devices);
      if (r.devices > 0 && typeof Notification !== "undefined" && Notification.permission === "granted")
        setState("on");
    });
  }, []);

  const enable = useCallback(async () => {
    setState("busy");
    setMsg("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error("браузер не поддерживает Push");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("разрешение не выдано");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY),
        }));
      const r = await pushSubscribeFn({ data: { sub: sub.toJSON() as never } });
      if (!r.ok) throw new Error("сервер не принял подписку");
      setDevices(r.devices ?? 1);
      setState("on");
      setMsg("Подписка активна");
    } catch (e) {
      setState("err");
      setMsg(e instanceof Error ? e.message : "не получилось");
    }
  }, []);

  const test = useCallback(async () => {
    setMsg("…");
    const r = await pushTestFn();
    setMsg(r.ok ? `Отправлено (${r.sent} устр.)` : `Не вышло: ${r.reason}`);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Chip color={state === "on" ? GREEN : "rgba(255,255,255,.4)"}>
        PUSH {state === "on" ? `${t("ВКЛ")} · ${devices}` : t("ВЫКЛ")}
      </Chip>
      {state !== "on" ? (
        <button className="gtr-btn gtr-btn-sm" onClick={enable} disabled={state === "busy"}>
          {state === "busy" ? t("Включаю…") : t("Включить push")}
        </button>
      ) : (
        <button className="gtr-btn gtr-btn-sm" onClick={test}>
          {t("Тест")}
        </button>
      )}
      {msg ? (
        <span style={{ font: mono(9), color: state === "err" ? RED : "rgba(255,255,255,.5)" }}>{msg}</span>
      ) : null}
    </div>
  );
}

// ---------- Telegram-статус ----------
export function TgChip() {
  const { t } = useTranslation();
  const [linked, setLinked] = useState<boolean | null>(null);
  useEffect(() => {
    tgStatusFn().then((r: { linked?: boolean }) => setLinked(Boolean(r.linked)));
  }, []);
  const link = useCallback(async () => {
    const r = (await tgLinkFn()) as { ok?: boolean; url?: string };
    if (r.ok && r.url) window.open(r.url, "_blank");
  }, []);
  if (linked === null) return null;
  return linked ? (
    <Chip color={GREEN}>TELEGRAM {t("ВКЛ")}</Chip>
  ) : (
    <button className="gtr-btn gtr-btn-sm" onClick={link}>
      {t("Привязать Telegram")}
    </button>
  );
}

// ---------- Задачи ----------
function TasksBlock({ users, me }: { users: PublicUser[]; me: string }) {
  const [tasks, setTasks] = useState<GtrTask[]>([]);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const refresh = useCallback(() => {
    pullTasksFn().then((r) => setTasks(r.tasks));
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 45000);
    return () => clearInterval(t);
  }, [refresh]);

  const meUser = users.find((u) => u.email === me);
  const add = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    const person = users.find((u) => u.email === assignee) ?? meUser;
    if (!person) return;
    const task: GtrTask = {
      id: `TSK-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`,
      title: t,
      assignee: person.email,
      assigneeName: person.name,
      due: due || undefined,
      status: "new",
      by: me,
      byName: meUser?.name ?? "BOSS",
      ts: Date.now(),
      updated: Date.now(),
    };
    setTasks((l) => [task, ...l]);
    setTitle("");
    setDue("");
    await pushTaskFn({ data: { task } });
    refresh();
  }, [title, assignee, due, users, me, meUser, refresh]);

  const move = useCallback(
    async (t: GtrTask, status: GtrTask["status"]) => {
      const next = { ...t, status };
      setTasks((l) => l.map((x) => (x.id === t.id ? next : x)));
      await pushTaskFn({ data: { task: next } });
    },
    [],
  );
  const remove = useCallback(async (id: string) => {
    setTasks((l) => l.filter((x) => x.id !== id));
    await deleteTaskFn({ data: { id } });
  }, []);

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done").slice(0, 3);
  const ST: Record<GtrTask["status"], [string, string]> = {
    new: ["НОВАЯ", AMBER],
    doing: ["В РАБОТЕ", "#7B4DFF"],
    done: ["ГОТОВО", GREEN],
  };

  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>ЗАДАЧИ КОМАНДЫ</Eyebrow>
        <span style={{ font: mono(9), color: "rgba(255,255,255,.4)" }}>
          {open.length} откр.
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "2 1 160px", minWidth: 0 }}
          placeholder="Что сделать…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <select
          className="gtr-input"
          style={{ flex: "1 1 120px" }}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">— исполнитель —</option>
          {users.map((u) => (
            <option key={u.email} value={u.email}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          className="gtr-input"
          type="date"
          style={{ flex: "0 1 130px" }}
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red gtr-btn-sm" onClick={add}>
          Поставить
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 250, overflowY: "auto" }}>
        {open.length === 0 ? (
          <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>Открытых задач нет.</span>
        ) : null}
        {open.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 9px",
              border: "1px solid rgba(255,255,255,.09)",
              borderLeft: `3px solid ${ST[t.status][1]}`,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", font: golos(11.5, 600), color: "#fff" }}>{t.title}</span>
              <span style={{ font: mono(8.5), color: "rgba(255,255,255,.4)" }}>
                {t.assigneeName}
                {t.due ? ` · до ${t.due}` : ""} · {ST[t.status][0]}
              </span>
            </span>
            {t.status === "new" ? (
              <button className="gtr-btn gtr-btn-sm" onClick={() => move(t, "doing")}>
                В работу
              </button>
            ) : (
              <button className="gtr-btn gtr-btn-sm" onClick={() => move(t, "done")}>
                Готово
              </button>
            )}
            <button
              className="gtr-btn gtr-btn-sm"
              style={{ opacity: 0.5 }}
              onClick={() => remove(t.id)}
              title="Удалить"
            >
              ✕
            </button>
          </div>
        ))}
        {done.map((t) => (
          <div key={t.id} style={{ display: "flex", gap: 8, padding: "4px 9px", opacity: 0.45 }}>
            <Dot color={GREEN} />
            <span style={{ font: golos(10.5), textDecoration: "line-through" }}>
              {t.title} — {t.assigneeName}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Рассылка ----------
function BroadcastBlock() {
  const [text, setText] = useState("");
  const [aud, setAud] = useState<"all" | "team" | "artists" | "organizers">("all");
  const [note, setNote] = useState("");
  const send = useCallback(async () => {
    if (!text.trim()) return;
    setNote("…");
    const r = await broadcastFn({ data: { text, audience: aud } });
    setNote(r.ok ? `Доставлено: ${r.sent}` : "не вышло");
    if (r.ok) setText("");
  }, [text, aud]);
  const AUD: [typeof aud, string][] = [
    ["all", "ВСЕМ"],
    ["team", "КОМАНДЕ"],
    ["artists", "АРТИСТАМ"],
    ["organizers", "ОРГАМ"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {AUD.map(([k, l]) => (
          <button
            key={k}
            className="gtr-pal-btn"
            style={{
              padding: "4px 9px",
              font: mono(8.5, 600),
              flex: "0 0 auto",
              width: "auto",
              background: aud === k ? "rgba(229,35,27,.16)" : "transparent",
              color: aud === k ? "#fff" : "rgba(255,255,255,.5)",
            }}
            onClick={() => setAud(k)}
          >
            {l}
          </button>
        ))}
        {note ? <span style={{ font: mono(9), color: "rgba(255,255,255,.5)", marginLeft: "auto" }}>{note}</span> : null}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="gtr-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Сообщение в Telegram + push…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="gtr-btn gtr-btn-red gtr-btn-sm" onClick={send}>
          📣
        </button>
      </div>
    </div>
  );
}

// ---------- Кабинет BOSS ----------
export function BossCabinet() {
  const { user, shared } = useGtr();
  const navigate = useNavigate();
  const go = (s: ScreenId) => navigate({ to: "/gtr/$screen", params: { screen: s } });
  const [users, setUsers] = useState<PublicUser[]>([]);
  useEffect(() => {
    listUsersFn().then((r) => {
      if (r.ok) setUsers(r.users);
    });
  }, []);

  const money = useMemo(() => {
    let total = 0;
    let commission = 0;
    const byStage = new Map<string, { n: number; sum: number }>();
    const rows = shared.drafts.map((d) => {
      const q = computeQuote(d.graph, d.venueId);
      total += q.total;
      commission += q.commission;
      const st = d.graph.stage ?? "draft";
      const cur = byStage.get(st) ?? { n: 0, sum: 0 };
      byStage.set(st, { n: cur.n + 1, sum: cur.sum + q.total });
      return { d, q };
    });
    const top = rows.filter((r) => r.q.total > 0).sort((a, b) => b.q.total - a.q.total).slice(0, 3);
    return { total, commission, byStage, top };
  }, [shared.drafts]);

  const reqs = shared.requests;
  const reqOpen = reqs.filter((r) => r.status === "new" || r.status === "seen");
  const upcoming = useMemo(
    () =>
      shared.drafts
        .filter((d) => d.dateIso && d.dateIso >= new Date().toISOString().slice(0, 10))
        .sort((a, b) => (a.dateIso ?? "").localeCompare(b.dateIso ?? ""))
        .slice(0, 5),
    [shared.drafts],
  );

  // Живая лента: последние действия из всех источников
  const feed = useMemo(() => {
    const items: { ts: number; text: string; color: string }[] = [];
    for (const d of shared.drafts.slice(0, 40))
      items.push({
        ts: d.updated,
        text: `${draftTitle(d)} — ${STAGE_LABEL[d.graph.stage ?? "draft"]}${d.owner ? ` · ${d.owner.split("@")[0]}` : ""}`,
        color: STAGE_COLOR[d.graph.stage ?? "draft"],
      });
    for (const r of reqs.slice(0, 30))
      items.push({
        ts: r.ts,
        text: `Заявка: ${r.title || r.venueName}${r.assigneeName ? ` → ${r.assigneeName}` : ""} · ${r.status}`,
        color: AMBER,
      });
    for (const o of shared.offers.slice(0, 30))
      items.push({ ts: o.ts, text: `Оффер ${o.artistName} · ${o.venueName} · ${o.status}`, color: "#7B4DFF" });
    for (const u2 of users.slice(0, 20))
      items.push({ ts: u2.created, text: `Новый участник: ${u2.name} (${u2.roleLabel})`, color: GREEN });
    // сидовые записи без реального времени (ts≈0) в ленту не попадают
    return items.filter((x) => x.ts > 1e12).sort((a, b) => b.ts - a.ts).slice(0, 12);
  }, [shared.drafts, reqs, shared.offers, users]);

  const fmtAgo = (ts: number) => {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return `${m}м`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h}ч` : `${Math.round(h / 24)}д`;
  };

  const kpis: [string, string, string][] = [
    ["ПАЙПЛАЙН", fmtThb(money.total), "все сметы"],
    ["КОМИССИЯ GTR", fmtThb(money.commission), "заложено"],
    ["СОБЫТИЯ", String(shared.drafts.length), `${upcoming.length} впереди`],
    ["ЗАЯВКИ", String(reqOpen.length), "открытых"],
    ["КОМАНДА", String(users.length), "аккаунтов"],
  ];

  return (
    <div className="gtr-boss" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* -------- шапка BOSS -------- */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="gtr-boss-hero">
          <Boss3D />
          <div style={{ flex: 1, minWidth: 220, padding: "16px 0" }}>
            <Eyebrow style={{ color: RED }}>КОНТРОЛЬ ОПЕРАЦИИ · GTR EVENT</Eyebrow>
            <h1
              style={{
                margin: "6px 0 2px",
                font: "700 30px/1 'Oswald','Golos Text',sans-serif",
                letterSpacing: ".02em",
                textTransform: "uppercase",
              }}
            >
              {user.name}
            </h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Chip color={RED}>BOSS</Chip>
              <span style={{ font: mono(9.5), color: "rgba(255,255,255,.45)" }}>{user.email}</span>
            </div>
          </div>
          <div className="gtr-boss-kpis">
            {kpis.map(([l, v2, n]) => (
              <div key={l} className="gtr-boss-kpi">
                <span style={{ font: mono(8, 600), color: "rgba(255,255,255,.4)", letterSpacing: ".12em" }}>
                  {l}
                </span>
                <span style={{ font: "700 17px/1.1 'Oswald',sans-serif", color: "#fff" }}>{v2}</span>
                <span style={{ font: mono(8), color: "rgba(255,255,255,.35)" }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="gtr-boss-grid">
        <SprintBlock go={go} />
        {/* -------- деньги -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>ДЕНЬГИ И СМЕТЫ</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("events")}>
              Все события →
            </button>
          </div>
          {[...money.byStage.entries()].map(([st, x]) => (
            <div key={st} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Dot color={STAGE_COLOR[st as keyof typeof STAGE_COLOR] ?? "#888"} />
              <span style={{ flex: 1, font: golos(11) }}>
                {STAGE_LABEL[st as keyof typeof STAGE_LABEL] ?? st} · {x.n}
              </span>
              <span style={{ font: mono(10.5, 600), color: "#fff" }}>{fmtThb(x.sum)}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 8 }}>
            {money.top.map(({ d, q }) => (
              <div key={d.id} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                <span style={{ flex: 1, font: golos(10.5), color: "rgba(255,255,255,.75)" }}>
                  {draftTitle(d)} · {V(d.venueId).name}
                </span>
                <span style={{ font: mono(10, 600), color: GREEN }}>{fmtThb(q.total)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* -------- задачи -------- */}
        <TasksBlock users={users} me={user.email} />

        {/* -------- заявки + события -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>ЗАЯВКИ И БЛИЖАЙШЕЕ</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("inquiries")}>
              Канбан →
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(
              [
                ["new", "НОВЫЕ", RED],
                ["seen", "В РАЗБОРЕ", AMBER],
                ["accepted", "ПРИНЯТЫ", GREEN],
              ] as const
            ).map(([k, l, c]) => (
              <span
                key={k}
                style={{
                  font: mono(9, 600),
                  color: c,
                  border: `1px solid ${tint(c, 0.4)}`,
                  padding: "4px 8px",
                }}
              >
                {l} {reqs.filter((r) => r.status === k).length}
              </span>
            ))}
          </div>
          {upcoming.length ? (
            upcoming.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ font: mono(9.5, 600), color: RED, width: 46 }}>
                  {(d.dateIso ?? "").slice(5).replace("-", ".")}
                </span>
                <span style={{ flex: 1, font: golos(11) }}>
                  {draftTitle(d)}
                  <span style={{ color: "rgba(255,255,255,.4)" }}> · {V(d.venueId).name}</span>
                </span>
              </div>
            ))
          ) : (
            <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>Ближайших дат нет.</span>
          )}
        </Card>

        {/* -------- команда + лента -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>КОМАНДА · ЖИВАЯ ЛЕНТА</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("admin")}>
              Управление →
            </button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {users.slice(0, 8).map((u2) => (
              <span
                key={u2.email}
                title={`${u2.name} · ${u2.roleLabel}`}
                style={{
                  font: mono(8.5, 700),
                  border: "1px solid rgba(255,255,255,.15)",
                  padding: "4px 7px",
                  color: "rgba(255,255,255,.75)",
                }}
              >
                {u2.initials}
              </span>
            ))}
            {users.length > 8 ? (
              <span style={{ font: mono(9), color: "rgba(255,255,255,.4)", alignSelf: "center" }}>
                +{users.length - 8}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 190, overflowY: "auto" }}>
            {feed.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                <Dot color={f.color} />
                <span style={{ flex: 1, font: golos(10.5), color: "rgba(255,255,255,.75)" }}>{f.text}</span>
                <span style={{ font: mono(8), color: "rgba(255,255,255,.3)" }}>{fmtAgo(f.ts)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* -------- связь + уведомления -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Eyebrow>СВЯЗЬ И УВЕДОМЛЕНИЯ</Eyebrow>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <TgChip />
              <PushPanel />
            </div>
          </div>
          <BroadcastBlock />
        </Card>

        <PendingCard />
        <PromptpayCard />
        <CommunityCard />
        <MetaCard />
      </div>
    </div>
  );
}

// Заявки на роли: артисты, организаторы, площадки, команда. Дублирует
// Telegram-кнопки BOSS — решение можно принять прямо из дашборда.
// Метки ролей — из клиентского app-data: kv-api в браузере отдаёт только
// RPC-стабы серверных функций, обычные константы оттуда не доезжают.
const PENDING_ROLE_LABEL: Record<string, string> = {
  pr: "PR-директор", owner: "Площадка", sales: "Event-продажи",
  gtr: "Команда GTR", artist: "Артист", organizer: "Организатор", visitor: "Посетитель",
};
function PendingCard() {
  const [items, setItems] = useState<PendingApp[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    pendingListFn()
      .then((r) => setItems(r.items))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  const decide = async (email: string, approve: boolean) => {
    setBusy(email);
    try {
      const r = await pendingDecideFn({ data: { email, approve } });
      setNote(r.note);
      load();
    } catch {
      setNote("Сервер недоступен");
    } finally {
      setBusy("");
    }
  };
  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Eyebrow>ЗАЯВКИ НА РОЛИ · ПОДТВЕРЖДЕНИЕ BOSS</Eyebrow>
        <span style={{ font: mono(9.5, 700), color: items.length ? RED : "rgba(255,255,255,.35)" }}>
          {items.length}
        </span>
      </div>
      {items.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((a) => (
            <div
              key={a.email}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                border: "1px solid rgba(255,255,255,.1)",
                padding: "9px 11px",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ font: golos(11.5, 700) }}>
                  {a.name}
                  <span style={{ color: RED, marginLeft: 8, font: mono(9, 700) }}>
                    {PENDING_ROLE_LABEL[a.role]?.toUpperCase()}
                  </span>
                </div>
                <div style={{ font: mono(9), color: "rgba(255,255,255,.45)", marginTop: 2 }}>
                  {a.email} · {new Date(a.created).toLocaleDateString("ru-RU")}
                </div>
                {a.about ? (
                  <div style={{ font: golos(10.5), color: "rgba(255,255,255,.6)", marginTop: 3 }}>«{a.about}»</div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="gtr-btn gtr-btn-sm gtr-btn-red"
                  disabled={busy === a.email}
                  onClick={() => void decide(a.email, true)}
                >
                  ✅ Принять
                </button>
                <button
                  className="gtr-btn gtr-btn-sm"
                  disabled={busy === a.email}
                  onClick={() => void decide(a.email, false)}
                >
                  ❌ Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>
          Новых заявок нет. Артисты, организаторы, площадки и кандидаты в команду появятся здесь и в Telegram.
        </span>
      )}
      {note ? <span style={{ font: golos(10.5), color: "rgba(255,255,255,.6)" }}>{note}</span> : null}
    </Card>
  );
}

// Meta: авторизация страницы BOSS (FB/IG Business) через официальный
// Graph API — посты и медиа страницы затягиваются легально по токену.
// Комьюнити Telegram: канал новостей + группа общения. Бот проверяет,
// что добавлен админом, и дальше умеет постить дайджест вечера и
// приглашение тестовой группы.
function CommunityCard() {
  const [channelUrl, setChannelUrl] = useState("");
  const [chatUrl, setChatUrl] = useState("");
  const [channelTitle, setChannelTitle] = useState("");
  const [chatTitle, setChatTitle] = useState("");
  const [state, setState] = useState("");
  const [inviteText, setInviteText] = useState("");
  useEffect(() => {
    communityCfgFn()
      .then((r) => {
        setChannelUrl(r.channelUrl);
        setChatUrl(r.chatUrl);
        setChannelTitle(r.channelTitle);
        setChatTitle(r.chatTitle);
      })
      .catch(() => {});
  }, []);
  const save = async () => {
    setState("Проверяю канал и группу у Telegram…");
    try {
      const r = await setCommunityCfgFn({ data: { channelUrl, chatUrl } });
      if (r.ok) {
        setChannelTitle(r.cfg.channelTitle);
        setChatTitle(r.cfg.chatTitle);
        setState(
          r.notes.length
            ? r.notes.join(" · ")
            : `✓ Привязано: ${[r.cfg.channelTitle, r.cfg.chatTitle].filter(Boolean).join(" + ") || "пока пусто"}`,
        );
      } else setState(r.reason ?? "…");
    } catch {
      setState("Сервер недоступен");
    }
  };
  const activate = async () => {
    setState("Обновляю вебхук бота (конкурс)…");
    try {
      const r = await tgActivateFn();
      setState(r.ok ? `✓ Вебхук обновлён · @${r.bot}` : r.error);
    } catch {
      setState("Сервер недоступен");
    }
  };
  const post = async (kind: "digest" | "invite" | "contest", target: "channel" | "chat") => {
    setState(kind === "digest" ? "Собираю дайджест вечера…" : kind === "contest" ? "Публикую конкурс…" : "Отправляю приглашение…");
    try {
      const r = await communityPostFn({ data: { kind, target } });
      setState(r.ok ? "✓ Опубликовано" : r.reason);
    } catch {
      setState("Сервер недоступен");
    }
  };
  const copyInvite = async () => {
    try {
      const r = await communityInviteTextFn();
      setInviteText(r.text);
      try {
        await navigator.clipboard.writeText(r.text);
        setState("✓ Текст приглашения скопирован — шли кому угодно");
      } catch {
        setState("Текст ниже — скопируй вручную");
      }
    } catch {
      setState("Сервер недоступен");
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>КОМЬЮНИТИ TELEGRAM · НОВОСТИ И ОБЩЕНИЕ</Eyebrow>
        <Chip color={channelTitle ? GREEN : AMBER}>
          {channelTitle ? `КАНАЛ · ${channelTitle.toUpperCase()}` : "КАНАЛ НЕ ПРИВЯЗАН"}
        </Chip>
        <Chip color={chatTitle ? GREEN : AMBER}>
          {chatTitle ? `ЧАТ · ${chatTitle.toUpperCase()}` : "ЧАТ НЕ ПРИВЯЗАН"}
        </Chip>
      </div>
      <div
        className="gtr-mono"
        style={{ font: "500 9.5px/1.6 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginBottom: 10 }}
      >
        1) создай публичный канал (новости) и группу (чат) · 2) добавь бота @Gtrcom1_bot админом в оба ·
        3) вставь ссылки t.me и привяжи. Дайджест вечера уходит в канал сам — каждый день в 17:00.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 220px" }}
          placeholder="Канал: t.me/имя_канала"
          value={channelUrl}
          onChange={(e) => setChannelUrl(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ flex: "1 1 220px" }}
          placeholder="Группа: t.me/имя_группы"
          value={chatUrl}
          onChange={(e) => setChatUrl(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>Привязать и проверить</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="gtr-btn" onClick={() => post("digest", "channel")}>📣 Дайджест в канал сейчас</button>
        <button className="gtr-btn" onClick={() => post("invite", "channel")}>🎉 Приглашение в канал</button>
        <button className="gtr-btn" onClick={() => post("contest", "channel")}>🏆 Конкурс инвайтинга в канал</button>
        <button className="gtr-btn" onClick={copyInvite}>📋 Текст приглашения (разослать)</button>
        <button className="gtr-btn" onClick={activate}>⚙️ Обновить вебхук (для конкурса)</button>
      </div>
      {state ? (
        <div
          className="gtr-mono"
          style={{ marginTop: 8, font: "500 10px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
        >
          {state}
        </div>
      ) : null}
      {inviteText ? (
        <textarea
          className="gtr-input"
          readOnly
          value={inviteText}
          style={{ marginTop: 8, width: "100%", minHeight: 120, font: "500 11px/1.5 'Golos Text',sans-serif" }}
        />
      ) : null}
    </Card>
  );
}

function MetaCard() {
  const [token, setToken] = useState("");
  const [pageName, setPageName] = useState("");
  const [igUser, setIgUser] = useState("");
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [feed, setFeed] = useState<{ page: string; text: string; url?: string; ts?: string; kind: string }[]>([]);
  useEffect(() => {
    metaCfgFn()
      .then((r) => {
        setConnected(r.connected);
        setPageName(r.pageName);
        setIgUser(r.igUser);
      })
      .catch(() => {});
    metaFeedFn().then((r) => setFeed(r.items.slice(0, 6))).catch(() => {});
  }, []);
  const exchange = async () => {
    setState("Обмениваю токены на долгоживущие…");
    try {
      const r = await metaExchangeFn({ data: { appId, appSecret } });
      setState((r.ok ? "✓ " : "") + r.note);
      if (r.ok) setAppSecret("");
    } catch {
      setState("Сервер недоступен");
    }
  };
  const save = async () => {
    setState("Проверяю токен у Meta…");
    try {
      const r = await setMetaCfgFn({ data: { token } });
      if (r.ok) {
        setConnected(true);
        setPageName(r.pageName ?? "");
        setIgUser(r.igUser ?? "");
        setState(`✓ Страница «${r.pageName}» подключена${r.igUser ? ` · IG @${r.igUser}` : ""}`);
        setToken("");
      } else setState(r.reason ?? "…");
    } catch {
      setState("Сервер недоступен");
    }
  };
  const sync = async () => {
    setState("Забираю публикации…");
    try {
      const r = await metaSyncFn();
      setState(r.ok ? `✓ Подтянуто публикаций: ${r.count}` : (r.reason ?? "…"));
    } catch {
      setState("Сервер недоступен");
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>META · СТРАНИЦА FACEBOOK / INSTAGRAM</Eyebrow>
        <Chip color={connected ? GREEN : AMBER}>
          {connected ? `ПОДКЛЮЧЕНА${pageName ? ` · ${pageName.toUpperCase()}` : ""}` : "НЕ ПОДКЛЮЧЕНА"}
        </Chip>
        {igUser ? <Chip color="#7B4DFF">IG @{igUser}</Chip> : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 280px" }}
          placeholder="Access Token из Graph API Explorer (вставить и сохранить)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>
          Подключить
        </button>
        {connected ? (
          <button className="gtr-btn" onClick={sync}>
            Синк публикаций
          </button>
        ) : null}
      </div>
      {connected ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input
            className="gtr-input"
            style={{ flex: "1 1 140px" }}
            placeholder="App ID (Settings → Basic)"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
          <input
            className="gtr-input"
            style={{ flex: "1 1 200px" }}
            type="password"
            placeholder="App Secret (Show → скопировать)"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
          <button className="gtr-btn" onClick={exchange}>
            Сделать токены вечными
          </button>
        </div>
      ) : null}
      <div
        className="gtr-mono"
        style={{ marginTop: 8, font: "500 9.5px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
      >
        {state ||
          "Токен проверяется живым запросом к Meta: подхватываем страницу, её IG Business и последние публикации. Инструкция по выдаче токена — в Telegram."}
      </div>
      {feed.length ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <Eyebrow>ЛЕНТА СТРАНИЦ · {feed.length}</Eyebrow>
          {feed.map((f) => (
            <a
              key={f.url ?? f.text}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                className="gtr-mono"
                style={{ font: "600 9px/1.3 'JetBrains Mono',monospace", color: "var(--gtr-t3)", flex: "none" }}
              >
                {f.kind.toUpperCase()} · {(f.ts ?? "").slice(0, 10)}
              </span>
              <span
                style={{
                  font: "500 11px/1.4 'Golos Text',sans-serif",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.page}: {f.text || "медиа-публикация"}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// PromptPay: реквизит для QR-оплат (бронь, депозиты, вход). Деньги идут
// напрямую на счёт — без эквайринга. Виден и правится только здесь.
function PromptpayCard() {
  const [id, setId] = useState("");
  const [name, setName] = useState("GTR Event");
  const [saved, setSaved] = useState<string>("");
  const [state, setState] = useState("");
  useEffect(() => {
    promptpayCfgFn()
      .then((r) => {
        if (r.cfg) {
          setId(r.cfg.id);
          setName(r.cfg.name);
          setSaved(r.cfg.id);
        }
      })
      .catch(() => {});
  }, []);
  const save = async () => {
    setState("…");
    try {
      const r = await setPromptpayCfgFn({ data: { id, name } });
      setState(r.ok ? "✓ Сохранено — QR-оплата включена во всех бронях" : (r.reason ?? "…"));
      if (r.ok) setSaved(id);
    } catch {
      setState("Сервер недоступен");
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>PROMPTPAY · ПРИЁМ ОПЛАТ</Eyebrow>
        <Chip color={saved ? GREEN : AMBER}>{saved ? "ВКЛЮЧЕНО" : "НЕ НАСТРОЕНО"}</Chip>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 200px" }}
          placeholder="Телефон (10 цифр) / Tax ID (13) / e-wallet (15)"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ flex: "1 1 160px" }}
          placeholder="Имя получателя на экране оплаты"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>
          Сохранить
        </button>
      </div>
      <div
        className="gtr-mono"
        style={{ marginTop: 8, font: "500 9.5px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
      >
        {state ||
          "Гость сканирует QR в своём банке — деньги приходят напрямую на этот реквизит. Кнопка оплаты появляется в брони раздела «Сегодня» сразу после сохранения."}
      </div>
    </Card>
  );
}

// Спринт недели: 15 площадок с подтверждёнными прайсами. Воронка
// отправлено → открыто → подтверждено из vconfirm-записей, живьём.
const SPRINT_GOAL = 15;
function SprintBlock({ go }: { go: (s: ScreenId) => void }) {
  const [confirms, setConfirms] = useState<Record<string, VenueConfirm>>({});
  useEffect(() => {
    const load = () =>
      venueConfirmsFn().then((r) => setConfirms(r.confirms)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const list = Object.values(confirms);
  const sent = list.length;
  const opened = list.filter((c) => c.status === "opened" || c.status === "confirmed").length;
  const confirmed = list.filter((c) => c.status === "confirmed");
  const bySender = new Map<string, number>();
  for (const c of list) bySender.set(c.sentBy, (bySender.get(c.sentBy) ?? 0) + 1);
  const pct = Math.min(100, Math.round((confirmed.length / SPRINT_GOAL) * 100));
  const last = [...confirmed]
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))
    .slice(0, 3);
  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow style={{ color: RED }}>ЦЕЛЬ НЕДЕЛИ · ПОДТВЕРЖДЁННЫЕ ПРАЙСЫ</Eyebrow>
        <button className="gtr-btn gtr-btn-sm" onClick={() => go("base")}>
          К базе →
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ font: "700 26px/1 'Oswald',sans-serif", color: confirmed.length ? GREEN : "#fff" }}>
          {confirmed.length}
        </span>
        <span style={{ font: mono(11, 600), color: "rgba(255,255,255,.45)" }}>/ {SPRINT_GOAL} площадок</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,.08)" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: GREEN,
            transition: "width .4s",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {[
          ["ОТПРАВЛЕНО", sent, "rgba(255,255,255,.6)"],
          ["ОТКРЫТО", opened, AMBER],
          ["ПОДТВЕРЖДЕНО", confirmed.length, GREEN],
        ].map(([l, n, c]) => (
          <span key={l as string} style={{ font: mono(9.5, 600), color: c as string }}>
            {l}: {n}
          </span>
        ))}
      </div>
      {last.length ? (
        <div style={{ display: "grid", gap: 5 }}>
          {last.map((c) => (
            <div key={c.vid} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Dot color={GREEN} />
              <span style={{ flex: 1, minWidth: 0, font: golos(10.5), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {V(c.vid)?.name ?? c.vid}
                {c.rate?.amount ? ` · ${fmtThb(c.rate.amount)}` : ""}
              </span>
              <span style={{ font: mono(9), color: "rgba(255,255,255,.4)" }}>
                {c.sentBy.split("@")[0]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ font: golos(10.5), color: "rgba(255,255,255,.4)" }}>
          Отправляйте площадкам ссылки подтверждения из паспорта — каждое
          подтверждение появится здесь.
        </div>
      )}
      {bySender.size ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[...bySender.entries()].map(([e, n]) => (
            <span key={e} style={{ font: mono(9), color: "rgba(255,255,255,.45)" }}>
              {e.split("@")[0]}: {n}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
