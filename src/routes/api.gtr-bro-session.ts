// Создание короткоживущей Realtime-сессии GTR BRO.
//
// Клиент никогда не видит основной ключ. Он получает эфемерный секрет,
// который живёт минуты и годен только на одно соединение. Ключ читается
// из окружения воркера и не попадает ни в ответ, ни в лог, ни в ошибку.
//
// Важно про окружение: это Cloudflare Worker, и .env.local здесь не
// работает. Ключ должен лежать секретом воркера:
//     npx wrangler secret put OPENAI_API_KEY --name gtr-event-hub
// Пока секрета нет, ручка честно отвечает 503 с понятной причиной, а не
// притворяется рабочей.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { buildPrompt, PROMPT_VERSION, type BroContext, type PersonaMode } from "../gtr/bro/prompt.ru";
import { TOOL_DEFS } from "../gtr/bro/tools";

const MODEL = "gpt-realtime-2.1";
const VOICES = ["cedar", "marin", "ash"] as const;
type Voice = (typeof VOICES)[number];

// Столько сессий на пользователя за окно. Realtime дорогой, и открытая
// ручка создания сессий — это открытый кран.
const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// Разрешённые источники: свой домен и локальный стенд разработчика.
const ORIGINS = [
  "https://gtr-event-hub.gtr-event.workers.dev",
  "https://gtr.events",
  "http://localhost:8811",
  "http://127.0.0.1:8811",
];

type Flags = { broEnabled?: boolean; broKill?: boolean; broRoles?: string[] };

const json = (body: unknown, status = 200, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
    },
  });

const pickVoice = (raw: unknown): Voice =>
  VOICES.includes(raw as Voice) ? (raw as Voice) : "cedar";

const pickMode = (raw: unknown): PersonaMode =>
  raw === "concierge" || raw === "unhinged" ? raw : "bro";

export const Route = createFileRoute("/api/gtr-bro-session")({
  server: {
    handlers: {
      // Диагностика: три булевых значения, по которым видно, почему
      // кнопка не зовёт голос. Ни ключа, ни ролей, ни личности здесь нет.
      GET: async () => {
        const ns = await getKvNs();
        const flags = ns
          ? ((await kvGetJson<Flags>(ns, "setting:flags")) ?? {})
          : {};
        const oai = Boolean(typeof process !== "undefined" && process.env?.OPENAI_API_KEY);
        const gem = Boolean(typeof process !== "undefined" && process.env?.GEMINI_API_KEY);
        return json({
          kv: Boolean(ns),
          enabled: Boolean(flags.broEnabled) && !flags.broKill,
          roles: flags.broRoles ?? [],
          keyReady: oai,
          geminiKey: gem,
          brain: Boolean(await kvGetJson(ns!, "setting:brain")),
        });
      },

      OPTIONS: ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        if (!ORIGINS.includes(origin)) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "600",
            vary: "origin",
          },
        });
      },

      POST: async ({ request }) => {
        const origin = request.headers.get("origin") ?? "";
        const allow = ORIGINS.includes(origin) ? origin : undefined;
        if (origin && !allow) return json({ error: "origin" }, 403);

        const user = await currentUser();
        if (!user) return json({ error: "auth" }, 401, allow);

        const ns = await getKvNs();
        // Без KV нет ни флага, ни рубильника — значит, фичи нет.
        if (!ns) return json({ error: "unconfigured", reason: "no-kv" }, 503, allow);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        // Рубильник важнее флага: он гасит фичу, даже если её включили.
        if (flags.broKill) return json({ error: "disabled", reason: "kill" }, 503, allow);
        if (!flags.broEnabled) return json({ error: "disabled", reason: "flag" }, 503, allow);
        if (flags.broRoles?.length && !flags.broRoles.includes(user.role))
          return json({ error: "forbidden" }, 403, allow);

        // Ключ только на сервере и только по факту наличия.
        const key =
          (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined) ?? "";
        if (!key) return json({ error: "unconfigured", reason: "no-key" }, 503, allow);

        // Ограничение частоты: счётчик в KV с окном.
        {
          const rkey = `brorate:${user.email}`;
          const rec = (await kvGetJson<{ n: number; at: number }>(ns, rkey)) ?? { n: 0, at: 0 };
          const fresh = Date.now() - rec.at < RATE_WINDOW_MS;
          const n = fresh ? rec.n + 1 : 1;
          if (fresh && n > RATE_MAX) return json({ error: "rate" }, 429, allow);
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

        const voice = pickVoice(body.voice);
        const personaMode = pickMode(body.personaMode);
        const ctx: BroContext = {
          userId: user.email,
          displayName: user.name,
          language: "ru",
          personaMode,
          timezone: "Asia/Bangkok",
          currentTime: new Date().toISOString(),
          location:
            typeof body.district === "string" || typeof body.latitude === "number"
              ? {
                  city: "Phuket",
                  district: typeof body.district === "string" ? body.district.slice(0, 40) : undefined,
                  latitude: typeof body.latitude === "number" ? body.latitude : undefined,
                  longitude: typeof body.longitude === "number" ? body.longitude : undefined,
                  accuracyMeters:
                    typeof body.accuracyMeters === "number" ? body.accuracyMeters : undefined,
                }
              : { city: "Phuket" },
          partySize: typeof body.partySize === "number" ? body.partySize : undefined,
          currentScreen: typeof body.screen === "string" ? body.screen.slice(0, 40) : undefined,
        };

        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              expires_after: { anchor: "created_at", seconds: 600 },
              session: {
                type: "realtime",
                model: MODEL,
                instructions: buildPrompt(ctx),
                audio: {
                output: { voice },
                // Расшифровка речи пользователя выключена по умолчанию.
                // Без неё панель разговора односторонняя: видно только
                // то, что сказал BRO.
                input: {
                  transcription: { model: "gpt-4o-mini-transcribe", language: "ru" },
                  // Рация задаётся при создании сессии: конец реплики
                  // определяет палец на кнопке, поэтому серверный детектор
                  // речи выключен. session.update с клиента не нужен —
                  // меньше подвижных частей.
                  turn_detection: body.ptt ? null : { type: "server_vad" },
                },
              },
                tools: TOOL_DEFS,
                tool_choice: "auto",
              },
              // Идентификатора здесь нет намеренно: ручка выдачи
              // эфемерных секретов параметра safety_identifier не
              // принимает и отвечает на него ошибкой. Личность
              // пользователя провайдеру и не нужна.
            }),
            signal: AbortSignal.timeout(12_000),
          });
        } catch {
          // Наружу отдаём нормализованную причину: тело чужой ошибки
          // может содержать что угодно, включая эхо заголовков.
          return json({ error: "upstream", reason: "network" }, 502, allow);
        }

        if (!res.ok) {
          // Статус — да, тело — нет. В логи тоже ничего с ключом.
          console.warn("gtr-bro: realtime session rejected", res.status);
          return json({ error: "upstream", status: res.status }, 502, allow);
        }

        const data = (await res.json()) as { value?: string; expires_at?: number };
        if (!data.value) return json({ error: "upstream", reason: "shape" }, 502, allow);

        return json(
          {
            clientSecret: data.value,
            expiresAt: data.expires_at ?? null,
            model: MODEL,
            voice,
            personaMode,
            promptVersion: PROMPT_VERSION,
          },
          200,
          allow,
        );
      },
    },
  },
});
