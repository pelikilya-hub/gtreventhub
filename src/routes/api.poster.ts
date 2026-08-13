// Отдача кэшированных постеров афиш из KV: /api/poster?k=<vid>:<eventId>.
// Агент афиш складывает постеры площадок в poster:<vid>:<id> (base64),
// здесь они превращаются обратно в картинку с долгим кэшем на клиенте.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs, kvGetJson } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/poster")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        if (!/^[A-Za-z0-9:_-]{3,120}$/.test(k)) return new Response("bad key", { status: 400 });
        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });
        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `poster:${k}`);
        if (!rec) return new Response("not found", { status: 404 });
        const bin = atob(rec.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            "content-type": rec.ct,
            "cache-control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});
