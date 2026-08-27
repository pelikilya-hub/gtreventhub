// Серверный слой GTR Event поверх Workers KV: аккаунты менеджеров и общая
// база событий/заявок. Пока биндинга нет (vite-dev), функции возвращают
// null/недоступно — клиент продолжает работать на localStorage.
import { createServerFn } from "@tanstack/react-start";
import { currentUser, hashPassword, type SessionUser, type StoredUser } from "./auth";
import type { EventDraft, Offer, OrgRequest, RoleId } from "./data/app-data";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "./kv-ns";
import { tgApi, tgConfigured, tgEsc, tgWebhookSecret } from "./tg";
import type { VenueAfisha } from "./afisha";
// Афиша площадки возвращается наружу серверными функциями этого модуля,
// поэтому тип обязан уезжать вместе с ними — экраны импортируют его отсюда.
export type { VenueAfisha };
import { menuOf } from "./venue-commerce";
import {
  gtrFrom,
  priceKey,
  staleVillas,
  VILLA_MARKUP,
  type VillaPrice,
} from "./villa-price";

export const ROLE_LABELS: Record<RoleId, string> = {
  pr: "PR-директор",
  owner: "Владелец",
  sales: "Event-продажи",
  gtr: "GTR-админ",
  artist: "Артист / диджей",
  organizer: "Организатор",
  visitor: "Посетитель",
  venue: "Площадка",
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

export async function notifyAdminsTg(
  ns: KvNs,
  text: string,
  markup?: { inline_keyboard: { text: string; callback_data: string }[][] },
) {
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
    await tgApi("sendMessage", {
      chat_id: chat,
      text,
      parse_mode: "HTML",
      ...(markup ? { reply_markup: markup } : {}),
    });
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
      passHash: await hashPassword(data.password),
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
      await notifyAdminsTg(
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
    // Аккаунт заведения (роль venue) сюда не пускаем: офферы артистам —
    // работа нашего букинга, площадка договаривается через менеджера.
    if (!me || me.role === "artist" || me.role === "venue")
      return { ok: false as const, error: "Только команда GTR и организаторы" };
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
    // chat_member — вступления в канал по инвайт-ссылкам (конкурс);
    // channel_post — привязка служебного канала /ops;
    // my_chat_member — учёт групп, куда добавили бота (реестр для коллабораций)
    allowed_updates: ["message", "callback_query", "chat_member", "channel_post", "my_chat_member"],
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
  /** Площадка, к которой привязан кабинет. Для роли venue обязателен:
   *  без него аккаунт заведения не знает, чью программу показывать, и
   *  скоуп по venueId не работает. */
  venueId?: string;
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
    if (!me || me.role === "artist" || me.role === "venue")
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
      // Кабинет площадки привязан к своему заведению: по venueId идёт
      // весь скоуп — программа, заявки, брони, паспорт.
      venueId: inv.venueId ?? "",
      artistId: "",
      teamOf: inv.teamOf || undefined,
      initials: initialsOf(data.name),
      passHash: await hashPassword(data.password),
      created: Date.now(),
      invitedBy: inv.invitedBy,
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    await ns.put(`invite:${data.code}`, JSON.stringify({ ...inv, uses: inv.uses + 1 }));

    await notifyAdminsTg(
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
          text: `🔊 <b>${tgEsc(u.name)}</b>:\n\n${tgEsc(text)}`,
          parse_mode: "HTML",
        });
        if (r.ok) sent++;
      }
      const { sendPushTo } = await import("./push");
      sendPushTo(ns, p.email, { title: `🔊 ${u.name}`, body: text.slice(0, 140), url: "/gtr/dash" }).catch(
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
  // Центр связи — внутренний контур команды. Заведение общается с нами
  // через своего менеджера, а не через список всех сотрудников и клиентов.
  if (!me || me.role === "artist" || me.role === "venue" || !ns)
    return { users: [] as ContactUser[] };
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

// Постер события руками: площадка присылает афишу в мессенджере чаще, чем
// вешает на сайт, а у половины заведений сайта нет вовсе. Загруженная
// картинка ложится ровно в тот же ключ, что и добытая разведкой, поэтому её
// сразу отдаёт /api/poster — без отдельной ветки в интерфейсе.
//
// Кто вправе: команда GTR по любой площадке, кабинет площадки — только по
// своей. Роль venue не должна дотягиваться до чужих афиш.
const POSTER_UP_MAX = 1_400_000; // ~1 МБ картинки после base64

export const afishaPosterFn = createServerFn({ method: "POST" })
  .inputValidator((d: { vid: string; id: string; dataUrl: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    const mine = u.role === "venue" && u.venueId && u.venueId === data.vid;
    if (u.role !== "gtr" && !mine) return { ok: false as const, reason: "нет прав на эту площадку" };

    const { posterKvKey, posterUrl } = await import("./poster");
    const key = posterKvKey(data.vid, data.id);

    // пустая строка — «убрать постер», вернёмся к нарисованной афише
    if (!data.dataUrl) {
      await ns.delete(key);
      return { ok: true as const, poster: posterUrl(data.vid, data.id) };
    }

    const m = data.dataUrl.match(/^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { ok: false as const, reason: "нужен PNG, JPEG или WEBP" };
    if (m[2].length > POSTER_UP_MAX)
      return { ok: false as const, reason: "картинка тяжелее 1 МБ — сожми" };
    await ns.put(key, JSON.stringify({ ct: m[1], b64: m[2] }));

    // В самой записи афиши помечаем, что постер наш и лежит в кэше: иначе
    // следующий прогон разведки снова полезет за оригиналом на сайт.
    const rec = await kvGetJson<VenueAfisha>(ns, `venueevents:${data.vid}`);
    if (rec) {
      const hit = rec.events.find((e) => e.id === data.id);
      if (hit) {
        hit.poster = posterUrl(data.vid, data.id);
        hit.posterSrc = undefined;
        await ns.put(`venueevents:${data.vid}`, JSON.stringify(rec));
      }
    }
    return { ok: true as const, poster: posterUrl(data.vid, data.id) };
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
  /** Код приглашения в кабинет площадки. Заводится в момент
   *  подтверждения: заведение уже здесь и уже отвечает на вопросы —
   *  второй раз собрать его внимание будет втрое дороже. */
  cabinetCode?: string;
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
    // Кабинет заводим прямо здесь, а не отдельным шагом позже: площадка
    // только что потратила время на анкету — это лучшая и единственная
    // минута, когда она готова завести аккаунт. Ссылка одноразовая и
    // привязана к её же площадке, пароль человек задаёт сам.
    const cabCode = `join-${randToken().slice(0, 10)}`;
    const cabInvite: AppInvite = {
      role: "venue",
      teamOf: "",
      venueId: link.vid,
      invitedBy: next.sentBy,
      inviterName: "GTR Event",
      created: Date.now(),
      uses: 0,
      maxUses: 3, // менеджер, владелец, маркетолог — обычно этого хватает
      exp: Date.now() + 30 * 24 * 3600 * 1000,
    };
    await ns.put(`invite:${cabCode}`, JSON.stringify(cabInvite));
    await ns.put(key, JSON.stringify({ ...next, cabinetCode: cabCode } satisfies VenueConfirm));

    // Телеграм: лично отправившему и в общий канал — подтверждение это событие
    if (tgConfigured()) {
      const { V } = await import("./data/app-data");
      const { APP_URL } = await import("./community");
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
        "",
        // Ссылку кладём в то же сообщение: менеджеру не надо идти в
        // дашборд и искать код — он пересылает её площадке в тот же чат,
        // пока разговор ещё тёплый.
        `<b>Кабинет площадки:</b> ${APP_URL}/gtr/join?code=${cabCode}`,
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
    // Код кабинета возвращаем на страницу подтверждения: площадка видит
    // «ваш кабинет готов» сразу после отправки анкеты, а не когда-нибудь
    // потом, когда до неё дойдут руки менеджера.
    return { ok: true as const, cabinetCode: cabCode };
  });

// Команде: все статусы подтверждений — для базы, паспорта и спринт-дашборда
export const venueConfirmsFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  const empty = { confirms: {} as Record<string, VenueConfirm> };
  if (!me || me.role === "artist" || me.role === "organizer" || !ns) return empty;
  // Здесь лежат контакты и ставки всех заведений сети. Аккаунту площадки
  // отдаём ровно одну запись — его собственную: чужой прайс и чужой
  // менеджер не его дело, а показать их означало бы слить конкуренту.
  if (me.role === "venue") {
    if (!me.venueId) return empty;
    const own = await kvGetJson<VenueConfirm>(ns, `vconfirm:${me.venueId}`);
    return { confirms: own ? { [me.venueId]: own } : {} };
  }
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
      if (rec && (rec.role === "artist" || rec.role === "organizer" || rec.role === "venue")) continue;
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
    // Массовая регистрация ботами — это мусор в базе, спам BOSS в
    // Telegram и накрутка реферальных баллов. Пять аккаунтов в час с
    // одного адреса живому человеку хватит с запасом.
    const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    if (await tooMany("signup", clientIp(), LIMITS.signup, ns))
      return { ok: false as const, error: TOO_MANY_MSG };
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
      passHash: await hashPassword(data.password),
      created: Date.now(),
      invitedBy: "signup",
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    const { passHash: _p, created: _c, invitedBy: _i, ...sessionUser } = stored;
    const { issueSession } = await import("./auth");
    await issueSession(sessionUser);
    // метрика + пинг в служебный контур (не в публичные чаты)
    const { bumpMetric } = await import("./community");
    await bumpMetric(ns, "reg").catch(() => {});
    await notifyBossTg(
      ns,
      `🆕 <b>Регистрация в GTR Event</b>\n${tgEsc(stored.name)} · ${tgEsc(email)} · посетитель`,
    ).catch(() => {});
    return { ok: true as const };
  });

// ---------- заявки на роли: артист / организатор / площадка / команда ----------
// Посетитель регистрируется мгновенно; остальные роли — заявка, которую
// подтверждает BOSS (в Telegram кнопками или в дашборде). До одобрения
// входа нет; после — человек входит со своим паролем.

export type PendingApp = {
  name: string;
  email: string;
  passHash: string;
  role: RoleId;
  about: string;
  code: string;
  created: number;
};

const APPLY_ROLES: Record<string, RoleId> = {
  artist: "artist",
  organizer: "organizer",
  venue: "owner",
  team: "gtr",
};
const APPLY_LABEL: Record<string, string> = {
  artist: "Артист",
  organizer: "Организатор",
  venue: "Площадка",
  team: "Команда GTR",
};

export const signupApplyFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { name: string; email: string; password: string; kind: string; about: string }) => d,
  )
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
    const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    if (await tooMany("apply", clientIp(), LIMITS.apply, ns))
      return { ok: false as const, error: TOO_MANY_MSG };
    const role = APPLY_ROLES[data.kind];
    if (!role) return { ok: false as const, error: "Неизвестная роль" };
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false as const, error: "Некорректный email" };
    if (data.password.length < 6) return { ok: false as const, error: "Пароль от 6 символов" };
    if (await ns.get(`user:${email}`))
      return { ok: false as const, error: "Такой аккаунт уже есть — войдите" };
    if (await ns.get(`pending:${email}`))
      return { ok: false as const, error: "Заявка уже на рассмотрении — мы напишем" };
    const code = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const app: PendingApp = {
      name: data.name.trim() || email.split("@")[0],
      email,
      passHash: await hashPassword(data.password),
      role,
      about: data.about.trim().slice(0, 400),
      code,
      created: Date.now(),
    };
    await ns.put(`pending:${email}`, JSON.stringify(app));
    await ns.put(`pcode:${code}`, email, { expirationTtl: 60 * 60 * 24 * 30 });
    // заявка — владельческое решение: только BOSS-контур, с кнопками
    const { guardInternalChatId, OPS_KEY } = await import("./community");
    const keys = await kvListAll(ns, "user:");
    const users = (
      await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
    ).filter((u): u is StoredUser => Boolean(u));
    const text = [
      `📥 <b>Заявка на роль: ${APPLY_LABEL[data.kind]}</b>`,
      "",
      `<b>${tgEsc(app.name)}</b> · ${tgEsc(email)}`,
      app.about ? `«${tgEsc(app.about)}»` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const markup = {
      inline_keyboard: [
        [
          { text: "✅ Принять", callback_data: `apr:${code}` },
          { text: "❌ Отклонить", callback_data: `rej:${code}` },
        ],
      ],
    };
    const sent = new Set<string>();
    const push = async (raw: string | number | null | undefined) => {
      const chat = await guardInternalChatId(ns, raw);
      if (!chat || sent.has(chat)) return;
      sent.add(chat);
      await tgApi("sendMessage", { chat_id: chat, text, parse_mode: "HTML", reply_markup: markup });
    };
    for (const a of users.filter((u) => u.role === "gtr" && u.boss)) {
      await push(await ns.get(`tg:${a.email}`));
    }
    const ops = await kvGetJson<import("./community").OpsCfg>(ns, OPS_KEY);
    await push(ops?.chatId);
    return { ok: true as const };
  });

// Общее ядро решения по заявке — им пользуются TG-кнопки и дашборд
export async function decidePendingCore(
  ns: KvNs,
  email: string,
  approve: boolean,
): Promise<{ ok: boolean; note: string; app?: PendingApp }> {
  const app = await kvGetJson<PendingApp>(ns, `pending:${email}`);
  if (!app) return { ok: false, note: "Заявка не найдена (уже решена?)" };
  if (approve) {
    const stored: StoredUser = {
      email: app.email,
      name: app.name,
      role: app.role,
      roleLabel: ROLE_LABELS[app.role],
      venueId: "",
      initials: initialsOf(app.name),
      passHash: app.passHash,
      created: Date.now(),
      invitedBy: "apply",
    };
    await ns.put(`user:${app.email}`, JSON.stringify(stored));
  }
  await ns.delete(`pending:${email}`);
  await ns.delete(`pcode:${app.code}`);
  return {
    ok: true,
    note: approve
      ? `✅ ${app.name} (${app.email}) — роль «${ROLE_LABELS[app.role]}» одобрена`
      : `❌ Заявка ${app.name} (${app.email}) отклонена`,
    app,
  };
}

export const pendingListFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns || u.role !== "gtr") return { items: [] as PendingApp[] };
  const keys = await kvListAll(ns, "pending:");
  const items = (
    await Promise.all(keys.map((k) => kvGetJson<PendingApp>(ns, k)))
  ).filter((x): x is PendingApp => Boolean(x));
  return { items: items.sort((a, b) => b.created - a.created).map(({ passHash: _p, ...r }) => r as PendingApp) };
});

export const pendingDecideFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; approve: boolean }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, note: "нужен вход" };
    if (u.role !== "gtr" || !u.boss) return { ok: false as const, note: "только BOSS" };
    const r = await decidePendingCore(ns, data.email.toLowerCase(), data.approve);
    return { ok: r.ok as true, note: r.note };
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
  .inputValidator(
    (d: { kind: "digest" | "invite" | "contest" | "moved" | "poll"; target: "channel" | "chat" }) => d,
  )
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (u.role !== "gtr" && !u.boss) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const {
      COMMUNITY_KEY,
      bkkDayNo,
      buildContestText,
      buildDigest,
      buildInviteText,
      buildMovedText,
      buildPoll,
    } = await import("./community");
    const cfg = await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY);
    const chatId = data.target === "channel" ? cfg?.channelId : cfg?.chatId;
    if (!chatId) {
      return { ok: false as const, reason: data.target === "channel" ? "Канал не привязан" : "Группа не привязана" };
    }
    const bot = (await ns.get("tg:bot")) || "Gtrcom1_bot";
    const { APP_URL } = await import("./community");

    // Опрос — не текстовый пост: у него свой метод и свои пределы, поэтому
    // он уходит здесь и дальше по общей ветке не идёт.
    if (data.kind === "poll") {
      const poll = await buildPoll(ns, bkkDayNo());
      if (poll.options.length < 2)
        return { ok: false as const, reason: "нечего спрашивать — программа на сегодня пуста" };
      const pr = await tgApi("sendPoll", {
        chat_id: chatId,
        question: poll.question,
        question_parse_mode: "HTML",
        options: poll.options,
        is_anonymous: true,
        allows_multiple_answers: Boolean(poll.multiple),
      });
      return pr.ok
        ? { ok: true as const, reason: "" }
        : { ok: false as const, reason: pr.description || "Telegram отклонил опрос" };
    }
    let text: string;
    let photos: string[] = [];
    if (data.kind === "digest") {
      const d = await buildDigest(ns);
      text = d.text;
      photos = d.photos;
    }
    else if (data.kind === "contest") text = buildContestText();
    else if (data.kind === "moved") {
      // Цифры берём из живой базы, а не из памяти: пост о переезде читают
      // сотни человек, и «110 площадок» из прошлого месяца — прямая ложь.
      const { PH, loadArtists } = await import("./data/app-data");
      const base = await loadArtists();
      text = buildMovedText(PH.venues.length, base.artists.length);
    } else text = buildInviteText(cfg ?? {}, false); // false: ссылки только в кнопках
    // ссылки — всегда кнопками, никогда голым текстом в теле поста
    const buttons: { text: string; url: string }[][] =
      data.kind === "contest"
        ? [[{ text: "🎁 Получить мою ссылку", url: `https://t.me/${bot}?start=ref` }]]
        : data.kind === "moved"
        ? [
            [{ text: "🚀 Открыть gtrevent.com", url: `${APP_URL}/gtr/tonight` }],
            [{ text: "👤 Создать аккаунт", url: `${APP_URL}/gtr/signup` }],
          ]
        : [
            [{ text: "🎫 Открыть GTR Event", url: `${APP_URL}/gtr/tonight` }],
            [
              ...(cfg?.channelUrl ? [{ text: "🔊 Канал", url: cfg.channelUrl }] : []),
              ...(cfg?.chatUrl ? [{ text: "💬 Чат", url: cfg.chatUrl }] : []),
            ],
          ].filter((row) => row.length);
    // Афиши вперёд, текст следом — как в кроновом дайджесте. Альбому
    // Telegram не даёт ни подписи, ни кнопок, поэтому это два сообщения.
    if (photos.length >= 2)
      await tgApi("sendMediaGroup", {
        chat_id: chatId,
        media: photos.slice(0, 10).map((u) => ({ type: "photo", media: u })),
      });
    else if (photos.length === 1) await tgApi("sendPhoto", { chat_id: chatId, photo: photos[0] });

    const res = await tgApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
      ...(data.kind === "contest" || photos.length
        ? { link_preview_options: { is_disabled: true } }
        : {
            link_preview_options: { url: APP_URL, prefer_large_media: true },
          }),
    });
    if (!res.ok)
      return { ok: false as const, reason: res.description || "Telegram отклонил пост" };
    // Пост о переезде закрепляем: адрес должен быть первым, что видит
    // новый подписчик, а не тонуть в ленте через сутки.
    if (data.kind === "moved") {
      const id = (res.result as { message_id?: number } | undefined)?.message_id;
      if (id)
        await tgApi("pinChatMessage", {
          chat_id: chatId,
          message_id: id,
          disable_notification: false,
        });
    }
    return { ok: true as const, reason: "" };
  });

// ---------- переезд: обновить все ссылки на стороне Telegram ----------
// Внутри продукта адрес один — APP_URL, и его сторожит тест. Но часть ссылок
// живёт НЕ в коде, а в настройках самого Telegram: описание бота, кнопка
// меню, список команд, описание канала и группы. Их правит только Bot API, и
// после переезда они остались бы с техническим адресом воркера — первое, что
// видит человек, открывая профиль бота.
//
// Эта ручка приводит их все в порядок одним нажатием. Каждый шаг
// отчитывается отдельно: Telegram отклоняет часть вызовов по правам (бот не
// админ канала, описание длиннее лимита), и молчаливое «готово» здесь было
// бы враньём.
export const tgRelinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { ok: false as const, steps: [] as string[], reason: "нужен вход" };
  if (u.role !== "gtr" && !u.boss)
    return { ok: false as const, steps: [] as string[], reason: "только BOSS / GTR-админ" };

  const { APP_URL, COMMUNITY_KEY, plural } = await import("./community");
  const cfg = await kvGetJson<import("./community").CommunityCfg>(ns, COMMUNITY_KEY);
  const { PH } = await import("./data/app-data");
  const host = APP_URL.replace(/^https?:\/\//, "");
  // «354 площадок» в описании канала видит каждый, кто открывает его впервые
  const venueWord = plural(PH.venues.length, "площадка", "площадки", "площадок");
  const steps: string[] = [];
  const run = async (label: string, method: string, params: Record<string, unknown>) => {
    const r = await tgApi(method, params);
    steps.push(`${r.ok ? "✓" : "✗"} ${label}${r.ok ? "" : ` — ${r.description ?? "отказ"}`}`);
    return r.ok;
  };

  // Профиль бота: длинное описание (пустой чат) и короткое (карточка).
  // Лимиты Telegram: 512 и 120 знаков — держимся заметно ниже.
  const about =
    `GTR Event — гид по ночному Таиланду. ${PH.venues.length} ${venueWord}, живая афиша на каждый вечер, ` +
    `бронь стола и ИИ-подбор вечеринок под твой вкус. Приложение: ${host}`;
  await run("описание бота", "setMyDescription", { description: about.slice(0, 500) });
  await run("короткое описание бота", "setMyShortDescription", {
    short_description: `Ночной Таиланд: афиша, бронь, артисты. ${host}`.slice(0, 118),
  });

  // Кнопка меню в чате с ботом — ТОЛЬКО список команд.
  //
  // Здесь стояла кнопка Web App на приложение, и это было ошибкой сразу по
  // двум причинам. Первая: Telegram на десктопе и в вебе открывает Web App
  // во фрейме, а наш собственный периметр отдаёт
  // `content-security-policy: frame-ancestors 'self'` — браузер такой фрейм
  // не рисует, и кнопка просто ничего не делала. Вторая: она заняла место
  // списка команд, то есть человек лишился и «/» тоже.
  //
  // Ссылке на приложение место в кнопках под сообщениями: там обычный url,
  // он открывается в браузере и никакими фреймами не ограничен.
  await run("кнопка меню бота", "setChatMenuButton", { menu_button: { type: "commands" } });

  // Список команд — то, что подсказывает Telegram при вводе «/».
  // Перечислены ВСЕ команды, которые бот реально понимает: короткий список
  // прячет половину бота, а сам вызов затирает то, что было заведено в
  // BotFather, и восстановить это оттуда нечем.
  await run("список команд", "setMyCommands", {
    commands: [
      { command: "tonight", description: "Куда пойти сегодня" },
      { command: "afisha", description: "Афиша ближайших вечеров" },
      { command: "menu", description: "Кнопки быстрых действий" },
      { command: "ref", description: "Моя ссылка для конкурса" },
      { command: "top", description: "Таблица лидеров конкурса" },
      { command: "cabinet", description: "Мой кабинет в приложении" },
      { command: "offers", description: "Предложения выступить" },
      { command: "gigs", description: "Мои подтверждённые выступления" },
      { command: "events", description: "Мои события и сметы (команда)" },
      { command: "requests", description: "Заявки организаторов (команда)" },
      { command: "offair", description: "Снять себя с эфира" },
      { command: "status", description: "Кто я" },
      { command: "cancel", description: "Отменить текущую форму" },
      { command: "help", description: "Что умеет бот" },
    ],
  });

  // Описания канала и группы: адрес должен быть виден до подписки.
  if (cfg?.channelId)
    await run("описание канала", "setChatDescription", {
      chat_id: cfg.channelId,
      description:
        `Ночной Таиланд без поисков: афиша на каждый вечер, ${PH.venues.length} ${venueWord}, бронь стола за пару касаний. ` +
        `Приложение — ${host}`,
    });
  else steps.push("• канал не привязан — описание не трогали");
  if (cfg?.chatId)
    await run("описание чата", "setChatDescription", {
      chat_id: cfg.chatId,
      description: `Чат сообщества GTR Event. Куда пойти, кто играет, с кем ехать. Приложение — ${host}`,
    });
  else steps.push("• чат не привязан — описание не трогали");

  return { ok: steps.some((s) => s.startsWith("✓")), steps, reason: "" };
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
// Для площадок с полной рассадкой (Café del Mar) заявка несёт зону, тип
// стола, слот времени, депозит и предзаказ по меню.
export type PreorderLine = {
  id: string;      // id позиции меню
  name: string;
  opt?: string;    // выбранный вариант (бокал/бутылка, 3 шт…)
  qty: number;
  price: number;   // цена за единицу выбранного варианта
};

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
  // рассадка (опционально — есть только у площадок с загруженной схемой)
  zone?: string;       // человекочитаемое имя зоны
  tableType?: string;  // человекочитаемое имя стола
  slot?: string;       // «13:00»
  deposit?: number;    // THB
  credit?: number;     // из депозита зачитывается на еду/напитки
  preorder?: PreorderLine[];
  preorderTotal?: number;
  decidedBy?: string;  // кто нажал подтверждение
  decidedTs?: number;
};

const bookingTgText = (b: TableBooking, venueName: string) =>
  [
    "🪑 <b>GTR · заявка на стол</b>",
    "",
    `<b>${tgEsc(venueName)}</b> · ${tgEsc(b.dateIso)}${b.slot ? ` · ${tgEsc(b.slot)}` : ""} · ${b.guests} чел.`,
    b.zone ? `<b>Зона:</b> ${tgEsc(b.zone)}${b.tableType ? ` · ${tgEsc(b.tableType)}` : ""}` : "",
    b.deposit
      ? `<b>Депозит:</b> ${b.deposit.toLocaleString("ru-RU")} THB${b.credit ? ` (кредит на F&B ${b.credit.toLocaleString("ru-RU")})` : ""}`
      : "",
    `<b>Гость:</b> ${tgEsc(b.name)} · ${tgEsc(b.phone)}`,
    b.preorder?.length
      ? [
          "<b>Предзаказ:</b>",
          ...b.preorder.map(
            (l) => `  · ${tgEsc(l.name)}${l.opt ? ` (${tgEsc(l.opt)})` : ""} ×${l.qty} — ${(l.price * l.qty).toLocaleString("ru-RU")}`,
          ),
          `  <b>Итого предзаказ: ${(b.preorderTotal ?? 0).toLocaleString("ru-RU")} THB</b>`,
        ].join("\n")
      : "",
    b.note ? `<b>Комментарий:</b> ${tgEsc(b.note)}` : "",
    `<i>${tgEsc(b.by)} · ${b.id}</i>`,
  ]
    .filter(Boolean)
    .join("\n");

export type BookTableInput = {
  vid: string;
  dateIso: string;
  guests: number;
  name: string;
  phone: string;
  note?: string;
  zone?: string;
  tableType?: string;
  slot?: string;
  deposit?: number;
  credit?: number;
  preorder?: PreorderLine[];
};

/** Ядро брони: используется и формой в приложении, и голосовым BRO. */
export async function bookTableCore(
  ns: KvNs,
  u: { email: string },
  data: BookTableInput,
) {
    if (!data.name.trim() || !data.phone.trim() || !data.dateIso)
      return { ok: false as const, reason: "имя, телефон и дата обязательны" };
    if (await ns.get(`bklimit:${u.email}`))
      return { ok: false as const, reason: "не чаще одной заявки в минуту" };
    await ns.put(`bklimit:${u.email}`, "1", { expirationTtl: 60 });
    // Предзаказ обязан состоять из блюд ЭТОЙ площадки. Раньше сюда
    // проходило что угодно: форма брони — один живой компонент на все
    // заведения, и при смене площадки её корзина уезжала в заявку
    // соседнего ресторана. Менеджеру приходил заказ блюд, которых у него
    // нет, с суммой из чужого прайса. Клиент починен, но проверка нужна
    // здесь: заявка уходит живому человеку, и граница — последнее место,
    // где ошибку ещё можно остановить.
    const venueMenu = menuOf(data.vid);
    const onMenu = new Map<string, { name: string; price: number; opts?: { l: string; p: number }[] }>();
    for (const sec of venueMenu?.sections ?? [])
      for (const g of sec.groups) for (const it of g.items) onMenu.set(it.id, it);
    const preorder = (data.preorder ?? [])
      .filter((l) => l && l.qty > 0 && l.price >= 0 && onMenu.has(String(l.id)))
      .slice(0, 40)
      .map((l) => {
        const it = onMenu.get(String(l.id))!;
        // Цену берём из меню, а не из заявки: клиент её не назначает.
        const opt = l.opt ? it.opts?.find((o) => o.l === l.opt) : undefined;
        return {
          id: String(l.id).slice(0, 60),
          name: it.name.slice(0, 90),
          opt: opt?.l,
          qty: Math.max(1, Math.min(99, Math.round(l.qty))),
          price: Math.max(0, Math.round(opt ? opt.p : it.price)),
        };
      });
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
      zone: data.zone?.slice(0, 60),
      tableType: data.tableType?.slice(0, 60),
      slot: data.slot?.slice(0, 10),
      deposit: data.deposit ? Math.max(0, Math.round(data.deposit)) : undefined,
      credit: data.credit ? Math.max(0, Math.round(data.credit)) : undefined,
      preorder: preorder.length ? preorder : undefined,
      preorderTotal: preorder.length
        ? preorder.reduce((s, l) => s + l.price * l.qty, 0)
        : undefined,
    };
    await ns.put(`booking:${booking.id}`, JSON.stringify(booking));
    const { V } = await import("./data/app-data");
    const venueName = V(booking.vid)?.name ?? booking.vid;
    const text = bookingTgText(booking, venueName);
    const markup = {
      inline_keyboard: [
        [
          { text: "✅ Подтвердить", callback_data: `bk:ok:${booking.id}` },
          { text: "❌ Отклонить", callback_data: `bk:no:${booking.id}` },
        ],
      ],
    };
    await notifyAdminsTg(ns, text, markup);
    // менеджер площадки: chat_id в KV venuemgr:<vid> (привязывает BOSS)
    const mgrChat = await ns.get(`venuemgr:${booking.vid}`);
    if (mgrChat)
      await tgApi("sendMessage", {
        chat_id: mgrChat,
        text,
        parse_mode: "HTML",
        reply_markup: markup,
      }).catch(() => {});
    return { ok: true as const, id: booking.id };
}

export const bookTableFn = createServerFn({ method: "POST" })
  .inputValidator((d: BookTableInput) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    // Две разные беды — два разных ответа. Слитые в «нужен вход» они врут
    // залогиненному гостю: 18.08.2026 прод уехал без биндинга KV, и человек
    // с живой сессией видел предложение войти, выходил и заходил снова.
    if (!u) return { ok: false as const, reason: "нужен вход" };
    if (!ns)
      return {
        ok: false as const,
        reason: "Хранилище недоступно — бронь не сохранить. Напишите площадке напрямую.",
      };
    return bookTableCore(ns, u, data);
  });

// Решение по брони: из Telegram-кнопки или из аккаунта площадки/команды.
export async function decideBookingCore(
  ns: KvNs,
  id: string,
  ok: boolean,
  byLabel: string,
) {
  const b = await kvGetJson<TableBooking>(ns, `booking:${id}`);
  if (!b) return { ok: false as const, note: "Бронь не найдена" };
  if (b.status !== "new")
    return {
      ok: false as const,
      note: b.status === "confirmed" ? "Уже подтверждена" : "Уже отклонена",
    };
  b.status = ok ? "confirmed" : "declined";
  b.decidedBy = byLabel;
  b.decidedTs = Date.now();
  await ns.put(`booking:${b.id}`, JSON.stringify(b));
  // гостю — в личку бота, если TG привязан
  const guestChat = await ns.get(`tg:${b.by}`);
  if (guestChat) {
    const { V } = await import("./data/app-data");
    await tgApi("sendMessage", {
      chat_id: guestChat,
      parse_mode: "HTML",
      text: ok
        ? `✅ <b>Бронь подтверждена</b>\n${tgEsc(V(b.vid)?.name ?? b.vid)} · ${tgEsc(b.dateIso)}${b.slot ? ` · ${tgEsc(b.slot)}` : ""}${b.tableType ? `\n${tgEsc(b.tableType)}` : ""}\nЖдём вас!`
        : `❌ <b>Бронь отклонена</b>\n${tgEsc(V(b.vid)?.name ?? b.vid)} · ${tgEsc(b.dateIso)}\nПопробуйте другой стол или дату.`,
    }).catch(() => {});
  }
  return { ok: true as const, note: ok ? "Подтверждена ✅" : "Отклонена ❌", booking: b };
}

export const decideBookingFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; ok: boolean }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, note: "нужен вход" };
    if (u.role !== "gtr" && u.role !== "owner")
      return { ok: false as const, note: "нет прав" };
    return decideBookingCore(ns, data.id, data.ok, u.name ?? u.email);
  });

export const myBookingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return { bookings: [] as TableBooking[] };
  const keys = await kvListAll(ns, "booking:");
  const all = (await Promise.all(keys.map((k) => kvGetJson<TableBooking>(ns, k)))).filter(
    (b): b is TableBooking => Boolean(b),
  );
  const mine = u.role === "gtr" || u.role === "owner" ? all : all.filter((b) => b.by === u.email);
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

    // Заодно забираем аватар страницы: у заведения там почти всегда
    // стоит собственный знак. Это единственный законный путь к логотипу
    // через Meta — публичные страницы чужих заведений Graph закрыл, для
    // них нужен разбор приложения. А со своим токеном площадка отдаёт
    // аватар сама, и это уже её осознанное согласие.
    try {
      const pic = await fetch(
        `${G}/${page.pageId}/picture?type=large&redirect=false&access_token=${encodeURIComponent(page.token)}`,
      )
        .then(
          (r) =>
            r.json() as Promise<{
              data?: { url?: string; width?: number; height?: number; is_silhouette?: boolean };
            }>,
        )
        .catch(() => null);
      const d = pic?.data;
      // Силуэт — заглушка Facebook «аватара нет»: сохранять нечего.
      if (d?.url && !d.is_silhouette) {
        await ns.put(
          `vlogo:${link.vid}`,
          JSON.stringify({
            url: d.url,
            w: d.width ?? 0,
            h: d.height ?? 0,
            from: "facebook",
            pageName: page.pageName,
            at: Date.now(),
          }),
        );
      }
    } catch {
      // аватар — приятное дополнение, из-за него подключение не валим
    }

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
  /** роль слота, под который артист подошёл: разогрев, прайм, закат */
  slot?: string | null;
  /** коридор темпа этого слота — менеджеру видно, о чём договариваться */
  bpm?: [number, number] | null;
  /** жанры артиста, которые и дали совпадение с палитрой слота */
  fitStyles?: string[];
};

// Подбор: слушателю — площадки и события под вкус; команде — артисты под
// площадку. Вектора собираются из music площадок, стилей артистов и афиш.
export const aiMatchFn = createServerFn({ method: "GET" })
  // hour — час вечера, под который подбираем. Без него берём главный
  // слот площадки: тот, ради которого туда и приходят.
  .inputValidator((d: { vid?: string; hour?: number }) => d)
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
    const { normalizeGenres, scoreVectors, scoreStyles } = await import("./match");
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

    // Живые подписи площадки — тот же набор, из которого строится её
    // вектор семейств. Дереву нужны именно они: по ним оно узнаёт жанры.
    const venueStyles = (vid: string) => {
      const v = PH.venues.find((x) => x.id === vid);
      const parts: string[] = [v?.music ?? "", v?.concept ?? "", v?.events ?? ""];
      for (const e of afishaBy.get(vid) ?? [])
        for (const aid of e.artistIds) parts.push(styleOf.get(aid) ?? "");
      return parts.filter(Boolean);
    };

    // Счёт артиста складывается из трёх слоёв, и порядок между ними
    // важен. Сверху — звуковой паспорт площадки: он знает, что играет в
    // этот час и чего здесь не играют никогда, и его вето отменяет всё
    // остальное. Ниже — дерево жанров: оно различает дип-хаус и биг-рум.
    // В основании — старые семейства: они выручают, когда про артиста
    // известно только «электроника».
    const { fitArtist, soundOf } = await import("./venue-sound");
    const scoreArtist = (
      a: { id: string; styles?: string[]; styleIds?: string[] },
      famTarget: ReturnType<typeof normalizeGenres>,
      styles: string[],
      vid: string,
      hour?: number,
    ) => {
      const raw = a.styles ?? [];
      const ids = a.styleIds ?? [];
      const base = styles.length
        ? scoreStyles(raw, styles)
        : scoreVectors(normalizeGenres(raw), famTarget);

      const sound = soundOf(vid);
      if (!sound || !ids.length) return { ...base, fit: null as ReturnType<typeof fitArtist> | null };

      const fit = fitArtist(vid, ids, hour);
      // Запрещённый стиль — это отказ, а не минус к оценке: испорченный
      // вечер не окупается совпадением по остальным жанрам.
      if (fit.vetoed.length) return { score: 0, reasons: base.reasons, fit };
      return { score: 0.6 * fit.score + 0.4 * base.score, reasons: base.reasons, fit };
    };

    const teamSide = ["gtr", "pr", "owner", "sales", "organizer"].includes(u.role);
    if (teamSide) {
      const vid = data.vid || "VEN-0002";
      const target = venueVec(vid);
      const targetStyles = venueStyles(vid);
      const flagsKeys = await kvListAll(ns, "aflag:");
      const verified = new Set<string>();
      for (const k of flagsKeys) {
        const f = await kvGetJson<ArtistFlags>(ns, k);
        if (f?.verified) verified.add(k.slice("aflag:".length));
      }
      const artists: MatchArtist[] = base.artists
        .filter((a) => (a.styles ?? []).length && a.kind !== "venue")
        .map((a) => {
          // Дерево жанров поверх семейств: у половины каталога есть
          // размеченные styleIds, и для них счёт считается по родству
          // жанров, а не по попаданию в одну из пятнадцати корзин.
          const { score, reasons, fit } = scoreArtist(a, target, targetStyles, vid, data.hour);
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
            slot: fit?.slot?.role ?? null,
            bpm: fit?.slot?.bpm ?? null,
            fitStyles: fit?.matched?.map((m) => m.id) ?? [],
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

// ---------- цены вилл Private: ежедневная сверка ----------
// Цена живёт в KV, а не в villas.json: JSON — это статика из trip.com,
// а ставка меняется каждый день. Наценка считается на сервере, чтобы
// клиент не мог её подкрутить.

export const villaPricesFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const { canPrivate } = await import("./data/app-data");
  if (!u || !canPrivate(u)) return { prices: {} as Record<string, VillaPrice>, stale: [] as string[] };
  const { villaIds } = await import("./villa-price");
  const { prices, stale } = await staleVillas(villaIds());
  return { prices, stale };
});

export const setVillaPriceFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { vid: string; basePerNight: number; available?: boolean | null; note?: string }) => d,
  )
  .handler(async ({ data }) => {
    const u = await currentUser();
    if (!u || u.role !== "gtr") return { ok: false as const, error: "Только GTR-админ" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно" };
    const base = Math.round(Number(data.basePerNight));
    if (!Number.isFinite(base) || base <= 0) return { ok: false as const, error: "Нужна ставка за ночь" };
    const price: VillaPrice = {
      vid: data.vid,
      currency: "THB",
      basePerNight: base,
      gtrPerNight: gtrFrom(base),
      markup: VILLA_MARKUP,
      checkedAt: new Date().toISOString().slice(0, 10),
      source: "manual",
      by: u.email,
      available: data.available ?? null,
      note: data.note?.trim() || undefined,
    };
    await ns.put(priceKey(data.vid), JSON.stringify(price));
    return { ok: true as const, price };
  });

// ---------- занятость площадок: даты, где уже стоит своя программа ----------
// Календарь и конструктор спрашивают «свободна ли дата», а не «покажи
// афишу» — держим отдельный лёгкий индекс, чтобы не тянуть события целиком.

// ---------- знаки площадок ----------
// Два источника, и порядок между ними важен. Снизу лежит то, что мы
// сами сняли с официальных сайтов (venue-logos.json, файлы в сборке).
// Сверху — то, что площадка отдала нам сама, подключив свою страницу:
// её знак свежее нашего и получен с прямого согласия, поэтому он
// перекрывает собранный.
export type VenueLogo = {
  file: string;
  w: number;
  h: number;
  plate: string | null;
  tone: "light" | "dark";
  onDark: boolean;
  from: "site" | "facebook";
};

export const venueLogosFn = createServerFn({ method: "GET" }).handler(async () => {
  const { default: statics } = await import("./data/venue-logos.json");
  const out: Record<string, VenueLogo> = {};
  for (const [vid, d] of Object.entries(statics as Record<string, Record<string, unknown>>)) {
    out[vid] = {
      file: String(d.file),
      w: Number(d.w),
      h: Number(d.h),
      plate: (d.plate as string | null) ?? null,
      tone: d.tone === "light" ? "light" : "dark",
      onDark: Boolean(d.onDark),
      from: "site",
    };
  }
  const ns = await getKvNs();
  if (ns) {
    for (const key of await kvListAll(ns, "vlogo:")) {
      const v = await kvGetJson<{ url: string; w?: number; h?: number }>(ns, key);
      if (!v?.url) continue;
      // Аватар страницы — всегда квадрат на сплошной подложке: подложку
      // не угадываем, а честно помечаем «плашка нужна».
      out[key.slice("vlogo:".length)] = {
        file: v.url,
        w: v.w ?? 0,
        h: v.h ?? 0,
        plate: null,
        tone: "dark",
        onDark: false,
        from: "facebook",
      };
    }
  }
  return { logos: out };
});

export const venueBusyFn = createServerFn({ method: "GET" })
  .inputValidator((d: { vids: string[] }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { busy: {} as Record<string, string[]> };
    const { busyKey } = await import("./afisha");
    const busy: Record<string, string[]> = {};
    await Promise.all(
      data.vids.slice(0, 60).map(async (vid) => {
        const b = await kvGetJson<import("./afisha").VenueBusy>(ns, busyKey(vid));
        if (b?.dates?.length) busy[vid] = b.dates;
      }),
    );
    return { busy };
  });

// Что нашёл движок разведки: для BOSS-дашборда — видно, где афиша живая,
// а где источник ещё не найден и нужен человек.
export const afishaSourcesFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || me.role !== "gtr" || !ns) return { sources: [] as { vid: string; kind: string; found: number; checkedAt: string }[] };
  const keys = await kvListAll(ns, "afishasrc:");
  const rows = await Promise.all(
    keys.map(async (k) => {
      const r = await kvGetJson<{ kind: string; found: number; checkedAt: string }>(ns, k);
      return r ? { vid: k.slice("afishasrc:".length), ...r } : null;
    }),
  );
  return { sources: rows.filter((r): r is NonNullable<typeof r> => Boolean(r)) };
});

// ------------------------------------------------------------ GTR BRO

export type BroFlags = {
  enabled: boolean;
  kill: boolean;
  roles: string[];
  keyReady: boolean;
  /** Какой голосовой транспорт использовать. По умолчанию — gemini, если
   *  его ключ есть: это бесплатный путь. Явное значение в setting:flags
   *  (voiceProvider) перекрывает автоматику. */
  provider: "openai" | "gemini";
};

/** Флаги голосового помощника для клиента.
 *
 *  Клиенту нужно знать заранее, включена ли фича: центральная кнопка GTR
 *  иначе будет обещать голос и упираться в 503. Значение ключа сюда не
 *  попадает — только факт его наличия. */
// ---------- портрет BOSS для эмблемы дашборда ----------
// Два снимка: день (прозрачные очки) и ночь (тёмные). Храним как
// data-URL в KV: файлов у нас негде держать, а два PNG по паре сотен
// килобайт — это ровно тот размер, ради которого не стоит заводить
// объектное хранилище.
export type BossHeadCfg = { day?: string; night?: string; updated?: number };

const HEAD_KEY = "boss:head";
const HEAD_MAX = 900_000; // ~0.9 МБ на снимок после сжатия в браузере

export const bossHeadFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { head: null as BossHeadCfg | null };
  return { head: (await kvGetJson<BossHeadCfg>(ns, HEAD_KEY)) ?? null };
});

export const saveBossHeadFn = createServerFn({ method: "POST" })
  .inputValidator((d: { day?: string | null; night?: string | null }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (!u.boss) return { ok: false as const, reason: "только BOSS" };
    const cur = (await kvGetJson<BossHeadCfg>(ns, HEAD_KEY)) ?? {};
    const clean = (v: string | null | undefined, keep: string | undefined) => {
      if (v === null) return undefined; // явное «убрать»
      if (v === undefined) return keep;
      if (!/^data:image\/(png|webp|jpeg);base64,/.test(v))
        return keep; // чужой формат игнорируем молча, прозрачность нужна
      if (v.length > HEAD_MAX) return keep;
      return v;
    };
    const next: BossHeadCfg = {
      day: clean(data.day, cur.day),
      night: clean(data.night, cur.night),
      updated: Date.now(),
    };
    if ((data.day && next.day !== data.day) || (data.night && next.night !== data.night))
      return { ok: false as const, reason: "снимок слишком тяжёлый — сожми до 900 КБ" };
    await ns.put(HEAD_KEY, JSON.stringify(next));
    return { ok: true as const };
  });

export const broFlagsFn = createServerFn({ method: "GET" }).handler(async (): Promise<BroFlags> => {
  const off: BroFlags = { enabled: false, kill: false, roles: [], keyReady: false, provider: "gemini" };
  const user = await currentUser();
  if (!user) return off;
  const ns = await getKvNs();
  if (!ns) return off;
  const f =
    (await kvGetJson<{
      broEnabled?: boolean;
      broKill?: boolean;
      broRoles?: string[];
      voiceProvider?: "openai" | "gemini";
    }>(ns, "setting:flags")) ?? {};
  const oai = Boolean(typeof process !== "undefined" && process.env?.OPENAI_API_KEY);
  const gem = Boolean(typeof process !== "undefined" && process.env?.GEMINI_API_KEY);
  const provider = f.voiceProvider ?? (gem ? "gemini" : "openai");
  const keyReady = provider === "gemini" ? gem : oai;
  const allowed = !f.broRoles?.length || f.broRoles.includes(user.role);
  return {
    enabled: Boolean(f.broEnabled) && !f.broKill && allowed,
    kill: Boolean(f.broKill),
    roles: f.broRoles ?? [],
    keyReady,
    provider,
  };
});

/** Счётчики использования BRO. Пишем агрегат по дням: сколько сессий,
 *  сколько прервали, какие инструменты звали, какие ошибки. Ни реплик,
 *  ни аудио, ни текста пользователя здесь нет и быть не должно. */
export const broLogFn = createServerFn({ method: "POST" })
  .inputValidator((d: { events: string[] }) => d)
  .handler(async ({ data }) => {
    const user = await currentUser();
    if (!user) return { ok: false };
    const ns = await getKvNs();
    if (!ns) return { ok: false };
    const day = new Date().toISOString().slice(0, 10);
    const key = `brostat:${day}`;
    const cur = (await kvGetJson<Record<string, number>>(ns, key)) ?? {};
    for (const raw of data.events.slice(0, 40)) {
      // Имя события — только из безопасного алфавита: счётчик не место
      // для произвольной строки с клиента.
      const name = String(raw).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 48);
      if (name) cur[name] = (cur[name] ?? 0) + 1;
    }
    await ns.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 120 });
    return { ok: true };
  });

// ---------- рабочие контакты: только команде и только по запросу ----------
//
// Раньше контакты приезжали в браузер вместе с базой и лежали в бандле,
// который отдаётся анонимно. Теперь их отдаёт сервер и только тем ролям,
// которым они положены по работе.

export type WorkContact = {
  venueId?: string;
  artistId?: string;
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  wa?: string;
  mgmt?: string;
  person?: string;
  rider?: string;
  notes?: string;
  evidence?: string;
  channel?: string;
  status?: string;
  verified?: string;
};

const TEAM = ["gtr", "organizer", "pr", "owner", "sales"];

/** Все контакты площадок разом: рабочие экраны показывают их списком. */
export const venueContactsFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  if (!me || !TEAM.includes(me.role)) return { contacts: [] as WorkContact[] };
  // Даже у своих есть потолок: угнанная сессия не должна превращаться в
  // выгрузку всей базы контактов.
  const { tooMany, LIMITS } = await import("./abuse");
  if (await tooMany("contacts", me.email, LIMITS.contacts)) return { contacts: [] as WorkContact[] };
  const { loadVenuesFull } = await import("./data/private-data");
  const full = await loadVenuesFull();
  const out: WorkContact[] = full.contacts.map((c) => ({
    venueId: c.venueId,
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
    channel: c.channel,
    status: c.status,
    verified: c.verified,
    notes: c.notes,
  }));
  // Телефон и почта из самой записи площадки — тот же рабочий контакт.
  for (const v of full.venues) {
    if (!v.phone && !v.email) continue;
    if (out.some((c) => c.venueId === v.id)) continue;
    out.push({ venueId: v.id, phone: v.phone, email: v.email, role: "Площадка" });
  }
  return { contacts: out };
});

/** Контакт и рабочая карточка одного артиста. */
export const artistContactFn = createServerFn({ method: "GET" })
  .validator((d: { artistId: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (!me || !TEAM.includes(me.role)) return { contact: null as WorkContact | null };
    const { tooMany, LIMITS } = await import("./abuse");
    if (await tooMany("contacts", me.email, LIMITS.contacts))
      return { contact: null as WorkContact | null };
    const { loadArtistsFull } = await import("./data/private-data");
    const full = await loadArtistsFull();
    const a = full.artists.find((x) => x.id === data.artistId);
    if (!a) return { contact: null as WorkContact | null };
    return {
      contact: {
        artistId: a.id,
        phone: a.phone,
        email: a.email,
        wa: a.waRu || a.wa,
        mgmt: a.mgmtRu || a.mgmt,
        person: a.person,
        rider: a.riderName || a.rider,
        notes: a.notesRu || a.notes,
        evidence: a.evidenceRu || a.evidence,
      } as WorkContact,
    };
  });

// ---------- работа с площадками: доска менеджера ----------
//
// Прогресс по каждой площадке живёт в KV: кто на связи, что уже собрали,
// какие ссылки прислали. Это рабочая доска команды, а не витрина, —
// поэтому и читает, и пишет только команда.

export type OutreachRow = {
  vid: string;
  stage: string;
  owner?: string;
  contact?: string;
  links?: Record<string, string>;
  done?: string[];
  note?: string;
  updatedAt: number;
};

export const outreachAllFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || !TEAM.includes(me.role) || !ns) return { rows: [] as OutreachRow[] };
  const keys = await kvListAll(ns, "outreach:");
  const rows = (await Promise.all(keys.map((k) => kvGetJson<OutreachRow>(ns, k)))).filter(
    (r): r is OutreachRow => Boolean(r),
  );
  return { rows };
});

export const outreachSaveFn = createServerFn({ method: "POST" })
  .inputValidator((d: Partial<OutreachRow> & { vid: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me || !TEAM.includes(me.role) || !ns) return { ok: false as const };
    const key = `outreach:${data.vid}`;
    const prev = (await kvGetJson<OutreachRow>(ns, key)) ?? { vid: data.vid, stage: "new", updatedAt: 0 };
    const row: OutreachRow = {
      ...prev,
      ...data,
      links: { ...(prev.links ?? {}), ...(data.links ?? {}) },
      owner: data.owner ?? prev.owner ?? me.name,
      updatedAt: Date.now(),
    };
    await ns.put(key, JSON.stringify(row));
    // Согласие площадки — событие для всей команды, а не строка в таблице.
    if (data.stage === "agreed" && prev.stage !== "agreed") {
      const { V } = await import("./data/app-data");
      await notifyBossTg(
        ns,
        `🤝 <b>Согласие площадки</b>\n${tgEsc(V(data.vid)?.name ?? data.vid)} — ${tgEsc(row.owner ?? "менеджер")}`,
      ).catch(() => {});
    }
    return { ok: true as const, row };
  });

// ---------- Threads: подключение и публикация ----------
//
// Threads — отдельное подключение от страниц Facebook: свой домен API,
// свой токен, свои права. Токен страницы здесь не работает, поэтому и
// настройка отдельная.

export const setThreadsFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me?.boss || !ns) return { ok: false as const, reason: "только BOSS" };
    const token = data.token.trim();
    if (token.length < 20) return { ok: false as const, reason: "токен слишком короткий" };
    const { threadsMe, THREADS_KEY } = await import("./threads");
    const who = await threadsMe(token);
    if (!who.ok) return { ok: false as const, reason: who.reason };
    await ns.put(
      THREADS_KEY,
      JSON.stringify({
        userId: who.id,
        username: who.username,
        token,
        // Долгоживущий токен Threads живёт 60 дней: помечаем срок сразу,
        // чтобы напомнить до того, как публикации начнут молча падать.
        expiresAt: Date.now() + 60 * 24 * 3600 * 1000,
        savedAt: Date.now(),
      }),
    );
    return { ok: true as const, username: who.username ?? who.id };
  });

export const threadsStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me?.boss || !ns) return { connected: false as const };
  const { threadsCfg } = await import("./threads");
  const cfg = await threadsCfg(ns);
  if (!cfg) return { connected: false as const };
  const daysLeft = cfg.expiresAt ? Math.round((cfg.expiresAt - Date.now()) / 86_400_000) : null;
  return { connected: true as const, username: cfg.username ?? cfg.userId, daysLeft };
});

/** Ручная публикация: BOSS проверяет связку одной кнопкой, не дожидаясь
 *  вечернего крона. */
export const threadsPostFn = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string; imageUrl?: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me?.boss || !ns) return { ok: false as const, reason: "только BOSS" };
    const { threadsCfg, threadsPost } = await import("./threads");
    const cfg = await threadsCfg(ns);
    if (!cfg) return { ok: false as const, reason: "Threads не подключён" };
    const r = await threadsPost(cfg, data.text, data.imageUrl);
    return r.ok ? { ok: true as const, id: r.id } : { ok: false as const, reason: r.reason };
  });

// ---------- черновики приёмника афиш ----------
//
// Приёмник разбирает чужие посты и складывает всё, чего нет в базе:
// незнакомые площадки с обогащением по OpenStreetMap и незнакомые имена
// из лайнапов. Решение принимает человек — автомат заводит карточки
// только в черновики.

export type VenueDraftRow = {
  slug: string;
  name: string;
  seenAt: number;
  seenIn: string[];
  lat?: number;
  lon?: number;
  kind?: string;
  address?: string;
  hours?: string;
  website?: string;
  status: string;
  /** События, которые ждут эту площадку: без карточки их некуда класть. */
  waiting: { dateIso: string; title: string }[];
};

export type ArtistDraftRow = {
  slug: string;
  name: string;
  seen: number;
  at: number;
  source?: string;
  status: string;
};

export const draftsFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || !TEAM.includes(me.role) || !ns)
    return { venues: [] as VenueDraftRow[], artists: [] as ArtistDraftRow[] };

  const vKeys = await kvListAll(ns, "venuedraft:");
  const wKeys = await kvListAll(ns, "intakewait:");
  const venues: VenueDraftRow[] = [];
  for (const k of vKeys) {
    const d = await kvGetJson<Omit<VenueDraftRow, "waiting">>(ns, k);
    if (!d || d.status === "skip") continue;
    const slug = k.slice("venuedraft:".length);
    // События этой площадки ждут своей карточки — показываем их рядом,
    // иначе решение принимается вслепую: одно дело новая точка, другое —
    // точка, за которой уже стоят три вечера.
    const waiting: { dateIso: string; title: string }[] = [];
    for (const wk of wKeys.filter((x) => x.startsWith(`intakewait:${slug}:`))) {
      const w = await kvGetJson<{ dateIso: string; title: string }>(ns, wk);
      if (w) waiting.push({ dateIso: w.dateIso, title: w.title });
    }
    venues.push({ ...d, slug, waiting: waiting.sort((a, b) => a.dateIso.localeCompare(b.dateIso)) });
  }

  const aKeys = await kvListAll(ns, "artistdraft:");
  const artists: ArtistDraftRow[] = [];
  for (const k of aKeys) {
    const d = await kvGetJson<Omit<ArtistDraftRow, "slug">>(ns, k);
    if (!d || d.status === "skip") continue;
    artists.push({ ...d, slug: k.slice("artistdraft:".length) });
  }

  return {
    // Сначала то, за чем стоят события, потом остальное по свежести.
    venues: venues.sort((a, b) => b.waiting.length - a.waiting.length || b.seenAt - a.seenAt),
    artists: artists.sort((a, b) => b.seen - a.seen || b.at - a.at),
  };
});

/** Решение по черновику. Одобрение площадки сразу переносит ждущие
 *  события в её календарь: ради них черновик и заводился. */
export const draftDecideFn = createServerFn({ method: "POST" })
  .inputValidator((d: { kind: "venue" | "artist"; slug: string; approve: boolean }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me || !TEAM.includes(me.role) || !ns) return { ok: false as const, note: "только команда GTR" };
    const key = `${data.kind === "venue" ? "venuedraft" : "artistdraft"}:${data.slug}`;
    const draft = await kvGetJson<Record<string, unknown>>(ns, key);
    if (!draft) return { ok: false as const, note: "черновик не найден" };

    if (!data.approve) {
      await ns.put(key, JSON.stringify({ ...draft, status: "skip", by: me.email }), {
        expirationTtl: 180 * 24 * 3600,
      });
      return { ok: true as const, note: "Отклонено" };
    }

    if (data.kind === "artist") {
      await ns.put(`artistadd:${data.slug}`, JSON.stringify({ ...draft, approvedBy: me.email, at: Date.now() }));
      await ns.delete(key);
      return { ok: true as const, note: "Артист принят в базу" };
    }

    // Площадке нужен идентификатор. Диапазон 9xxx отделяет принятые из
    // приёмника от исходных ста десяти: по id сразу видно происхождение.
    const existing = await kvListAll(ns, "venueadd:");
    const id = `VEN-9${String(existing.length + 1).padStart(3, "0")}`;
    await ns.put(
      `venueadd:${id}`,
      JSON.stringify({ ...draft, id, approvedBy: me.email, at: Date.now() }),
    );

    // Ждущие события переезжают в календарь новой площадки.
    const wKeys = (await kvListAll(ns, "intakewait:")).filter((k) =>
      k.startsWith(`intakewait:${data.slug}:`),
    );
    const events = [];
    for (const wk of wKeys) {
      const w = await kvGetJson<{ dateIso: string; title: string }>(ns, wk);
      if (!w) continue;
      events.push({
        id: `intake-${w.dateIso}-${data.slug.slice(0, 16)}`,
        title: w.title,
        dateIso: w.dateIso,
        url: "",
        artistIds: [] as string[],
        source: "intake",
      });
      await ns.delete(wk);
    }
    if (events.length) {
      await ns.put(
        `venueevents:${id}`,
        JSON.stringify({ events, syncedAt: Date.now(), source: "intake" }),
      );
      await ns.put(
        `venuebusy:${id}`,
        JSON.stringify({ dates: [...new Set(events.map((e) => e.dateIso))].sort(), updatedAt: Date.now() }),
      );
    }
    await ns.delete(key);
    return {
      ok: true as const,
      id,
      note: `Площадка принята как ${id}${events.length ? `, событий перенесено: ${events.length}` : ""}`,
    };
  });
