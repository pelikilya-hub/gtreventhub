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
import { BossHead3D, isDaylight, type BossHead } from "../boss-head";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";
import { TicketsAdmin } from "./Tickets";
import { Card, Chip, Dot, Eyebrow, Icon, StkBtn, tint } from "../ui";
import {
  allAfishaFn,
  bossHeadFn,
  broadcastFn,
  communityInviteTextFn,
  communityPostFn,
  tgRelinkFn,
  deleteTaskFn,
  metaCfgFn,
  metaExchangeFn,
  metaFeedFn,
  metaSyncFn,
  communityCfgFn,
  promptpayCfgFn,
  setCommunityCfgFn,
  setMetaCfgFn,
  setThreadsFn,
  threadsPostFn,
  threadsStatusFn,
  setPromptpayCfgFn,
  listUsersFn,
  pendingDecideFn,
  pendingListFn,
  pullTasksFn,
  pushStatusFn,
  pushSubscribeFn,
  pushTaskFn,
  pushTestFn,
  saveBossHeadFn,
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
import { eventsToday, signupsToday, createdToday, phuketDayStart } from "../daily-digest";

const mono = (s: number, w = 500) => `${w} ${s}px/1.3 'JetBrains Mono',monospace`;
const golos = (s: number, w = 500) => `${w} ${s}px/1.4 'Golos Text',sans-serif`;

// ---------- 3D-эмблема: вращающееся ядро импульса ----------
const b64ToU8 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};


// ---------- портрет BOSS в эмблеме: день и ночь ----------
// Снимок готовится в браузере: масштаб до 640 px по высоте и PNG, чтобы
// уцелела прозрачность вырезанного силуэта. Всё остальное сделает CSS.
function shrinkToPng(file: File, max = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(1, img.height));
        const w = Math.round(img.width * k);
        const h = Math.round(img.height * k);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d");
        if (!g) return reject(new Error("canvas"));
        g.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

function BossHeadCard({ head, onSaved }: { head: BossHead | null; onSaved: (h: BossHead) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<"day" | "night" | null>(null);
  const put = async (slot: "day" | "night", file?: File | null) => {
    if (!file) return;
    setBusy(t("готовлю снимок…"));
    try {
      const dataUrl = await shrinkToPng(file);
      const r = await saveBossHeadFn({ data: { [slot]: dataUrl } });
      if (r.ok) {
        const next = { ...(head ?? {}), [slot]: dataUrl };
        onSaved(next);
        setBusy(t("сохранено"));
      } else setBusy(r.reason ? t(r.reason) : t("не вышло"));
    } catch {
      setBusy(t("файл не читается — нужен PNG с прозрачным фоном"));
    }
    setTimeout(() => setBusy(""), 4000);
  };
  const drop = async (slot: "day" | "night") => {
    setBusy(t("убираю…"));
    const r = await saveBossHeadFn({ data: { [slot]: null } });
    if (r.ok) {
      const next = { ...(head ?? {}) };
      delete next[slot];
      onSaved(next);
    }
    setBusy("");
  };
  const slot = (id: "day" | "night", title: string, hint: string) => (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ font: mono(8.5, 600), color: "rgba(255,255,255,.45)", letterSpacing: ".12em" }}>
        {title}
      </span>
      <div
        style={{
          height: 96,
          border: `1px solid ${head?.[id] ? "rgba(46,204,113,.4)" : "rgba(255,255,255,.12)"}`,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,.02)",
          overflow: "hidden",
        }}
      >
        {head?.[id] ? (
          <img src={head[id]} alt="" style={{ maxHeight: "100%", objectFit: "contain" }} />
        ) : (
          <span style={{ font: mono(9), color: "rgba(255,255,255,.3)" }}>{t("пусто")}</span>
        )}
      </div>
      <span style={{ font: mono(8), color: "rgba(255,255,255,.35)" }}>{hint}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <label className="gtr-btn" style={{ cursor: "pointer" }}>
          {t("Загрузить")}
          <input
            type="file"
            accept="image/png,image/webp"
            hidden
            onChange={(e) => void put(id, e.target.files?.[0])}
          />
        </label>
        {head?.[id] ? (
          <button className="gtr-btn" onClick={() => void drop(id)}>
            {t("Убрать")}
          </button>
        ) : null}
      </div>
    </div>
  );
  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Eyebrow>{t("ПОРТРЕТ В ЭМБЛЕМЕ · ДЕНЬ И НОЧЬ")}</Eyebrow>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ font: mono(8.5), color: "rgba(255,255,255,.4)" }}>
            {t("сейчас на острове:")} {isDaylight() ? t("день") : t("ночь")}
          </span>
          <button className="gtr-btn" onClick={() => setPreview(preview === "day" ? "night" : "day")}>
            {preview === null ? t("Примерить") : preview === "day" ? t("Показать ночь") : t("Показать день")}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <BossHead3D head={head} size={132} force={preview} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, minWidth: 260 }}>
          {slot("day", t("ДЕНЬ · 06–18"), t("прозрачные очки, дневной свет"))}
          {slot("night", t("НОЧЬ · 18–06"), t("тёмные очки, клубный свет"))}
        </div>
      </div>
      {busy ? <span style={{ font: mono(10), color: "var(--gtr-t3)" }}>{busy}</span> : null}
    </Card>
  );
}

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
        throw new Error(t("браузер не поддерживает Push"));
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(t("разрешение не выдано"));
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY),
        }));
      const r = await pushSubscribeFn({ data: { sub: sub.toJSON() as never } });
      if (!r.ok) throw new Error(t("сервер не принял подписку"));
      setDevices(r.devices ?? 1);
      setState("on");
      setMsg(t("Подписка активна"));
    } catch (e) {
      setState("err");
      setMsg(e instanceof Error ? e.message : t("не получилось"));
    }
  }, [t]);

  const test = useCallback(async () => {
    setMsg("…");
    const r = await pushTestFn();
    setMsg(
      r.ok
        ? t("Отправлено ({{n}} устр.)", { n: r.sent })
        : t("Не вышло: {{reason}}", { reason: r.reason ? t(String(r.reason)) : "" }),
    );
  }, [t]);

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
  const { t } = useTranslation();
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
    new: [t("НОВАЯ"), AMBER],
    doing: [t("В РАБОТЕ"), "#7B4DFF"],
    done: [t("ГОТОВО"), GREEN],
  };

  return (
    <section className="gtr-dash-sec">
      <div className="gtr-dash-sec-head">
        <h2 className="gtr-dash-h">{t("ЗАДАЧИ КОМАНДЫ")}</h2>
        <span className="gtr-dash-row-v">{open.length}</span>
      </div>
      <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <input
          className="gtr-input"
          style={{ flex: "2 1 160px", minWidth: 0 }}
          placeholder={t("Что сделать…")}
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
          <option value="">{t("— исполнитель —")}</option>
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
          {t("Поставить")}
        </button>
      </div>
      <div>
        {open.length === 0 ? (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Открытых задач нет.")}</span>
          </div>
        ) : null}
        {open.map((tk) => (
          <div key={tk.id} className="gtr-dash-row">
            <Dot color={ST[tk.status][1]} />
            <span className="gtr-dash-row-t">
              {tk.title}
              <small>
                {tk.assigneeName}
                {tk.due ? ` · ${t("до {{date}}", { date: tk.due })}` : ""} · {ST[tk.status][0]}
              </small>
            </span>
            {tk.status === "new" ? (
              <button className="gtr-btn gtr-btn-sm" onClick={() => move(tk, "doing")}>
                {t("В работу")}
              </button>
            ) : (
              <button className="gtr-btn gtr-btn-sm" onClick={() => move(tk, "done")}>
                {t("Готово")}
              </button>
            )}
            <button
              className="gtr-btn gtr-btn-sm"
              style={{ opacity: 0.5 }}
              onClick={() => remove(tk.id)}
              title={t("Удалить")}
            >
              ✕
            </button>
          </div>
        ))}
        {done.map((t) => (
          <div key={t.id} className="gtr-dash-row" style={{ opacity: 0.45 }}>
            <Dot color={GREEN} />
            <span className="gtr-dash-row-t" style={{ fontWeight: 500, textDecoration: "line-through" }}>
              {t.title} — {t.assigneeName}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Рассылка ----------
function BroadcastBlock() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [aud, setAud] = useState<"all" | "team" | "artists" | "organizers">("all");
  const [note, setNote] = useState("");
  const send = useCallback(async () => {
    if (!text.trim()) return;
    setNote("…");
    const r = await broadcastFn({ data: { text, audience: aud } });
    setNote(r.ok ? t("Доставлено: {{n}}", { n: r.sent }) : t("не вышло"));
    if (r.ok) setText("");
  }, [text, aud, t]);
  const AUD: [typeof aud, string][] = [
    ["all", t("ВСЕМ")],
    ["team", t("КОМАНДЕ")],
    ["artists", t("АРТИСТАМ")],
    ["organizers", t("ОРГАМ")],
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
          placeholder={t("Сообщение в Telegram + push…")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        {/* знак сам кнопка: на красной заливке наши стикеры не читаются —
            они тёмные с красным акцентом и созданы под тёмный фон */}
        <StkBtn name="speaker" onClick={send} title={t("Отправить")}>
          {t("Отправить")}
        </StkBtn>
      </div>
    </div>
  );
}

// ---------- Кабинет BOSS ----------
export function BossCabinet() {
  const { t } = useTranslation();
  const { user, shared } = useGtr();
  const navigate = useNavigate();
  const go = (s: ScreenId) => navigate({ to: "/gtr/$screen", params: { screen: s } });
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [head, setHead] = useState<BossHead | null>(null);
  const [afisha, setAfisha] = useState<{ vid: string; dateIso: string; artistIds: string[] }[]>([]);
  useEffect(() => {
    listUsersFn().then((r) => {
      if (r.ok) setUsers(r.users);
    });
    bossHeadFn().then((r) => setHead(r.head)).catch(() => {});
    allAfishaFn().then((r) => setAfisha(r.items)).catch(() => {});
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
        text: `${t(draftTitle(d))} — ${t(STAGE_LABEL[d.graph.stage ?? "draft"])}${d.owner ? ` · ${d.owner.split("@")[0]}` : ""}`,
        color: STAGE_COLOR[d.graph.stage ?? "draft"],
      });
    for (const r of reqs.slice(0, 30))
      items.push({
        ts: r.ts,
        text: t("Заявка: {{title}}", { title: r.title || r.venueName }) +
          `${r.assigneeName ? ` → ${r.assigneeName}` : ""} · ${t(REQ_STATUS_LABEL[r.status] ?? r.status)}`,
        color: AMBER,
      });
    for (const o of shared.offers.slice(0, 30))
      items.push({
        ts: o.ts,
        text: `${t("Оффер {{artist}}", { artist: o.artistName })} · ${o.venueName} · ${t(OFFER_STATUS_LABEL[o.status] ?? o.status)}`,
        color: "#7B4DFF",
      });
    for (const u2 of users.slice(0, 20))
      items.push({
        ts: u2.created,
        text: t("Новый участник: {{name}} ({{role}})", { name: u2.name, role: t(String(u2.roleLabel)) }),
        color: GREEN,
      });
    // сидовые записи без реального времени (ts≈0) в ленту не попадают
    return items.filter((x) => x.ts > 1e12).sort((a, b) => b.ts - a.ts).slice(0, 12);
  }, [shared.drafts, reqs, shared.offers, users, t]);

  const fmtAgo = (ts: number) => {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return t("{{n}}м", { n: m });
    const h = Math.round(m / 60);
    return h < 48 ? t("{{n}}ч", { n: h }) : t("{{n}}д", { n: Math.round(h / 24) });
  };

  // Сводка дня: живые сигналы за сегодняшние сутки (Пхукет, UTC+7). Афиша —
  // из реального синка, регистрации/черновики/заявки — по своим таймстемпам.
  const digest = useMemo(() => {
    const dayStart = phuketDayStart(Date.now());
    const todayIso = new Date(dayStart + 12 * 3600_000).toISOString().slice(0, 10);
    return {
      events: eventsToday(afisha, todayIso),
      signups: signupsToday(users, dayStart),
      newDrafts: createdToday(shared.drafts.map((d) => ({ ts: d.updated })), dayStart),
      newReqs: createdToday(reqs.map((r) => ({ ts: r.ts })), dayStart),
    };
  }, [afisha, users, shared.drafts, reqs]);

  const reqCount = (k: string) => reqs.filter((r) => r.status === k).length;

  // Кабинет BOSS в общем языке кабинетов: имя и эмблема, четыре главные
  // цифры, дальше рабочие разделы строками. Интеграции (портрет, PromptPay,
  // Telegram-комьюнити, Meta, Threads) нужны редко — они свёрнуты в конце.
  return (
    <div className="gtr-dash gtr-boss">
      <section className="gtr-dash-head gtr-boss-head">
        <BossHead3D head={head} />
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <Eyebrow>{t("КАБИНЕТ BOSS")}</Eyebrow>
          <h1 className="gtr-dash-name">{user.name}</h1>
          <div className="gtr-dash-cta">
            <button className="gtr-btn gtr-btn-red" onClick={() => go("events")}>
              {t("Все события →")}
            </button>
            <button className="gtr-btn" onClick={() => go("inquiries")}>
              {t("Канбан →")}
            </button>
            <button className="gtr-btn" onClick={() => go("admin")}>
              {t("Управление →")}
            </button>
          </div>
        </div>
      </section>

      <div className="gtr-stats">
        <div className="gtr-stat">
          <b className="long">{fmtThb(money.total)}</b>
          <span>{t("ПАЙПЛАЙН")}</span>
        </div>
        <div className="gtr-stat">
          <b className="long" style={{ color: money.commission ? GREEN : undefined }}>
            {fmtThb(money.commission)}
          </b>
          <span>{t("КОМИССИЯ GTR")}</span>
        </div>
        <div className="gtr-stat">
          <b>{shared.drafts.length}</b>
          <span>{t("СОБЫТИЯ")}</span>
        </div>
        <div className="gtr-stat">
          <b style={{ color: reqOpen.length ? AMBER : undefined }}>{reqOpen.length}</b>
          <span>{t("ЗАЯВКИ")}</span>
        </div>
      </div>

      <PendingCard />

      <TicketsAdmin />

      <div className="gtr-boss-grid">
        <SprintBlock go={go} />

        {/* сводка дня: что произошло на платформе за сегодня */}
        <section className="gtr-dash-sec">
          <div className="gtr-dash-sec-head">
            <h2 className="gtr-dash-h">{t("СВОДКА ДНЯ")}</h2>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("tonight")}>
              {t("Афиша →")}
            </button>
          </div>
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">
              {digest.events.total} {t("событий в")} {digest.events.venues} {t("заведениях сегодня")}
              {digest.events.withArtist ? (
                <small>
                  {digest.events.withArtist} {t("с нашими артистами")}
                </small>
              ) : null}
            </span>
          </div>
          {digest.events.byVenue.slice(0, 5).map((b) => (
            <button
              key={b.vid}
              className="gtr-dash-row gtr-dash-link"
              onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" }, search: { vid: b.vid } })}
            >
              <span className="gtr-dash-row-t">{V(b.vid)?.name ?? b.vid}</span>
              <span className="gtr-dash-row-v" style={{ color: GREEN }}>
                {b.count}
              </span>
            </button>
          ))}
          {digest.signups.total || digest.newDrafts || digest.newReqs ? (
            <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 6 }}>
              {([
                [t("площадки"), digest.signups.venues],
                [t("организаторы"), digest.signups.organizers],
                [t("артисты"), digest.signups.artists],
                [t("черновики"), digest.newDrafts],
                [t("заявки"), digest.newReqs],
              ] as [string, number][])
                .filter(([, n]) => n > 0)
                .map(([label, n]) => (
                  <Chip key={label} color={GREEN}>
                    +{n} {label}
                  </Chip>
                ))}
            </div>
          ) : null}
        </section>

        {/* деньги: сумма смет по стадиям и три крупнейшие */}
        <section className="gtr-dash-sec">
          <div className="gtr-dash-sec-head">
            <h2 className="gtr-dash-h">{t("ДЕНЬГИ И СМЕТЫ")}</h2>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("events")}>
              {t("Все события →")}
            </button>
          </div>
          {[...money.byStage.entries()].map(([st, x]) => (
            <div key={st} className="gtr-dash-row">
              <Dot color={STAGE_COLOR[st as keyof typeof STAGE_COLOR] ?? "#888"} />
              <span className="gtr-dash-row-t">
                {t(STAGE_LABEL[st as keyof typeof STAGE_LABEL] ?? st)} · {x.n}
              </span>
              <span className="gtr-dash-row-v">{fmtThb(x.sum)}</span>
            </div>
          ))}
          {money.top.map(({ d, q }) => (
            <div key={d.id} className="gtr-dash-row">
              <span className="gtr-dash-row-t">
                {t(draftTitle(d))}
                <small>{V(d.venueId).name}</small>
              </span>
              <span className="gtr-dash-row-v" style={{ color: GREEN }}>
                {fmtThb(q.total)}
              </span>
            </div>
          ))}
        </section>

        {/* заявки по статусам и ближайшие даты */}
        <section className="gtr-dash-sec">
          <div className="gtr-dash-sec-head">
            <h2 className="gtr-dash-h">{t("ЗАЯВКИ И БЛИЖАЙШЕЕ")}</h2>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("inquiries")}>
              {t("Канбан →")}
            </button>
          </div>
          <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 6 }}>
            <Chip color={RED}>
              {t("НОВЫЕ")} {reqCount("new")}
            </Chip>
            <Chip color={AMBER}>
              {t("В РАЗБОРЕ")} {reqCount("seen")}
            </Chip>
            <Chip color={GREEN}>
              {t("ПРИНЯТЫ")} {reqCount("accepted")}
            </Chip>
          </div>
          {upcoming.length ? (
            upcoming.map((d) => (
              <div key={d.id} className="gtr-dash-row">
                <span className="gtr-dash-row-v" style={{ color: RED, width: 46 }}>
                  {(d.dateIso ?? "").slice(5).replace("-", ".")}
                </span>
                <span className="gtr-dash-row-t">
                  {t(draftTitle(d))}
                  <small>{V(d.venueId).name}</small>
                </span>
              </div>
            ))
          ) : (
            <div className="gtr-dash-row">
              <span className="gtr-dash-row-t">{t("Ближайших дат нет.")}</span>
            </div>
          )}
        </section>

        <TasksBlock users={users} me={user.email} />

        {/* команда и живая лента действий */}
        <section className="gtr-dash-sec">
          <div className="gtr-dash-sec-head">
            <h2 className="gtr-dash-h">{t("КОМАНДА · ЖИВАЯ ЛЕНТА")}</h2>
            <span className="gtr-dash-row-v">{users.length}</span>
          </div>
          {feed.length ? (
            feed.slice(0, 8).map((f, i) => (
              <div key={i} className="gtr-dash-row">
                <Dot color={f.color} />
                <span className="gtr-dash-row-t" style={{ fontWeight: 500, fontSize: 14 }}>
                  {f.text}
                </span>
                <span className="gtr-dash-row-v" style={{ color: "var(--gtr-t4)" }}>
                  {fmtAgo(f.ts)}
                </span>
              </div>
            ))
          ) : (
            <div className="gtr-dash-row">
              <span className="gtr-dash-row-t">{t("Пока тихо")}</span>
            </div>
          )}
        </section>

        {/* рассылка: Telegram + push одной строкой */}
        <section className="gtr-dash-sec">
          <div className="gtr-dash-sec-head">
            <h2 className="gtr-dash-h">{t("СВЯЗЬ И УВЕДОМЛЕНИЯ")}</h2>
          </div>
          <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <TgChip />
            <PushPanel />
          </div>
          <div style={{ paddingTop: 14 }}>
            <BroadcastBlock />
          </div>
        </section>
      </div>

      <details className="gtr-dash-sec gtr-dash-more gtr-boss-more">
        <summary className="gtr-dash-h">{t("Интеграции и оплаты")}</summary>
        <div className="gtr-boss-integr">
          <PromptpayCard />
          <CommunityCard />
          <MetaCard />
          <ThreadsCard />
          <BossHeadCard head={head} onSaved={(h) => setHead(h)} />
        </div>
      </details>
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
// Статусы заявок и офферов для живой ленты — ключи перевода, t() при выводе
const REQ_STATUS_LABEL: Record<string, string> = {
  new: "новая", seen: "в разборе", accepted: "принята", declined: "отклонена",
};
const OFFER_STATUS_LABEL: Record<string, string> = {
  sent: "отправлен", accepted: "принят", declined: "отклонён",
};
function PendingCard() {
  const { t, i18n } = useTranslation();
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
    const app = items.find((x) => x.email === email);
    try {
      const r = await pendingDecideFn({ data: { email, approve } });
      // Итог сервера собран по-русски с именем — для успеха пишем свой
      // переведённый текст, для отказов переводим известные причины.
      setNote(
        r.ok && app
          ? approve
            ? t("✅ {{name}} ({{email}}) — роль «{{role}}» одобрена", {
                name: app.name,
                email: app.email,
                role: t(PENDING_ROLE_LABEL[app.role] ?? app.role),
              })
            : t("❌ Заявка {{name}} ({{email}}) отклонена", { name: app.name, email: app.email })
          : t(String(r.note)),
      );
      load();
    } catch {
      setNote(t("Сервер недоступен"));
    } finally {
      setBusy("");
    }
  };
  // пустой блок не показываем: о новых заявках напомнит Telegram
  if (!items.length && !note) return null;
  return (
    <section className="gtr-dash-sec">
      <div className="gtr-dash-sec-head">
        <h2 className="gtr-dash-h">{t("Заявки на роли")}</h2>
        <span className="gtr-dash-row-v" style={{ color: items.length ? RED : undefined }}>
          {items.length}
        </span>
      </div>
      {items.map((a) => (
        <div key={a.email} className="gtr-dash-row">
          <span className="gtr-dash-row-t">
            {a.name}
            <span style={{ color: RED, marginLeft: 8, font: mono(11, 700) }}>
              {PENDING_ROLE_LABEL[a.role] ? t(PENDING_ROLE_LABEL[a.role]).toUpperCase() : null}
            </span>
            <small>
              {a.email} · {new Date(a.created).toLocaleDateString(i18n.language === "th" ? "th-TH" : i18n.language === "en" ? "en-GB" : "ru-RU")}
              {a.about ? ` · «${a.about}»` : ""}
            </small>
          </span>
          {/* решение по заявке — знак и есть кнопка: подтверждение
              нашей галочкой, отказ словом, чтобы их нельзя было
              перепутать в спешке */}
          <StkBtn name="check" tone="ok" disabled={busy === a.email} onClick={() => void decide(a.email, true)}>
            {t("Принять")}
          </StkBtn>
          <button
            className="gtr-btn gtr-btn-sm"
            disabled={busy === a.email}
            onClick={() => void decide(a.email, false)}
          >
            {t("Отклонить")}
          </button>
        </div>
      ))}
      {note ? (
        <div className="gtr-dash-row">
          <span className="gtr-dash-row-t" style={{ fontWeight: 500, color: "var(--gtr-t2)" }}>{note}</span>
        </div>
      ) : null}
    </section>
  );
}

// Meta: авторизация страницы BOSS (FB/IG Business) через официальный
// Graph API — посты и медиа страницы затягиваются легально по токену.
// Комьюнити Telegram: канал новостей + группа общения. Бот проверяет,
// что добавлен админом, и дальше умеет постить дайджест вечера и
// приглашение тестовой группы.
function CommunityCard() {
  const { t } = useTranslation();
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
    setState(t("Проверяю канал и группу у Telegram…"));
    try {
      const r = await setCommunityCfgFn({ data: { channelUrl, chatUrl } });
      if (r.ok) {
        setChannelTitle(r.cfg.channelTitle);
        setChatTitle(r.cfg.chatTitle);
        setState(
          r.notes.length
            ? r.notes.map((n) => t(String(n))).join(" · ")
            : t("✓ Привязано: {{what}}", {
                what: [r.cfg.channelTitle, r.cfg.chatTitle].filter(Boolean).join(" + ") || t("пока пусто"),
              }),
        );
      } else setState(r.reason ? t(String(r.reason)) : "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const activate = async () => {
    setState(t("Обновляю вебхук бота (конкурс)…"));
    try {
      const r = await tgActivateFn();
      setState(r.ok ? `${t("✓ Вебхук обновлён")} · @${r.bot}` : t(String(r.error)));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const post = async (
    kind: "digest" | "invite" | "contest" | "moved" | "poll",
    target: "channel" | "chat",
  ) => {
    setState(
      kind === "digest"
        ? t("Собираю дайджест вечера…")
        : kind === "contest"
          ? t("Публикую конкурс…")
          : kind === "moved"
            ? t("Объявляю о переезде и закрепляю пост…")
            : kind === "poll"
              ? t("Публикую опрос…")
              : t("Отправляю приглашение…"),
    );
    try {
      const r = await communityPostFn({ data: { kind, target } });
      setState(r.ok ? t("✓ Опубликовано") : t(String(r.reason)));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  // Ссылки, живущие не в коде, а в настройках Telegram: описание бота,
  // кнопка меню, команды, описания канала и чата. Отчёт построчный —
  // часть вызовов Telegram отклоняет по правам, и это надо видеть.
  const relink = async () => {
    setState(t("Обновляю ссылки в Telegram…"));
    try {
      const r = await tgRelinkFn();
      setState(r.steps.length ? r.steps.join("\n") : r.reason ? t(String(r.reason)) : t("Telegram не ответил"));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const copyInvite = async () => {
    try {
      const r = await communityInviteTextFn();
      setInviteText(r.text);
      try {
        await navigator.clipboard.writeText(r.text);
        setState(t("✓ Текст приглашения скопирован — шли кому угодно"));
      } catch {
        setState(t("Текст ниже — скопируй вручную"));
      }
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>{t("КОМЬЮНИТИ TELEGRAM · НОВОСТИ И ОБЩЕНИЕ")}</Eyebrow>
        <Chip color={channelTitle ? GREEN : AMBER}>
          {channelTitle ? `${t("КАНАЛ")} · ${channelTitle.toUpperCase()}` : t("КАНАЛ НЕ ПРИВЯЗАН")}
        </Chip>
        <Chip color={chatTitle ? GREEN : AMBER}>
          {chatTitle ? `${t("ЧАТ")} · ${chatTitle.toUpperCase()}` : t("ЧАТ НЕ ПРИВЯЗАН")}
        </Chip>
      </div>
      {channelTitle && chatTitle ? null : (
        <div
          className="gtr-mono"
          style={{ font: "500 11px/1.6 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginBottom: 10 }}
        >
          {t("1) создай публичный канал (новости) и группу (чат) · 2) добавь бота @Gtrcom1_bot админом в оба · 3) вставь ссылки t.me и привяжи. Дайджест вечера уходит в канал сам — каждый день в 17:00.")}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 220px" }}
          placeholder={t("Канал: t.me/имя_канала")}
          value={channelUrl}
          onChange={(e) => setChannelUrl(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ flex: "1 1 220px" }}
          placeholder={t("Группа: t.me/имя_группы")}
          value={chatUrl}
          onChange={(e) => setChatUrl(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>{t("Привязать и проверить")}</button>
      </div>
      <div
        className="gtr-mono"
        style={{ font: "600 11px/1 'JetBrains Mono',monospace", letterSpacing: "0.09em", color: "var(--gtr-t3)", marginBottom: 6 }}
      >
        {t("ПУБЛИКАЦИЯ")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="gtr-btn" onClick={() => post("digest", "channel")}>
          <Icon d="M3 9v6h4l6 4V5L7 9H3z M15.5 8.5a4 4 0 0 1 0 7" size={13} />
          {t("Дайджест в канал сейчас")}
        </button>
        <button className="gtr-btn" onClick={() => post("invite", "channel")}>
          <Icon d="M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6 M15 8l4 4-4 4 M19 12H9" size={13} />
          {t("Приглашение в канал")}
        </button>
        <button className="gtr-btn gtr-btn-red" onClick={() => post("moved", "channel")}>
          <Icon d="M4 20h16 M12 3v13 M7 11l5 5 5-5" size={13} />
          {t("Объявить о переезде на gtrevent.com")}
        </button>
        <button className="gtr-btn" onClick={() => post("poll", "channel")}>
          <Icon d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2" size={13} />
          {t("Опрос в канал")}
        </button>
        <button className="gtr-btn" onClick={() => post("contest", "channel")}>
          <Icon d="M7 4h10v4a5 5 0 0 1-10 0V4z M5 5H3v2a4 4 0 0 0 4 4 M21 5h-2v2a4 4 0 0 0-4 4 M9 21h6 M12 17v4" size={13} />
          {t("Конкурс инвайтинга в канал")}
        </button>
      </div>
      <div
        className="gtr-mono"
        style={{ font: "600 11px/1 'JetBrains Mono',monospace", letterSpacing: "0.09em", color: "var(--gtr-t3)", marginBottom: 6 }}
      >
        {t("ИНСТРУМЕНТЫ")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="gtr-btn gtr-btn-ghost" onClick={copyInvite}>
          <Icon d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z M6 5h12v15H6z M9 10h6 M9 14h6" size={13} />
          {t("Текст приглашения (разослать)")}
        </button>
        <button className="gtr-btn gtr-btn-ghost" onClick={activate}>
          <Icon d="M20 11a8 8 0 1 0-2.2 6.6 M20 6v5h-5" size={13} />
          {t("Обновить вебхук (для конкурса)")}
        </button>
        <button className="gtr-btn gtr-btn-ghost" onClick={relink}>
          <Icon d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" size={13} />
          {t("Обновить ссылки в Telegram")}
        </button>
      </div>
      {state ? (
        <div
          className="gtr-mono"
          style={{
            marginTop: 8,
            font: "500 11px/1.5 'JetBrains Mono',monospace",
            color: "var(--gtr-t2)",
            whiteSpace: "pre-line",
          }}
        >
          {state}
        </div>
      ) : null}
      {inviteText ? (
        <textarea
          className="gtr-input"
          readOnly
          value={inviteText}
          style={{ marginTop: 8, width: "100%", minHeight: 120, font: "500 13px/1.5 'Golos Text',sans-serif" }}
        />
      ) : null}
    </Card>
  );
}


/** Threads — отдельное подключение от страниц Facebook: свой токен, свои
 *  права, свой домен API. Поэтому и карточка отдельная: одна кнопка
 *  «подключить» и одна «проверить постом», чтобы связку было видно
 *  сразу, а не вечером после крона. */
function ThreadsCard() {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [state, setState] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    void threadsStatusFn()
      .then((r) => {
        if (r.connected) {
          setWho(r.username);
          setDaysLeft(r.daysLeft ?? null);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setState(t("Проверяю токен у Threads…"));
    try {
      const r = await setThreadsFn({ data: { token } });
      if (r.ok) {
        setWho(r.username);
        setDaysLeft(60);
        setToken("");
        setState(`${t("✓ Подключён профиль")} @${r.username}`);
      } else setState(r.reason ? t(String(r.reason)) : "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };

  const test = async () => {
    setState(t("Публикую проверочный пост…"));
    try {
      const r = await threadsPostFn({
        data: { text: "GTR Event — афиша ночного Пхукета. Проверка связи." },
      });
      setState(r.ok ? t("✓ Пост опубликован — проверь профиль") : r.reason ? t(String(r.reason)) : "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };

  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>{t("THREADS · ПУБЛИКАЦИЯ АФИШИ")}</Eyebrow>
        <Chip color={who ? GREEN : AMBER}>{who ? `@${who.toUpperCase()}` : t("НЕ ПОДКЛЮЧЁН")}</Chip>
        {daysLeft !== null ? (
          <Chip color={daysLeft < 10 ? RED : "#7B4DFF"}>{t("ТОКЕН ·")} {daysLeft} {t("ДН.")}</Chip>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 280px" }}
          placeholder={t("Access Token профиля Threads")}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>
          {t("Подключить")}
        </button>
        {who ? (
          <button className="gtr-btn" onClick={test}>
            {t("Проверить постом")}
          </button>
        ) : null}
      </div>
      <div
        className="gtr-mono"
        style={{ marginTop: 8, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
      >
        {state}
      </div>
    </Card>
  );
}

function MetaCard() {
  const { t } = useTranslation();
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
    setState(t("Обмениваю токены на долгоживущие…"));
    try {
      const r = await metaExchangeFn({ data: { appId, appSecret } });
      setState((r.ok ? "✓ " : "") + t(String(r.note)));
      if (r.ok) setAppSecret("");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const save = async () => {
    setState(t("Проверяю токен у Meta…"));
    try {
      const r = await setMetaCfgFn({ data: { token } });
      if (r.ok) {
        setConnected(true);
        setPageName(r.pageName ?? "");
        setIgUser(r.igUser ?? "");
        setState(
          t("✓ Страница «{{page}}» подключена", { page: r.pageName }) + (r.igUser ? ` · IG @${r.igUser}` : ""),
        );
        setToken("");
      } else setState(r.reason ? t(String(r.reason)) : "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const sync = async () => {
    setState(t("Забираю публикации…"));
    try {
      const r = await metaSyncFn();
      setState(r.ok ? t("✓ Подтянуто публикаций: {{n}}", { n: r.count }) : r.reason ? t(String(r.reason)) : "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>{t("META · СТРАНИЦА FACEBOOK / INSTAGRAM")}</Eyebrow>
        <Chip color={connected ? GREEN : AMBER}>
          {connected ? `${t("ПОДКЛЮЧЕНА")}${pageName ? ` · ${pageName.toUpperCase()}` : ""}` : t("НЕ ПОДКЛЮЧЕНА")}
        </Chip>
        {igUser ? <Chip color="#7B4DFF">IG @{igUser}</Chip> : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 280px" }}
          placeholder={t("Access Token из Graph API Explorer (вставить и сохранить)")}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>
          {t("Подключить")}
        </button>
        {connected ? (
          <button className="gtr-btn" onClick={sync}>
            {t("Синк публикаций")}
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
            placeholder={t("App Secret (Show → скопировать)")}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
          <button className="gtr-btn" onClick={exchange}>
            {t("Сделать токены вечными")}
          </button>
        </div>
      ) : null}
      <div
        className="gtr-mono"
        style={{ marginTop: 8, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
      >
        {state}
      </div>
      {feed.length ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <Eyebrow>{t("ЛЕНТА СТРАНИЦ ·")} {feed.length}</Eyebrow>
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
                style={{ font: "600 11px/1.45 'JetBrains Mono',monospace", color: "var(--gtr-t3)", flex: "none" }}
              >
                {f.kind.toUpperCase()} · {(f.ts ?? "").slice(0, 10)}
              </span>
              <span
                style={{
                  font: "500 13px/1.5 'Golos Text',sans-serif",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {f.page}: {f.text || t("медиа-публикация")}
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
  const { t } = useTranslation();
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
      setState(r.ok ? t("✓ Сохранено — QR-оплата включена во всех бронях") : r.reason ? t(String(r.reason)) : "…");
      if (r.ok) setSaved(id);
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  return (
    <Card style={{ padding: 14, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Eyebrow>{t("PROMPTPAY · ПРИЁМ ОПЛАТ")}</Eyebrow>
        <Chip color={saved ? GREEN : AMBER}>{saved ? t("ВКЛЮЧЕНО") : t("НЕ НАСТРОЕНО")}</Chip>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 200px" }}
          placeholder={t("Телефон (10 цифр) / Tax ID (13) / e-wallet (15)")}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ flex: "1 1 160px" }}
          placeholder={t("Имя получателя на экране оплаты")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="gtr-btn gtr-btn-red" onClick={save}>
          {t("Сохранить")}
        </button>
      </div>
      <div
        className="gtr-mono"
        style={{ marginTop: 8, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
      >
        {state}
      </div>
    </Card>
  );
}

// Спринт недели: 15 площадок с подтверждёнными прайсами. Воронка
// отправлено → открыто → подтверждено из vconfirm-записей, живьём.
const SPRINT_GOAL = 15;
function SprintBlock({ go }: { go: (s: ScreenId) => void }) {
  const { t } = useTranslation();
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
  const pct = Math.min(100, Math.round((confirmed.length / SPRINT_GOAL) * 100));
  const last = [...confirmed]
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))
    .slice(0, 3);
  return (
    <section className="gtr-dash-sec">
      <div className="gtr-dash-sec-head">
        <h2 className="gtr-dash-h">{t("Цель недели")}</h2>
        <button className="gtr-btn gtr-btn-sm" onClick={() => go("base")}>
          {t("К базе →")}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0 12px" }}>
        <span style={{ font: "400 clamp(34px, 4vw, 52px)/1 var(--glitch)", color: confirmed.length ? GREEN : "#fff" }}>
          {confirmed.length}
        </span>
        <span style={{ font: mono(12, 600), color: "var(--gtr-t3)" }}>
          / {SPRINT_GOAL} {t("площадок")}
        </span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,.08)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: GREEN, transition: "width .4s" }} />
      </div>
      <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 14 }}>
        {[
          [t("ОТПРАВЛЕНО"), sent, "var(--gtr-t2)"],
          [t("ОТКРЫТО"), opened, AMBER],
          [t("ПОДТВЕРЖДЕНО"), confirmed.length, GREEN],
        ].map(([l, n, c]) => (
          <span key={l as string} style={{ font: mono(11, 600), color: c as string }}>
            {l}: {n}
          </span>
        ))}
      </div>
      {last.map((c) => (
        <div key={c.vid} className="gtr-dash-row">
          <Dot color={GREEN} />
          <span className="gtr-dash-row-t">
            {V(c.vid)?.name ?? c.vid}
            <small>{c.sentBy.split("@")[0]}</small>
          </span>
          {c.rate?.amount ? <span className="gtr-dash-row-v">{fmtThb(c.rate.amount)}</span> : null}
        </div>
      ))}
    </section>
  );
}
