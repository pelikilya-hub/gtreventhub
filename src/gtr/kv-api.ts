// Серверный слой GTR Event поверх Workers KV: аккаунты менеджеров и общая
// база событий/заявок. Пока биндинга нет (vite-dev), функции возвращают
// null/недоступно — клиент продолжает работать на localStorage.
import { createServerFn } from "@tanstack/react-start";
import { currentUser, type SessionUser, type StoredUser } from "./auth";
import type { EventDraft, Offer, OrgRequest, RoleId } from "./data/app-data";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "./kv-ns";
import { tgApi, tgConfigured, tgEsc, tgWebhookSecret } from "./tg";
import type { VenueAfisha } from "./afisha";

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const ROLE_LABELS: Record<RoleId, string> = {
  pr: "PR-директор",
  owner: "Владелец",
  sales: "Event-продажи",
  gtr: "GTR-админ",
  artist: "Артист / диджей",
  organizer: "Организатор",
};

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "ГТ";

// Видит ли пользователь событие: владелец, его площадка (для событий без
// владельца — старых и засеянных) или GTR-админ
const canSeeDraft = (u: SessionUser, d: EventDraft) =>
  u.role === "gtr" ||
  (d.owner ? d.owner === u.email || d.owner === u.teamOf : Boolean(u.venueId) && d.venueId === u.venueId);

const canSeeRequest = (u: SessionUser, r: OrgRequest) =>
  u.role === "gtr" ||
  (Boolean(u.venueId) && r.venueId === u.venueId) ||
  r.assignee === u.email ||
  r.organizerEmail === u.email;

// Уведомление GTR-админам: личные чаты всех admin-аккаунтов + общий канал
async function notifyAdminsTg(ns: KvNs, text: string) {
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  const sent = new Set<string>();
  for (const a of users.filter((u) => u.role === "gtr")) {
    const chat = await ns.get(`tg:${a.email}`);
    if (chat && !sent.has(chat)) {
      sent.add(chat);
      await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML" });
    }
  }
  const channel = process.env.TELEGRAM_CHAT_ID;
  if (channel && !sent.has(channel))
    await tgApi("sendMessage", { chat_id: channel, text, parse_mode: "HTML" });
}

// ---------- пользователи ----------

export type PublicUser = Omit<StoredUser, "passHash">;

export const inviteUserFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      name: string;
      email: string;
      role: RoleId;
      venueId: string;
      artistId?: string;
      password: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (me?.role !== "gtr") return { ok: false as const, error: "Только GTR-админ" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно (локальный режим)" };

    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false as const, error: "Некорректный email" };
    if (data.password.length < 6)
      return { ok: false as const, error: "Пароль от 6 символов" };
    if (await ns.get(`user:${email}`))
      return { ok: false as const, error: "Такой пользователь уже есть" };

    const stored: StoredUser = {
      email,
      name: data.name.trim() || email,
      role: data.role,
      roleLabel: ROLE_LABELS[data.role],
      venueId: data.venueId || "",
      artistId: data.artistId || "",
      initials: initialsOf(data.name),
      passHash: await sha256(data.password),
      created: Date.now(),
      invitedBy: me.email,
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    const { passHash: _p, ...pub } = stored;
    return { ok: true as const, user: pub as PublicUser };
  });

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  if (me?.role !== "gtr") return { ok: false as const, users: [] as PublicUser[] };
  const ns = await getKvNs();
  if (!ns) return { ok: false as const, users: [] as PublicUser[] };
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  return {
    ok: true as const,
    users: users
      .map(({ passHash: _p, ...u }) => u as PublicUser)
      .sort((a, b) => b.created - a.created),
  };
});

export const deleteUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (me?.role !== "gtr") return { ok: false as const };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    await ns.delete(`user:${data.email.trim().toLowerCase()}`);
    return { ok: true as const };
  });

// Менеджеры для назначения заявок: доступно всем ролям площадок
export const listManagersFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  if (!me) return { managers: [] as { email: string; name: string }[] };
  const ns = await getKvNs();
  if (!ns) return { managers: [] };
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  return {
    managers: users
      .filter((u) => u.role === "sales" || u.role === "gtr")
      .map((u) => ({ email: u.email, name: u.name })),
  };
});

// ---------- события и заявки ----------

const getDraft = (ns: KvNs, id: string) => kvGetJson<EventDraft>(ns, `draft:${id}`);

export const pullSharedFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return null;

  // Команда: тимлид видит события участников, участники — события тимлида
  const owners = new Set<string>([u.email]);
  if (u.teamOf) owners.add(u.teamOf);
  if (u.role !== "gtr") {
    const userKeys = await kvListAll(ns, "user:");
    const users = (
      await Promise.all(userKeys.map((k) => kvGetJson<StoredUser>(ns, k)))
    ).filter((x): x is StoredUser => Boolean(x));
    for (const m of users) {
      if (m.teamOf && (m.teamOf === u.email || (u.teamOf && m.teamOf === u.teamOf)))
        owners.add(m.email);
    }
  }

  const [draftKeys, reqKeys] = await Promise.all([
    kvListAll(ns, "draft:"),
    kvListAll(ns, "req:"),
  ]);
  const [drafts, requests] = await Promise.all([
    Promise.all(draftKeys.map((k) => kvGetJson<EventDraft>(ns, k))),
    Promise.all(reqKeys.map((k) => kvGetJson<OrgRequest>(ns, k))),
  ]);
  return {
    drafts: drafts
      .filter((d): d is EventDraft => Boolean(d))
      .filter((d) =>
        u.role === "gtr"
          ? true
          : d.owner
            ? owners.has(d.owner)
            : Boolean(u.venueId) && d.venueId === u.venueId,
      ),
    requests: requests
      .filter((r): r is OrgRequest => Boolean(r))
      .filter((r) => canSeeRequest(u, r)),
    owners: [...owners],
  };
});

export const pushDraftFn = createServerFn({ method: "POST" })
  .inputValidator((d: EventDraft) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    // писать можно только своё (или админом); чужой существующий драфт не трогаем
    const existing = await getDraft(ns, data.id);
    const target = existing ?? data;
    if (!canSeeDraft(u, target)) return { ok: false as const };
    await ns.put(`draft:${data.id}`, JSON.stringify(data));
    // Новое событие организатора — оповещение GTR-админам
    if (!existing && u.role === "organizer") {
      const { V } = await import("./data/app-data");
      notifyAdminsTg(
        ns,
        [
          "<b>GTR EVENT · новое событие организатора</b>",
          "",
          `<b>${tgEsc(data.title || data.format || "Событие")}</b> · ${tgEsc(data.id)}`,
          `Площадка: ${tgEsc(V(data.venueId).name ?? data.venueId)}`,
          data.date ? `Когда: ${tgEsc(data.date)}` : "",
          `Создал: ${tgEsc(u.name)} (${tgEsc(u.email)})`,
        ]
          .filter(Boolean)
          .join("\n"),
      ).catch(() => {});
    }
    return { ok: true as const };
  });

export const deleteDraftKvFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    const existing = await getDraft(ns, data.id);
    if (existing && !canSeeDraft(u, existing)) return { ok: false as const };
    await ns.delete(`draft:${data.id}`);
    return { ok: true as const };
  });

// Заявку создаёт организатор без сессии; правки — только авторизованные
export const pushRequestFn = createServerFn({ method: "POST" })
  .inputValidator((d: OrgRequest) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    const existing = await kvGetJson<OrgRequest>(ns, `req:${data.id}`);
    if (existing) {
      const u = await currentUser();
      if (!u || !canSeeRequest(u, existing)) return { ok: false as const };
    }
    await ns.put(`req:${data.id}`, JSON.stringify(data));

    // Новая заявка: личные уведомления сотрудникам площадки (и в общий канал)
    if (!existing && data.status === "new") {
      const text = [
        "<b>GTR EVENT · новая заявка</b>",
        "",
        `<b>${tgEsc(data.title || "Заявка")}</b> · ${tgEsc(data.venueName)}`,
        `${tgEsc(data.date || "дата не указана")} · ${tgEsc(data.guests || "—")} гостей`,
        `<b>Смета:</b> ${tgEsc(String(data.quoteTotal))} THB · орг.: ${tgEsc(data.organizerName || "—")}`,
      ].join("\n");
      const markup = {
        inline_keyboard: [
          [
            { text: "Взять на себя", callback_data: `req:${data.id}:take` },
            { text: "✅ Принять", callback_data: `req:${data.id}:acc` },
          ],
        ],
      };
      const keys = await kvListAll(ns, "user:");
      const users = (
        await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
      ).filter((u): u is StoredUser => Boolean(u));
      const staff = users.filter(
        (u) => u.role !== "artist" && (u.role === "gtr" || u.venueId === data.venueId),
      );
      const sent = new Set<string>();
      for (const st of staff) {
        const chat = await ns.get(`tg:${st.email}`);
        if (chat && !sent.has(chat)) {
          sent.add(chat);
          await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_markup: markup });
        }
      }
      const channel = process.env.TELEGRAM_CHAT_ID;
      if (channel && !sent.has(channel))
        await tgApi("sendMessage", { chat_id: channel, text, parse_mode: "HTML" });
    }
    return { ok: true as const };
  });

// ---------- предложения артистам ----------

const canSeeOffer = (u: SessionUser, o: Offer) =>
  u.role === "gtr" || o.from === u.email || (o.to !== "" && o.to === u.email);

// Ядро решения по предложению: используется и серверной функцией (кнопки в
// приложении), и вебхуком Telegram. Обновляет предложение, узел артиста в
// графе события и шлёт уведомление менеджеру.
export async function decideOfferCore(
  ns: KvNs,
  offer: Offer,
  accept: boolean,
  byLabel: string,
): Promise<Offer> {
  const next: Offer = {
    ...offer,
    status: accept ? "accepted" : "declined",
    decidedTs: Date.now(),
  };
  await ns.put(`offer:${offer.id}`, JSON.stringify(next));

  // отметка на узле артиста в графе события
  const draft = await kvGetJson<EventDraft>(ns, `draft:${offer.draftId}`);
  if (draft) {
    const node = draft.graph.nodes.find(
      (n) => n.kind === "artist" && n.fields.some((f) => f[0] === "КАРТОЧКА" && f[1] === offer.artistId),
    );
    if (node) {
      node.badge = accept ? "OK" : "ОТКАЗ";
      const st = node.fields.find((f) => f[0] === "СТАТУС");
      const val = accept ? "Подтверждён артистом" : "Отказ артиста";
      if (st) st[1] = val;
      else node.fields.push(["СТАТУС", val]);
      draft.updated = Date.now();
      await ns.put(`draft:${draft.id}`, JSON.stringify(draft));
    }
  }

  const chatId = await ns.get(`tg:${offer.from}`);
  const text = [
    `<b>GTR EVENT · ответ артиста</b>`,
    "",
    `<b>${tgEsc(offer.artistName)}</b> ${accept ? "принял(а) ✅" : "отклонил(а) ❌"} предложение`,
    `<b>Событие:</b> ${tgEsc(offer.venueName)}${offer.date ? ` · ${tgEsc(offer.date)}` : ""}`,
    offer.fee ? `<b>Условия:</b> ${tgEsc(offer.fee)}` : "",
    `<i>${tgEsc(byLabel)}</i>`,
  ]
    .filter(Boolean)
    .join("\n");
  const target = chatId || process.env.TELEGRAM_CHAT_ID;
  if (target) await tgApi("sendMessage", { chat_id: target, text, parse_mode: "HTML" });
  return next;
}

// Язык, на котором предложение уходит артисту в Telegram
export type OfferLang = "ru" | "en" | "th";
const OFFER_T: Record<
  OfferLang,
  { title: string; artist: string; venue: string; when: string; fee: string; note: string; from: string; acc: string; dec: string }
> = {
  ru: { title: "предложение выступить", artist: "Артист", venue: "Площадка", when: "Когда", fee: "Условия", note: "Комментарий", from: "От", acc: "✅ Принять", dec: "❌ Отклонить" },
  en: { title: "performance offer", artist: "Artist", venue: "Venue", when: "When", fee: "Terms", note: "Note", from: "From", acc: "✅ Accept", dec: "❌ Decline" },
  th: { title: "ข้อเสนอการแสดง", artist: "ศิลปิน", venue: "สถานที่", when: "วันเวลา", fee: "เงื่อนไข", note: "หมายเหตุ", from: "จาก", acc: "✅ รับข้อเสนอ", dec: "❌ ปฏิเสธ" },
};

export const sendOfferFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      draftId: string;
      artistId: string;
      artistName: string;
      venueId: string;
      venueName: string;
      date: string;
      fee: string;
      note: string;
      lang?: OfferLang;
    }) => d,
  )
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (!me || me.role === "artist")
      return { ok: false as const, error: "Только команда GTR и площадки" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно (локальный режим)" };

    // аккаунт артиста, если он приглашён — по artistId карточки
    const keys = await kvListAll(ns, "user:");
    const users = (
      await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
    ).filter((u): u is StoredUser => Boolean(u));
    const artistUser = users.find((u) => u.role === "artist" && u.artistId === data.artistId);

    const offer: Offer = {
      id: `OF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      draftId: data.draftId,
      artistId: data.artistId,
      artistName: data.artistName,
      to: artistUser?.email ?? "",
      from: me.email,
      fromName: me.name,
      venueId: data.venueId,
      venueName: data.venueName,
      date: data.date,
      fee: data.fee,
      note: data.note,
      status: "sent",
      ts: Date.now(),
    };
    await ns.put(`offer:${offer.id}`, JSON.stringify(offer));

    // уведомление: личный чат артиста с кнопками, иначе общий канал GTR.
    // Язык выбирает отправитель (ru/en/th) — кнопки тоже переводятся
    const T = OFFER_T[data.lang ?? "ru"] ?? OFFER_T.ru;
    const text = [
      `<b>GTR EVENT · ${T.title}</b>`,
      "",
      `<b>${T.artist}:</b> ${tgEsc(offer.artistName)}`,
      `<b>${T.venue}:</b> ${tgEsc(offer.venueName)}`,
      offer.date ? `<b>${T.when}:</b> ${tgEsc(offer.date)}` : "",
      offer.fee ? `<b>${T.fee}:</b> ${tgEsc(offer.fee)}` : "",
      offer.note ? `<b>${T.note}:</b> ${tgEsc(offer.note)}` : "",
      "",
      `<i>${T.from}: ${tgEsc(offer.fromName)}</i>`,
    ]
      .filter(Boolean)
      .join("\n");
    const artistChat = offer.to ? await ns.get(`tg:${offer.to}`) : null;
    if (artistChat) {
      await tgApi("sendMessage", {
        chat_id: artistChat,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: T.acc, callback_data: `offer:${offer.id}:acc` },
              { text: T.dec, callback_data: `offer:${offer.id}:dec` },
            ],
          ],
        },
      });
    } else if (process.env.TELEGRAM_CHAT_ID) {
      await tgApi("sendMessage", {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: text + "\n\n<i>Личный Telegram артиста не привязан — передайте вручную.</i>",
        parse_mode: "HTML",
      });
    }
    return { ok: true as const, offer, hasAccount: Boolean(offer.to), tgDirect: Boolean(artistChat) };
  });

export const decideOfferFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; accept: boolean }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me || !ns) return { ok: false as const };
    const offer = await kvGetJson<Offer>(ns, `offer:${data.id}`);
    if (!offer) return { ok: false as const };
    if (!(me.role === "gtr" || (offer.to && offer.to === me.email)))
      return { ok: false as const };
    const next = await decideOfferCore(ns, offer, data.accept, `Решение в приложении · ${me.name}`);
    return { ok: true as const, offer: next };
  });

export const pullOffersFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return null;
  const keys = await kvListAll(ns, "offer:");
  const offers = (
    await Promise.all(keys.map((k) => kvGetJson<Offer>(ns, k)))
  ).filter((o): o is Offer => Boolean(o));
  return { offers: offers.filter((o) => canSeeOffer(u, o)).sort((a, b) => b.ts - a.ts) };
});

// ---------- привязка Telegram ----------

export const tgStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || !ns) return { configured: false, linked: false, bot: "" };
  const [chat, bot] = await Promise.all([ns.get(`tg:${me.email}`), ns.get("tg:bot")]);
  return { configured: tgConfigured(), linked: Boolean(chat), bot: bot || "" };
});

export const tgLinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || !ns) return { ok: false as const, error: "Нужен вход и общая база" };
  const bot = await ns.get("tg:bot");
  if (!bot)
    return { ok: false as const, error: "Бот не активирован — админ должен запустить вебхук" };
  const code = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await ns.put(`tglink:${code}`, me.email);
  return { ok: true as const, link: `https://t.me/${bot}?start=${code}` };
});

// Активация бота (GTR-админ): узнаём username и вешаем вебхук на воркер.
// Токен приложение читает только из окружения — через чат он не проходит.
export const tgActivateFn = createServerFn({ method: "POST" }).handler(async () => {
  const me = await currentUser();
  if (me?.role !== "gtr") return { ok: false as const, error: "Только GTR-админ" };
  const ns = await getKvNs();
  if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
  if (!tgConfigured())
    return {
      ok: false as const,
      error: "TELEGRAM_BOT_TOKEN не задан в переменных воркера (dash.cloudflare.com → Workers → gtr-event-hub → Settings)",
    };
  const meBot = await tgApi<{ username: string }>("getMe", {});
  if (!meBot.ok || !meBot.result)
    return { ok: false as const, error: `getMe: ${meBot.description || "ошибка"}` };
  const { getRequestUrl } = await import("@tanstack/react-start/server");
  const origin = new URL(getRequestUrl().href).origin;
  const hook = await tgApi("setWebhook", {
    url: `${origin}/api/tg`,
    secret_token: await tgWebhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  if (!hook.ok) return { ok: false as const, error: `setWebhook: ${hook.description}` };
  await ns.put("tg:bot", meBot.result.username);
  return { ok: true as const, bot: meBot.result.username };
});

// ---------- ссылки-приглашения в приложение ----------
// Код приглашения живёт в KV; человек открывает /gtr/join?code=… и сам
// заводит аккаунт (email + пароль). Telegram не обязателен.

export type AppInvite = {
  role: RoleId;
  teamOf: string; // команда организатора-тимлида ("" — вне команды)
  invitedBy: string;
  inviterName: string;
  created: number;
  uses: number;
  maxUses: number;
  exp: number; // ms
};

export const createInviteFn = createServerFn({ method: "POST" })
  .inputValidator((d: { role?: RoleId; maxUses?: number }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (!me || me.role === "artist")
      return { ok: false as const, error: "Приглашать могут команда GTR и организаторы" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно (локальный режим)" };

    // организатор зовёт только в свою команду; роли раздаёт только админ
    const role: RoleId = me.role === "gtr" ? (data.role ?? "organizer") : "organizer";
    const invite: AppInvite = {
      role,
      teamOf: me.role === "organizer" ? me.email : "",
      invitedBy: me.email,
      inviterName: me.name,
      created: Date.now(),
      uses: 0,
      maxUses: Math.min(50, Math.max(1, data.maxUses ?? 10)),
      exp: Date.now() + 14 * 24 * 3600 * 1000,
    };
    const code = `join-${Math.random().toString(36).slice(2, 10)}`;
    await ns.put(`invite:${code}`, JSON.stringify(invite));
    return { ok: true as const, code, link: `/gtr/join?code=${code}` };
  });

export const inviteInfoFn = createServerFn({ method: "GET" })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
    const inv = await kvGetJson<AppInvite>(ns, `invite:${data.code}`);
    if (!inv) return { ok: false as const, error: "Приглашение не найдено или отозвано" };
    if (inv.exp < Date.now()) return { ok: false as const, error: "Срок приглашения истёк" };
    if (inv.uses >= inv.maxUses)
      return { ok: false as const, error: "Лимит приглашения исчерпан" };
    return {
      ok: true as const,
      inviterName: inv.inviterName,
      role: inv.role,
      roleLabel: ROLE_LABELS[inv.role],
      team: Boolean(inv.teamOf),
    };
  });

export const joinFn = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; name: string; email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
    const inv = await kvGetJson<AppInvite>(ns, `invite:${data.code}`);
    if (!inv || inv.exp < Date.now() || inv.uses >= inv.maxUses)
      return { ok: false as const, error: "Приглашение не действует" };

    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false as const, error: "Некорректный email" };
    if (data.password.length < 6) return { ok: false as const, error: "Пароль от 6 символов" };
    if (!data.name.trim()) return { ok: false as const, error: "Представьтесь" };
    if (await ns.get(`user:${email}`))
      return { ok: false as const, error: "Такой аккаунт уже есть — войдите" };

    const stored: StoredUser = {
      email,
      name: data.name.trim(),
      role: inv.role,
      roleLabel: ROLE_LABELS[inv.role],
      venueId: "",
      artistId: "",
      teamOf: inv.teamOf || undefined,
      initials: initialsOf(data.name),
      passHash: await sha256(data.password),
      created: Date.now(),
      invitedBy: inv.invitedBy,
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    await ns.put(`invite:${data.code}`, JSON.stringify({ ...inv, uses: inv.uses + 1 }));

    notifyAdminsTg(
      ns,
      [
        "<b>GTR EVENT · новый участник</b>",
        "",
        `<b>${tgEsc(stored.name)}</b> присоединился по ссылке`,
        `Логин: ${tgEsc(email)} · роль: ${tgEsc(stored.roleLabel)}`,
        `Пригласил: ${tgEsc(inv.inviterName)}${inv.teamOf ? ` · команда ${tgEsc(inv.teamOf)}` : ""}`,
      ].join("\n"),
    ).catch(() => {});

    const { issueSession } = await import("./auth");
    const { passHash: _p, created: _c, invitedBy: _i, ...sessionUser } = stored;
    await issueSession(sessionUser);
    return { ok: true as const, user: sessionUser };
  });

// ---------- задачи команды (BOSS ставит, команда выполняет) ----------

export type GtrTask = {
  id: string;
  title: string;
  note?: string;
  assignee: string; // email исполнителя
  assigneeName: string;
  due?: string; // ISO-дата дедлайна
  status: "new" | "doing" | "done";
  by: string; // кто поставил
  byName: string;
  ts: number;
  updated: number;
};

export const pullTasksFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { tasks: [] as GtrTask[] };
  const keys = await kvListAll(ns, "task:");
  const tasks = (await Promise.all(keys.map((k) => kvGetJson<GtrTask>(ns, k)))).filter(
    (t): t is GtrTask => Boolean(t),
  );
  const mine = u.role === "gtr" ? tasks : tasks.filter((t) => t.assignee === u.email || t.by === u.email);
  return { tasks: mine.sort((a, b) => b.updated - a.updated) };
});

export const pushTaskFn = createServerFn({ method: "POST" })
  .inputValidator((d: { task: GtrTask }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    const prev = await kvGetJson<GtrTask>(ns, `task:${data.task.id}`);
    // Ставить и переназначать может GTR/BOSS; исполнитель — двигать статус своей
    const mineToMove = prev && prev.assignee === u.email;
    if (u.role !== "gtr" && !mineToMove) return { ok: false as const };
    const task: GtrTask = { ...data.task, updated: Date.now() };
    await ns.put(`task:${task.id}`, JSON.stringify(task));

    // Уведомления: новое назначение — исполнителю; «готово» — постановщику
    const assigneeChanged = !prev || prev.assignee !== task.assignee;
    if (assigneeChanged && task.assignee) {
      const chat = await ns.get(`tg:${task.assignee}`);
      if (chat)
        tgApi("sendMessage", {
          chat_id: chat,
          text: [
            "📌 <b>Новая задача от " + tgEsc(task.byName) + "</b>",
            "",
            `<b>${tgEsc(task.title)}</b>`,
            task.note ? tgEsc(task.note) : "",
            task.due ? `Срок: ${tgEsc(task.due)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          parse_mode: "HTML",
        }).catch(() => {});
      const { sendPushTo } = await import("./push");
      sendPushTo(ns, task.assignee, {
        title: `Задача от ${task.byName}`,
        body: task.title,
        url: "/gtr/dash",
      }).catch(() => {});
    }
    if (prev && prev.status !== "done" && task.status === "done") {
      const chat = await ns.get(`tg:${task.by}`);
      if (chat)
        tgApi("sendMessage", {
          chat_id: chat,
          text: `✅ <b>${tgEsc(task.assigneeName)}</b> закрыл(а) задачу: <b>${tgEsc(task.title)}</b>`,
          parse_mode: "HTML",
        }).catch(() => {});
      const { sendPushTo } = await import("./push");
      sendPushTo(ns, task.by, {
        title: "Задача выполнена",
        body: `${task.assigneeName}: ${task.title}`,
        url: "/gtr/dash",
      }).catch(() => {});
    }
    return { ok: true as const };
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || u.role !== "gtr") return { ok: false as const };
    await ns.delete(`task:${data.id}`);
    return { ok: true as const };
  });

// ---------- Web Push: подписки и лента ----------

export const pushSubscribeFn = createServerFn({ method: "POST" })
  .inputValidator((d: { sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } } }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || !data.sub?.endpoint) return { ok: false as const };
    const key = `push:${u.email}`;
    const subs = (await kvGetJson<{ endpoint: string }[]>(ns, key)) ?? [];
    if (!subs.some((s) => s.endpoint === data.sub.endpoint)) {
      subs.push(data.sub);
      await ns.put(key, JSON.stringify(subs.slice(-5))); // максимум 5 устройств
    }
    return { ok: true as const, devices: Math.min(subs.length, 5) };
  });

export const pushStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { devices: 0 };
  const subs = (await kvGetJson<unknown[]>(ns, `push:${u.email}`)) ?? [];
  return { devices: subs.length };
});

export const pushTestFn = createServerFn({ method: "POST" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { ok: false as const, reason: "нет сессии" };
  const { sendPushTo, pushConfigured } = await import("./push");
  if (!pushConfigured()) return { ok: false as const, reason: "VAPID не настроен" };
  const r = await sendPushTo(ns, u.email, {
    title: "GTR EVENT · проверка",
    body: "Push работает. Так придут заявки, задачи и события.",
    url: "/gtr/dash",
  });
  return r.ok
    ? { ok: true as const, sent: r.sent ?? 0 }
    : { ok: false as const, reason: r.reason ?? "нет подписок" };
});

// ---------- рассылка (центр связи BOSS) ----------

export const broadcastFn = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string; audience: "all" | "team" | "artists" | "organizers" }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || u.role !== "gtr") return { ok: false as const, sent: 0 };
    const text = data.text.trim().slice(0, 1500);
    if (!text) return { ok: false as const, sent: 0 };
    const keys = await kvListAll(ns, "user:");
    const users = (await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))).filter(
      (x): x is StoredUser => Boolean(x),
    );
    const fit = (r: RoleId) =>
      data.audience === "all"
        ? true
        : data.audience === "artists"
          ? r === "artist"
          : data.audience === "organizers"
            ? r === "organizer"
            : r === "sales" || r === "gtr" || r === "pr" || r === "owner";
    const seen = new Set<string>();
    let sent = 0;
    for (const p of users.filter((x) => fit(x.role) && x.email !== u.email)) {
      const chat = await ns.get(`tg:${p.email}`);
      if (chat && !seen.has(chat)) {
        seen.add(chat);
        const r = await tgApi("sendMessage", {
          chat_id: chat,
          text: `📣 <b>${tgEsc(u.name)}</b>:\n\n${tgEsc(text)}`,
          parse_mode: "HTML",
        });
        if (r.ok) sent++;
      }
      const { sendPushTo } = await import("./push");
      sendPushTo(ns, p.email, { title: `📣 ${u.name}`, body: text.slice(0, 140), url: "/gtr/dash" }).catch(
        () => {},
      );
    }
    return { ok: true as const, sent };
  });

// ---------- эфиры: Twitch (автодетект) + ручной флаг «я в эфире» ----------

type LiveState = { live: boolean; kind: "tw" | "ig"; url?: string };

// Публичный GQL твича (тот же, что у их веб-плеера): stream != null → эфир
async function twitchLive(logins: string[]): Promise<Record<string, boolean>> {
  if (!logins.length) return {};
  try {
    const body = logins.map((l) => ({
      query: "query($l:String!){user(login:$l){login stream{id}}}",
      variables: { l },
    }));
    const res = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const arr = (await res.json()) as { data?: { user?: { login: string; stream: unknown } } }[];
    const out: Record<string, boolean> = {};
    arr.forEach((r, i) => {
      out[logins[i]] = Boolean(r?.data?.user && (r.data.user as { stream: unknown }).stream);
    });
    return out;
  } catch {
    return {};
  }
}

export const liveStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: { items: { id: string; tw?: string }[] }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    const items = data.items.slice(0, 60);
    const out: Record<string, LiveState> = {};
    const misses: { id: string; tw: string }[] = [];

    // Ручные флаги «я в эфире» — целиком (их единицы, ключи с TTL)
    if (ns) {
      const manualKeys = await kvListAll(ns, "live:ig:");
      for (const k of manualKeys) {
        const manual = await kvGetJson<{ url?: string; until: number }>(ns, k);
        if (manual && manual.until > Date.now())
          out[k.slice("live:ig:".length)] = { live: true, kind: "ig", url: manual.url };
      }
    }

    for (const it of items) {
      if (out[it.id]) continue;
      if (!it.tw) continue;
      const login = it.tw.toLowerCase();
      if (ns) {
        const cached = await kvGetJson<{ live: boolean }>(ns, `live:tw:${login}`);
        if (cached) {
          if (cached.live) out[it.id] = { live: true, kind: "tw", url: `https://www.twitch.tv/${login}` };
          continue;
        }
      }
      misses.push({ id: it.id, tw: login });
    }

    if (misses.length) {
      const fresh = await twitchLive([...new Set(misses.map((m) => m.tw))]);
      for (const m of misses) {
        const live = Boolean(fresh[m.tw]);
        if (ns)
          await ns.put(`live:tw:${m.tw}`, JSON.stringify({ live }), { expirationTtl: 120 });
        if (live) out[m.id] = { live: true, kind: "tw", url: `https://www.twitch.tv/${m.tw}` };
      }
    }
    return { live: out };
  });

// Артист сам включает «я в эфире» (Instagram Live и т.п.): 4 часа или до /offair
export const setLiveFn = createServerFn({ method: "POST" })
  .inputValidator((d: { on: boolean; url?: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || !u.artistId) return { ok: false as const };
    const key = `live:ig:${u.artistId}`;
    if (!data.on) {
      await ns.delete(key);
      return { ok: true as const, on: false };
    }
    await ns.put(
      key,
      JSON.stringify({ url: (data.url || "").slice(0, 300), until: Date.now() + 4 * 3600 * 1000 }),
      { expirationTtl: 4 * 3600 },
    );
    return { ok: true as const, on: true };
  });

// ---------- настройки пользователя (язык предложений и т.п.) ----------

export const getPrefsFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { prefLang: "ru" as OfferLang };
  const stored = await kvGetJson<StoredUser & { prefLang?: OfferLang }>(ns, `user:${u.email}`);
  return { prefLang: stored?.prefLang ?? ("ru" as OfferLang) };
});

export const setPrefsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { prefLang: OfferLang }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    const stored = await kvGetJson<StoredUser>(ns, `user:${u.email}`);
    if (!stored) return { ok: false as const };
    await ns.put(`user:${u.email}`, JSON.stringify({ ...stored, prefLang: data.prefLang }));
    return { ok: true as const };
  });

// ---------- контакты для центра связи ----------
// Организаторам и площадкам нужен канал связи с командой — отдаём карточки
// без чувствительных полей (в отличие от полного listUsersFn для GTR)

export type ContactUser = {
  email: string;
  name: string;
  role: RoleId;
  roleLabel: string;
  teamOf?: string;
  tgNick?: string;
};

export const contactsUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || me.role === "artist" || !ns) return { users: [] as ContactUser[] };
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser & { tgNick?: string }>(ns, k)))
  ).filter((u): u is StoredUser & { tgNick?: string } => Boolean(u));
  return {
    users: users.map((u) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      roleLabel: u.roleLabel,
      teamOf: u.teamOf,
      tgNick: u.tgNick,
    })),
  };
});

// ---------- статусы артистов: верификация GTR и work permit ----------

export type ArtistFlags = { verified?: boolean; workPermit?: boolean };

export const artistFlagsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { flags: {} as Record<string, ArtistFlags> };
  const keys = await kvListAll(ns, "aflag:");
  const flags: Record<string, ArtistFlags> = {};
  for (const k of keys) {
    const f = await kvGetJson<ArtistFlags>(ns, k);
    if (f) flags[k.slice("aflag:".length)] = f;
  }
  return { flags };
});

export const setArtistFlagFn = createServerFn({ method: "POST" })
  .inputValidator((d: { artistId: string; patch: ArtistFlags }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || u.role !== "gtr") return { ok: false as const };
    const key = `aflag:${data.artistId}`;
    const cur = (await kvGetJson<ArtistFlags>(ns, key)) ?? {};
    const next = { ...cur, ...data.patch };
    await ns.put(key, JSON.stringify(next));
    return { ok: true as const, flags: next };
  });

// ---------- афиши площадок (собирает агент из официальных источников) ----------

export const listAfishaFn = createServerFn({ method: "GET" })
  .inputValidator((d: { vid: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { events: [], syncedAt: 0, source: "" } as VenueAfisha;
    const rec = await kvGetJson<VenueAfisha>(ns, `venueevents:${data.vid}`);
    return rec ?? ({ events: [], syncedAt: 0, source: "" } as VenueAfisha);
  });

export const syncAfishaNowFn = createServerFn({ method: "POST" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || u.role !== "gtr" || !ns) return { ok: false as const };
  const { syncAfisha } = await import("./afisha");
  const counts = await syncAfisha(ns);
  return { ok: true as const, counts };
});

// Площадки, по которым агент уже собирает афиши (для зелёных точек в селекторе)
export const afishaVenuesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { vids: [] as string[] };
  const keys = await kvListAll(ns, "venueevents:");
  return { vids: keys.map((k) => k.slice("venueevents:".length)) };
});
