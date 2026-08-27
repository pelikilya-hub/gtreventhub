// Ворота качества региональных баз.
//
// Агенты-разведчики пишут data/regions/<code>.json пачками и параллельно —
// без механической проверки в базу неизбежно просочатся кривые id, чужие
// кластеры и дубли уже существующих площадок. Скрипт валидирует каждую
// региональную базу против реестра regions.json и общей базы: ошибки — код
// выхода 1 (в базу не пускаем), спорное — предупреждения.
//
// Запуск: node scripts/validate-regions.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";

const DIR = "src/gtr/data/regions";
const { _note: _n, ...REGIONS } = JSON.parse(readFileSync("src/gtr/data/regions.json", "utf8"));
const BASE = JSON.parse(readFileSync("src/gtr/data/venues.json", "utf8"));
const GEO = JSON.parse(readFileSync("src/gtr/data/venue-geo.json", "utf8"));

// Словарь ровно тот, по которому живут карта и фильтры (map-style MAP_CATS).
// Свой «почти такой же» словарь в регионах уже стоил нам 97 площадок,
// упавших в «Прочее» серой точкой: тег не совпал регистром и написанием.
const TAGS = new Set([
  "Beach club", "Nightclub", "Rooftop", "Bar / Lounge", "Resort / MICE",
  "Marina / Yacht", "Show / Park", "Live music", "Event space", "Villa", "Other",
]);
const REQUIRED = ["id", "name", "type", "tag", "area", "cluster", "district", "concept", "source", "sourceType", "confidence", "status", "notes"];

const errors = [];
const warns = [];
const seenIds = new Set(BASE.venues.map((v) => v.id));
const seenNames = new Set(BASE.venues.map((v) => v.name.toLowerCase().trim()));

if (!existsSync(DIR)) {
  console.log("регионов нет — нечего проверять");
  process.exit(0);
}

for (const f of readdirSync(DIR).sort()) {
  if (!/^[a-z]{3}\.json$/.test(f)) continue;
  const code = f.slice(0, 3);
  const reg = REGIONS[code];
  if (!reg) {
    errors.push(`${f}: региона «${code}» нет в regions.json`);
    continue;
  }
  const R = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  const idRe = new RegExp(`^${reg.prefix}-\\d{4}$`);
  const clusters = new Set(reg.clusters);

  for (const v of R.venues ?? []) {
    const at = `${f} · ${v.id ?? v.name ?? "?"}`;
    for (const k of REQUIRED)
      if (typeof v[k] !== "string" || (k !== "notes" && v[k].trim() === ""))
        errors.push(`${at}: пустое обязательное поле «${k}»`);
    if (v.id) {
      if (!idRe.test(v.id)) errors.push(`${at}: id не по формату ${reg.prefix}-NNNN`);
      if (seenIds.has(v.id)) errors.push(`${at}: id уже занят`);
      seenIds.add(v.id);
      if (!GEO[v.id]) warns.push(`${at}: нет координаты в venue-geo.json — не попадёт на карту`);
    }
    if (v.tag && !TAGS.has(v.tag)) errors.push(`${at}: tag «${v.tag}» вне словаря`);
    if (clusters.size && v.cluster && !clusters.has(v.cluster))
      errors.push(`${at}: cluster «${v.cluster}» вне словаря региона`);
    if (v.confidence && !["high", "medium", "low"].includes(String(v.confidence).toLowerCase()))
      errors.push(`${at}: confidence «${v.confidence}» — жду high/medium/low`);
    const nm = (v.name ?? "").toLowerCase().trim();
    if (nm && seenNames.has(nm)) warns.push(`${at}: имя совпадает с уже существующей площадкой — проверить дубль`);
    seenNames.add(nm);
    if (v.source && !/^https?:\/\//.test(v.source)) warns.push(`${at}: source не похож на URL`);
  }
  for (const s of R.spaces ?? [])
    if (!seenIds.has(s.venueId)) errors.push(`${f} · ${s.id}: зал ссылается на неизвестную площадку ${s.venueId}`);
  for (const c of R.contacts ?? [])
    if (!seenIds.has(c.venueId)) errors.push(`${f} · ${c.id}: контакт ссылается на неизвестную площадку ${c.venueId}`);
  console.log(`${code}: площадок ${(R.venues ?? []).length}, залов ${(R.spaces ?? []).length}, контактов ${(R.contacts ?? []).length}`);
}

for (const w of warns) console.warn("ПРЕДУПРЕЖДЕНИЕ:", w);
for (const e of errors) console.error("ОШИБКА:", e);
console.log(`итого: ошибок ${errors.length}, предупреждений ${warns.length}`);
process.exit(errors.length ? 1 : 0);
