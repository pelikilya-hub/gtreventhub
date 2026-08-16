// Вебхук Telegram-бота GTR Event. Сюда приходят:
//  - /start <код>  — привязка Telegram к аккаунту (код выдаёт кабинет)
//  - кнопки «Принять/Отклонить» под предложением артисту
//  - /guest <EV-…> <имя> — спец-гость в гостевой список события
// Подлинность запроса проверяется секретом вебхука в заголовке.
import { createFileRoute } from "@tanstack/react-router";

import {
  computeQuote,
  draftTitle,
  fmtThb,
  OFFER_LABEL,
  STAGE_LABEL,
  type EventDraft,
  type Offer,
  type OrgRequest,
} from "../gtr/data/app-data";
import type { StoredUser } from "../gtr/auth";
import { decideOfferCore } from "../gtr/kv-api";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "../gtr/kv-ns";
import { tgApi, tgEsc, tgWebhookSecret } from "../gtr/tg";

const sha256hex = async (t: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Кириллица → латиница, чтобы логины выглядели аккуратно
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24) || "guest";

type TgUpdate = {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { first_name?: string; username?: string; language_code?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
  // пост в канале (нужен для /ops — привязки служебного канала)
  channel_post?: {
    text?: string;
    chat: { id: number; title?: string };
  };
  // конкурс инвайтинга: Telegram шлёт вступления в канал с инвайт-ссылкой
  chat_member?: {
    chat: { id: number };
    from?: { id: number; first_name?: string };
    old_chat_member: { status: string; user: { id: number; first_name?: string } };
    new_chat_member: { status: string; user: { id: number; first_name?: string } };
    invite_link?: { invite_link: string; name?: string };
  };
  // статус самого бота: добавили/убрали из группы — ведём реестр чатов,
  // куда BOSS добавил бота (источник админов для коллабораций)
  my_chat_member?: {
    chat: { id: number; title?: string; type: string; username?: string };
    from?: { id: number; first_name?: string; username?: string };
    old_chat_member: { status: string };
    new_chat_member: { status: string };
  };
};

const reply = (chatId: number, text: string, markup?: unknown) =>
  tgApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(markup ? { reply_markup: markup } : {}),
  });

// Пользователь по чату: привязка + карточка аккаунта
async function userOfChat(ns: KvNs, chatId: number): Promise<StoredUser | { email: string } | null> {
  const email = await ns.get(`tgrev:${chatId}`);
  if (!email) return null;
  return (await kvGetJson<StoredUser>(ns, `user:${email}`)) ?? { email };
}

const isStaff = (u: { role?: string }) => u.role !== "artist";

// ---------- конкурс инвайтинга ----------
// Личная инвайт-ссылка на канал ИЛИ на чат: кто по ней вступил — засчитан
// пригласившему. Раньше выдавалась ссылка только на канал, из-за чего все
// вступления в чат (а туда идёт основной трафик) в конкурсе не считались —
// теперь у каждого человека своя ссылка на оба входа, счёт общий.
// refown:<ссылка> → владелец; refscore:<chatId> → {n, name};
// reflinkof:<chatId>:<target> → ссылка (кэш, чтобы не плодить дубли в Telegram).
async function issueRefLink(
  ns: KvNs,
  chatId: number,
  name: string,
  target: "channel" | "chat",
): Promise<{ ok: true; link: string } | { ok: false; reason: string }> {
  const { COMMUNITY_KEY } = await import("../gtr/community");
  const cfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
  const targetChatId = target === "channel" ? cfg?.channelId : cfg?.chatId;
  if (!targetChatId)
    return { ok: false, reason: target === "channel" ? "Канал ещё не привязан" : "Чат ещё не привязан" };
  const cacheKey = `reflinkof:${chatId}:${target}`;
  const existing = await ns.get(cacheKey);
  if (existing) return { ok: true, link: existing };
  // миграция: раньше ссылка на канал кэшировалась без суффикса — у людей,
  // получивших её до этого фикса, не плодим дубль, просто переносим ключ
  if (target === "channel") {
    const legacy = await ns.get(`reflinkof:${chatId}`);
    if (legacy) {
      await ns.put(cacheKey, legacy);
      return { ok: true, link: legacy };
    }
  }
  const r = await tgApi<{ invite_link: string }>("createChatInviteLink", {
    chat_id: targetChatId,
    name: `ref ${name}`.slice(0, 32),
  });
  if (!r.ok || !r.result) return { ok: false, reason: r.description || "Telegram не выдал ссылку" };
  const link = r.result.invite_link;
  await ns.put(`refown:${link}`, JSON.stringify({ chat: chatId, name }));
  await ns.put(cacheKey, link);
  return { ok: true, link };
}

// Обе персональные ссылки разом — раньше выдавалась только на канал, и все
// вступления в чат (основной поток трафика) конкурсом не засчитывались.
async function issueRefLinks(
  ns: KvNs,
  chatId: number,
  name: string,
): Promise<{ channel?: string; chat?: string }> {
  const [rc, rg] = await Promise.all([
    issueRefLink(ns, chatId, name, "channel"),
    issueRefLink(ns, chatId, name, "chat"),
  ]);
  return { channel: rc.ok ? rc.link : undefined, chat: rg.ok ? rg.link : undefined };
}

async function refLeaderboard(ns: KvNs): Promise<string> {
  const keys = await kvListAll(ns, "refscore:");
  const rows: { n: number; name: string }[] = [];
  for (const k of keys) {
    const v = await kvGetJson<{ n: number; name: string }>(ns, k);
    if (v?.n) rows.push(v);
  }
  rows.sort((a, b) => b.n - a.n);
  if (!rows.length)
    return "Пока никто не приглашал. Возьми личную ссылку — /ref — и открой счёт!";
  const medal = ["🥇", "🥈", "🥉"];
  return [
    "🏆 <b>Топ инвайтеров GTR</b>",
    "",
    ...rows.slice(0, 10).map((r, i) => `${medal[i] ?? `${i + 1}.`} <b>${tgEsc(r.name)}</b> — ${r.n}`),
    "",
    "Личная ссылка: /ref",
  ].join("\n");
}

// Мои события (та же логика скоупа, что в приложении)
async function draftsFor(ns: KvNs, u: StoredUser | { email: string }) {
  const keys = await kvListAll(ns, "draft:");
  const drafts = (
    await Promise.all(keys.map((k) => kvGetJson<EventDraft>(ns, k)))
  ).filter((d): d is EventDraft => Boolean(d));
  const role = (u as StoredUser).role;
  const venueId = (u as StoredUser).venueId;
  return drafts
    .filter((d) =>
      role === "gtr" ? true : d.owner ? d.owner === u.email : Boolean(venueId) && d.venueId === venueId,
    )
    .sort((a, b) => b.updated - a.updated);
}

async function offersFor(ns: KvNs, email: string) {
  const keys = await kvListAll(ns, "offer:");
  const offers = (
    await Promise.all(keys.map((k) => kvGetJson<Offer>(ns, k)))
  ).filter((o): o is Offer => Boolean(o));
  return offers.sort((a, b) => b.ts - a.ts).filter((o) => o.to === email || o.from === email);
}

async function requestsFor(ns: KvNs, u: StoredUser | { email: string }) {
  const keys = await kvListAll(ns, "req:");
  const reqs = (
    await Promise.all(keys.map((k) => kvGetJson<OrgRequest>(ns, k)))
  ).filter((r): r is OrgRequest => Boolean(r));
  const role = (u as StoredUser).role;
  const venueId = (u as StoredUser).venueId;
  return reqs
    .sort((a, b) => b.ts - a.ts)
    .filter((r) =>
      role === "gtr" ? true : r.assignee === u.email || (Boolean(venueId) && r.venueId === venueId),
    );
}

// Постоянная клавиатура: кнопки вместо слэш-команд
const kbFor = (u: { role?: string }) => ({
  keyboard: isStaff(u)
    ? [
        [{ text: "📅 Мои события" }, { text: "📨 Заявки" }],
        [{ text: "🎧 Предложения" }, { text: "👥 Пригласить" }],
        [{ text: "🌐 Кабинет" }, { text: "ℹ️ Помощь" }],
      ]
    : [
        [{ text: "🎧 Предложения" }, { text: "🎟 Выступления" }],
        [{ text: "🔴 Я в эфире" }, { text: "⏹ Завершить эфир" }],
        [{ text: "🌐 Кабинет" }, { text: "ℹ️ Помощь" }],
      ],
  resize_keyboard: true,
  is_persistent: true,
});

// Кнопка-текст → команда
const BUTTON_CMDS: [RegExp, string][] = [
  [/^📅|^мои события/i, "/events"],
  [/^📨|^заявки/i, "/requests"],
  [/^🎧|^предложени/i, "/offers"],
  [/^🎟|^выступлени/i, "/gigs"],
  [/^👥|^пригласи/i, "/invite_form"],
  [/^отмена$/i, "/cancel"],
  [/^🔴|^я в эфире/i, "/live"],
  [/^⏹|^заверши/i, "/offair"],
  [/^🌐|^кабинет/i, "/cabinet"],
  [/^ℹ️|^ℹ|^помощь/i, "/help"],
];

const HELP_STAFF = [
  "<b>Команды GTR Event</b>",
  "/events — мои события и суммы смет",
  "/requests — заявки организаторов (взять/принять из чата)",
  "/offers — мои предложения артистам и их статусы",
  "👥 Пригласить — форма: имя + @ник, бот соберёт пост с постером",
  "/guest &lt;код события&gt; &lt;имя&gt; — спец-гость в список",
  "/status — кто я",
].join("\n");

const APP_HOST = "https://gtr-event-hub.gtr-event.workers.dev";
const POSTER_URL = `${APP_HOST}/brand/invite-poster.jpg`;

// Анкета приглашения в чате: шаг 1 — имя, шаг 2 — @ник
type InviteForm = { step: "name" | "nick"; name?: string };
const formKeyOf = (chatId: number) => `tgform:${chatId}`;

// Финал приглашения: создаёт аккаунт и отдаёт отправителю ГОТОВЫЙ пост —
// фирменный постер + личный призыв по нику + кнопка «Отправить». Один тап.
async function finishInvite(
  ns: KvNs,
  chatId: number,
  su: StoredUser,
  name: string,
  nick: string,
  email?: string,
) {
  const login =
    email || `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}@team.gtr.events`;
  if (await ns.get(`user:${login}`)) {
    await reply(chatId, `Аккаунт <b>${tgEsc(login)}</b> уже существует.`);
    return;
  }
  const pw = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  const teamOf = su.role === "organizer" ? su.email : "";
  const invited = {
    email: login,
    name,
    role: "organizer",
    roleLabel: "Организатор",
    venueId: "",
    artistId: "",
    teamOf,
    tgNick: nick,
    initials:
      name
        .split(/\s+/)
        .map((w) => w[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "ОР",
    passHash: await sha256hex(pw),
    created: Date.now(),
    invitedBy: su.email,
  };
  await ns.put(`user:${login}`, JSON.stringify(invited));
  const code = `tm-${Math.random().toString(36).slice(2, 10)}`;
  await ns.put(`tglink:${code}`, login);
  const welcome = [
    `🎟 <b>${tgEsc(name)}, добро пожаловать в GTR Event!</b>`,
    "",
    teamOf
      ? `Вы в команде организатора <b>${tgEsc(su.name ?? su.email)}</b> — его события уже у вас в кабинете. Ваш Telegram привязан, уведомления будут приходить сюда.`
      : "Ваш Telegram привязан, уведомления будут приходить сюда.",
    "",
    "<b>Вход в кабинет:</b>",
    `${APP_HOST}/gtr/login?invite=${encodeURIComponent(login)}`,
    `Логин: ${tgEsc(login)}`,
    `Пароль: ${tgEsc(pw)}`,
    "",
    "Команды бота: /events /offers /guest /help",
  ].join("\n");
  await ns.put(`invitemsg:${login}`, welcome);

  const bot = (await ns.get("tg:bot")) || "Gtrcom1_bot";
  const deep = `https://t.me/${bot}?start=${code}`;
  const who = nick ? `@${nick}` : tgEsc(name);
  const caption = [
    `🎟 <b>${who}, это личное приглашение</b>`,
    "",
    `<b>${tgEsc(su.name ?? su.email)}</b> зовёт вас в GTR EVENT — платформу событий Пхукета: <b>110 площадок · 312 артистов · события под ключ</b>.`,
    "",
    "Один шаг — нажмите Start:",
    deep,
  ].join("\n");
  const shareText = `${nick ? `@${nick}, ` : ""}личное приглашение в GTR EVENT от ${su.name ?? su.email}. 110 площадок · 312 артистов · события под ключ. Один шаг — нажмите Start: ${deep}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(POSTER_URL)}&text=${encodeURIComponent(shareText)}`;
  const rows: { text: string; url: string }[][] = [
    [{ text: nick ? `↗️ Отправить @${nick}` : "↗️ Отправить приглашение", url: shareUrl }],
  ];
  if (nick) rows.push([{ text: `💬 Открыть чат с @${nick}`, url: `https://t.me/${nick}` }]);
  const ph = await tgApi("sendPhoto", {
    chat_id: chatId,
    photo: POSTER_URL,
    caption,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
  if (!ph.ok) await reply(chatId, caption, { inline_keyboard: rows });
  await reply(
    chatId,
    `Пост готов ↑ Жмите кнопку — выберите чат — отправьте. Можно и просто переслать пост.\nАккаунт <b>${tgEsc(login)}</b> создан${teamOf ? ", человек в вашей команде" : ""}; доступы придут ему автоматически после Start.`,
  );

  // оповещение GTR-админам: кого добавили
  const userKeys = await kvListAll(ns, "user:");
  const allUsers = (
    await Promise.all(userKeys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((x): x is StoredUser => Boolean(x));
  const sent = new Set<string>();
  const noteText = [
    "<b>GTR EVENT · новый участник</b>",
    "",
    `<b>${tgEsc(su.name ?? su.email)}</b> пригласил(а): <b>${tgEsc(name)}</b>${nick ? ` (@${nick})` : ""}`,
    `Логин: ${tgEsc(login)}${teamOf ? ` · команда ${tgEsc(teamOf)}` : ""}`,
  ].join("\n");
  for (const a of allUsers.filter((x) => x.role === "gtr")) {
    const chat = await ns.get(`tg:${a.email}`);
    if (chat && chat !== String(chatId) && !sent.has(chat)) {
      sent.add(chat);
      await tgApi("sendMessage", { chat_id: chat, text: noteText, parse_mode: "HTML" });
    }
  }
  const channel = process.env.TELEGRAM_CHAT_ID;
  if (channel && channel !== String(chatId) && !sent.has(channel))
    await tgApi("sendMessage", { chat_id: channel, text: noteText, parse_mode: "HTML" });
}

const HELP_ARTIST = [
  "<b>Команды GTR Event</b>",
  "/offers — предложения выступить (принять/отклонить)",
  "/gigs — подтверждённые выступления",
  "/guest &lt;код события&gt; &lt;имя&gt; — спец-гость в список",
  "/status — кто я",
].join("\n");

export const Route = createFileRoute("/api/tg")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secret = request.headers.get("x-telegram-bot-api-secret-token");
        const ns = await getKvNs();
        // два валидных секрета: производная от секрета сессий (ставит
        // tgActivateFn) и операционный из KV (tg:hooksecret) — чтобы вебхук
        // можно было переустановить без входа в приложение
        const altSecret = ns ? await ns.get("tg:hooksecret") : null;
        if (secret !== (await tgWebhookSecret()) && (!altSecret || secret !== altSecret))
          return new Response("nope", { status: 401 });
        if (!ns) return Response.json({ ok: true });
        const up = (await request.json().catch(() => null)) as TgUpdate | null;
        if (!up) return Response.json({ ok: true });

        // ---------- /ops в закрытом канале: привязка служебного контура ----------
        if (up.channel_post?.text) {
          const cp = up.channel_post;
          const cmd0 = cp.text.trim().split(/[\s@]/)[0].toLowerCase();
          if (cmd0 === "/ops") {
            const { COMMUNITY_KEY, OPS_KEY } = await import("../gtr/community");
            const ccfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
            // публичные чаты комьюнити служебным контуром быть не могут
            if (String(cp.chat.id) === String(ccfg?.channelId ?? "∅") || String(cp.chat.id) === String(ccfg?.chatId ?? "∅")) {
              return Response.json({ ok: true, ops: "rejected-public" });
            }
            const me = await tgApi<{ id: number }>("getMe", {});
            const member = me.ok && me.result
              ? await tgApi<{ status: string }>("getChatMember", { chat_id: cp.chat.id, user_id: me.result.id })
              : { ok: false as const, result: undefined };
            const admin = Boolean(member.ok && member.result && ["administrator", "creator"].includes(member.result.status));
            if (!admin) return Response.json({ ok: true, ops: "not-admin" });
            await ns.put(OPS_KEY, JSON.stringify({ chatId: cp.chat.id, title: cp.chat.title || "", bound: Date.now() }));
            await tgApi("sendMessage", {
              chat_id: cp.chat.id,
              parse_mode: "HTML",
              text: "✅ <b>Служебный канал GTR OPS привязан.</b>\nСюда будут приходить метрики и технические уведомления. Публичный контент сюда не попадает, служебный — не попадает в комьюнити.",
            });
            return Response.json({ ok: true, ops: "bound" });
          }
          return Response.json({ ok: true });
        }

        // ---------- реестр групп бота: добавили/убрали из чата ----------
        // BOSS добавляет бота в свои группы — мы запоминаем чат и можем
        // вытащить его админов для коллабораций. Служебное — только BOSS-контур.
        if (up.my_chat_member) {
          const mm = up.my_chat_member;
          const nowIn = ["member", "administrator"].includes(mm.new_chat_member.status);
          const out = ["left", "kicked"].includes(mm.new_chat_member.status);
          if (["group", "supergroup", "channel"].includes(mm.chat.type)) {
            const { notifyBossTg } = await import("../gtr/kv-api");
            if (nowIn) {
              await ns.put(
                `knownchat:${mm.chat.id}`,
                JSON.stringify({
                  id: mm.chat.id,
                  title: mm.chat.title || "",
                  type: mm.chat.type,
                  username: mm.chat.username || "",
                  status: mm.new_chat_member.status,
                  by: mm.from?.username || mm.from?.first_name || "",
                  ts: Date.now(),
                }),
              );
              await notifyBossTg(
                ns,
                `🤝 Бот добавлен в «${tgEsc(mm.chat.title || String(mm.chat.id))}» (${mm.new_chat_member.status}). Чат в реестре коллабораций.`,
              ).catch(() => {});
            }
            if (out) await ns.delete(`knownchat:${mm.chat.id}`);
          }
          return Response.json({ ok: true });
        }

        // ---------- конкурс: вступление в канал ИЛИ чат по личной ссылке ----------
        if (up.chat_member) {
          const cm = up.chat_member;
          const was = ["left", "kicked"].includes(cm.old_chat_member.status);
          const now = ["member", "administrator"].includes(cm.new_chat_member.status);
          const link = cm.invite_link?.invite_link;
          const { COMMUNITY_KEY, bumpMetric } = await import("../gtr/community");
          const ccfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
          const isCh = ccfg?.channelId === cm.chat.id;
          const isGr = ccfg?.chatId === cm.chat.id;
          if (was && now && link) {
            const own = await kvGetJson<{ chat: number; name: string }>(ns, `refown:${link}`);
            // честный счёт: каждый реальный человек засчитывается ровно один
            // раз за всю историю (выход-вход не фармится), самоприглашение
            // по собственной ссылке не считается
            const joinedId = cm.new_chat_member.user.id;
            const creditedKey = `refcredited:${joinedId}`;
            if (own && own.chat !== joinedId && !(await ns.get(creditedKey))) {
              await ns.put(creditedKey, String(own.chat));
              const key = `refscore:${own.chat}`;
              const cur = (await kvGetJson<{ n: number; name: string }>(ns, key)) ?? {
                n: 0,
                name: own.name,
              };
              cur.n += 1;
              cur.name = own.name;
              await ns.put(key, JSON.stringify(cur));
              const joined = cm.new_chat_member.user.first_name || "друг";
              const where = isCh ? "канал" : isGr ? "чат" : "GTR";
              await reply(
                own.chat,
                `🎉 <b>${tgEsc(joined)}</b> вступил(а) в ${where} по твоей ссылке!\nТвой счёт: <b>${cur.n}</b> · таблица лидеров — /top`,
              );
            }
          }
          // метрики служебного контура: кто пришёл/ушёл в канале и чате
          {
            const left = !["left", "kicked"].includes(cm.old_chat_member.status) &&
              ["left", "kicked"].includes(cm.new_chat_member.status);
            // Поимённые «вступил/вышел» никуда не постим (решение BOSS):
            // метрики тихо копятся в mstat и выходят цифрами в сводке 17:00
            if ((isCh || isGr) && (was && now)) {
              await bumpMetric(ns, isCh ? "chJoin" : "gJoin").catch(() => {});
            }
            if ((isCh || isGr) && left) {
              await bumpMetric(ns, isCh ? "chLeave" : "gLeave").catch(() => {});
            }
          }

          // приветствие новичка в чате сообщества (не чаще раза в 3 минуты,
          // чтобы наплыв людей не превращался в стену приветствий)
          if (was && now && !cm.new_chat_member.user.id.toString().startsWith("-")) {
            if (isGr && !(await ns.get("greetlock"))) {
              await ns.put("greetlock", "1", { expirationTtl: 180 });
              const who = cm.new_chat_member.user.first_name || "друг";
              await tgApi("sendMessage", {
                chat_id: cm.chat.id,
                parse_mode: "HTML",
                text: [
                  `👋 <b>${tgEsc(who)}</b>, добро пожаловать в GTR! · welcome to GTR!`,
                  `Комнаты · Rooms: 🔥 Афиша · 🎵 Музыка · 🎉 Знакомства · 💡 Идеи`,
                  `🌴 /tonight — куда пойти сегодня · where to go tonight`,
                ].join("\n"),
                link_preview_options: { is_disabled: true },
              });
            }
          }
          return Response.json({ ok: true });
        }

        // ---------- сообщения ----------
        if (up.message?.text) {
          const chatId = up.message.chat.id;
          const text = up.message.text.trim();

          // Контур: в группах и каналах бот отвечает ТОЛЬКО на публичные
          // команды. Всё служебное (события, заявки, сметы, формы) — строго
          // в личке, чтобы техника не протекала к пользователям.
          if (chatId < 0) {
            const pub = text.split(/[\s@]/)[0].toLowerCase();
            // /ops — привязка закрытой группы как служебного контура:
            // публичные чаты комьюнити отклоняются, бот обязан быть админом
            if (pub === "/ops") {
              const { COMMUNITY_KEY, OPS_KEY } = await import("../gtr/community");
              const ccfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
              if (
                String(chatId) === String(ccfg?.channelId ?? "∅") ||
                String(chatId) === String(ccfg?.chatId ?? "∅")
              ) {
                return Response.json({ ok: true, ops: "rejected-public" });
              }
              const me = await tgApi<{ id: number }>("getMe", {});
              const member = me.ok && me.result
                ? await tgApi<{ status: string }>("getChatMember", { chat_id: chatId, user_id: me.result.id })
                : { ok: false as const, result: undefined };
              const admin = Boolean(
                member.ok && member.result && ["administrator", "creator"].includes(member.result.status),
              );
              if (!admin) {
                await reply(chatId, "Чтобы привязать служебный контур, сделайте бота админом этого чата и повторите /ops.");
                return Response.json({ ok: true, ops: "not-admin" });
              }
              await ns.put(OPS_KEY, JSON.stringify({ chatId, title: "", bound: Date.now() }));
              await reply(
                chatId,
                "✅ <b>Служебный контур GTR OPS привязан.</b>\nСюда будут приходить метрики и технические уведомления. Публичный контент сюда не попадает, служебный — не попадает в комьюнити.",
              );
              return Response.json({ ok: true, ops: "bound" });
            }
            if (!["/tonight", "/afisha", "/top"].includes(pub)) {
              return Response.json({ ok: true, scope: "public-only" });
            }
          }

          const start = text.match(/^\/start\s+(\S+)/);
          // deep-link конкурса: t.me/бот?start=ref — сразу выдаём личные ссылки
          if (start && start[1] === "ref") {
            const who = up.message.from?.first_name || up.message.from?.username || "участник";
            const links = await issueRefLinks(ns, chatId, who);
            const lines = [
              `🎁 <b>Ты в конкурсе GTR!</b>`,
              "",
              links.channel || links.chat
                ? "Зови друзей по кнопкам ниже — каждый вступивший засчитается тебе. Лидеры: /top"
                : "Ссылки пока не готовы — сообщество ещё настраивается.",
              `А афиша вечера всегда тут: /tonight`,
            ];
            const refButtons = [
              ...(links.channel ? [{ text: "📣 Моя ссылка на канал", url: links.channel }] : []),
              ...(links.chat ? [{ text: "💬 Моя ссылка на чат", url: links.chat }] : []),
            ].map((b) => [b]);
            await reply(chatId, lines.join("\n"), refButtons.length ? { inline_keyboard: refButtons } : undefined);
            return Response.json({ ok: true });
          }
          if (start) {
            const email = await ns.get(`tglink:${start[1]}`);
            if (!email) {
              await reply(chatId, "Код привязки не найден или устарел. Возьмите свежую ссылку в кабинете GTR Event.");
              return Response.json({ ok: true });
            }
            await ns.put(`tg:${email}`, String(chatId));
            await ns.put(`tgrev:${chatId}`, email);
            await ns.delete(`tglink:${start[1]}`);
            // конкурс-мостик: первый привязанный аккаунт = +3 балла (один раз
            // на человека и на email — команда и повторные привязки не фармят)
            let bonusLine = "";
            if (!(await ns.get(`regbonus:${chatId}`)) && !(await ns.get(`regbonus:e:${email}`))) {
              await ns.put(`regbonus:${chatId}`, "1");
              await ns.put(`regbonus:e:${email}`, "1");
              const who = up.message.from?.first_name || up.message.from?.username || "участник";
              const key = `refscore:${chatId}`;
              const cur = (await kvGetJson<{ n: number; name: string }>(ns, key)) ?? { n: 0, name: who };
              cur.n += 3;
              cur.name = cur.name || who;
              await ns.put(key, JSON.stringify(cur));
              bonusLine = `\n\n🏆 <b>+3 балла в конкурсе за аккаунт GTR!</b> Твой счёт: ${cur.n} · лидеры: /top`;
            }
            // персональное приглашение (инструкция с доступами) — один раз
            const linkedUser = await kvGetJson<StoredUser>(ns, `user:${email}`);
            const kb = linkedUser ? kbFor(linkedUser) : undefined;
            const welcome = await ns.get(`invitemsg:${email}`);
            if (welcome) {
              await ns.delete(`invitemsg:${email}`);
              await reply(chatId, welcome + bonusLine, kb);
            } else {
              await reply(
                chatId,
                `✅ Telegram привязан к аккаунту <b>${tgEsc(email)}</b>.\nКнопки внизу — вся работа в один тап.${bonusLine}`,
                kb,
              );
            }
            return Response.json({ ok: true });
          }

          const guest = text.match(/^\/guest\s+(\S+)\s+(.+)/);
          if (guest) {
            const email = await ns.get(`tgrev:${chatId}`);
            if (!email) {
              await reply(chatId, "Сначала привяжите аккаунт: ссылка «Привязать Telegram» в кабинете.");
              return Response.json({ ok: true });
            }
            const draftId = guest[1];
            const name = guest[2].trim().slice(0, 80);
            const draft = await kvGetJson<EventDraft>(ns, `draft:${draftId}`);
            if (!draft) {
              await reply(chatId, `Событие <b>${tgEsc(draftId)}</b> не найдено. Код события — в шапке конструктора.`);
              return Response.json({ ok: true });
            }
            draft.guestList = [
              ...(draft.guestList ?? []),
              { name, by: email, via: "tg", ts: Date.now() },
            ];
            draft.updated = Date.now();
            await ns.put(`draft:${draft.id}`, JSON.stringify(draft));
            await reply(
              chatId,
              `🎟 <b>${tgEsc(name)}</b> добавлен(а) в спец-гости события ${tgEsc(draftId)}. Всего в списке: ${draft.guestList.length}.`,
            );
            return Response.json({ ok: true });
          }

          let cmd = text.split(/[\s@]/)[0].toLowerCase();
          if (!cmd.startsWith("/")) {
            const hit = BUTTON_CMDS.find(([re]) => re.test(text.trim()));
            if (hit) cmd = hit[1];
          }

          // /tonight работает везде — и в личке, и в группе комьюнити,
          // без привязки аккаунта: это витрина, а не кабинет
          if (cmd === "/tonight" || cmd === "/afisha") {
            const { APP_URL, buildDigestText, tgLangOf } = await import("../gtr/community");
            await reply(chatId, await buildDigestText(ns, tgLangOf(up.message.from?.language_code)), {
              inline_keyboard: [[{ text: "🎟 Открыть в приложении", url: `${APP_URL}/gtr/tonight` }]],
            });
            return Response.json({ ok: true });
          }

          // конкурс инвайтинга: личные ссылки (канал + чат) и таблица лидеров
          if (cmd === "/ref") {
            const { tgLangOf } = await import("../gtr/community");
            const lng = tgLangOf(up.message.from?.language_code);
            const who = up.message.from?.first_name || up.message.from?.username || "участник";
            const links = await issueRefLinks(ns, chatId, who);
            const REF_T = {
              ru: { h: "🎁 <b>Твои личные ссылки GTR Live:</b>", ch: "📣 Моя ссылка на канал", gr: "💬 Моя ссылка на чат", f: "Зови друзей по кнопкам ниже — каждый, кто вступит, засчитается тебе.", top: "Счёт и лидеры: /top", none: "Ссылки пока не готовы — сообщество ещё настраивается." },
              en: { h: "🎁 <b>Your personal GTR Live links:</b>", ch: "📣 My channel link", gr: "💬 My chat link", f: "Share the buttons below — everyone who joins counts for you.", top: "Score & leaderboard: /top", none: "Links aren't ready yet — community setup in progress." },
              th: { h: "🎁 <b>ลิงก์ส่วนตัวของคุณ:</b>", ch: "📣 ลิงก์ช่องของฉัน", gr: "💬 ลิงก์แชทของฉัน", f: "แชร์ปุ่มด้านล่างให้เพื่อน — ทุกคนที่เข้าร่วมนับเป็นคะแนนของคุณ", top: "คะแนนและอันดับ: /top", none: "ลิงก์ยังไม่พร้อม — กำลังตั้งค่าคอมมูนิตี้" },
            } as const;
            const T = REF_T[lng];
            const lines = [T.h, "", links.channel || links.chat ? T.f : T.none, T.top];
            const refButtons = [
              ...(links.channel ? [{ text: T.ch, url: links.channel }] : []),
              ...(links.chat ? [{ text: T.gr, url: links.chat }] : []),
            ].map((b) => [b]);
            await reply(chatId, lines.join("\n"), refButtons.length ? { inline_keyboard: refButtons } : undefined);
            return Response.json({ ok: true });
          }
          if (cmd === "/top") {
            await reply(chatId, await refLeaderboard(ns));
            return Response.json({ ok: true });
          }

          const u = await userOfChat(ns, chatId);

          if (cmd === "/start" || cmd === "/menu") {
            if (u) {
              await reply(
                chatId,
                `Аккаунт: <b>${tgEsc(u.email)}</b>. Кнопки внизу — вся работа в один тап.`,
                kbFor(u as StoredUser),
              );
            } else {
              const { APP_URL } = await import("../gtr/community");
              await tgApi("sendMessage", {
                chat_id: chatId,
                parse_mode: "HTML",
                text: [
                  "⚡ <b>GTR Event — вся ночная жизнь Пхукета</b>",
                  "",
                  "🎟 Афиша 110 клубов на сегодня · 🎧 312 артистов · 🍾 бронь столов",
                  "",
                  "🏆 Создай аккаунт за 30 секунд и привяжи Telegram — <b>+3 балла в конкурсе</b> (призы 1 сентября!)",
                ].join("\n"),
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🚀 Создать аккаунт", url: `${APP_URL}/gtr/signup` }],
                    [{ text: "🌴 Куда пойти сегодня", url: `${APP_URL}/gtr/tonight` }],
                  ],
                },
              });
            }
            return Response.json({ ok: true });
          }
          if (!u) {
            const { APP_URL } = await import("../gtr/community");
            await reply(
              chatId,
              `Сначала привяжите аккаунт: «Привязать Telegram» в кабинете GTR Event.\nНет аккаунта? Регистрация за 30 секунд — +3 балла в конкурсе.`,
              { inline_keyboard: [[{ text: "🚀 Создать аккаунт", url: `${APP_URL}/gtr/signup` }]] },
            );
            return Response.json({ ok: true });
          }
          const su = u as StoredUser;

          // ---------- анкета приглашения (имя → @ник) ----------
          const formKey = formKeyOf(chatId);
          const formRaw = await ns.get(formKey);

          if (cmd === "/cancel") {
            await ns.delete(formKey);
            await reply(chatId, "Ок, отменил.", kbFor(su));
            return Response.json({ ok: true });
          }

          if (cmd === "/invite_form" || cmd === "/invite_hint") {
            if (!isStaff(su)) {
              await reply(chatId, "Приглашения доступны команде GTR и организаторам.");
              return Response.json({ ok: true });
            }
            await ns.put(formKey, JSON.stringify({ step: "name" } satisfies InviteForm), {
              expirationTtl: 1800,
            });
            await reply(
              chatId,
              "👥 <b>Приглашение в GTR Event</b>\n\nШаг 1 из 2 — напишите <b>имя и фамилию</b> человека.\n\n/cancel — отменить",
            );
            return Response.json({ ok: true });
          }

          if (formRaw && cmd.startsWith("/")) await ns.delete(formKey);
          if (formRaw && !cmd.startsWith("/") && isStaff(su)) {
            const form = JSON.parse(formRaw) as InviteForm;
            if (form.step === "name") {
              const nm = text.replace(/\s+/g, " ").trim().slice(0, 60);
              if (nm.length < 2 || nm.includes("@")) {
                await reply(chatId, "Напишите имя и фамилию текстом, например: <b>Анна Ким</b>. /cancel — отменить");
                return Response.json({ ok: true });
              }
              await ns.put(formKey, JSON.stringify({ step: "nick", name: nm } satisfies InviteForm), {
                expirationTtl: 1800,
              });
              await reply(
                chatId,
                `Шаг 2 из 2 — <b>@ник в Telegram</b> для ${tgEsc(nm)} (например <code>@skabi4evsky</code>).\nЕсли ника нет — напишите «нет».`,
              );
              return Response.json({ ok: true });
            }
            const raw = text.trim();
            let nick = "";
            if (!/^(нет|не[тту]?|no|-)$/i.test(raw)) {
              const mNick = raw.match(/^@?([A-Za-z0-9_]{5,32})$/);
              if (!mNick) {
                await reply(
                  chatId,
                  "Ник выглядит как <b>@имя</b> латиницей (5–32 символа). Попробуйте ещё раз или напишите «нет». /cancel — отменить",
                );
                return Response.json({ ok: true });
              }
              nick = mNick[1];
            }
            await ns.delete(formKey);
            await finishInvite(ns, chatId, su, form.name ?? "Гость", nick);
            return Response.json({ ok: true });
          }

          if (cmd === "/help") {
            await reply(chatId, isStaff(su) ? HELP_STAFF : HELP_ARTIST, kbFor(su));
            return Response.json({ ok: true });
          }

          if (cmd === "/cabinet") {
            await reply(chatId, "Ваш кабинет GTR Event:", {
              inline_keyboard: [
                [
                  {
                    text: "🌐 Открыть кабинет",
                    url: `https://gtr-event-hub.gtr-event.workers.dev/gtr/login?invite=${encodeURIComponent(su.email)}`,
                  },
                ],
              ],
            });
            return Response.json({ ok: true });
          }

          if (cmd === "/status") {
            await reply(
              chatId,
              [
                `<b>${tgEsc(su.name ?? su.email)}</b>`,
                `Роль: ${tgEsc(su.roleLabel ?? "—")}`,
                `Email: ${tgEsc(su.email)}`,
                su.venueId ? `Площадка: ${tgEsc(su.venueId)}` : "",
                su.artistId ? `Карточка артиста: ${tgEsc(su.artistId)}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            );
            return Response.json({ ok: true });
          }

          if (cmd === "/events" && isStaff(su)) {
            const drafts = (await draftsFor(ns, su)).slice(0, 6);
            if (!drafts.length) {
              await reply(chatId, "Событий пока нет — создайте в приложении: «События» → «+ Новое событие».");
              return Response.json({ ok: true });
            }
            const lines = drafts.map((d) => {
              const q = computeQuote(d.graph, d.venueId);
              const st = STAGE_LABEL[d.graph.stage ?? "draft"];
              return `▪️ <b>${tgEsc(draftTitle(d))}</b> · ${tgEsc(d.id)}\n${tgEsc(d.date || "дата не выбрана")} · ${tgEsc(st)} · ${q.total ? tgEsc(fmtThb(q.total)) : "смета пуста"}`;
            });
            await reply(chatId, `<b>Мои события</b>\n\n${lines.join("\n\n")}`);
            return Response.json({ ok: true });
          }

          if (cmd === "/requests" && isStaff(su)) {
            const reqs = (await requestsFor(ns, su)).filter((r) => r.status !== "declined").slice(0, 5);
            if (!reqs.length) {
              await reply(chatId, "Открытых заявок нет.");
              return Response.json({ ok: true });
            }
            for (const r of reqs) {
              const head = [
                `▪️ <b>${tgEsc(r.title || "Заявка")}</b> · ${tgEsc(r.venueName)}`,
                `${tgEsc(r.date || "дата не указана")} · ${tgEsc(r.guests || "—")} гостей · ${tgEsc(fmtThb(r.quoteTotal))}`,
                r.assignee ? `ведёт: ${tgEsc(r.assigneeName || r.assignee)}` : "не назначена",
              ].join("\n");
              const buttons: { text: string; callback_data: string }[] = [];
              if (!r.assignee) buttons.push({ text: "Взять на себя", callback_data: `req:${r.id}:take` });
              if (r.status !== "accepted") {
                buttons.push({ text: "✅ Принять", callback_data: `req:${r.id}:acc` });
                buttons.push({ text: "❌ Отклонить", callback_data: `req:${r.id}:dec` });
              }
              await reply(chatId, head, buttons.length ? { inline_keyboard: [buttons] } : undefined);
            }
            return Response.json({ ok: true });
          }

          if (cmd === "/offers") {
            const offers = (await offersFor(ns, su.email)).slice(0, 6);
            if (!offers.length) {
              await reply(chatId, "Предложений нет.");
              return Response.json({ ok: true });
            }
            for (const o of offers) {
              const mineToDecide = o.to === su.email && o.status === "sent";
              const head = [
                `▪️ <b>${tgEsc(o.artistName)}</b> · ${tgEsc(o.venueName)}`,
                `${tgEsc(o.date || "дата уточняется")}${o.fee ? ` · ${tgEsc(o.fee)}` : ""}`,
                `статус: ${tgEsc(OFFER_LABEL[o.status])}`,
              ].join("\n");
              await reply(
                chatId,
                head,
                mineToDecide
                  ? {
                      inline_keyboard: [
                        [
                          { text: "✅ Принять", callback_data: `offer:${o.id}:acc` },
                          { text: "❌ Отклонить", callback_data: `offer:${o.id}:dec` },
                        ],
                      ],
                    }
                  : undefined,
              );
            }
            return Response.json({ ok: true });
          }

          // ---------- «я в эфире»: зелёная кнопка у артиста в каталоге ----------
          if (cmd === "/live" || cmd === "/offair") {
            if (!su.artistId) {
              await reply(chatId, "Эта команда для артистов: к вашему аккаунту не привязана карточка каталога.");
              return Response.json({ ok: true });
            }
            const key = `live:ig:${su.artistId}`;
            if (cmd === "/offair") {
              await ns.delete(key);
              await reply(chatId, "⏹ Эфир завершён — индикатор в каталоге погашен.");
              return Response.json({ ok: true });
            }
            const url = (text.match(/https?:\/\/\S+/) || [])[0] || "";
            await ns.put(
              key,
              JSON.stringify({ url, until: Date.now() + 4 * 3600 * 1000 }),
              { expirationTtl: 4 * 3600 },
            );
            await reply(
              chatId,
              `🔴 <b>Вы в эфире!</b> Кнопка в каталоге стала зелёной${url ? " и ведёт на вашу ссылку" : " и ведёт на ваш Instagram"}.\nАвтоотключение через 4 часа, раньше — «⏹ Завершить эфир».\nСо ссылкой: <code>/live https://instagram.com/…</code>`,
            );
            return Response.json({ ok: true });
          }

          if (cmd === "/gigs") {
            const gigs = (await offersFor(ns, su.email)).filter(
              (o) => o.to === su.email && o.status === "accepted",
            );
            await reply(
              chatId,
              gigs.length
                ? `<b>Подтверждённые выступления</b>\n\n` +
                    gigs
                      .map((o) => `▪️ ${tgEsc(o.venueName)} · ${tgEsc(o.date || "дата уточняется")}${o.fee ? ` · ${tgEsc(o.fee)}` : ""}`)
                      .join("\n")
                : "Подтверждённых выступлений пока нет.",
            );
            return Response.json({ ok: true });
          }

          const inv = text.match(/^\/invite\s+(.+)/i);
          if (inv && isStaff(su)) {
            const tokens = inv[1].trim().split(/\s+/);
            const nickTok = tokens.find((t) => /^@[A-Za-z0-9_]{5,32}$/.test(t));
            const emailTok = tokens.find((t) => t !== nickTok && t.includes("@"));
            const name = tokens.filter((t) => t !== nickTok && t !== emailTok).join(" ").trim();
            if (!name) {
              await reply(
                chatId,
                "Формат: /invite Имя Фамилия [@ник] [email]\nНапример: <code>/invite Анна Ким @anna_kim</code>\nИли просто нажмите «👥 Пригласить» — бот спросит по шагам.",
              );
              return Response.json({ ok: true });
            }
            await finishInvite(ns, chatId, su, name, nickTok ? nickTok.slice(1) : "", emailTok?.toLowerCase());
            return Response.json({ ok: true });
          }

          await reply(chatId, isStaff(su) ? HELP_STAFF : HELP_ARTIST);
          return Response.json({ ok: true });
        }

        // ---------- кнопки: заявки организаторов ----------
        if (up.callback_query) {
          const cqr = up.callback_query;
          if (cqr.message && cqr.message.chat.id < 0) {
            await tgApi("answerCallbackQuery", { callback_query_id: cqr.id, text: "Только в личке бота" });
            return Response.json({ ok: true, scope: "public-only" });
          }

          // решение по заявке на роль: только BOSS
          const ma = (cqr.data || "").match(/^(apr|rej):(\S+)$/);
          if (ma && cqr.message) {
            const u = await userOfChat(ns, cqr.message.chat.id);
            const su = u as StoredUser | null;
            if (!su || su.role !== "gtr" || !su.boss) {
              await tgApi("answerCallbackQuery", { callback_query_id: cqr.id, text: "Только BOSS" });
              return Response.json({ ok: true });
            }
            const email = await ns.get(`pcode:${ma[2]}`);
            const { decidePendingCore } = await import("../gtr/kv-api");
            const r = email
              ? await decidePendingCore(ns, email, ma[1] === "apr")
              : { ok: false, note: "Заявка не найдена (уже решена?)" };
            await tgApi("answerCallbackQuery", { callback_query_id: cqr.id, text: r.ok ? "Готово" : r.note });
            await tgApi("editMessageText", {
              chat_id: cqr.message.chat.id,
              message_id: cqr.message.message_id,
              parse_mode: "HTML",
              text: `${cqr.message.text ? tgEsc(cqr.message.text) + "\n\n" : ""}<b>${tgEsc(r.note)}</b>`,
            });
            return Response.json({ ok: true });
          }

          const mr = (cqr.data || "").match(/^req:(\S+):(take|acc|dec)$/);
          if (mr && cqr.message) {
            const chatId = cqr.message.chat.id;
            const u = await userOfChat(ns, chatId);
            const req = await kvGetJson<OrgRequest>(ns, `req:${mr[1]}`);
            if (!u || !req || !isStaff(u as StoredUser)) {
              await tgApi("answerCallbackQuery", { callback_query_id: cqr.id, text: "Недоступно" });
              return Response.json({ ok: true });
            }
            const su = u as StoredUser;
            let note = "";
            if (mr[2] === "take") {
              req.assignee = su.email;
              req.assigneeName = su.name ?? su.email;
              if (req.status === "new") req.status = "seen";
              note = "Заявка на вас";
            } else if (mr[2] === "acc") {
              req.status = "accepted";
              note = "Принята";
              const draft = req.draftId ? await kvGetJson<EventDraft>(ns, `draft:${req.draftId}`) : null;
              if (draft) {
                draft.graph.stage = "approved";
                draft.updated = Date.now();
                await ns.put(`draft:${draft.id}`, JSON.stringify(draft));
              }
            } else {
              req.status = "declined";
              note = "Отклонена";
            }
            await ns.put(`req:${req.id}`, JSON.stringify(req));
            await tgApi("answerCallbackQuery", { callback_query_id: cqr.id, text: note });
            await tgApi("editMessageText", {
              chat_id: chatId,
              message_id: cqr.message.message_id,
              text: `${cqr.message.text ?? "Заявка"}\n\n➡️ ${note.toUpperCase()} · ${su.name ?? su.email}`,
            });
            return Response.json({ ok: true });
          }
        }

        // ---------- кнопки под предложением ----------
        if (up.callback_query) {
          const cq = up.callback_query;
          const m = (cq.data || "").match(/^offer:(\S+):(acc|dec)$/);
          if (m && cq.message) {
            const chatId = cq.message.chat.id;
            const email = await ns.get(`tgrev:${chatId}`);
            const offer = await kvGetJson<Offer>(ns, `offer:${m[1]}`);
            if (!offer || !email || offer.to !== email) {
              await tgApi("answerCallbackQuery", { callback_query_id: cq.id, text: "Это предложение адресовано не вам" });
              return Response.json({ ok: true });
            }
            if (offer.status !== "sent") {
              await tgApi("answerCallbackQuery", { callback_query_id: cq.id, text: "Решение уже принято" });
              return Response.json({ ok: true });
            }
            const accept = m[2] === "acc";
            await decideOfferCore(ns, offer, accept, "Решение в Telegram");
            await tgApi("answerCallbackQuery", {
              callback_query_id: cq.id,
              text: accept ? "Принято ✅" : "Отклонено ❌",
            });
            await tgApi("editMessageText", {
              chat_id: chatId,
              message_id: cq.message.message_id,
              text: `${cq.message.text ?? "Предложение"}\n\n${accept ? "✅ ПРИНЯТО" : "❌ ОТКЛОНЕНО"}`,
            });
          }
          return Response.json({ ok: true });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
