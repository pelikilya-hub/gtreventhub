// Дымовая проверка живого продукта — по расписанию.
//
// Проверяем не «код собрался», а «прод отвечает тем, чем должен». Сам
// прогон — в src/gtr/bro/smoke.ts: его же зовёт пульт по требованию.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { runSmoke } from "../gtr/bro/smoke-run";
import { getKvNs } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/smoke")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") || new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });

        const ns = await getKvNs();
        // Без KV проверять нечего, и это само по себе главная поломка —
        // ровно она однажды уронила вход, регистрацию и BRO разом.
        if (!ns)
          return Response.json({ ok: false, checks: [{ id: "kv", ok: false, note: "нет биндинга" }] });
        return Response.json(await runSmoke(ns));
      },
    },
  },
});
