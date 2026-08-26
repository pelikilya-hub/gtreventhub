// Разбор афиши моделью — по расписанию.
//
// Отдельной ручкой, а не внутри /api/afisha: прогон ходит по сайтам и
// ждёт инференс, и его затупивший сайт не должен тянуть за собой сбор
// афиши по рабочим источникам. Сам прогон — в src/gtr/afisha-llm-run.ts,
// его же зовёт пульт по требованию.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { runAfishaLlm } from "../gtr/afisha-llm-run";
import { getKvNs } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/afisha-llm")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const key = request.headers.get("x-afisha-key") || url.searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no-kv", venues: [] });
        const limit = Math.max(1, Math.min(6, Number(url.searchParams.get("limit")) || 2));
        return Response.json(await runAfishaLlm(ns, limit));
      },
    },
  },
});
