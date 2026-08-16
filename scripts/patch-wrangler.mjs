// Нитро генерирует .output/server/wrangler.json заново на каждый билд и не
// знает о наших биндингах — доклеиваем KV и cron-обёртку после сборки.
import { readFileSync, writeFileSync } from "node:fs";

const p = ".output/server/wrangler.json";
const cfg = JSON.parse(readFileSync(p, "utf8"));
cfg.kv_namespaces = [{ binding: "GTR_KV", id: "a26fc466919d43e4a2e684d8765810b8" }];

// Cron: каждые 2 часа дёргаем сбор афиш через собственный HTTP-роут —
// нитро-энтри не экспортирует scheduled, поэтому оборачиваем.
writeFileSync(
  ".output/server/cron.mjs",
  `import worker from "./index.mjs";
const derive = async (env, salt) => {
  const base = env.GTR_SESSION_SECRET || "gtr-dev";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + base));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
};
export default {
  fetch: (req, env, ctx) => worker.fetch(req, env, ctx),
  async scheduled(event, env, ctx) {
    // 13:00 UTC = 20:00 Пхукета — вечерний отчёт спринта; остальное — афиши
    if (event.cron === "0 13 * * *") {
      const key = await derive(env, "afisha");
      ctx.waitUntil(
        fetch("https://gtr-event-hub.gtr-event.workers.dev/api/sprint-report?key=" + key),
      );
      return;
    }
    // 02:00 UTC = 09:00 Пхукета — ежедневная сверка цен вилл Private
    if (event.cron === "0 2 * * *") {
      const key = await derive(env, "afisha");
      ctx.waitUntil(
        fetch("https://gtr-event-hub.gtr-event.workers.dev/api/villa-check?key=" + key),
      );
      return;
    }
    // 10:00 UTC = 17:00 Пхукета — дайджест вечера в канал комьюнити
    if (event.cron === "0 10 * * *") {
      const key = await derive(env, "afisha");
      ctx.waitUntil(
        fetch("https://gtr-event-hub.gtr-event.workers.dev/api/community-digest?key=" + key),
      );
      return;
    }
    // Афиши. Раньше крон ходил на свой же публичный адрес по сети: лишний
    // контур, где молча отваливается и ключ, и сам запрос — синхронизация
    // встала 14 августа, и понять это можно было только по KV. Теперь зовём
    // собственный обработчик в процессе: ни DNS, ни TLS, ни самообращения.
    // И записываем исход прогона, чтобы следующий разбор занимал минуту.
    const key = await derive(env, "afisha");
    ctx.waitUntil(
      (async () => {
        const started = Date.now();
        let status = 0;
        let body = "";
        try {
          const res = await worker.fetch(
            new Request("https://gtr-event-hub.gtr-event.workers.dev/api/afisha", {
              headers: { "x-afisha-key": key },
            }),
            env,
            ctx,
          );
          status = res.status;
          body = (await res.text()).slice(0, 500);
        } catch (e) {
          body = "throw: " + String(e && e.message ? e.message : e);
        }
        try {
          await env.GTR_KV?.put(
            "afisha:lastrun",
            JSON.stringify({ at: started, ms: Date.now() - started, status, body }),
          );
        } catch {}
      })(),
    );
  },
};
`,
);
cfg.main = "cron.mjs";
cfg.triggers = { crons: ["0 */2 * * *", "0 13 * * *", "0 10 * * *", "0 2 * * *"] };
writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log("wrangler.json: GTR_KV + кроны (афиши 2ч, отчёт 20:00, дайджест 17:00, цены вилл 09:00 Пхукета)");
