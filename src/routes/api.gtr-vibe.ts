// Слух вайб-чека: клиент записывает 5 секунд зала, воркер отдаёт звук
// Gemini (тот же бесплатный ключ, что и текстовый мозг — Flash понимает
// аудио) и возвращает жанр строго из нашего словаря genres.json.
// Локальная прикидка по темпу на клиенте остаётся мгновенным ответом и
// запасным путём: эта ручка — уточнение, а не единственная надежда.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { genreIdList, parseVibeReply } from "../gtr/bro/vibe-parse";

type Flags = { broEnabled?: boolean; broKill?: boolean; geminiOff?: boolean };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Опус на 5 секунд — десятки килобайт; потолок с запасом, но не шлюз
// для перекачки чего угодно через наш ключ.
const MAX_B64 = 1_400_000;
const MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"];

export const Route = createFileRoute("/api/gtr-vibe")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled) return json({ ok: false, error: "disabled" }, 503);
        // Пауза Gemini глушит и слух: пусть клиент честно живёт локальной
        // прикидкой, а не ждёт таймаут.
        const gemKey = flags.geminiOff
          ? ""
          : ((typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined) ?? "");
        if (!gemKey) return json({ ok: false, error: "no-ear" }, 503);

        const { tooMany, LIMITS } = await import("../gtr/abuse");
        if (await tooMany("vibe", user.email, LIMITS.bro, ns))
          return json({ ok: false, error: "rate" }, 429);

        let body: { mime?: string; data?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const mime = String(body.mime ?? "").split(";")[0].trim();
        const data = String(body.data ?? "");
        if (!MIMES.includes(mime)) return json({ ok: false, error: "bad-mime" }, 400);
        if (!data || data.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(data))
          return json({ ok: false, error: "bad-audio" }, 400);

        const gcfg = (await kvGetJson<{ textModel?: string }>(ns, "setting:gemini")) ?? {};
        const gmodel = gcfg.textModel ?? "gemini-flash-latest";
        const prompt = [
          "Ты — музыкальный эксперт. В аудио — 5 секунд музыки, записанной телефоном в заведении (шум толпы возможен).",
          "Определи жанр и темп. Жанр выбери СТРОГО одним id из списка ниже — ближайший по смыслу, ничего своего не выдумывай.",
          'Ответь ТОЛЬКО JSON без пояснений: {"genre":"<id из списка>","bpm":<число или null>}',
          "Список id:",
          genreIdList().join(", "),
        ].join("\n");

        const call = () =>
          fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${gmodel}:generateContent?key=${gemKey}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [{ text: prompt }, { inlineData: { mimeType: mime, data } }],
                  },
                ],
                generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
              }),
              signal: AbortSignal.timeout(12_000),
            },
          );

        const metric = async (name: string) => {
          try {
            const day = new Date().toISOString().slice(0, 10);
            const mkey = `brostat:${day}`;
            const cur = (await kvGetJson<Record<string, number>>(ns, mkey)) ?? {};
            cur[name] = (cur[name] ?? 0) + 1;
            await ns.put(mkey, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 120 });
          } catch {
            /* счётчик не важнее ответа */
          }
        };

        let res: Response;
        try {
          res = await call();
          if (res.status === 503 || res.status === 500) {
            await new Promise((r) => setTimeout(r, 1200));
            res = await call();
          }
        } catch {
          await metric("bro.vibe.fail.network");
          return json({ ok: false, error: "ear-network" }, 502);
        }
        if (!res.ok) {
          await metric(`bro.vibe.fail.http-${res.status}`);
          return json({ ok: false, error: "ear-http", status: res.status }, 502);
        }

        const out = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = (out.candidates?.[0]?.content?.parts ?? [])
          .map((p) => String(p.text ?? ""))
          .join("");
        const guess = parseVibeReply(text);
        if (!guess) {
          await metric("bro.vibe.fail.parse");
          return json({ ok: false, error: "ear-unclear" }, 200);
        }
        await metric("bro.vibe.ok");
        return json({ ok: true, ...guess, engine: gmodel });
      },
    },
  },
});
