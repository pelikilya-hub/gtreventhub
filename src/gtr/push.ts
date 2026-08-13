// Web Push из воркера без библиотек: пуш без полезной нагрузки (сервис-воркер
// сам забирает свежую карточку из /api/push?feed), авторизация VAPID (ES256,
// Web Crypto). Приватный ключ — секрет воркера VAPID_PRIVATE_JWK.

import type { KvNs } from "./kv-ns";
import { kvGetJson } from "./kv-ns";

// Публичный VAPID-ключ (uncompressed P-256, base64url) — он же в клиенте
export const VAPID_PUBLIC_KEY =
  "BBnpfBCzWnhgTMlz4IkOTi17l-7U5fUBQdUNesBvAdjJ41VB2_Qq2k2bEC9sj4aeDa70lElKZrTX27iSj8cATh4";

const b64urlToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const bytesToB64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const privateJwk = () =>
  (typeof process !== "undefined" && process.env?.VAPID_PRIVATE_JWK) || "";

export const pushConfigured = () => Boolean(privateJwk());

async function vapidAuth(endpoint: string): Promise<string | null> {
  const jwkRaw = privateJwk();
  if (!jwkRaw) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(jwkRaw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const aud = new URL(endpoint).origin;
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "mailto:pelikilya@gmail.com",
  })}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `vapid t=${unsigned}.${bytesToB64url(new Uint8Array(sig))}, k=${VAPID_PUBLIC_KEY}`;
}

export type PushSub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };
export type PushCard = { title: string; body: string; url?: string; ts: number };

// Отправка пуша адресату: карточка кладётся в pushfeed:<email>, затем на все
// его подписки уходит «пустой» пуш — сервис-воркер сам заберёт карточку
export async function sendPushTo(ns: KvNs, email: string, card: Omit<PushCard, "ts">) {
  const subs = (await kvGetJson<PushSub[]>(ns, `push:${email}`)) ?? [];
  if (!subs.length) return { ok: false, reason: "no-subs" };
  await ns.put(`pushfeed:${email}`, JSON.stringify({ ...card, ts: Date.now() } satisfies PushCard));
  const alive: PushSub[] = [];
  for (const sub of subs) {
    try {
      const auth = await vapidAuth(sub.endpoint);
      if (!auth) return { ok: false, reason: "no-vapid" };
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { TTL: "3600", Authorization: auth, Urgency: "high" },
      });
      // 404/410 — подписка мертва, вычищаем
      if (res.status !== 404 && res.status !== 410) alive.push(sub);
    } catch {
      alive.push(sub); // сеть мигнула — подписку не хороним
    }
  }
  if (alive.length !== subs.length) await ns.put(`push:${email}`, JSON.stringify(alive));
  return { ok: true, sent: alive.length };
}
