// Нитро генерирует .output/server/wrangler.json заново на каждый билд и не
// знает о наших биндингах — доклеиваем KV и cron-обёртку после сборки.
import { readFileSync, writeFileSync } from "node:fs";

const p = ".output/server/wrangler.json";
const cfg = JSON.parse(readFileSync(p, "utf8"));
cfg.kv_namespaces = [{ binding: "GTR_KV", id: "a26fc466919d43e4a2e684d8765810b8" }];

// Cron: каждые 6 часов дёргаем сбор афиш через собственный HTTP-роут —
// нитро-энтри не экспортирует scheduled, поэтому оборачиваем.
writeFileSync(
  ".output/server/cron.mjs",
  `import worker from "./index.mjs";
export default {
  fetch: (req, env, ctx) => worker.fetch(req, env, ctx),
  async scheduled(event, env, ctx) {
    const base = env.GTR_SESSION_SECRET || "gtr-dev";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("afisha:" + base));
    const key = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
    ctx.waitUntil(
      fetch("https://gtr-event-hub.gtr-event.workers.dev/api/afisha", {
        headers: { "x-afisha-key": key },
      }),
    );
  },
};
`,
);
cfg.main = "cron.mjs";
cfg.triggers = { crons: ["0 */6 * * *"] };
writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log("wrangler.json: GTR_KV + cron-обёртка (афиши каждые 6ч)");
