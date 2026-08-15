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
  visitor: "Посетитель",
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

// Служебный контур: личные чаты GTR-админов + закрытый ops-канал.
// Любой адрес проходит через guardInternalChatId — в публичные чаты
// комьюнити техническое не уходит никогда.
// Метрики и владельческое: ТОЛЬКО BOSS + закрытый ops-канал. Команда
// (Фёдор, Владимир) это не получает — им идёт только их операционка.
export async function notifyBossTg(ns: KvNs, text: string) {
  const { guardInternalChatId, OPS_KEY } = await import("./community");
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  const sent = new Set<string>();
  const push = async (raw: string | number | null | undefined) => {
    const chat = await guardInternalChatId(ns, raw);
    if (!chat || sent.has(chat)) return;
    sent.add(chat);
    await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML" });
  };
  for (const a of users.filter((u) => u.role === "gtr" && u.boss)) {
    await push(await ns.get(`tg:${a.email}`));
  }
  const ops = await kvGetJson<import("./community").OpsCfg>(ns, OPS_KEY);
  await push(ops?.chatId);
}

export async function notifyAdminsTg(ns: KvNs, text: string) {
  const { guardInternalChatId, OPS_KEY } = await import("./community");
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  const sent = new Set<string>();
  const push = async (raw: string | number | null | undefined) => {
    const chat = await guardInternalChatId(ns, raw);
    if (!chat || sent.has(chat)) return;
    sent.add(chat);
    await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML" });
  };
  for (const a of users.filter((u) => u.role === "gtr")) {
    await push(await ns.get(`tg:${a.email}`));
  }
  const ops = await kvGetJson<import("./community").OpsCfg>(ns, OPS_KEY);
  await push(ops?.chatId);
  await push(process.env.TELEGRAM_CHAT_ID);
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
      const { guardInternalChatId } = await import("./community");
      const channel = await guardInternalChatId(ns, process.env.TELEGRAM_CHAT_ID);
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
  const { guardInternalChatId } = await import("./community");
  const target = await guardInternalChatId(ns, chatId || process.env.TELEGRAM_CHAT_ID);
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
    } else if (await (await import("./community")).guardInternalChatId(ns, process.env.TELEGRAM_CHAT_ID)) {
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
    // chat_member — вступления в канал по инвайт-ссылкам (конкурс инвайтинга)
    allowed_updates: ["message", "callback_query", "chat_member"],
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
      const pushRes = await sendPushTo(ns, task.assignee, {
        title: `Задача от ${task.byName}`,
        body: task.title,
        url: "/gtr/dash",
      }).catch(() => ({ ok: false as const }));
      // Ни бота, ни push-подписок — честно говорим постановщику и дублируем
      // в общий канал, чтобы задача не потерялась в тишине
      if (!chat && !pushRes.ok) {
        const warn = [
          `⚠️ <b>Задача не доставлена ${tgEsc(task.assigneeName)}</b>`,
          `«${tgEsc(task.title)}»`,
          "",
          "У исполнителя не привязан Telegram (@Gtrcom1_bot → /start) и не включён push в настройках кабинета. Передайте задачу лично.",
        ].join("\n");
        const byChat = await ns.get(`tg:${task.by}`);
        const common = await (await import("./community")).guardInternalChatId(
          ns,
          (typeof process !== "undefined" && process.env?.TELEGRAM_CHAT_ID) || "",
        );
        for (const c of new Set([byChat, common].filter(Boolean) as string[]))
          tgApi("sendMessage", { chat_id: c, text: warn, parse_mode: "HTML" }).catch(() => {});
      }
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
    if (!rec) return { events: [], syncedAt: 0, source: "" } as VenueAfisha;
    // паспорт площадки показывает ту же чистую программу, что и лента
    const { cleanEventTitle, isJunkEventTitle } = await import("./afisha-clean");
    const { V } = await import("./data/app-data");
    const vname = V(data.vid)?.name;
    return {
      ...rec,
      events: rec.events
        .filter((e) => !isJunkEventTitle(e.title))
        .map((e) => ({ ...e, title: cleanEventTitle(e.title, vname) }))
        .filter((e) => !isJunkEventTitle(e.title)),
    } as VenueAfisha;
  });

// Ручное событие афиши: команда добивает программу площадок, у которых
// нет RA/FB/сайта. Живёт в venueevents с source:"manual", переживает синк.
export const afishaAddFn = createServerFn({ method: "POST" })
  .inputValidator((d: { vid: string; title: string; dateIso: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr") return { ok: false as const, reason: "только команда GTR" };
    const title = data.title.trim().slice(0, 80);
    if (title.length < 3) return { ok: false as const, reason: "название от 3 символов" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateIso))
      return { ok: false as const, reason: "дата в формате ГГГГ-ММ-ДД" };
    const key = `venueevents:${data.vid}`;
    const rec =
      (await kvGetJson<VenueAfisha>(ns, key)) ??
      ({ events: [], syncedAt: Date.now(), source: "manual" } as VenueAfisha);
    if (
      rec.events.some(
        (e) => e.dateIso === data.dateIso && e.title.toLowerCase() === title.toLowerCase(),
      )
    )
      return { ok: false as const, reason: "такое событие уже есть" };
    rec.events.push({
      id: `man-${Date.now().toString(36)}`,
      title,
      dateIso: data.dateIso,
      url: "",
      artistIds: [],
      source: "manual",
    });
    rec.events.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    rec.syncedAt = Date.now();
    await ns.put(key, JSON.stringify(rec));
    return { ok: true as const };
  });

export const afishaDelFn = createServerFn({ method: "POST" })
  .inputValidator((d: { vid: string; id: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr") return { ok: false as const, reason: "только команда GTR" };
    // удалять можно только ручные записи — синкованные вернёт источник
    if (!data.id.startsWith("man-")) return { ok: false as const, reason: "только ручные события" };
    const key = `venueevents:${data.vid}`;
    const rec = await kvGetJson<VenueAfisha>(ns, key);
    if (!rec) return { ok: false as const, reason: "нет записи" };
    rec.events = rec.events.filter((e) => e.id !== data.id);
    await ns.put(key, JSON.stringify(rec));
    return { ok: true as const };
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

// ---------- подтверждение данных площадкой: магик-ссылка без регистрации ----------
// Команда отправляет менеджеру площадки персональную ссылку; тот открывает
// страницу, правит вместимость/прайс и подтверждает. Токен — единственный
// «пароль», живёт 30 дней. vlink:<token> → vid, vconfirm:<vid> → статус.

export type VenueConfirmContact = { name: string; role: string; phone: string; email?: string };
export type VenueConfirmRate = { amount: number; unit: string; covers: string };
export type VenueConfirm = {
  vid: string;
  status: "sent" | "opened" | "confirmed";
  sentBy: string;
  sentAt: number;
  openedAt?: number;
  confirmedAt?: number;
  contact?: VenueConfirmContact;
  rate?: VenueConfirmRate;
  capacity?: string;
  notes?: string;
};

const randToken = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
};

export const createVenueLinkFn = createServerFn({ method: "POST" })
  .inputValidator((d: { vid: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || (u.role !== "gtr" && u.role !== "sales"))
      return { ok: false as const, error: "нет прав" };
    const token = randToken();
    await ns.put(
      `vlink:${token}`,
      JSON.stringify({ vid: data.vid, by: u.email, at: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    const key = `vconfirm:${data.vid}`;
    const cur = await kvGetJson<VenueConfirm>(ns, key);
    if (!cur || cur.status !== "confirmed") {
      await ns.put(
        key,
        JSON.stringify({
          ...(cur ?? {}),
          vid: data.vid,
          status: cur?.status === "opened" ? "opened" : "sent",
          sentBy: u.email,
          sentAt: Date.now(),
        } satisfies VenueConfirm),
      );
    }
    return { ok: true as const, token };
  });

// Публичная: страница по токену. Отмечает «открыто» и отдаёт предзаполнение.
export const venueLinkOpenFn = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    const link = await kvGetJson<{ vid: string }>(ns, `vlink:${data.token}`);
    if (!link) return { ok: false as const };
    const key = `vconfirm:${link.vid}`;
    const cur = await kvGetJson<VenueConfirm>(ns, key);
    if (cur && cur.status === "sent")
      await ns.put(key, JSON.stringify({ ...cur, status: "opened", openedAt: Date.now() }));
    const { V, rateOf } = await import("./data/app-data");
    const venue = V(link.vid);
    const rate = rateOf(link.vid);
    return {
      ok: true as const,
      vid: link.vid,
      name: venue?.name ?? link.vid,
      area: venue?.area ?? "",
      capacity: cur?.capacity ?? venue?.capacity ?? "",
      rate:
        cur?.rate ??
        (rate ? { amount: rate.amount, unit: rate.unit, covers: rate.covers } : null),
      confirmed: cur?.status === "confirmed",
      contact: cur?.contact ?? null,
    };
  });

// Публичная: подтверждение. Имя и телефон обязательны — это контакт площадки.
export const venueConfirmSubmitFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      token: string;
      contact: VenueConfirmContact;
      rate: VenueConfirmRate;
      capacity: string;
      notes?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    const link = await kvGetJson<{ vid: string; by: string }>(ns, `vlink:${data.token}`);
    if (!link) return { ok: false as const };
    if (!data.contact.name.trim() || !data.contact.phone.trim()) return { ok: false as const };
    const key = `vconfirm:${link.vid}`;
    const cur = await kvGetJson<VenueConfirm>(ns, key);
    const next: VenueConfirm = {
      vid: link.vid,
      status: "confirmed",
      sentBy: cur?.sentBy ?? link.by,
      sentAt: cur?.sentAt ?? Date.now(),
      openedAt: cur?.openedAt,
      confirmedAt: Date.now(),
      contact: {
        name: data.contact.name.trim().slice(0, 120),
        role: data.contact.role.trim().slice(0, 120),
        phone: data.contact.phone.trim().slice(0, 60),
        email: data.contact.email?.trim().slice(0, 120),
      },
      rate: {
        amount: Math.max(0, Math.round(data.rate.amount)),
        unit: data.rate.unit.slice(0, 30),
        covers: data.rate.covers.trim().slice(0, 200),
      },
      capacity: data.capacity.trim().slice(0, 60),
      notes: data.notes?.trim().slice(0, 500),
    };
    await ns.put(key, JSON.stringify(next));
    // Телеграм: лично отправившему и в общий канал — подтверждение это событие
    if (tgConfigured()) {
      const { V } = await import("./data/app-data");
      const name = V(link.vid)?.name ?? link.vid;
      const text = [
        "✅ <b>GTR EVENT · площадка подтвердила данные</b>",
        "",
        `<b>${tgEsc(name)}</b> (${tgEsc(link.vid)})`,
        `<b>Вместимость:</b> ${tgEsc(next.capacity || "—")}`,
        `<b>Прайс:</b> ฿${next.rate!.amount.toLocaleString("ru-RU")} / ${tgEsc(next.rate!.unit)}`,
        next.rate!.covers ? `<b>Что входит:</b> ${tgEsc(next.rate!.covers)}` : "",
        "",
        `<b>Контакт:</b> ${tgEsc(next.contact!.name)}${next.contact!.role ? " · " + tgEsc(next.contact!.role) : ""}`,
        `<b>Телефон:</b> ${tgEsc(next.contact!.phone)}`,
        next.notes ? `<b>Комментарий:</b> ${tgEsc(next.notes)}` : "",
      ]
        .filter((l) => l !== "")
        .join("\n");
      const personal = await ns.get(`tg:${next.sentBy}`);
      const common = await (await import("./community")).guardInternalChatId(
        ns,
        (typeof process !== "undefined" && process.env?.TELEGRAM_CHAT_ID) || "",
      );
      const chats = [...new Set([personal, common].filter(Boolean))] as string[];
      for (const chat of chats)
        await tgApi("sendMessage", {
          chat_id: chat,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
    }
    return { ok: true as const };
  });

// Команде: все статусы подтверждений — для базы, паспорта и спринт-дашборда
export const venueConfirmsFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  const empty = { confirms: {} as Record<string, VenueConfirm> };
  if (!me || me.role === "artist" || me.role === "organizer" || !ns) return empty;
  const keys = await kvListAll(ns, "vconfirm:");
  const confirms: Record<string, VenueConfirm> = {};
  for (const k of keys) {
    const c = await kvGetJson<VenueConfirm>(ns, k);
    if (c) confirms[k.slice("vconfirm:".length)] = c;
  }
  return { confirms };
});

// ---------- профиль стиля площадки: корпус афиш как источник правды ----------
// Палитра и образцы собираются из кэшированных постеров; на этом корпусе
// будет работать генератор афиш будущих событий (бриф → готовый вариант).

export type StyleProfile = {
  vid: string;
  colors: string[]; // доминирующие цвета постеров, hex
  posters: number; // размер корпуса
  artists: string[]; // артисты, замеченные в афишах площадки
  updatedAt: number;
};

export const styleProfileFn = createServerFn({ method: "GET" })
  .inputValidator((d: { vid: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { profile: null as StyleProfile | null };
    const profile = await kvGetJson<StyleProfile>(ns, `styleprofile:${data.vid}`);
    return { profile };
  });

// Фото, загруженные самой площадкой через форму подтверждения
export const venuePhotosFn = createServerFn({ method: "GET" })
  .inputValidator((d: { vid: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { photos: [] as string[] };
    const keys = await kvListAll(ns, `vphoto:${data.vid}:`);
    return {
      photos: keys.map(
        (k) => `/api/vphoto?k=${encodeURIComponent(k.slice("vphoto:".length))}`,
      ),
    };
  });

// ---------- Артист 2.0: профиль-самообслуживание, сеты, связь с командой ----------
// Артист редактирует свой слой поверх каталога (aprofile:<id>), статика
// artists.json остаётся источником по умолчанию. Медиа живут в KV через
// /api/aphoto и /api/avideo.

export type ArtistSet = { title: string; url: string };
export type ArtistProfile = {
  bio?: string;
  links?: Partial<Record<"ig" | "sp" | "yt" | "sc" | "twitch" | "wa", string>>;
  sets?: ArtistSet[];
  updatedAt?: number;
  by?: string;
};

const canEditArtist = (u: SessionUser, artistId: string) =>
  u.role === "gtr" || (u.role === "artist" && u.artistId === artistId);

export const setAprofileFn = createServerFn({ method: "POST" })
  .inputValidator((d: { artistId: string; patch: ArtistProfile }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns || !canEditArtist(u, data.artistId)) return { ok: false as const };
    const key = `aprofile:${data.artistId}`;
    const cur = (await kvGetJson<ArtistProfile>(ns, key)) ?? {};
    const p = data.patch;
    const clean = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined;
    const next: ArtistProfile = {
      bio: p.bio !== undefined ? clean(p.bio, 900) : cur.bio,
      links:
        p.links !== undefined
          ? Object.fromEntries(
              Object.entries(p.links)
                .map(([k, v]) => [k, clean(v, 300)])
                .filter(([, v]) => v),
            )
          : cur.links,
      sets:
        p.sets !== undefined
          ? p.sets
              .map((x) => ({ title: (x.title || "").trim().slice(0, 90), url: (x.url || "").trim().slice(0, 400) }))
              .filter((x) => x.title && /^https?:\/\//.test(x.url))
              .slice(0, 12)
          : cur.sets,
      updatedAt: Date.now(),
      by: u.email,
    };
    await ns.put(key, JSON.stringify(next));
    return { ok: true as const, profile: next };
  });

// Публичные дополнения к карточке артиста: профиль, фото, наличие видео
export const artistExtrasFn = createServerFn({ method: "GET" })
  .inputValidator((d: { artistId: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    const empty = {
      profile: null as ArtistProfile | null,
      photos: [] as string[],
      avatar: null as string | null,
      heroVideo: null as string | null,
      heroPoster: null as string | null,
    };
    if (!ns || !/^MC-\d{4}$/.test(data.artistId)) return empty;
    const [profile, keys, hasVideo] = await Promise.all([
      kvGetJson<ArtistProfile>(ns, `aprofile:${data.artistId}`),
      kvListAll(ns, `aphoto:${data.artistId}:`),
      ns.get(`avideo:${data.artistId}`).then((v) => Boolean(v)),
    ]);
    const path = (k: string) => `/api/aphoto?k=${encodeURIComponent(k.slice("aphoto:".length))}`;
    const avatarKey = keys.find((k) => k.endsWith(":avatar"));
    const posterKey = keys.find((k) => k.endsWith(":heroposter"));
    return {
      profile,
      photos: keys.filter((k) => !k.endsWith(":avatar") && !k.endsWith(":heroposter")).map(path),
      avatar: avatarKey ? path(avatarKey) : null,
      heroVideo: hasVideo ? `/api/avideo?a=${data.artistId}` : null,
      heroPoster: posterKey ? path(posterKey) : null,
    };
  });

// Кастомные аватары для списка каталога — одним запросом
export const customAvatarsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { avatars: {} as Record<string, string> };
  const keys = await kvListAll(ns, "aphoto:");
  const avatars: Record<string, string> = {};
  for (const k of keys)
    if (k.endsWith(":avatar"))
      avatars[k.slice("aphoto:".length).split(":")[0]] =
        `/api/aphoto?k=${encodeURIComponent(k.slice("aphoto:".length))}`;
  return { avatars };
});

// Сообщение команде: из кабинета артиста (или любого участника) в TG всем
// менеджерам + push. Лимит — раз в минуту, чтобы не спамили.
export const contactTeamFn = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    const text = data.text.trim().slice(0, 800);
    if (!text) return { ok: false as const, reason: "пустое сообщение" };
    if (await ns.get(`ctlimit:${u.email}`))
      return { ok: false as const, reason: "не чаще раза в минуту" };
    await ns.put(`ctlimit:${u.email}`, "1", { expirationTtl: 60 });
    const msg = [
      `💬 <b>${tgEsc(u.name)}</b> (${tgEsc(u.roleLabel)}) пишет команде:`,
      "",
      tgEsc(text),
    ].join("\n");
    const tgKeys = await kvListAll(ns, "tg:");
    const sent = new Set<string>();
    let delivered = 0;
    for (const k of tgKeys) {
      if (k === "tg:bot" || k === `tg:${u.email}`) continue;
      const target = k.slice("tg:".length);
      // только команде: артистам и организаторам чужие сообщения не шлём
      const rec = await kvGetJson<StoredUser>(ns, `user:${target}`);
      if (rec && (rec.role === "artist" || rec.role === "organizer")) continue;
      const chat = await ns.get(k);
      if (!chat || sent.has(chat)) continue;
      sent.add(chat);
      const r = await tgApi("sendMessage", { chat_id: chat, text: msg, parse_mode: "HTML" });
      if (r.ok) delivered++;
      const { sendPushTo } = await import("./push");
      sendPushTo(ns, target, { title: `💬 ${u.name}`, body: text.slice(0, 140), url: "/gtr/contacts" }).catch(
        () => {},
      );
    }
    const common = await (await import("./community")).guardInternalChatId(
      ns,
      (typeof process !== "undefined" && process.env?.TELEGRAM_CHAT_ID) || "",
    );
    if (common && !sent.has(common)) {
      const r = await tgApi("sendMessage", { chat_id: common, text: msg, parse_mode: "HTML" });
      if (r.ok) delivered++;
    }
    return { ok: true as const, delivered };
  });

// ---------- фаза A: посетители, лента событий, бронь столов ----------

// Публичная регистрация посетителя — без приглашения. Лимит по IP не ведём
// (Workers за CDN), но email уникален и пароль хэшируется как у всех.
export const signupVisitorFn = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false as const, error: "Некорректный email" };
    if (data.password.length < 6)
      return { ok: false as const, error: "Пароль от 6 символов" };
    if (await ns.get(`user:${email}`))
      return { ok: false as const, error: "Такой аккаунт уже есть — войдите" };
    const stored: StoredUser = {
      email,
      name: data.name.trim() || email.split("@")[0],
      role: "visitor",
      roleLabel: ROLE_LABELS.visitor,
      venueId: "",
      initials: initialsOf(data.name || email),
      passHash: await sha256(data.password),
      created: Date.now(),
      invitedBy: "signup",
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    const { passHash: _p, created: _c, invitedBy: _i, ...sessionUser } = stored;
    const { issueSession } = await import("./auth");
    await issueSession(sessionUser);
    // метрика + пинг в служебный контур (не в публичные чаты)
    const { bumpMetric } = await import("./community");
    bumpMetric(ns, "reg").catch(() => {});
    notifyBossTg(
      ns,
      `🆕 <b>Регистрация в GTR Event</b>\n${tgEsc(stored.name)} · ${tgEsc(email)} · посетитель`,
    ).catch(() => {});
    return { ok: true as const };
  });

// Лента событий всех площадок — публичная витрина (посетители и артисты)
export const allAfishaFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { items: [] as (VenueAfisha["events"][number] & { vid: string })[] };
  // чистка названий, фильтр мусора и дедуп — в общем сборщике комьюнити
  const { collectCleanAfisha } = await import("./community");
  const items = await collectCleanAfisha(ns);
  return { items: items.slice(0, 60) };
});

// ---------- комьюнити Telegram: канал новостей + группа общения ----------

export const communityCfgFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  const empty = { channelUrl: "", chatUrl: "", channelTitle: "", chatTitle: "" };
  if (!ns) return empty;
  const { COMMUNITY_KEY } = await import("./community");
  const cfg = await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY);
  if (!cfg) return empty;
  // публичная часть: ссылки и названия — их видит любой залогиненный
  return {
    channelUrl: cfg.channelUrl || "",
    chatUrl: cfg.chatUrl || "",
    channelTitle: cfg.channelTitle || "",
    chatTitle: cfg.chatTitle || "",
  };
});

export const setCommunityCfgFn = createServerFn({ method: "POST" })
  .inputValidator((d: { channelUrl?: string; chatUrl?: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const { COMMUNITY_KEY, resolveTgChat } = await import("./community");
    const prev =
      (await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY)) ?? {};
    const cfg: import("./community").CommunityCfg = { ...prev, updated: Date.now() };
    const notes: string[] = [];
    if (data.channelUrl !== undefined) {
      cfg.channelUrl = data.channelUrl.trim();
      cfg.channelId = undefined;
      cfg.channelTitle = undefined;
      cfg.channelAdmin = undefined;
      if (cfg.channelUrl) {
        const r = await resolveTgChat(cfg.channelUrl);
        if (r.ok) {
          cfg.channelId = r.id;
          cfg.channelTitle = r.title;
          cfg.channelAdmin = r.admin;
          if (!r.admin) notes.push(`Канал «${r.title}» найден, но бот НЕ админ — посты не пройдут`);
        } else notes.push(`Канал: ${r.reason}`);
      }
    }
    if (data.chatUrl !== undefined) {
      cfg.chatUrl = data.chatUrl.trim();
      cfg.chatId = undefined;
      cfg.chatTitle = undefined;
      cfg.chatAdmin = undefined;
      if (cfg.chatUrl) {
        const r = await resolveTgChat(cfg.chatUrl);
        if (r.ok) {
          cfg.chatId = r.id;
          cfg.chatTitle = r.title;
          cfg.chatAdmin = r.admin;
          if (!r.admin) notes.push(`Группа «${r.title}» найдена, бот пока не админ (для /tonight хватит и участника)`);
        } else notes.push(`Группа: ${r.reason}`);
      }
    }
    await ns.put(COMMUNITY_KEY, JSON.stringify(cfg));
    return {
      ok: true as const,
      cfg: {
        channelUrl: cfg.channelUrl || "",
        chatUrl: cfg.chatUrl || "",
        channelTitle: cfg.channelTitle || "",
        chatTitle: cfg.chatTitle || "",
        channelAdmin: Boolean(cfg.channelAdmin),
        chatAdmin: Boolean(cfg.chatAdmin),
        channelId: cfg.channelId ?? null,
        chatId: cfg.chatId ?? null,
      },
      notes,
    };
  });

export const communityPostFn = createServerFn({ method: "POST" })
  .inputValidator((d: { kind: "digest" | "invite" | "contest"; target: "channel" | "chat" }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const { COMMUNITY_KEY, buildContestText, buildDigestText, buildInviteText } = await import("./community");
    const cfg = await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY);
    const chatId = data.target === "channel" ? cfg?.channelId : cfg?.chatId;
    if (!chatId) {
      return { ok: false as const, reason: data.target === "channel" ? "Канал не привязан" : "Группа не привязана" };
    }
    const bot = (await ns.get("tg:bot")) || "Gtrcom1_bot";
    const text =
      data.kind === "digest"
        ? await buildDigestText(ns)
        : data.kind === "contest"
          ? buildContestText()
          : buildInviteText(cfg ?? {});
    const res = await tgApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(data.kind === "contest"
        ? {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎁 Получить мою ссылку", url: `https://t.me/${bot}?start=ref` }],
              ],
            },
          }
        : {
            link_preview_options: {
              url: (await import("./community")).APP_URL,
              prefer_large_media: true,
            },
          }),
    });
    return res.ok
      ? { ok: true as const, reason: "" }
      : { ok: false as const, reason: res.description || "Telegram отклонил пост" };
  });

// Текст приглашения для ручной рассылки (BOSS копирует и шлёт кому угодно)
export const communityInviteTextFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  const { COMMUNITY_KEY, buildInviteText } = await import("./community");
  const cfg = ns
    ? await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY)
    : null;
  // без HTML-тегов — это текст для копирования
  return { text: buildInviteText(cfg ?? {}).replace(/<\/?b>/g, "") };
});

// Бронь стола / гостевой список: заявка без оплаты — команде в Telegram.
export type TableBooking = {
  id: string;
  vid: string;
  dateIso: string;
  guests: number;
  name: string;
  phone: string;
  note?: string;
  by: string;
  ts: number;
  status: "new" | "confirmed" | "declined";
};

export const bookTableFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { vid: string; dateIso: string; guests: number; name: string; phone: string; note?: string }) => d,
  )
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (!data.name.trim() || !data.phone.trim() || !data.dateIso)
      return { ok: false as const, reason: "имя, телефон и дата обязательны" };
    if (await ns.get(`bklimit:${u.email}`))
      return { ok: false as const, reason: "не чаще одной заявки в минуту" };
    await ns.put(`bklimit:${u.email}`, "1", { expirationTtl: 60 });
    const booking: TableBooking = {
      id: `BK-${Date.now().toString(36)}`,
      vid: data.vid,
      dateIso: data.dateIso,
      guests: Math.max(1, Math.min(100, Math.round(data.guests) || 2)),
      name: data.name.trim().slice(0, 90),
      phone: data.phone.trim().slice(0, 40),
      note: data.note?.trim().slice(0, 300),
      by: u.email,
      ts: Date.now(),
      status: "new",
    };
    await ns.put(`booking:${booking.id}`, JSON.stringify(booking));
    const { V } = await import("./data/app-data");
    await notifyAdminsTg(
      ns,
      [
        "🪑 <b>GTR · заявка на стол</b>",
        "",
        `<b>${tgEsc(V(booking.vid)?.name ?? booking.vid)}</b> · ${tgEsc(booking.dateIso)} · ${booking.guests} чел.`,
        `<b>Гость:</b> ${tgEsc(booking.name)} · ${tgEsc(booking.phone)}`,
        booking.note ? `<b>Комментарий:</b> ${tgEsc(booking.note)}` : "",
        `<i>${tgEsc(booking.by)}</i>`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return { ok: true as const, id: booking.id };
  });

export const myBookingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { bookings: [] as TableBooking[] };
  const keys = await kvListAll(ns, "booking:");
  const all = (await Promise.all(keys.map((k) => kvGetJson<TableBooking>(ns, k)))).filter(
    (b): b is TableBooking => Boolean(b),
  );
  const mine = u.role === "gtr" ? all : all.filter((b) => b.by === u.email);
  return { bookings: mine.sort((a, b) => b.ts - a.ts).slice(0, 30) };
});

// ---------- фаза B: музыкальный профиль и ИИ-подбор ----------

// ---------- FB-афиши площадки: токен их страницы по магик-ссылке ----------
// Площадка вставляет токен своей FB-страницы в форму подтверждения — её
// события идут в наш календарь официально. Обмениваем на вечный сразу.
export type VenueMeta = { pageId: string; pageName: string; token: string; igId?: string };

export const venueFbConnectFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; fbToken: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "no kv" };
    const link = await kvGetJson<{ vid: string; by: string }>(ns, `vlink:${data.token}`);
    if (!link) return { ok: false as const, reason: "link" };
    const fbToken = data.fbToken.trim();
    if (fbToken.length < 30) return { ok: false as const, reason: "token" };
    const G = "https://graph.facebook.com/v21.0";
    // чей токен: страница напрямую или user → первая страница
    const me = await fetch(`${G}/me?fields=id,name&access_token=${encodeURIComponent(fbToken)}`)
      .then((r) => r.json() as Promise<{ id?: string; name?: string; error?: { message: string } }>)
      .catch(() => null);
    if (!me?.id || me.error) return { ok: false as const, reason: me?.error?.message?.slice(0, 100) ?? "meta" };
    let page: VenueMeta = { pageId: me.id, pageName: me.name ?? "", token: fbToken };
    const acc = await fetch(
      `${G}/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid%7D&access_token=${encodeURIComponent(fbToken)}`,
    )
      .then(
        (r) =>
          r.json() as Promise<{
            data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[];
          }>,
      )
      .catch(() => null);
    if (acc?.data?.length) {
      const p = acc.data[0];
      page = { pageId: p.id, pageName: p.name, token: p.access_token, igId: p.instagram_business_account?.id };
    }
    // сразу меняем на вечный, если App-креды настроены
    const app = await kvGetJson<{ appId: string; appSecret: string }>(ns, "setting:metaapp");
    if (app?.appId) {
      const ex = await fetch(
        `${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(app.appId)}&client_secret=${encodeURIComponent(app.appSecret)}&fb_exchange_token=${encodeURIComponent(page.token)}`,
      )
        .then((r) => r.json() as Promise<{ access_token?: string }>)
        .catch(() => null);
      if (ex?.access_token) page.token = ex.access_token;
    }
    await ns.put(`vmeta:${link.vid}`, JSON.stringify(page));
    const { V } = await import("./data/app-data");
    await notifyAdminsTg(
      ns,
      [
        "📡 <b>GTR · площадка подключила FB-афиши</b>",
        `${tgEsc(V(link.vid).name)} → страница «${tgEsc(page.pageName)}»`,
        "События их страницы теперь идут в календарь автоматически.",
      ].join("\n"),
    );
    return { ok: true as const, pageName: page.pageName };
  });

// ---------- Meta (Facebook/Instagram): авторизация страницы BOSS ----------
// Официальный Graph API вместо закрытого анонимного доступа: токен страницы
// даёт посты, медиа и события — легально и стабильно.
export type MetaPage = { id: string; name: string; token: string; igId?: string; igUser?: string };
export type MetaCfg = { pages: MetaPage[] };

export const metaCfgFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { connected: false as const, pageName: "", igUser: "" };
  if (u.role !== "gtr" && !u.boss) return { connected: false as const, pageName: "", igUser: "" };
  const cfg = await kvGetJson<MetaCfg>(ns, "setting:meta");
  const pages = cfg?.pages ?? [];
  return {
    connected: pages.length > 0,
    pageName: pages.map((p) => p.name).join(" · "),
    igUser: pages.map((p) => p.igUser).filter(Boolean).join(", "),
  };
});

export const setMetaCfgFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const token = data.token.trim();
    if (token.length < 30) return { ok: false as const, reason: "это не похоже на токен Meta" };
    // живая проверка: чей это токен и какие страницы доступны
    const me = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
    ).then((r) => r.json() as Promise<{ id?: string; name?: string; error?: { message: string } }>);
    if (me.error) return { ok: false as const, reason: `Meta: ${me.error.message.slice(0, 120)}` };
    // user-token → забираем ВСЕ страницы с их page-токенами и IG Business
    const acc = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&access_token=${encodeURIComponent(token)}`,
    ).then(
      (r) =>
        r.json() as Promise<{
          data?: {
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string; username: string };
          }[];
        }>,
    ).catch(() => ({ data: [] as never[] }));
    const pages: MetaPage[] = (acc.data ?? []).map((p) => ({
      id: p.id,
      name: p.name.trim(),
      token: p.access_token,
      igId: p.instagram_business_account?.id,
      igUser: p.instagram_business_account?.username,
    }));
    // page-token без списка страниц: сам объект и есть страница
    if (!pages.length && me.id) pages.push({ id: me.id, name: me.name ?? "", token });
    if (!pages.length) return { ok: false as const, reason: "у токена нет доступных страниц" };
    await ns.put("setting:meta", JSON.stringify({ pages } satisfies MetaCfg));
    return {
      ok: true as const,
      pageName: pages.map((p) => p.name).join(" · "),
      igUser: pages.map((p) => p.igUser).filter(Boolean).join(", "),
    };
  });

// Подтяжка последних публикаций страницы/IG в KV — «реально отслеживаем»
export const metaSyncFn = createServerFn({ method: "POST" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
  if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
  const { metaSyncCore } = await import("./meta");
  const r = await metaSyncCore(ns);
  return r.ok
    ? { ok: true as const, count: r.count, note: r.note }
    : { ok: false as const, reason: r.note ?? "синк не прошёл" };
});

// Обмен токенов на долгоживущие по App ID/Secret (страницы — бессрочные)
export const metaExchangeFn = createServerFn({ method: "POST" })
  .inputValidator((d: { appId: string; appSecret: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, note: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, note: "только BOSS / GTR-админ" };
    if (!data.appId.trim() || data.appSecret.trim().length < 16)
      return { ok: false as const, note: "нужны App ID и App Secret из настроек приложения" };
    const { metaExchangeCore } = await import("./meta");
    return metaExchangeCore(ns, data.appId.trim(), data.appSecret.trim());
  });

// Лента подключённых страниц для дашборда BOSS
export const metaFeedFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { items: [] as import("./meta").MetaFeedItem[], syncedAt: 0 };
  if (u.role !== "gtr" && !u.boss) return { items: [] as import("./meta").MetaFeedItem[], syncedAt: 0 };
  const feed = await kvGetJson<{ items: import("./meta").MetaFeedItem[]; syncedAt: number }>(ns, "metafeed");
  return feed ?? { items: [], syncedAt: 0 };
});

// ---------- PromptPay: реквизит для QR-оплат (правит только BOSS/GTR) ----------
export type PromptpayCfg = { id: string; name: string };

export const promptpayCfgFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { cfg: null as PromptpayCfg | null };
  return { cfg: await kvGetJson<PromptpayCfg>(ns, "setting:promptpay") };
});

export const setPromptpayCfgFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; name: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const digits = data.id.replace(/[^\d]/g, "");
    if (![10, 13, 15].includes(digits.length))
      return { ok: false as const, reason: "ID: телефон (10 цифр), Tax ID (13) или e-wallet (15)" };
    await ns.put(
      "setting:promptpay",
      JSON.stringify({ id: digits, name: data.name.trim().slice(0, 60) } satisfies PromptpayCfg),
    );
    return { ok: true as const };
  });

// Ручной музыкальный профиль: без внешних ключей — посетитель выбирает
// жанры (и, по желанию, любимых артистов), профиль ложится в тот же
// mprofile и питает тот же движок подбора, что и Spotify-анализ.
export const saveTasteFn = createServerFn({ method: "POST" })
  .inputValidator((d: { genres: string[]; artists?: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    const { FAMILY_LABEL } = await import("./match");
    const picked = data.genres.filter((g) => FAMILY_LABEL[g]).slice(0, 6);
    if (!picked.length) return { ok: false as const, reason: "выберите хотя бы один жанр" };
    // любимые артисты: матчим по нашей базе, их стили усиливают профиль
    const names = (data.artists ?? "")
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    const top: { name: string; genres: string[] }[] = [];
    const extra = new Map<string, number>();
    if (names.length) {
      const { loadArtists } = await import("./data/app-data");
      const { normalizeGenres } = await import("./match");
      const base = await loadArtists();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/g, "");
      for (const n of names) {
        const hit = base.artists.find(
          (a) => norm(a.name) === norm(n) || norm(a.name).includes(norm(n)),
        );
        top.push({ name: hit?.name ?? n, genres: hit?.styles ?? [] });
        if (hit?.styles?.length)
          for (const [fam, w] of normalizeGenres(hit.styles)) extra.set(fam, Math.max(extra.get(fam) ?? 0, w * 0.6));
      }
    }
    const genres = new Map<string, number>();
    picked.forEach((g, i) => genres.set(g, 1 - i * 0.08));
    for (const [fam, w] of extra) genres.set(fam, Math.max(genres.get(fam) ?? 0, w));
    const profile = {
      source: "manual" as const,
      displayName: u.name,
      genres: [...genres.entries()].sort((a, b) => b[1] - a[1]),
      rawGenres: picked.map((g) => [FAMILY_LABEL[g], 1] as [string, number]),
      topArtists: top,
      updatedAt: Date.now(),
    };
    await ns.put(`mprofile:${u.email}`, JSON.stringify(profile));
    return { ok: true as const };
  });

export const musicProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { profile: null as import("./spotify").MusicProfile | null };
  const profile = await kvGetJson<import("./spotify").MusicProfile>(ns, `mprofile:${u.email}`);
  return { profile };
});

export type MatchVenue = { vid: string; score: number; reasons: string[] };
export type MatchEvent = {
  vid: string;
  id: string;
  title: string;
  dateIso: string;
  poster?: string;
  score: number;
  reasons: string[];
};
export type MatchArtist = {
  id: string;
  name: string;
  score: number;
  reasons: string[];
  verified: boolean;
  hasMedia: boolean;
};

// Подбор: слушателю — площадки и события под вкус; команде — артисты под
// площадку. Вектора собираются из music площадок, стилей артистов и афиш.
export const aiMatchFn = createServerFn({ method: "GET" })
  .inputValidator((d: { vid?: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    const empty = {
      mode: "none" as "none" | "listener" | "team",
      profileReady: false,
      venues: [] as MatchVenue[],
      events: [] as MatchEvent[],
      artists: [] as MatchArtist[],
    };
    if (!u || !ns) return empty;
    const { normalizeGenres, scoreVectors } = await import("./match");
    const { PH, loadArtists } = await import("./data/app-data");
    const base = await loadArtists();
    const styleOf = new Map(base.artists.map((a) => [a.id, (a.styles ?? []).join(" ")]));

    // афиши: какие артисты замечены на какой площадке
    const evKeys = await kvListAll(ns, "venueevents:");
    const afishaBy = new Map<string, VenueAfisha["events"]>();
    for (const k of evKeys) {
      const rec = await kvGetJson<VenueAfisha>(ns, k);
      if (rec) afishaBy.set(k.slice("venueevents:".length), rec.events);
    }
    const venueVec = (vid: string) => {
      const v = PH.venues.find((x) => x.id === vid);
      const parts: string[] = [v?.music ?? "", v?.concept ?? "", v?.events ?? ""];
      for (const e of afishaBy.get(vid) ?? [])
        for (const aid of e.artistIds) parts.push(styleOf.get(aid) ?? "");
      return normalizeGenres(parts.filter(Boolean));
    };

    const teamSide = ["gtr", "pr", "owner", "sales", "organizer"].includes(u.role);
    if (teamSide) {
      const vid = data.vid || "VEN-0002";
      const target = venueVec(vid);
      const flagsKeys = await kvListAll(ns, "aflag:");
      const verified = new Set<string>();
      for (const k of flagsKeys) {
        const f = await kvGetJson<ArtistFlags>(ns, k);
        if (f?.verified) verified.add(k.slice("aflag:".length));
      }
      const artists: MatchArtist[] = base.artists
        .filter((a) => (a.styles ?? []).length && a.kind !== "venue")
        .map((a) => {
          const { score, reasons } = scoreVectors(normalizeGenres(a.styles ?? []), target);
          const hasMedia = Boolean(a.ig || a.sp);
          // бонусы малые: шкала Ружички 0..1, верификация не должна ломать её
          const bonus = (verified.has(a.id) ? 0.08 : 0) + (hasMedia ? 0.04 : 0);
          return {
            id: a.id,
            name: a.name,
            score: Math.min(0.99, score + (score > 0 ? bonus : 0)),
            reasons,
            verified: verified.has(a.id),
            hasMedia,
          };
        })
        .filter((x) => x.score > 0.15)
        .sort((x, y) => y.score - x.score)
        .slice(0, 12);
      return { ...empty, mode: "team" as const, artists };
    }

    // слушатель: нужен музыкальный профиль (верифицированные данные Spotify)
    const profile = await kvGetJson<import("./spotify").MusicProfile>(ns, `mprofile:${u.email}`);
    if (!profile) return { ...empty, mode: "listener" as const };
    const userVec = new Map(profile.genres);
    const venues: MatchVenue[] = PH.venues
      .map((v) => {
        const { score, reasons } = scoreVectors(userVec, venueVec(v.id));
        return { vid: v.id, score, reasons };
      })
      .filter((x) => x.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const today = new Date().toISOString().slice(0, 10);
    const events: MatchEvent[] = [];
    for (const [vid, list] of afishaBy)
      for (const e of list) {
        if (e.dateIso < today) continue;
        const vec = normalizeGenres([
          e.title,
          ...e.artistIds.map((aid) => styleOf.get(aid) ?? ""),
          PH.venues.find((x) => x.id === vid)?.music ?? "",
        ]);
        const { score, reasons } = scoreVectors(userVec, vec);
        if (score > 0.12)
          events.push({
            vid,
            id: e.id,
            title: e.title,
            dateIso: e.dateIso,
            poster: e.poster,
            score,
            reasons,
          });
      }
    events.sort((a, b) => b.score - a.score);
    return {
      ...empty,
      mode: "listener" as const,
      profileReady: true,
      venues,
      events: events.slice(0, 8),
    };
  });
