// Нитро генерирует .output/server/wrangler.json заново на каждый билд и не
// знает о наших биндингах — доклеиваем KV после сборки, перед wrangler deploy.
import { readFileSync, writeFileSync } from "node:fs";

const p = ".output/server/wrangler.json";
const cfg = JSON.parse(readFileSync(p, "utf8"));
cfg.kv_namespaces = [{ binding: "GTR_KV", id: "a26fc466919d43e4a2e684d8765810b8" }];
writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log("wrangler.json: добавлен биндинг GTR_KV");
