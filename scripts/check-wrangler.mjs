// Страж сборки: сгенерированный wrangler.json обязан нести боевой конфиг.
//
// Nitro вливает корневой wrangler.jsonc в .output/server/wrangler.json.
// Если это сломается (обновление nitro, переезд файла) — деплой уедет без
// KV, и продукт ляжет молча, как 18.08.2026. Дешевле уронить сборку здесь.
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(".output/server/wrangler.json", "utf8"));
const fail = (msg) => {
  console.error(`check-wrangler: ${msg}`);
  process.exit(1);
};

if (cfg.name !== "gtr-event-hub") fail(`имя воркера "${cfg.name}", ждали gtr-event-hub`);
if (!cfg.kv_namespaces?.some((n) => n.binding === "GTR_KV" && n.id))
  fail("нет биндинга GTR_KV — деплой уронит вход, регистрацию и BRO");
if (!cfg.triggers?.crons?.length) fail("нет кронов — афиши и обучение BRO встанут");
// Дата совместимости обязана совпадать с зафиксированной в корневом
// wrangler.jsonc — иначе она снова поплывёт с датой сборки.
const root = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""),
);
if (cfg.compatibility_date !== root.compatibility_date)
  fail(
    `compatibility_date "${cfg.compatibility_date}" ≠ "${root.compatibility_date}" из wrangler.jsonc — дата должна быть зафиксирована, а не плыть с датой сборки`,
  );
if (!cfg.compatibility_flags?.includes("nodejs_compat")) fail("нет nodejs_compat");

console.log("check-wrangler: конфиг воркера боевой (KV, кроны, имя, дата совместимости)");
