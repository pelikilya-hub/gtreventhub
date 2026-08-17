// Портрет BOSS для стенда: тот же снимок, что в эмблеме дашборда.
//
// Стенд — статическая страница без React и без серверных функций, ей
// нужен простой GET. Ручка закрыта тем же правилом, что и сам портрет:
// это лицо конкретного человека, и раздавать его всем подряд незачем.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/boss-head")({
  server: {
    handlers: {
      GET: async () => {
        const user = await currentUser();
        const ns = await getKvNs();
        if (!user || !ns)
          return new Response(JSON.stringify({ head: null }), {
            status: 401,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        const head = await kvGetJson<{ day?: string; night?: string }>(ns, "boss:head");
        return new Response(JSON.stringify({ head: head ?? null }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
