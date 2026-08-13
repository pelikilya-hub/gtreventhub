// Серверный слой GTR Event поверх Workers KV: аккаунты менеджеров и общая
// база событий/заявок. Пока биндинга нет (vite-dev), функции возвращают
// null/недоступно — клиент продолжает работать на localStorage.
import { createServerFn } from "@tanstack/react-start";
import { currentUser, type SessionUser, type StoredUser } from "./auth";
import type { EventDraft, Offer, OrgRequest, RoleId } from "./data/app-data";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "./kv-ns";
import { tgApi, tgConfigured, tgEsc, tgWebhookSecret } from "./tg";

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
  u.role === "gtr" || (d.owner ? d.owner === u.email : d.venueId === u.venueId);

const canSeeRequest = (u: SessionUser, r: OrgRequest) =>
  u.role === "gtr" || r.venueId === u.venueId || r.assignee === u.email;

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

  const [draftKeys, reqKeys] = await Promise.all([
    kvListAll(ns, "draft:"),
    kvListAll(ns, "req:"),
  ]);
  const [drafts, requests] = await Promise.all([
    Promise.all(draftKeys.map((k) => kvGetJson<EventDraft>(ns, k))),
    Promise.all(reqKeys.map((k) => kvGetJson<OrgRequest>(ns, k))),
  ]);
  return {
    drafts: drafts.filter((d): d is EventDraft => Boolean(d)).filter((d) => canSeeDraft(u, d)),
    requests: requests
      .filter((r): r is OrgRequest => Boolean(r))
      .filter((r) => canSeeRequest(u, r)),
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

    // уведомление: личный чат артиста с кнопками, иначе общий канал GTR
    const text = [
      `<b>GTR EVENT · предложение выступить</b>`,
      "",
      `<b>Артист:</b> ${tgEsc(offer.artistName)}`,
      `<b>Площадка:</b> ${tgEsc(offer.venueName)}`,
      offer.date ? `<b>Когда:</b> ${tgEsc(offer.date)}` : "",
      offer.fee ? `<b>Условия:</b> ${tgEsc(offer.fee)}` : "",
      offer.note ? `<b>Комментарий:</b> ${tgEsc(offer.note)}` : "",
      "",
      `<i>От: ${tgEsc(offer.fromName)}</i>`,
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
              { text: "✅ Принять", callback_data: `offer:${offer.id}:acc` },
              { text: "❌ Отклонить", callback_data: `offer:${offer.id}:dec` },
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
