// Голос гибридной полосы GTR BRO: текст → ElevenLabs → поток mp3.
//
// GET, а не POST, — нарочно: браузерный <audio> начинает играть поток
// по ссылке сразу, с первых килобайт, а ответ на fetch пришлось бы
// дожидаться целиком. Каждая реплика стоит денег, поэтому вход, флаг
// BRO и отдельный потолок на человека проверяются до запроса наружу.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { elevenKey, elevenSpeak, voiceCfg } from "../gtr/bro/eleven";

type Flags = { broEnabled?: boolean; broKill?: boolean };

const fail = (error: string, status: number) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/gtr-bro-tts")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return fail("auth", 401);
        const ns = await getKvNs();
        if (!ns) return fail("no-kv", 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled) return fail("disabled", 503);

        const key = elevenKey();
        const cfg = await voiceCfg(ns);
        if (!key || !cfg.voiceId) return fail("unconfigured", 503);

        const text = (new URL(request.url).searchParams.get("t") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 600);
        if (!text) return fail("empty", 400);

        const { tooMany, LIMITS } = await import("../gtr/abuse");
        if (await tooMany("brotts", user.email, LIMITS.broTts, ns)) return fail("rate", 429);

        let r: Response;
        try {
          r = await elevenSpeak(text, cfg, key, AbortSignal.timeout(15_000));
        } catch {
          return fail("network", 502);
        }
        if (!r.ok || !r.body) {
          // Тело ошибки ElevenLabs может содержать подробности аккаунта —
          // наружу только статус.
          console.warn("gtr-bro-tts: ElevenLabs", r.status);
          return fail(`eleven-${r.status}`, 502);
        }
        return new Response(r.body, {
          status: 200,
          headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
        });
      },
    },
  },
});
