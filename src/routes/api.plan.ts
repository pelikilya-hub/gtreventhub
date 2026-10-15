// Чертёж площадки или зала для режима «План» конструктора: /api/plan?k=<id>.
// Картинку кладёт planUploadFn; адрес неизменен, поэтому кэш — навсегда.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs, kvGetJson } from "../gtr/kv-ns";

export const Route = createFileRoute("/api/plan")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        if (!/^[a-z0-9]{12,40}$/.test(k)) return new Response("bad key", { status: 400 });
        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });
        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `plan:${k}`);
        if (!rec) return new Response("not found", { status: 404 });
        const bin = atob(rec.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            "content-type": rec.ct,
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
