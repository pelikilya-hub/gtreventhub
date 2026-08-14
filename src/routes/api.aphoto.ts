// Фото артистов: артист загружает своё через кабинет (аватар, галерея,
// постер hero-видео), GTR — любому. Хранение — KV aphoto:<artistId>:<id>,
// GET публичный.
import { createFileRoute } from "@tanstack/react-router";

import { userFromCookieHeader } from "../gtr/auth";
import { getKvNs, kvGetJson, kvListAll } from "../gtr/kv-ns";

const MAX_BYTES = 3_000_000;
const MAX_GALLERY = 8;

const toB64 = (buf: ArrayBuffer) => {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

const authArtist = async (request: Request, artistId: string) => {
  const u = await userFromCookieHeader(request.headers.get("cookie") ?? "");
  if (!u) return null;
  if (u.role === "gtr" || (u.role === "artist" && u.artistId === artistId)) return u;
  return null;
};

export const Route = createFileRoute("/api/aphoto")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        if (!/^MC-\d{4}:[A-Za-z0-9]{1,24}$/.test(k)) return new Response("bad key", { status: 400 });
        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });
        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `aphoto:${k}`);
        if (!rec) return new Response("not found", { status: 404 });
        const bin = atob(rec.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: { "content-type": rec.ct, "cache-control": "public, max-age=3600" },
        });
      },
      POST: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const a = url.searchParams.get("a") ?? "";
        const role = url.searchParams.get("role") ?? ""; // avatar | heroposter | ""
        if (!/^MC-\d{4}$/.test(a)) return Response.json({ ok: false }, { status: 400 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false }, { status: 503 });
        if (!(await authArtist(request, a)))
          return Response.json({ ok: false, reason: "нет прав" }, { status: 403 });
        const ct = request.headers.get("content-type") ?? "";
        if (!/^image\/(jpeg|png|webp)/.test(ct))
          return Response.json({ ok: false, reason: "not image" }, { status: 415 });
        const buf = await request.arrayBuffer();
        if (buf.byteLength < 3000 || buf.byteLength > MAX_BYTES)
          return Response.json({ ok: false, reason: "size" }, { status: 413 });
        let id: string;
        if (role === "avatar" || role === "heroposter") id = role;
        else {
          const keys = await kvListAll(ns, `aphoto:${a}:`);
          const gallery = keys.filter((k) => !k.endsWith(":avatar") && !k.endsWith(":heroposter"));
          if (gallery.length >= MAX_GALLERY)
            return Response.json({ ok: false, reason: "limit" });
          id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        }
        await ns.put(`aphoto:${a}:${id}`, JSON.stringify({ ct, b64: toB64(buf) }));
        return Response.json({ ok: true, path: `/api/aphoto?k=${encodeURIComponent(`${a}:${id}`)}` });
      },
      DELETE: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        const m = k.match(/^(MC-\d{4}):[A-Za-z0-9]{1,24}$/);
        if (!m) return Response.json({ ok: false }, { status: 400 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false }, { status: 503 });
        if (!(await authArtist(request, m[1])))
          return Response.json({ ok: false, reason: "нет прав" }, { status: 403 });
        await ns.delete(`aphoto:${k}`);
        return Response.json({ ok: true });
      },
    },
  },
});
