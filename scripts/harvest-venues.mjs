// Сбор паспортов площадок с их собственных сайтов.
//
// Ходит по сайтам площадок, читает разметку schema.org и складывает
// найденное с указанием источника. Ничего не придумывает: чего нет в
// разметке — того нет в результате.
//
// Запуск: node scripts/harvest-venues.mjs [--limit N] [--out файл]
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PATHS = ["", "/contact", "/contact-us", "/about", "/visit"];
const CONCURRENCY = 6;
const TIMEOUT = 15_000;

const args = process.argv.slice(2);
const num = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) || def : def;
};
const str = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = num("--limit", 999);
const OUT = str("--out", "src/gtr/data/venue-facts.json");

// Извлечение берём из модуля продукта, а не переписываем: одна логика,
// закрытая тестами, вместо двух похожих.
execSync(
  "npx esbuild src/gtr/venue-harvest.ts --bundle --format=esm --platform=node --outfile=/tmp/harvest.mjs --log-level=error",
  { stdio: "inherit" },
);
const { factsFromHtml } = await import("/tmp/harvest.mjs");

const raw = JSON.parse(readFileSync("src/gtr/data/venues.json", "utf8"));
const venues = (Array.isArray(raw) ? raw : raw.venues).filter((v) => v.website);

// Куда идти за паспортом. Первым делом — по тому адресу, который стоит в
// базе: у площадок внутри отелей это страница самой площадки, и часы там
// её собственные, а на главной группы — часы ресепшена или ничего.
const pagesFor = (website) => {
  let u;
  try {
    u = new URL(website.startsWith("http") ? website : `https://${website}`);
  } catch {
    return null;
  }
  const root = `${u.protocol}//${u.host}`;
  const exact = u.pathname.replace(/\/+$/, "") ? [u.toString()] : [];
  return [...exact, root, ...PATHS.slice(1).map((p) => root + p)];
};

const get = async (url) => {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
};

const today = new Date().toISOString().slice(0, 10);

async function harvest(v) {
  const pages = pagesFor(v.website);
  if (!pages) return { id: v.id, name: v.name, status: "bad-url" };
  let best = null;
  let reached = false;
  for (const page of pages) {
    const html = await get(page);
    if (!html) continue;
    reached = true;
    const f = factsFromHtml(html, page, today);
    if (!f) continue;
    const score = (f.hours ? 2 : 0) + (f.address ? 1 : 0) + (f.phone ? 1 : 0) + (f.email ? 1 : 0);
    if (!best || score > best.score) best = { ...f, score };
    if (f.hours && f.address && f.phone) break; // полный набор — дальше не ходим
  }
  // «Не открылся» и «открылся, но данных нет» — разные вещи: первое чинится
  // с нашей стороны, второе нет. Одним словом их звать значит не знать,
  // сколько площадок мы ещё можем закрыть.
  if (!best) return { id: v.id, name: v.name, status: reached ? "no-markup" : "unreachable" };
  const { score, ...facts } = best;
  return { id: v.id, name: v.name, status: "ok", ...facts };
}

const queue = venues.slice(0, LIMIT);
const results = [];
let done = 0;
async function worker() {
  for (;;) {
    const v = queue.shift();
    if (!v) return;
    results.push(await harvest(v));
    done++;
    if (done % 10 === 0) process.stderr.write(`  ${done}/${venues.slice(0, LIMIT).length}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ok = results.filter((r) => r.status === "ok");
const byField = (f) => ok.filter((r) => r[f]).length;
const report = {
  meta: {
    collectedAt: today,
    note: "Паспорта площадок из разметки schema.org на их собственных сайтах. Каждый факт с адресом страницы, откуда взят. Ничего не сгенерировано.",
    sitesTried: results.length,
    withMarkup: ok.length,
    noMarkup: results.filter((r) => r.status === "no-markup").length,
    unreachable: results.filter((r) => r.status === "unreachable").length,
    hours: byField("hours"),
    address: byField("address"),
    phone: byField("phone"),
    email: byField("email"),
  },
  venues: results.sort((a, b) => a.id.localeCompare(b.id)),
};
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.meta, null, 2));
