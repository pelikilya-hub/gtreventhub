// Автонаполнение площадок: то, что машина выводит сама.
//
// Замер (venue-readiness.mjs) показал 56 площадок, которых гость не
// увидит вовсе: 11 без категории и 45 без координаты. И то и другое —
// работа, которую незачем делать руками.
//
// Категория выводится из поля type: оно у нас заполнено почти везде и
// написано человеческим языком («Water park / event venue», «Hotel /
// meeting rooms»). Правила читают его и раскладывают по категориям
// карты. Ничего не подошло — оставляем «Other»: выдумать категорию
// хуже, чем признать, что её нет.
//
// Координата берётся геокодером OpenStreetMap по названию площадки.
// Здесь главная опасность не в том, что геокодер промолчит, а
// в том, что он уверенно ответит не тем: «Bodega» есть в Испании, а
// «Harmony Beach Club» — в десятке стран. Поэтому каждая найденная
// точка проверяется на попадание в границы своего региона, и всё, что
// не попало, отбрасывается. Лучше пустая координата, чем площадка,
// уехавшая на другой континент.
//
// Запуск:
//   node scripts/autofill-venues.mjs --tags     категории
//   node scripts/autofill-venues.mjs --geo      координаты
//   добавьте --dry, чтобы посмотреть, ничего не записывая
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
/** Запущены как команда, а не подключены тестом. Правила разбора имён
 *  и категорий проверяются тестами — им не нужны ни прогон, ни сеть. */
const IS_MAIN = Boolean(process.argv[1]) && resolve(process.argv[1]) === SELF;

const ROOT = join(dirname(SELF), "..");
const DATA = join(ROOT, "src/gtr/data");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1));

const DRY = process.argv.includes("--dry");

// ---------- категории ----------

// Порядок правил — от частного к общему: «beach club» должен сработать
// раньше, чем «club», а «water park» раньше, чем «park».
const TAG_RULES = [
  [/water\s*park|aqua\s*park|theme\s*park/i, "Show / Park"],
  [/live\s*music|jazz|blues|acoustic/i, "Live music"],
  [/beach\s*(club|\/|bar)|beachfront/i, "Beach club"],
  [/rooftop|sky\s*bar|roof\s*terrace/i, "Rooftop"],
  [/night\s*club|nightclub|disco/i, "Nightclub"],
  [/marina|yacht|sailing/i, "Marina / Yacht"],
  [/hotel|resort|meeting\s*room|banquet|conference|mice/i, "Resort / MICE"],
  [/villa|private\s*estate/i, "Villa"],
  [
    /arena|festival|event\s*(venue|space|ground)|meeting\s*space|lifestyle\s*complex|mansion|convention/i,
    "Event space",
  ],
  [/\bbar\b|lounge|\bpub\b|cocktail/i, "Bar / Lounge"],
  [/\bshow\b|\bpark\b|cabaret|theatre|theater/i, "Show / Park"],
  [/\bclub\b/i, "Nightclub"],
];

/** Категория по описанию типа. Пусто — значит правило не нашлось. */
export const tagFromType = (type, name = "") => {
  const hay = `${type ?? ""} ${name ?? ""}`;
  for (const [re, tag] of TAG_RULES) if (re.test(hay)) return tag;
  return "";
};

// ---------- файлы базы ----------

/** Все файлы, где живут площадки: исторический Пхукет и регионы.
 *  Публичная и полная версии правятся вместе — иначе они разойдутся. */
const venueFiles = () => {
  const out = [join(DATA, "venues.json"), join(DATA, "venues.public.json")];
  const dir = join(DATA, "regions");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) out.push(join(dir, f));
  return out;
};

const runTags = () => {
  let fixed = 0;
  const log = [];
  for (const file of venueFiles()) {
    const doc = read(file);
    const list = doc.venues ?? doc;
    if (!Array.isArray(list)) continue;
    let touched = false;
    for (const v of list) {
      if (v.tag && v.tag !== "Other") continue;
      const tag = tagFromType(v.type, v.name);
      if (!tag) continue;
      log.push(`  ${v.id.padEnd(13)} ${String(v.name).slice(0, 32).padEnd(34)} ${String(v.type).slice(0, 34).padEnd(36)} → ${tag}`);
      v.tag = tag;
      touched = true;
      fixed++;
    }
    if (touched && !DRY) write(file, doc);
  }
  console.log(`КАТЕГОРИИ: проставлено ${fixed}${DRY ? " (сухой прогон)" : ""}`);
  // Один и тот же id лежит в двух файлах — считаем площадки, не строки.
  console.log([...new Set(log)].join("\n"));
};

// ---------- координаты ----------

// Границы регионов: всё, что геокодер вернул мимо них, — чужая точка.
// Рамки взяты с запасом по береговой линии, но не настолько, чтобы
// пропустить соседнюю провинцию.
const BOUNDS = {
  phuket: [7.72, 98.24, 8.22, 98.46],
  smu: [9.38, 99.9, 9.62, 100.12],
  pgn: [9.66, 99.94, 9.81, 100.11],
  pty: [12.6, 100.79, 13.02, 101.02],
  bkk: [13.5, 100.3, 13.98, 100.75],
  pna: [8.2, 98.15, 9.2, 98.7],
};
const inBounds = (region, lat, lon) => {
  const b = BOUNDS[region];
  if (!b) return false;
  return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Как это устроено и почему именно так.
//
// Первый прогон нашёл 0 из 45 — и версия «геокодер не понимает наши
// запросы» оказалась неверной. Причина была в другом: Node не ходит
// через прокси окружения без NODE_USE_ENV_PROXY, шёл напрямую и получал
// от периметра 403 «Host not in allowlist». Тот же запрос через curl
// отвечал нормально. Ровно поэтому ниже мы включаем прокси сами и
// отделяем «геокодер недоступен» от «не найдено»: молчаливое
// «не найдено» на сетевой ошибке стоило целого прогона.
//
// Спрашиваем два источника, оба по данным OSM и оба бесплатные.
// Nominatim ищет строгим совпадением: он либо знает точку, либо молчит.
// Photon ищет нечётко и потому добирает то, что Nominatim пропустил, —
// но за это же и опасен: он отвечает всегда и отвечает уверенно. На
// «Q Bar Samui» он первым делом предлагает бар в Коста-Рике, а на
// «Horn Pub» — «Koh Samui Pub Crawl», который стоит ровно в нашем
// регионе и рамку прошёл бы.
//
// Поэтому ответ любого из них проходит два сита:
//   1. координата внутри границ региона — отсекает Коста-Рику и
//      финский «Horn Pub» на 60-й широте;
//   2. имя найденной точки содержит все значимые слова названия —
//      отсекает «Pub Crawl», выданный за «Horn Pub».
// Второе сито важнее первого: пустая координата — это просто работа для
// человека, а чужая координата — гость, приехавший не туда.

// Node 22 не читает HTTPS_PROXY сам, а флаг NODE_USE_ENV_PROXY он
// смотрит один раз при старте — поменять process.env по ходу уже поздно.
// Поэтому перезапускаем себя с флагом: иначе весь исходящий трафик
// скрипта упирается в периметр и возвращает 403 на любой геокодер.
if (IS_MAIN && process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

/** Слова, которые есть у половины заведений побережья и потому ничего
 *  не различают, плюс географические уточнения из наших же названий. */
const GENERIC = new Set([
  "bar", "pub", "club", "cafe", "coffee", "restaurant", "lounge", "resort",
  "hotel", "beach", "the", "and", "of", "at", "on", "a", "de", "la",
  "grill", "kitchen", "house", "village", "center", "centre", "samui",
  "phuket", "phangan", "pattaya", "bangkok", "koh", "ko", "thailand",
  "khaolak", "thai", "island", "sky", "dining", "sports", "diner",
]);

const words = (s) =>
  String(s ?? "")
    .toLowerCase()
    // Апостроф внутри слова не разделитель: иначе «Murphy's» распадается
    // на «murphy» и «s» и перестаёт совпадать с «Murphys» из OSM, где
    // апострофы пишут как придётся.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9฀-๿]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** Совпадает ли найденная точка с тем, что мы искали.
 *  Требуем, чтобы все значимые слова названия нашлись в имени точки:
 *  лишние слова у неё допустимы («Lost Beach Bar & Restaurant» ⊂
 *  «Lost Beach Bar»), а вот пропущенное значимое слово — уже другое
 *  заведение.
 *
 *  Отдельно про короткие слова. Первый прогон принял «Q Signature» за
 *  «Q Bar Samui»: от названия после отсева общих слов осталась одна
 *  буква «q», и она совпала. Одной буквы или пары для узнавания мало —
 *  поэтому короткое единственное слово не считается уликой. */
export const nameMatches = (venueName, hitName) => {
  const want = words(venueName).filter((w) => !GENERIC.has(w));
  if (!want.length) return false; // одни общие слова — узнать нечего
  if (want.length === 1 && want[0].length < 4) return false;
  const got = new Set(words(hitName));
  return want.every((w) => got.has(w));
};

/** Варианты запроса, от точного к общему. Дубли убираем: лишний
 *  одинаковый запрос — лишняя секунда паузы на каждую площадку. */
const queriesFor = (v) => {
  const name = String(v.name ?? "").trim();
  // «Cafe del Mar (Kamala)» → «Cafe del Mar»: скобки в OSM не пишут.
  const noParens = name.replace(/\s*[([].*$/, "").trim() || name;
  return [...new Set([name, noParens, v.area ? `${noParens} ${v.area}` : ""].filter(Boolean))];
};

/** Геокодер недоступен — это не «не найдено». Бросаем, чтобы прогон
 *  остановился и сказал правду, а не записал пустой результат. */
class GeocoderDown extends Error {}

const ask = async (url) => {
  let r;
  try {
    r = await fetch(url, {
      headers: { "User-Agent": "GTR-Event/1.0 (venue geocoding; pelikilya@gmail.com)" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GeocoderDown(`сеть до геокодера: ${e.message}`);
  }
  if (r.status === 403 || r.status === 407 || r.status >= 500)
    throw new GeocoderDown(`геокодер ответил ${r.status}: ${(await r.text()).slice(0, 120)}`);
  if (!r.ok) return null;
  return r.json();
};

/** Строгий источник: отвечает только на точное совпадение. */
const askNominatim = async (q) => {
  const arr =
    (await ask(
      `https://nominatim.openstreetmap.org/search?format=json&namedetails=1&limit=8&q=${encodeURIComponent(q)}`,
    )) ?? [];
  return arr.map((h) => ({
    lat: Number(h.lat),
    lon: Number(h.lon),
    name: h.namedetails?.name || String(h.display_name ?? "").split(",")[0],
    src: "nominatim",
  }));
};

/** Нечёткий источник: добирает пропущенное строгим. Центр региона идёт
 *  подсказкой ранжирования, но решают сита, а не порядок выдачи. */
const askPhoton = async (q, region) => {
  const b = BOUNDS[region];
  const bias = b ? `&lat=${(b[0] + b[2]) / 2}&lon=${(b[1] + b[3]) / 2}` : "";
  const res = await ask(`https://photon.komoot.io/api/?limit=10&q=${encodeURIComponent(q)}${bias}`);
  return (res?.features ?? []).map((f) => ({
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
    name: f.properties?.name,
    src: "photon",
  }));
};

/** Один запрос к одному источнику, пропущенный через оба сита. */
const geocode = async (q, region, venueName, source) => {
  const cands = source === "photon" ? await askPhoton(q, region) : await askNominatim(q);
  for (const c of cands) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    if (!inBounds(region, c.lat, c.lon)) continue;
    if (!nameMatches(venueName, c.name)) continue;
    return { ...c, q };
  }
  return null;
};

const runGeo = async () => {
  const geoPath = join(DATA, "venue-geo.json");
  const geo = read(geoPath);
  const venues = [];
  for (const file of venueFiles()) {
    if (file.endsWith("venues.json") || file.includes("regions")) {
      if (file.endsWith(".public.json")) continue;
      const doc = read(file);
      for (const v of doc.venues ?? doc) venues.push(v);
    }
  }
  const missing = venues.filter((v) => !geo[v.id]);
  console.log(`БЕЗ КООРДИНАТЫ: ${missing.length}`);

  let found = 0;
  let skipped = 0;
  for (const v of missing) {
    const region = v.region || "phuket";
    let hit = null;
    try {
      // Сначала строгий источник по всем вариантам запроса, потом
      // нечёткий: у него выше шанс ответить и выше шанс соврать, так
      // что он идёт добором, а не первым словом.
      outer: for (const source of ["nominatim", "photon"]) {
        for (const q of queriesFor(v)) {
          hit = await geocode(q, region, v.name, source);
          // Nominatim просит не частить сильнее раза в секунду.
          await sleep(source === "nominatim" ? 1100 : 350);
          if (hit) break outer;
        }
      }
    } catch (e) {
      if (!(e instanceof GeocoderDown)) throw e;
      // Молча писать «не найдено» тут значило бы соврать про причину.
      console.error(`\nГЕОКОДЕР НЕДОСТУПЕН — ${e.message}`);
      console.error("Прогон остановлен, найденное до этого места сохранено.");
      break;
    }
    if (!hit) {
      skipped++;
      console.log(`  — ${v.id.padEnd(13)} ${String(v.name).slice(0, 34).padEnd(36)} не найдено`);
      continue;
    }
    geo[v.id] = { lat: hit.lat, lon: hit.lon, src: `${hit.src}-auto` };
    found++;
    console.log(
      `  ✓ ${v.id.padEnd(13)} ${String(v.name).slice(0, 30).padEnd(32)} ${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}  ${hit.src.padEnd(9)} ${String(hit.name).slice(0, 40)}`,
    );
  }
  if (!DRY && found) write(geoPath, geo);
  console.log(`\nНАЙДЕНО: ${found}, не найдено: ${skipped}${DRY ? " (сухой прогон)" : ""}`);
};

if (IS_MAIN) {
  const mode = process.argv.find((a) => a === "--tags" || a === "--geo");
  if (mode === "--tags") runTags();
  else if (mode === "--geo") await runGeo();
  else console.log("Укажите --tags или --geo (плюс --dry для проверки без записи)");
}
