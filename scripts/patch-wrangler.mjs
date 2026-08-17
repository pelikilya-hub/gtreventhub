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
// ------------------------------------------------------------------
// Периметр воркера: сюда приходит каждый запрос к продукту, и здесь же
// дешевле всего отсечь то, чему в продукте делать нечего.
//
// Краулеры ИИ и скрейперы представляются честно — по User-Agent. Это не
// защита от целенаправленного копирования (агент подделает заголовок),
// но она снимает поток промышленного сбора данных и, вместе с robots.txt,
// фиксирует заявленную волю правообладателя.
const BOTS = /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|Bytespider|CCBot|Amazonbot|meta-externalagent|cohere-ai|Diffbot|omgili|Timpibot|ImagesiftBot|DataForSeoBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|scrapy|python-requests|python-urllib|Go-http-client|node-fetch|axios|libwww-perl|HTTrack|Wget|curl)/i;

// Заголовки безопасности на каждый ответ. Главное здесь — frame-ancestors:
// без него чужой сайт может встроить продукт в iframe и выдать за свой.
const SECURITY = {
  "content-security-policy": "frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "interest-cohort=(), browsing-topics=()",
  "x-robots-tag": "noai, noimageai",
};

const withSecurity = (res) => {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};

export default {
  async fetch(req, env, ctx) {
    const ua = req.headers.get("user-agent") || "";
    if (BOTS.test(ua))
      return new Response(
        "GTR Event: автоматический сбор данных запрещён. Каталог площадок и артистов, база знаний и логика продукта защищены авторским правом. По вопросам доступа: pelikilya@gmail.com",
        { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noai, noindex" } },
      );
    return withSecurity(await worker.fetch(req, env, ctx));
  },
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
    // 04:00 UTC = 11:00 Пхукета — BRO учит одну-две новые темы в день.
    if (event.cron === "0 4 * * *") {
      const key = await derive(env, "afisha");
      ctx.waitUntil(
        fetch("https://gtr-event-hub.gtr-event.workers.dev/api/bro-learn?key=" + key),
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
cfg.triggers = { crons: ["0 */2 * * *", "0 13 * * *", "0 10 * * *", "0 2 * * *", "0 4 * * *"] };
writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log("wrangler.json: GTR_KV + кроны (афиши 2ч, отчёт 20:00, дайджест 17:00, цены вилл 09:00, обучение BRO 11:00 Пхукета)");
