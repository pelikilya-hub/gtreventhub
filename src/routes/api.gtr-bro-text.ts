// Текстовый мозг GTR BRO: самохостная модель на сервере BOSS.
//
// Воркер — посредник и граница: он держит токен мозга, собирает промпт,
// исполняет инструменты и отдаёт клиенту только готовый ответ с
// типизированными карточками. Модель видит афишу через те же инструменты,
// что и голос, — выдумать событие ей не из чего.
//
// Конфигурация в KV `setting:brain`: { "url": "http://IP:8080",
// "token": "...", "model": "qwen3-8b" }. Нет записи — ручка честно
// отвечает no-brain, и клиент откатывается на разбор по правилам.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { buildTextPrompt, type BroContext } from "../gtr/bro/prompt.ru";
import { kvProvider } from "../gtr/bro/provider";
import { handlers, TOOL_DEFS, type ToolName } from "../gtr/bro/tools";

type Flags = { broEnabled?: boolean; broKill?: boolean };
type Brain = { url?: string; token?: string; model?: string };
type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
type Card = { kind: "event" | "venue" | "route"; data: Record<string, unknown> };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Схемы инструментов — в формате chat completions, который понимает
// llama.cpp с шаблоном Qwen.
const OPENAI_TOOLS = TOOL_DEFS.map((d) => ({
  type: "function" as const,
  function: { name: d.name, description: d.description, parameters: d.parameters },
}));

export const Route = createFileRoute("/api/gtr-bro-text")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled) return json({ ok: false, error: "disabled" }, 503);

        const brain = (await kvGetJson<Brain>(ns, "setting:brain")) ?? {};
        if (!brain.url || !brain.token) return json({ ok: false, error: "no-brain" }, 503);

        let body: { text?: string; history?: { who: string; text: string }[] } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const text = String(body.text ?? "").slice(0, 500).trim();
        if (!text) return json({ ok: false, error: "empty" }, 400);

        const ctx: BroContext = {
          userId: user.email,
          displayName: user.name,
          language: "ru",
          personaMode: "bro",
          timezone: "Asia/Bangkok",
          currentTime: new Date().toISOString(),
        };

        // История — хвост табло. Префикс сообщений стабилен, поэтому
        // llama.cpp прокэширует его и повторные ответы будут быстрыми.
        const messages: Msg[] = [{ role: "system", content: buildTextPrompt(ctx) }];
        for (const h of (body.history ?? []).slice(-6))
          messages.push({
            role: h.who === "bro" ? "assistant" : "user",
            content: String(h.text ?? "").slice(0, 300),
          });
        messages.push({ role: "user", content: text });

        const cards: Card[] = [];
        const provider = kvProvider(ns);

        // Агентная петля: модель зовёт инструмент → воркер исполняет →
        // результат обратно. Три круга хватает на «найди и собери маршрут»;
        // больше — уже зацикливание, режем.
        for (let round = 0; round < 3; round++) {
          let res: Response;
          try {
            res = await fetch(`${brain.url.replace(/\/$/, "")}/v1/chat/completions`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${brain.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: brain.model ?? "qwen3-8b",
                messages,
                tools: OPENAI_TOOLS,
                tool_choice: "auto",
                temperature: 0.7,
                max_tokens: 400,
                // Первый запрос прогревает кэш промпта — дальше быстрее.
                cache_prompt: true,
              }),
              // CPU-модель думает небыстро, особенно холодная.
              signal: AbortSignal.timeout(90_000),
            });
          } catch {
            return json({ ok: false, error: "brain-network" }, 502);
          }
          if (!res.ok) return json({ ok: false, error: "brain-http", status: res.status }, 502);

          const data = (await res.json()) as {
            choices?: { message?: Msg }[];
          };
          const msg = data.choices?.[0]?.message;
          if (!msg) return json({ ok: false, error: "brain-shape" }, 502);

          if (!msg.tool_calls?.length) {
            // Qwen3 в толстых случаях всё же присылает размышления —
            // человеку они не нужны.
            const reply = String(msg.content ?? "")
              .replace(/<think>[\s\S]*?<\/think>/g, "")
              .trim();
            return json({ ok: true, reply: reply || "…", cards });
          }

          messages.push(msg);
          for (const tc of msg.tool_calls.slice(0, 4)) {
            const name = tc.function.name as ToolName;
            const fn = handlers[name];
            let result: unknown = { ok: false, error: "unknown-tool", retryable: false };
            if (fn) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
              } catch {
                args = {};
              }
              try {
                result = await Promise.race([
                  fn(args, { provider }),
                  new Promise<{ ok: false; error: string; retryable: boolean }>((r) =>
                    setTimeout(() => r({ ok: false, error: "timeout", retryable: true }), 8000),
                  ),
                ]);
              } catch {
                result = { ok: false, error: "internal", retryable: false };
              }
            }

            // Карточки — из типизированных результатов, как и в голосе.
            const rr = result as { ok?: boolean; data?: Record<string, unknown> };
            if (rr.ok && rr.data) {
              if (name === "search_events" && Array.isArray(rr.data.events))
                for (const ev of (rr.data.events as Record<string, unknown>[]).slice(0, 3))
                  cards.push({ kind: "event", data: ev });
              else if (name === "get_event_details") cards.push({ kind: "venue", data: rr.data });
              else if (name === "build_night_route") cards.push({ kind: "route", data: rr.data });
            }

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result).slice(0, 4000),
            });
          }
        }

        return json({ ok: false, error: "loop-limit" }, 502);
      },
    },
  },
});
