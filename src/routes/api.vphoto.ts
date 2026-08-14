// Фото от площадок: менеджер загружает через форму подтверждения
// (/gtr/v?t=токен), фото живут в KV (vphoto:<vid>:<id>) и отдаются отсюда.
// POST — только по действующему токену ссылки; GET — публичная отдача.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs, kvGetJson, kvListAll } from "../gtr/kv-ns";

const MAX_BYTES = 3_000_000;
const MAX_PHOTOS = 6;

const toB64 = (buf: ArrayBuffer) => {
  const u8 = new Uint8Array(buf);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
};

export const Route = createFileRoute("/api/vphoto")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        if (!/^[A-Za-z0-9:_-]{3,80}$/.test(k)) return new Response("bad key", { status: 400 });
        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });
        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `vphoto:${k}`);
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
      POST: async ({ request }: { request: Request }) => {
        const t = new URL(request.url).searchParams.get("t") ?? "";
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" }, { status: 503 });
        const link = await kvGetJson<{ vid: string }>(ns, `vlink:${t}`);
        if (!link) return Response.json({ ok: false, reason: "bad token" }, { status: 403 });
        const ct = request.headers.get("content-type") ?? "";
        if (!/^image\/(jpeg|png|webp)/.test(ct))
          return Response.json({ ok: false, reason: "not image" }, { status: 415 });
        const buf = await request.arrayBuffer();
        if (buf.byteLength < 5000 || buf.byteLength > MAX_BYTES)
          return Response.json({ ok: false, reason: "size" }, { status: 413 });
        const keys = await kvListAll(ns, `vphoto:${link.vid}:`);
        if (keys.length >= MAX_PHOTOS)
          return Response.json({ ok: false, reason: "limit", count: keys.length });
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await ns.put(`vphoto:${link.vid}:${id}`, JSON.stringify({ ct, b64: toB64(buf) }));
        return Response.json({
          ok: true,
          path: `/api/vphoto?k=${encodeURIComponent(`${link.vid}:${id}`)}`,
          count: keys.length + 1,
        });
      },
    },
  },
});
