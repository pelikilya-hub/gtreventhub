// Синхронизация афиш по крону/ключу: cron-обёртка воркера дёргает этот
// роут каждые 6 часов; тот же ключ позволяет ручной запуск.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey, syncAfisha } from "../gtr/afisha";
import { getKvNs } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/afisha")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key = request.headers.get("x-afisha-key") || new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });
        const counts = await syncAfisha(ns);
        // заодно обновляем ленту страниц Meta — если подключены
        const { metaSyncCore } = await import("../gtr/meta");
        const meta = await metaSyncCore(ns).catch(() => null);
        return Response.json({ ok: true, counts, meta: meta?.count ?? null });
      },
    },
  },
});
