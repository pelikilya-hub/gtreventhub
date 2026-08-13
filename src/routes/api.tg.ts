// Вебхук Telegram-бота GTR Event. Сюда приходят:
//  - /start <код>  — привязка Telegram к аккаунту (код выдаёт кабинет)
//  - кнопки «Принять/Отклонить» под предложением артисту
//  - /guest <EV-…> <имя> — спец-гость в гостевой список события
// Подлинность запроса проверяется секретом вебхука в заголовке.
import { createFileRoute } from "@tanstack/react-router";

import type { EventDraft, Offer } from "../gtr/data/app-data";
import { decideOfferCore } from "../gtr/kv-api";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
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

const reply = (chatId: number, text: string) =>
  tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });

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
            await reply(
              chatId,
              `✅ Telegram привязан к аккаунту <b>${tgEsc(email)}</b>.\nСюда будут приходить предложения и заявки. Команды: /guest &lt;код события&gt; &lt;имя&gt; — добавить спец-гостя.`,
            );
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

          if (/^\/start/.test(text)) {
            await reply(chatId, "Это бот GTR Event. Привяжите аккаунт по ссылке из кабинета — и предложения будут приходить сюда.");
          }
          return Response.json({ ok: true });
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
