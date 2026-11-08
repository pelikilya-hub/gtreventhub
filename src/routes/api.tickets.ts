// Билетные площадки (Megatix, Ticketmelon) → KV. Дневная задача на тике
// сторожа: свой вызов воркера — свой бюджет подзапросов, и сбор афиш не
// делит его с билетами. Результат читают сбор афиш (вечера площадок из
// базы и находки радара) и витрина маршрута.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { getKvNs } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/tickets")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") ||
          new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });
        const { syncTickets } = await import("../gtr/afisha-tickets");
        try {
          return Response.json({ ok: true, counts: await syncTickets(ns) });
        } catch (e) {
          return Response.json({ ok: false, error: String(e instanceof Error ? e.message : e) }, { status: 500 });
        }
      },
    },
  },
});
