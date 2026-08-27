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
import { Card, Chip, Dot, Eyebrow, Icon, StkBtn, tint } from "../ui";
import {
  allAfishaFn,
  bossHeadFn,
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
    setBusy("готовлю снимок…");
    try {
      const dataUrl = await shrinkToPng(file);
      const r = await saveBossHeadFn({ data: { [slot]: dataUrl } });
      if (r.ok) {
        const next = { ...(head ?? {}), [slot]: dataUrl };
        onSaved(next);
        setBusy("сохранено");
      } else setBusy(r.reason ?? "не вышло");
    } catch {
      setBusy("файл не читается — нужен PNG с прозрачным фоном");
    }
    setTimeout(() => setBusy(""), 4000);
  };
  const drop = async (slot: "day" | "night") => {
    setBusy("убираю…");
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
            {t("сейчас на острове:")} {isDaylight() ? "день" : "ночь"}
          </span>
          <button className="gtr-btn" onClick={() => setPreview(preview === "day" ? "night" : "day")}>
            {preview === null ? "Примерить" : preview === "day" ? "Показать ночь" : "Показать день"}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <BossHead3D head={head} size={132} force={preview} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, minWidth: 260 }}>
          {slot("day", t("ДЕНЬ · 06–18"), "прозрачные очки, дневной свет")}
          {slot("night", t("НОЧЬ · 18–06"), "тёмные очки, клубный свет")}
        </div>
      </div>
      <span style={{ font: mono(8.5), color: "rgba(255,255,255,.4)" }}>
        {t("Нужен PNG с уже вырезанным фоном — прозрачность и есть объём: по её краю строится контровой свет. Высота ужимается до 640 px прямо в браузере.")}
        {busy ? ` · ${busy}` : ""}
      </span>
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
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>{t("ЗАДАЧИ КОМАНДЫ")}</Eyebrow>
        <span style={{ font: mono(9), color: "rgba(255,255,255,.4)" }}>
          {open.length} {t("откр.")}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 250, overflowY: "auto" }}>
        {open.length === 0 ? (
          <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>{t("Открытых задач нет.")}</span>
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
  const { t } = useTranslation();
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

  const kpis: [string, string, string][] = [
    [t("ПАЙПЛАЙН"), fmtThb(money.total), "все сметы"],
    ["КОМИССИЯ GTR", fmtThb(money.commission), "заложено"],
    [t("СОБЫТИЯ"), String(shared.drafts.length), `${upcoming.length} впереди`],
    [t("ЗАЯВКИ"), String(reqOpen.length), "открытых"],
    [t("КОМАНДА"), String(users.length), "аккаунтов"],
  ];

  return (
    <div className="gtr-boss" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* -------- шапка BOSS -------- */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="gtr-boss-hero">
          <BossHead3D head={head} />
          <div style={{ flex: 1, minWidth: 220, padding: "16px 0" }}>
            <Eyebrow style={{ color: RED }}>{t("КОНТРОЛЬ ОПЕРАЦИИ · GTR EVENT")}</Eyebrow>
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
        {/* -------- сводка дня: что произошло на платформе за сегодня -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>{t("СВОДКА ДНЯ")}</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("tonight")}>
              {t("Афиша →")}
            </button>
          </div>
          {/* афиша сегодня */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ font: "700 22px/1 'Oswald',sans-serif", color: "#fff" }}>{digest.events.total}</span>
            <span style={{ font: "500 12px/1.4 'Golos Text',sans-serif", color: "rgba(255,255,255,.7)" }}>
              {t("событий в")} {digest.events.venues} {t("заведениях сегодня")}
              {digest.events.withArtist ? ` · ${digest.events.withArtist} ${t("с нашими артистами")}` : ""}
            </span>
          </div>
          {/* в каких заведениях есть мероприятия — топ по числу событий */}
          {digest.events.byVenue.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ font: mono(8, 600), color: "rgba(255,255,255,.4)", letterSpacing: ".12em" }}>
                {t("ЗАВЕДЕНИЯ С СОБЫТИЯМИ")}
              </span>
              {digest.events.byVenue.slice(0, 5).map((b) => (
                <button
                  key={b.vid}
                  onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" }, search: { vid: b.vid } })}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", background: "none", border: "none", color: "inherit", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ font: "500 12px/1.4 'Golos Text',sans-serif", color: "rgba(255,255,255,.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {V(b.vid)?.name ?? b.vid}
                  </span>
                  <span style={{ font: mono(10, 600), color: GREEN }}>{b.count}</span>
                </button>
              ))}
            </div>
          ) : (
            <span style={{ font: "500 12px/1.5 'Golos Text',sans-serif", color: "rgba(255,255,255,.5)" }}>
              {t("На сегодня событий в афише пока нет.")}
            </span>
          )}
          {/* регистрации и активность за сегодня */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {([
              [t("площадки"), digest.signups.venues],
              [t("организаторы"), digest.signups.organizers],
              [t("артисты"), digest.signups.artists],
              [t("черновики"), digest.newDrafts],
              [t("заявки"), digest.newReqs],
            ] as [string, number][])
              .filter(([, n]) => n > 0)
              .map(([label, n]) => (
                <Chip key={label} color={GREEN}>+{n} {label}</Chip>
              ))}
            {digest.signups.total === 0 && digest.newDrafts === 0 && digest.newReqs === 0 ? (
              <span style={{ font: "500 12px/1.5 'Golos Text',sans-serif", color: "rgba(255,255,255,.45)" }}>
                {t("Новых регистраций и заявок сегодня ещё не было.")}
              </span>
            ) : null}
          </div>
        </Card>
        {/* -------- деньги -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>{t("ДЕНЬГИ И СМЕТЫ")}</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("events")}>
              {t("Все события →")}
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
            <Eyebrow>{t("ЗАЯВКИ И БЛИЖАЙШЕЕ")}</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("inquiries")}>
              {t("Канбан →")}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(
              [
                ["new", t("НОВЫЕ"), RED],
                ["seen", t("В РАЗБОРЕ"), AMBER],
                ["accepted", t("ПРИНЯТЫ"), GREEN],
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
            <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>{t("Ближайших дат нет.")}</span>
          )}
        </Card>

        {/* -------- команда + лента -------- */}
        <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>{t("КОМАНДА · ЖИВАЯ ЛЕНТА")}</Eyebrow>
            <button className="gtr-btn gtr-btn-sm" onClick={() => go("admin")}>
              {t("Управление →")}
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
            <Eyebrow>{t("СВЯЗЬ И УВЕДОМЛЕНИЯ")}</Eyebrow>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <TgChip />
              <PushPanel />
            </div>
          </div>
          <BroadcastBlock />
        </Card>

        <PendingCard />
        <BossHeadCard head={head} onSaved={(h) => setHead(h)} />
        <PromptpayCard />
        <CommunityCard />
        <MetaCard />
        <ThreadsCard />
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
  const { t } = useTranslation();
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
        <Eyebrow>{t("ЗАЯВКИ НА РОЛИ · ПОДТВЕРЖДЕНИЕ BOSS")}</Eyebrow>
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
              {/* решение по заявке — знак и есть кнопка: подтверждение
                  нашей галочкой, отказ словом, чтобы их нельзя было
                  перепутать в спешке */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <StkBtn
                  name="check"
                  tone="ok"
                  disabled={busy === a.email}
                  onClick={() => void decide(a.email, true)}
                >
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
            </div>
          ))}
        </div>
      ) : (
        <span style={{ font: golos(11), color: "var(--gtr-t3)" }}>
          {t("Новых заявок нет. Артисты, организаторы, площадки и кандидаты в команду появятся здесь и в Telegram.")}
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
        <Eyebrow>{t("КОМЬЮНИТИ TELEGRAM · НОВОСТИ И ОБЩЕНИЕ")}</Eyebrow>
        <Chip color={channelTitle ? GREEN : AMBER}>
          {channelTitle ? `КАНАЛ · ${channelTitle.toUpperCase()}` : t("КАНАЛ НЕ ПРИВЯЗАН")}
        </Chip>
        <Chip color={chatTitle ? GREEN : AMBER}>
          {chatTitle ? `ЧАТ · ${chatTitle.toUpperCase()}` : t("ЧАТ НЕ ПРИВЯЗАН")}
        </Chip>
      </div>
      <div
        className="gtr-mono"
        style={{ font: "500 11px/1.6 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginBottom: 10 }}
      >
        {t("1) создай публичный канал (новости) и группу (чат) · 2) добавь бота @Gtrcom1_bot админом в оба · 3) вставь ссылки t.me и привяжи. Дайджест вечера уходит в канал сам — каждый день в 17:00.")}
      </div>
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
      </div>
      {state ? (
        <div
          className="gtr-mono"
          style={{ marginTop: 8, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
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
    setState("Проверяю токен у Threads…");
    try {
      const r = await setThreadsFn({ data: { token } });
      if (r.ok) {
        setWho(r.username);
        setDaysLeft(60);
        setToken("");
        setState(`✓ Подключён профиль @${r.username}`);
      } else setState(r.reason ?? "…");
    } catch {
      setState("Сервер недоступен");
    }
  };

  const test = async () => {
    setState("Публикую проверочный пост…");
    try {
      const r = await threadsPostFn({
        data: { text: "GTR Event — афиша ночного Пхукета. Проверка связи." },
      });
      setState(r.ok ? "✓ Пост опубликован — проверь профиль" : (r.reason ?? "…"));
    } catch {
      setState("Сервер недоступен");
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
        {state ||
          "Вечерний дайджест уходит в Threads вместе с Telegram. Лимит поста — 500 знаков, разметки нет: текст режется по строкам, а не по буквам. Токен живёт 60 дней."}
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
        <Eyebrow>{t("META · СТРАНИЦА FACEBOOK / INSTAGRAM")}</Eyebrow>
        <Chip color={connected ? GREEN : AMBER}>
          {connected ? `ПОДКЛЮЧЕНА${pageName ? ` · ${pageName.toUpperCase()}` : ""}` : t("НЕ ПОДКЛЮЧЕНА")}
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
        {state ||
          "Токен проверяется живым запросом к Meta: подхватываем страницу, её IG Business и последние публикации. Инструкция по выдаче токена — в Telegram."}
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
      setState(r.ok ? "✓ Сохранено — QR-оплата включена во всех бронях" : (r.reason ?? "…"));
      if (r.ok) setSaved(id);
    } catch {
      setState("Сервер недоступен");
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
  const bySender = new Map<string, number>();
  for (const c of list) bySender.set(c.sentBy, (bySender.get(c.sentBy) ?? 0) + 1);
  const pct = Math.min(100, Math.round((confirmed.length / SPRINT_GOAL) * 100));
  const last = [...confirmed]
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0))
    .slice(0, 3);
  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow style={{ color: RED }}>{t("ЦЕЛЬ НЕДЕЛИ · ПОДТВЕРЖДЁННЫЕ ПРАЙСЫ")}</Eyebrow>
        <button className="gtr-btn gtr-btn-sm" onClick={() => go("base")}>
          {t("К базе →")}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ font: "700 26px/1 'Oswald',sans-serif", color: confirmed.length ? GREEN : "#fff" }}>
          {confirmed.length}
        </span>
        <span style={{ font: mono(11, 600), color: "rgba(255,255,255,.45)" }}>/ {SPRINT_GOAL} {t("площадок")}</span>
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
          [t("ОТПРАВЛЕНО"), sent, "rgba(255,255,255,.6)"],
          [t("ОТКРЫТО"), opened, AMBER],
          [t("ПОДТВЕРЖДЕНО"), confirmed.length, GREEN],
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
          {t("Отправляйте площадкам ссылки подтверждения из паспорта — каждое подтверждение появится здесь.")}
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
