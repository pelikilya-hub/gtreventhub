// Сессия GTR BRO поверх Gemini Live: выдача эфемерного токена.
//
// Логика та же, что у ручки Realtime: основной ключ живёт только здесь,
// браузер получает короткоживущий токен на одно подключение. Ключ
// берётся из секрета воркера GEMINI_API_KEY:
//     npx wrangler secret put GEMINI_API_KEY --name gtr-event-hub
// Модель можно переопределить в KV `setting:gemini` → {"model": "..."}.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { buildPrompt, type BroContext, type PersonaMode } from "../gtr/bro/prompt.ru";
import { TOOL_DEFS } from "../gtr/bro/tools";

const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
// Голоса Gemini, которые держат низкую мужскую подачу по-русски.
const VOICES = ["Charon", "Fenrir", "Puck"] as const;

const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;

type Flags = { broEnabled?: boolean; broKill?: boolean; broRoles?: string[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Схемы инструментов для Gemini: тот же JSON Schema, но без
// additionalProperties — его формат Google не принимает.
const stripExtra = (o: unknown): unknown => {
  if (Array.isArray(o)) return o.map(stripExtra);
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>))
      if (k !== "additionalProperties") out[k] = stripExtra(v);
    return out;
  }
  return o;
};

const GEMINI_TOOLS = TOOL_DEFS.map((d) => ({
  name: d.name,
  description: d.description,
  parameters: stripExtra(d.parameters),
}));

const pickMode = (raw: unknown): PersonaMode =>
  raw === "concierge" || raw === "unhinged" ? raw : "bro";

export const Route = createFileRoute("/api/gtr-bro-gem")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ error: "auth" }, 401);

        const ns = await getKvNs();
        if (!ns) return json({ error: "unconfigured", reason: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill) return json({ error: "disabled", reason: "kill" }, 503);
        if (!flags.broEnabled) return json({ error: "disabled", reason: "flag" }, 503);
        if (flags.broRoles?.length && !flags.broRoles.includes(user.role))
          return json({ error: "forbidden" }, 403);

        const key =
          (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined) ?? "";
        if (!key) return json({ error: "unconfigured", reason: "no-gemini-key" }, 503);

        // Общий с Realtime лимит запусков на пользователя.
        {
          const rkey = `brorate:${user.email}`;
          const rec = (await kvGetJson<{ n: number; at: number }>(ns, rkey)) ?? { n: 0, at: 0 };
          const fresh = Date.now() - rec.at < RATE_WINDOW_MS;
          const n = fresh ? rec.n + 1 : 1;
          if (fresh && n > RATE_MAX) return json({ error: "rate" }, 429);
          await ns.put(rkey, JSON.stringify({ n, at: fresh ? rec.at : Date.now() }), {
            expirationTtl: 3600,
          });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const gcfg = (await kvGetJson<{ model?: string }>(ns, "setting:gemini")) ?? {};
        const model = gcfg.model ?? DEFAULT_MODEL;
        const voice = VOICES.includes(body.voice as (typeof VOICES)[number])
          ? String(body.voice)
          : "Charon";

        const ctx: BroContext = {
          userId: user.email,
          displayName: user.name,
          language: "ru",
          personaMode: pickMode(body.personaMode),
          timezone: "Asia/Bangkok",
          currentTime: new Date().toISOString(),
          location: { city: "Phuket" },
          currentScreen: typeof body.screen === "string" ? body.screen.slice(0, 40) : undefined,
        };

        // Эфемерный токен: минуты жизни, одно подключение.
        let res: Response;
        try {
          res = await fetch(`https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${key}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              uses: 1,
              expireTime: new Date(Date.now() + 10 * 60_000).toISOString(),
              newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
            }),
            signal: AbortSignal.timeout(12_000),
          });
        } catch {
          return json({ error: "upstream", reason: "network" }, 502);
        }

        const text = await res.text();
        if (!res.ok) {
          // Кусок тела — на табло: без него телефон снова скажет
          // «закрыто» молча. Ключа в теле ошибки Google нет.
          console.warn("gtr-bro: gemini token rejected", res.status);
          return json(
            { error: "upstream", status: res.status, detail: text.slice(0, 240) },
            502,
          );
        }

        let data: { name?: string; token?: string } = {};
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          return json({ error: "upstream", reason: "shape" }, 502);
        }
        const token = data.name ?? data.token;
        if (!token) return json({ error: "upstream", reason: "shape" }, 502);

        return json({
          token,
          model,
          voice,
          instructions:
            buildPrompt(ctx) +
            // Живой прогон показал: эта модель охотно тащит «знания о
            // мире» в ответы про сегодняшний вечер. Дожимаем отдельным
            // железным правилом в конце — последняя инструкция весит
            // больше всего.
            "\n\n---\n\n# Железное правило фактов\n\nБез вызова search_events в ТЕКУЩЕМ ходу тебе запрещено называть: события, вечеринки, бары, клубы, время работы, лайнапы, диджеев. Твои знания о Пхукете устарели и считаются ложью. Нет результата инструмента — говори «сейчас гляну» и вызывай search_events, либо честно скажи, что данных нет. Это правило сильнее всех остальных.",
          tools: GEMINI_TOOLS,
        });
      },
    },
  },
});
