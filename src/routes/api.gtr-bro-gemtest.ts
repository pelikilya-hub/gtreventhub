// Диагностика подключения к Gemini Live — только для BOSS.
//
// Ручка перебирает способы предъявить эфемерный токен (и контрольный
// вариант с основным ключом) прямо из воркера, где до Google есть сеть,
// и возвращает по каждому варианту итог рукопожатия. Основной ключ в
// ответ не попадает — только исходы.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";

const WS = "https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage";
const MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const mkTokenRaw = async (key: string, body: unknown): Promise<{ status: number; body: string }> => {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: r.status, body: (await r.text()).slice(0, 500) };
  } catch (e) {
    return { status: 0, body: String(e).slice(0, 120) };
  }
};

const tryWs = (url: string, extraHeaders: Record<string, string>, model = MODEL): Promise<string> =>
  new Promise((resolve) => {
    void (async () => {
      let done = false;
      const finish = (s: string) => {
        if (!done) {
          done = true;
          resolve(s);
        }
      };
      setTimeout(() => finish("timeout"), 8000);
      let r: Response;
      try {
        r = await fetch(url, { headers: { Upgrade: "websocket", ...extraHeaders } });
      } catch (e) {
        finish(`fetch-err ${String(e).slice(0, 80)}`);
        return;
      }
      const ws = (r as Response & { webSocket?: WebSocket & { accept(): void } }).webSocket;
      if (!ws) {
        finish(`no-upgrade http ${r.status}`);
        return;
      }
      ws.accept();
      const dec = new TextDecoder();
      const frames: string[] = [];
      ws.addEventListener("message", (e) => {
        const raw = (e as MessageEvent).data;
        const t = typeof raw === "string" ? raw : dec.decode(raw as ArrayBuffer);
        frames.push(t.slice(0, 160));
        if (t.includes("setupComplete")) {
          try {
            ws.close();
          } catch {
            /* уже закрыт */
          }
          finish("OK setupComplete");
        }
      });
      ws.addEventListener("close", (e) => {
        const ce = e as CloseEvent;
        finish(`close ${ce.code} ${String(ce.reason ?? "").slice(0, 100)} | frames: ${frames.join(" || ").slice(0, 200)}`);
      });
      ws.addEventListener("error", () => {
        finish(`ws-error | frames: ${frames.join(" || ").slice(0, 200)}`);
      });
      // Показать в итоге и то, что пришло до таймаута
      setTimeout(() => finish(`timeout | frames: ${frames.join(" || ").slice(0, 200)}`), 7500);
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
          },
        }),
      );
    })();
  });

export const Route = createFileRoute("/api/gtr-bro-gemtest")({
  server: {
    handlers: {
      POST: async () => {
        const user = await currentUser();
        if (!user?.boss) return json({ error: "forbidden" }, 403);
        const key =
          (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : undefined) ?? "";
        if (!key) return json({ error: "no-key" }, 503);

        const out: Record<string, unknown> = {};

        // Какие live-модели вообще доступны этому ключу.
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          const d = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
          out["live-models"] = (d.models ?? [])
            .filter((m) => m.supportedGenerationMethods?.includes("bidiGenerateContent"))
            .map((m) => m.name);
        } catch (e) {
          out["live-models"] = String(e).slice(0, 100);
        }

        // Прямой ключ на трёх моделях — с дампом всех пришедших фреймов.
        out["direct-native"] = await tryWs(
          `${WS}.v1beta.GenerativeService.BidiGenerateContent?key=${key}`,
          {},
          MODEL,
        );
        out["direct-live25"] = await tryWs(
          `${WS}.v1beta.GenerativeService.BidiGenerateContent?key=${key}`,
          {},
          "gemini-live-2.5-flash",
        );
        // Догадка: эфемерный токен живёт на отдельном endpoint'е
        // BidiGenerateContentConstrained.
        const mk = async (body: unknown): Promise<string | null> => {
          const r = await mkTokenRaw(key, body);
          try {
            return (JSON.parse(r.body) as { name?: string }).name ?? null;
          } catch {
            return null;
          }
        };
        const plain = { uses: 1, expireTime: new Date(Date.now() + 10 * 60_000).toISOString() };
        const constrained = { ...plain, bidiGenerateContentSetup: { model: `models/${MODEL}` } };

        const t1 = await mk(plain);
        if (t1)
          out["constr-access"] = await tryWs(
            `${WS}.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(t1)}`,
            {},
          );
        const t2 = await mk(plain);
        if (t2)
          out["constr-key"] = await tryWs(
            `${WS}.v1alpha.GenerativeService.BidiGenerateContentConstrained?key=${encodeURIComponent(t2)}`,
            {},
          );
        const t3 = await mk(constrained);
        if (t3)
          out["constr-locked-access"] = await tryWs(
            `${WS}.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(t3)}`,
            {},
          );

        return json({ model: MODEL, results: out });
      },
    },
  },
});
