// Ежедневное обучение BRO: одна-две новые темы в день.
//
// Помощник, который повторяет один и тот же набор ответов, быстро
// становится мебелью. Поэтому знания BRO растут по расписанию: крон
// в 04:00 UTC (11:00 Пхукета) берёт из бэклога следующие темы и
// переносит их в живую базу — с этого момента BRO отвечает на них всем.
//
// Сама логика — в src/gtr/bro/learn.ts: её же дёргает кнопка «выучить
// сейчас» на стенде /bro-dev.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { learnNext, LEARNED_KEY } from "../gtr/bro/learn";
import { getKvNs } from "../gtr/kv-ns";

export { LEARNED_KEY };

/** Сколько тем берём за прогон. Две — потолок: смысл в постоянстве,
 *  а не в том, чтобы вывалить весь бэклог за неделю. */
const PER_DAY = 2;

export const Route = createFileRoute("/api/bro-learn")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") || new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });

        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });

        const res = await learnNext(ns, PER_DAY);
        if (!res.learned.length)
          return Response.json({ ok: true, learned: 0, total: res.total, note: "бэклог пуст" });
        return Response.json({ ok: true, learned: res.learned, total: res.total, left: res.left });
      },
    },
  },
});
