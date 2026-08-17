// GTR FLING — сигналинг видео-рулетки.
//
// Видео и звук идут напрямую между телефонами по WebRTC — через нас
// проходит только рукопожатие: оффер, ответ и присутствие. Ни кадры, ни
// голос сервера не касаются, записывать их здесь нечем и незачем.
//
// Почему без трикл-ICE: кандидаты, летящие поштучно, требуют очередей
// сообщений и порождают гонки на KV. Полный SDP со всеми кандидатами —
// это ровно два сообщения на пару (оффер и ответ), которым хватает
// одного JSON-ключа комнаты.
//
// Подбор пары: один слот ожидания. Первый пришедший садится в слот,
// второй его забирает и становится offerer'ом. При гонке двух «вторых»
// побеждает последняя запись, а проигравший через таймаут жмёт «дальше».
// На бете этого достаточно; вырастем — переедем на Durable Objects.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

type Wait = { uid: string; room: string; ts: number };
type Room = {
  a: string; // кто ждал (answerer)
  b?: string; // кто пришёл вторым (offerer)
  offer?: string;
  answer?: string;
  aTs: number;
  bTs?: number;
  bye?: string;
};

const WAIT_KEY = "fl:wait";
const WAIT_FRESH_MS = 20_000;
const PEER_FRESH_MS = 12_000;
const ROOM_TTL = 600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const rid = () => crypto.randomUUID().slice(0, 13);

export const Route = createFileRoute("/api/gtr-fling")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const action = String(body.action ?? "");
        const uid = user.email;
        const now = Date.now();
        const roomKey = (r: string) => `fl:room:${r}`;

        if (action === "join") {
          // Кого пропускаем: пары, разбитые кнопкой «дальше», не сводим
          // повторно ближайший час — иначе рулетка из двух людей
          // превращается в карусель.
          const skips = (await kvGetJson<string[]>(ns, `fl:skip:${uid}`)) ?? [];
          const wait = await kvGetJson<Wait>(ns, WAIT_KEY);
          const fresh = wait && now - wait.ts < WAIT_FRESH_MS && wait.uid !== uid;
          if (fresh && !skips.includes(wait.uid)) {
            // Забираем ожидающего: мы — offerer.
            await ns.put(WAIT_KEY, JSON.stringify({ uid: "", room: "", ts: 0 }), {
              expirationTtl: 60,
            });
            const room = (await kvGetJson<Room>(ns, roomKey(wait.room))) ?? {
              a: wait.uid,
              aTs: now,
            };
            room.b = uid;
            room.bTs = now;
            await ns.put(roomKey(wait.room), JSON.stringify(room), { expirationTtl: ROOM_TTL });
            return json({ ok: true, role: "offer", room: wait.room });
          }
          // Садимся в слот сами.
          const room = rid();
          await ns.put(WAIT_KEY, JSON.stringify({ uid, room, ts: now } satisfies Wait), {
            expirationTtl: 60,
          });
          await ns.put(roomKey(room), JSON.stringify({ a: uid, aTs: now } satisfies Room), {
            expirationTtl: ROOM_TTL,
          });
          return json({ ok: true, role: "wait", room });
        }

        const room = String(body.room ?? "").slice(0, 20);
        if (!room) return json({ ok: false, error: "no-room" }, 400);
        const rk = roomKey(room);
        const st = await kvGetJson<Room>(ns, rk);
        if (!st) return json({ ok: true, gone: true });
        const mine = st.a === uid ? "a" : st.b === uid ? "b" : null;
        if (!mine && action !== "report") return json({ ok: false, error: "not-yours" }, 403);

        if (action === "signal") {
          // SDP целиком: оффер от b, ответ от a. Больше сообщений нет.
          const sdp = String(body.sdp ?? "").slice(0, 100_000);
          if (!sdp.startsWith("v=0")) return json({ ok: false, error: "bad-sdp" }, 400);
          if (mine === "b") st.offer = sdp;
          else st.answer = sdp;
          if (mine === "a") st.aTs = now;
          else st.bTs = now;
          await ns.put(rk, JSON.stringify(st), { expirationTtl: ROOM_TTL });
          return json({ ok: true });
        }

        if (action === "poll") {
          if (mine === "a") st.aTs = now;
          else st.bTs = now;
          await ns.put(rk, JSON.stringify(st), { expirationTtl: ROOM_TTL });
          const peerTs = mine === "a" ? st.bTs : st.aTs;
          const peerHere = Boolean(mine === "a" ? st.b : st.a);
          return json({
            ok: true,
            offer: mine === "a" ? (st.offer ?? null) : null,
            answer: mine === "b" ? (st.answer ?? null) : null,
            matched: Boolean(st.b),
            bye: st.bye === (mine === "a" ? st.b : st.a) ? true : false,
            // Пропавший собеседник — это тоже «ушёл», просто невежливо.
            peerGone: peerHere && peerTs !== undefined && now - peerTs > PEER_FRESH_MS,
          });
        }

        if (action === "leave") {
          st.bye = uid;
          await ns.put(rk, JSON.stringify(st), { expirationTtl: 60 });
          // «Дальше» разводит пару на час в обе стороны.
          const peer = mine === "a" ? st.b : st.a;
          if (peer) {
            for (const [me, other] of [
              [uid, peer],
              [peer, uid],
            ] as const) {
              const sk = `fl:skip:${me}`;
              const cur = (await kvGetJson<string[]>(ns, sk)) ?? [];
              if (!cur.includes(other))
                await ns.put(sk, JSON.stringify([...cur, other].slice(-20)), {
                  expirationTtl: 3600,
                });
            }
          }
          // Если уходим из слота ожидания — освобождаем его.
          const wait = await kvGetJson<Wait>(ns, WAIT_KEY);
          if (wait?.uid === uid)
            await ns.put(WAIT_KEY, JSON.stringify({ uid: "", room: "", ts: 0 }), {
              expirationTtl: 60,
            });
          return json({ ok: true });
        }

        if (action === "report") {
          // Жалоба уходит BOSS в разбор: кто, на какую комнату, когда.
          // Видео мы не видим и не храним — фиксируется сам факт.
          const day = new Date().toISOString().slice(0, 10);
          const key = `flreport:${day}`;
          const cur = (await kvGetJson<unknown[]>(ns, key)) ?? [];
          cur.push({ t: now, by: uid, room, a: st.a, b: st.b ?? null, reason: String(body.reason ?? "").slice(0, 200) });
          await ns.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 90 });
          return json({ ok: true });
        }

        return json({ ok: false, error: "unknown-action" }, 400);
      },
    },
  },
});
