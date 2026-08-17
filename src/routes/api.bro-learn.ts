// Ежедневное обучение BRO: одна-две новые темы в день.
//
// Помощник, который повторяет один и тот же набор ответов, быстро
// становится мебелью. Поэтому знания BRO растут по расписанию: крон
// в 04:00 UTC (11:00 Пхукета) берёт из бэклога следующие темы и
// переносит их в живую базу — с этого момента BRO отвечает на них всем.
//
// Обучение намеренно не генеративное. Темы написаны заранее и проверены:
// база знаний — это то место, где BRO обязан быть точным, а не
// изобретательным.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import lessonsRaw from "../gtr/data/bro-lessons.json";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

/** Ключ живой базы знаний: какие темы BRO уже выучил. */
export const LEARNED_KEY = "broqa:learned";

type Lesson = { id: string; tag: string; title: string; keys: string[]; answers: string[] };
type Learned = { ids: string[]; at?: string };

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

        const all = (lessonsRaw as { lessons: Lesson[] }).lessons;
        const prev = (await kvGetJson<Learned>(ns, LEARNED_KEY)) ?? { ids: [] };
        const known = new Set(prev.ids);
        const next = all.filter((l) => !known.has(l.id)).slice(0, PER_DAY);
        if (!next.length)
          return Response.json({ ok: true, learned: 0, total: prev.ids.length, note: "бэклог пуст" });

        const ids = [...prev.ids, ...next.map((l) => l.id)];
        const at = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
        await ns.put(LEARNED_KEY, JSON.stringify({ ids, at } satisfies Learned));

        // BOSS видит, чему помощник научился: обучение без отчёта
        // неотличимо от его отсутствия.
        const { notifyBossTg } = await import("../gtr/kv-api");
        const left = all.length - ids.length;
        await notifyBossTg(
          ns,
          [
            "🎓 <b>BRO выучил новое</b>",
            ...next.map((l) => `• ${l.title} <i>(${l.tag})</i>`),
            "",
            `Всего тем в живой базе: ${ids.length}. В бэклоге осталось: ${left}.`,
          ].join("\n"),
        ).catch(() => {});

        return Response.json({ ok: true, learned: next.map((l) => l.id), total: ids.length, left });
      },
    },
  },
});
