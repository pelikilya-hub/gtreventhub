// Ежедневный дайджест вечера в Telegram-канал GTR: cron-обёртка дёргает
// этот роут в 10:00 UTC (17:00 Пхукета) — люди успевают собраться.
// Тот же ключ, что у афиш, позволяет ручной запуск.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { tgApi } from "../gtr/tg";

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
        const { APP_URL, COMMUNITY_KEY, buildDigestText } = await import("../gtr/community");
        const cfg = await kvGetJson<import("../gtr/community").CommunityCfg>(ns, COMMUNITY_KEY);
        if (!cfg?.channelId) return Response.json({ ok: false, reason: "канал не привязан" });
        // mode=ops — только служебная сводка, без публичного дайджеста
        // (ручной запуск и проверка контура метрик)
        const opsOnly = new URL(request.url).searchParams.get("mode") === "ops";
        let res: { ok: boolean; description?: string } = { ok: true };
        if (!opsOnly) {
          const text = await buildDigestText(ns);
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
          res = await tgApi("sendMessage", {
            chat_id: cfg.channelId,
            text,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🎟 Открыть GTR Event", url: `${APP_URL}/gtr/tonight` }]],
            },
            link_preview_options: { url: APP_URL, prefer_large_media: true },
          });
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
