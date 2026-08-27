// Ежедневный дайджест вечера в Telegram-канал GTR: cron-обёртка дёргает
// этот роут в 10:00 UTC (17:00 Пхукета) — люди успевают собраться.
// Тот же ключ, что у афиш, позволяет ручной запуск.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { tgApi } from "../gtr/tg";

/** Влезает ли текст в подпись к фото. Предел Telegram — 1024 знака
 *  РАЗМЕЧЕННОГО текста: теги в счёт не идут, они уезжают отдельными
 *  сущностями. Считать по сырой строке — значит отправлять картинку
 *  отдельно там, где подпись прекрасно помещалась. */
const captionFits = (html: string) => html.replace(/<[^>]+>/g, "").length <= 1024;

export const Route = createFileRoute("/api/community-digest")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") ||
          new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });
        const { APP_URL, COMMUNITY_KEY, buildDigest } = await import("../gtr/community");
        const cfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
        if (!cfg?.channelId) return Response.json({ ok: false, reason: "канал не привязан" });
        // mode=ops — только служебная сводка, без публичного дайджеста
        // (ручной запуск и проверка контура метрик)
        const opsOnly = new URL(request.url).searchParams.get("mode") === "ops";
        let res: { ok: boolean; description?: string } = { ok: true };
        if (!opsOnly) {
          const { text, photos } = await buildDigest(ns);
          // Тот же вечер уходит в Threads, если он подключён. Отдельным
          // текстом: там нет разметки и жёсткий лимит в 500 знаков, а
          // молчаливый обрез посреди лайнапа выглядит как поломка.
          try {
            const { threadsCfg, threadsPost, threadsDigest } = await import("../gtr/threads");
            const tcfg = await threadsCfg(ns);
            if (tcfg) {
              const short = threadsDigest(text.split("\n"), APP_URL);
              const tr = await threadsPost(tcfg, short);
              if (!tr.ok) {
                const { notifyBossTg } = await import("../gtr/kv-api");
                await notifyBossTg(ns, `⚠️ Threads не принял дайджест: ${tr.reason}`).catch(() => {});
              }
            }
          } catch {
            // Threads — дополнительный канал: его сбой не должен ронять
            // публикацию в Telegram, ради которой крон и запускается.
          }
          const markup = {
            inline_keyboard: [[{ text: "🎫 Открыть GTR Event", url: `${APP_URL}/gtr/tonight` }]],
          };
          // Афиши вперёд, текст следом. Порядок важен: в ленте канала
          // сначала видно вечер, а потом читают, где он.
          //
          // Альбом Telegram не принимает подпись с кнопками и требует от
          // двух элементов, поэтому веток три. Падение альбома не должно
          // уносить дайджест — ради него крон и запускается.
          if (photos.length >= 2) {
            await tgApi("sendMediaGroup", {
              chat_id: cfg.channelId,
              media: photos.slice(0, 10).map((u) => ({ type: "photo", media: u })),
            });
            res = await tgApi("sendMessage", {
              chat_id: cfg.channelId,
              text,
              parse_mode: "HTML",
              reply_markup: markup,
              link_preview_options: { is_disabled: true },
            });
          } else if (photos.length === 1 && captionFits(text)) {
            res = await tgApi("sendPhoto", {
              chat_id: cfg.channelId,
              photo: photos[0],
              caption: text,
              parse_mode: "HTML",
              reply_markup: markup,
            });
          } else {
            if (photos.length === 1)
              await tgApi("sendPhoto", { chat_id: cfg.channelId, photo: photos[0] });
            res = await tgApi("sendMessage", {
              chat_id: cfg.channelId,
              text,
              parse_mode: "HTML",
              reply_markup: markup,
              link_preview_options: photos.length
                ? { is_disabled: true }
                : { url: APP_URL, prefer_large_media: true },
            });
          }

          // Опрос по средам и пятницам: в среду люди планируют выходные,
          // в пятницу выбирают вечер. Каждый день — навязчиво, раз в неделю
          // — забывается. Варианты по возможности из живой афиши, поэтому
          // опрос заодно работает витриной программы.
          const { buildPoll, bkkDayNo, bkkWeekday } = await import("../gtr/community");
          if ([3, 5].includes(bkkWeekday())) {
            const poll = await buildPoll(ns, bkkDayNo());
            if (poll.options.length >= 2)
              await tgApi("sendPoll", {
                chat_id: cfg.channelId,
                question: poll.question,
                // HTML нужен ровно затем, чтобы обычный знак в начале
                // вопроса стал фирменным (см. brandEmojify в tg.ts)
                question_parse_mode: "HTML",
                options: poll.options,
                is_anonymous: true,
                allows_multiple_answers: Boolean(poll.multiple),
              });
            // Отказ опроса не роняет ничего: tgApi не бросает, а возвращает
            // ok:false — дайджест к этому моменту уже опубликован.
          }
        }
        // служебный контур: ежедневная сводка метрик — команде, не в паблик
        const { buildOpsSummary } = await import("../gtr/community");
        const { notifyBossTg } = await import("../gtr/kv-api");
        await notifyBossTg(ns, await buildOpsSummary(ns)).catch(() => {});
        return Response.json({ ok: res.ok, reason: res.description ?? "" });
      },
    },
  },
});
