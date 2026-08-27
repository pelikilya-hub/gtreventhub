// Ежедневная сверка цен вилл Private. Крон-обёртка воркера дёргает этот
// роут в 02:00 UTC (09:00 Пхукета) — до начала рабочего дня.
//
// Пока партнёрского ключа trip.com нет, автоматически взять ставку неоткуда
// (в публичных страницах цен нет — проверено), поэтому крон делает
// единственное честное действие: присылает BOSS список вилл, чью цену пора
// сверить, со ссылкой на нужные даты. Появится ключ — fetchLivePrice начнёт
// закрывать эти же позиции сам, и сообщение станет отчётом, а не просьбой.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { tgEsc } from "../gtr/tg";
import { checkLink, runDailyCheck, VILLA_MARKUP } from "../gtr/villa-price";
import { APP_URL } from "../gtr/app-url";

const APP = APP_URL;

export const Route = createFileRoute("/api/villa-check")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") ||
          new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });

        const { ns, auto, manual, stale } = await runDailyCheck();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });
        if (!stale.length) return Response.json({ ok: true, stale: 0, auto: 0, manual: 0 });

        const { notifyBossTg } = await import("../gtr/kv-api");
        const lines = [
          `🏝 <b>Цены вилл — сверка на сегодня</b>`,
          auto.length ? `Автоматически обновлено: ${auto.length}` : "",
          manual.length
            ? `Нужна ручная сверка (${manual.length}):\n` +
              manual
                .map(
                  (v) =>
                    `• <a href="${checkLink(v.tripId)}">${tgEsc(v.name)}</a> — ставка за ночь на завтра`,
                )
                .join("\n")
            : "",
          manual.length
            ? `\nВбить цифру: <a href="${APP}/gtr/private">Private → сверить цену</a>. Прайс GTR посчитается сам: +${Math.round(
                (VILLA_MARKUP - 1) * 100,
              )}%.`
            : "",
        ].filter(Boolean);
        await notifyBossTg(ns, lines.join("\n")).catch(() => {});
        return Response.json({
          ok: true,
          stale: stale.length,
          auto: auto.length,
          manual: manual.length,
        });
      },
    },
  },
});
