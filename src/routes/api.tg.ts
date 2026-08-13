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

type TgUpdate = {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number; text?: string };
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

const HELP_STAFF = [
  "<b>Команды GTR Event</b>",
  "/events — мои события и суммы смет",
  "/requests — заявки организаторов (взять/принять из чата)",
  "/offers — мои предложения артистам и их статусы",
  "/guest &lt;код события&gt; &lt;имя&gt; — спец-гость в список",
  "/status — кто я",
].join("\n");

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
        if (secret !== (await tgWebhookSecret())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: true });
        const up = (await request.json().catch(() => null)) as TgUpdate | null;
        if (!up) return Response.json({ ok: true });

        // ---------- сообщения ----------
        if (up.message?.text) {
          const chatId = up.message.chat.id;
          const text = up.message.text.trim();

          const start = text.match(/^\/start\s+(\S+)/);
          if (start) {
            const email = await ns.get(`tglink:${start[1]}`);
            if (!email) {
              await reply(chatId, "Код привязки не найден или устарел. Возьмите свежую ссылку в кабинете GTR Event.");
              return Response.json({ ok: true });
            }
            await ns.put(`tg:${email}`, String(chatId));
            await ns.put(`tgrev:${chatId}`, email);
            await ns.delete(`tglink:${start[1]}`);
            // персональное приглашение (инструкция с доступами) — один раз
            const welcome = await ns.get(`invitemsg:${email}`);
            if (welcome) {
              await ns.delete(`invitemsg:${email}`);
              await reply(chatId, welcome);
            } else {
              await reply(
                chatId,
                `✅ Telegram привязан к аккаунту <b>${tgEsc(email)}</b>.\nСюда будут приходить предложения и заявки. Команды: /help`,
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

          const cmd = text.split(/[\s@]/)[0].toLowerCase();
          const u = await userOfChat(ns, chatId);

          if (cmd === "/start") {
            await reply(
              chatId,
              u
                ? `Аккаунт уже привязан: <b>${tgEsc(u.email)}</b>. Команды — /help`
                : "Это бот GTR Event. Привяжите аккаунт: кнопка «Привязать Telegram» в кабинете → ссылка со стартовым кодом.",
            );
            return Response.json({ ok: true });
          }
          if (!u) {
            await reply(chatId, "Сначала привяжите аккаунт: «Привязать Telegram» в кабинете GTR Event.");
            return Response.json({ ok: true });
          }
          const su = u as StoredUser;

          if (cmd === "/help") {
            await reply(chatId, isStaff(su) ? HELP_STAFF : HELP_ARTIST);
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

          await reply(chatId, isStaff(su) ? HELP_STAFF : HELP_ARTIST);
          return Response.json({ ok: true });
        }

        // ---------- кнопки: заявки организаторов ----------
        if (up.callback_query) {
          const cqr = up.callback_query;
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
