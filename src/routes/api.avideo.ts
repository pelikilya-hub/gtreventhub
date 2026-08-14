// Hero-видео артиста: файл mp4 из кабинета (до 16 МБ, рекомендация — до
// 15 секунд), хранение в KV (avideo:<artistId>), публичная отдача — сюда.
// Это закрывает зависимость от Instagram: артист приносит видео сам.
import { createFileRoute } from "@tanstack/react-router";

import { userFromCookieHeader } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

const MAX_BYTES = 16_000_000; // base64 в KV укладывается в лимит значения 25 МБ

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

export const Route = createFileRoute("/api/avideo")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const a = new URL(request.url).searchParams.get("a") ?? "";
        if (!/^MC-\d{4}$/.test(a)) return new Response("bad id", { status: 400 });
        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });
        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `avideo:${a}`);
        if (!rec) return new Response("not found", { status: 404 });
        const bin = atob(rec.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            "content-type": rec.ct,
            "cache-control": "public, max-age=3600",
            "accept-ranges": "bytes",
          },
        });
      },
      POST: async ({ request }: { request: Request }) => {
        const a = new URL(request.url).searchParams.get("a") ?? "";
        if (!/^MC-\d{4}$/.test(a)) return Response.json({ ok: false }, { status: 400 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false }, { status: 503 });
        if (!(await authArtist(request, a)))
          return Response.json({ ok: false, reason: "нет прав" }, { status: 403 });
        const ct = request.headers.get("content-type") ?? "";
        if (!/^video\/(mp4|quicktime|webm)/.test(ct))
          return Response.json({ ok: false, reason: "not video" }, { status: 415 });
        const buf = await request.arrayBuffer();
        if (buf.byteLength < 10_000)
          return Response.json({ ok: false, reason: "too small" }, { status: 413 });
        if (buf.byteLength > MAX_BYTES)
          return Response.json({ ok: false, reason: "больше 16 МБ — сожмите видео" }, { status: 413 });
        await ns.put(`avideo:${a}`, JSON.stringify({ ct, b64: toB64(buf) }));
        return Response.json({ ok: true, path: `/api/avideo?a=${a}` });
      },
      DELETE: async ({ request }: { request: Request }) => {
        const a = new URL(request.url).searchParams.get("a") ?? "";
        if (!/^MC-\d{4}$/.test(a)) return Response.json({ ok: false }, { status: 400 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false }, { status: 503 });
        if (!(await authArtist(request, a)))
          return Response.json({ ok: false, reason: "нет прав" }, { status: 403 });
        await ns.delete(`avideo:${a}`);
        await ns.delete(`aphoto:${a}:heroposter`);
        return Response.json({ ok: true });
      },
    },
  },
});
