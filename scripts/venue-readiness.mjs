// Готовность площадок к показу гостю.
//
// «Наполнять по 20 в день» — лозунг, пока неизвестно, сколько именно
// пусто и по каким полям. Этот скрипт считает дыру честно: берёт ту же
// публичную базу, что уезжает в браузер, и меряет каждую площадку по
// тем полям, которые гость реально видит в карточке и в списке.
//
// Что считаем обязательным для показа:
//   имя и район   — без них карточки нет вовсе;
//   координата    — иначе площадки нет на карте и в «рядом со мной»;
//   описание      — концепция: то, ради чего гость выбирает между двумя;
//   фото          — hero: список без картинок гость пролистывает мимо;
//   тип           — категория карты, иначе точка серая «Прочее».
//
// Дальше — уровни: «на карте» (минимум), «в списке» (плюс фото),
// «в витрине» (плюс описание), «в продаже» (плюс контакт и вместимость).
// Уровень нужен, чтобы очередь наполнения шла не по алфавиту, а от того,
// что ближе всего к готовности.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src/gtr/data");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

// Публичная база: исторический Пхукет + регионы из regions/*.public.json
const venues = [];
const phuket = read(join(DATA, "venues.public.json"));
venues.push(...(phuket.venues ?? phuket));
const regionsDir = join(DATA, "regions");
for (const f of readdirSync(regionsDir).filter((n) => n.endsWith(".public.json"))) {
  const r = read(join(regionsDir, f));
  venues.push(...(r.venues ?? r));
}

const geo = read(join(DATA, "venue-geo.json"));
const rich = read(join(DATA, "rich.json"));

const has = (s) => typeof s === "string" && s.trim().length > 0;
/** Описание считаем настоящим, а не отпиской: одно слово или «—» не в счёт. */
const realText = (s, min = 40) => has(s) && s.trim().length >= min && !/^[-—–\s]+$/.test(s);

const rows = venues.map((v) => {
  const r = rich[v.id] ?? {};
  const f = {
    geo: Boolean(geo[v.id]),
    photo: has(r.hero),
    gallery: Array.isArray(r.gallery) && r.gallery.length >= 3,
    concept: realText(v.concept),
    type: has(v.tag) && v.tag !== "Other",
    contact: has(v.phone) || has(v.email) || has(v.website),
    capacity: has(v.capacity) && /\d/.test(String(v.capacity)),
    music: realText(v.music, 10),
    afisha: Array.isArray(r.afisha) && r.afisha.length > 0,
  };
  // Уровни идут лесенкой: каждый следующий включает предыдущий.
  const onMap = f.geo && f.type;
  const inList = onMap && f.photo;
  const inShow = inList && f.concept;
  const forSale = inShow && f.contact && f.capacity;
  return {
    id: v.id,
    name: v.name,
    region: v.region || "phuket",
    area: v.area || "",
    f,
    level: forSale ? "в продаже" : inShow ? "в витрине" : inList ? "в списке" : onMap ? "на карте" : "невидима",
  };
});

const LEVELS = ["невидима", "на карте", "в списке", "в витрине", "в продаже"];
const pct = (n) => `${Math.round((n / rows.length) * 100)}%`;

console.log(`ВСЕГО ПЛОЩАДОК: ${rows.length}\n`);
console.log("УРОВЕНЬ ГОТОВНОСТИ");
for (const L of LEVELS) {
  const n = rows.filter((r) => r.level === L).length;
  console.log(`  ${L.padEnd(12)} ${String(n).padStart(4)}  ${pct(n).padStart(4)}  ${"█".repeat(Math.round((n / rows.length) * 46))}`);
}

console.log("\nЧЕГО НЕ ХВАТАЕТ (по полям, все площадки)");
const FIELD_RU = {
  geo: "координата",
  type: "категория",
  photo: "главное фото",
  gallery: "галерея 3+",
  concept: "описание",
  contact: "контакт",
  capacity: "вместимость",
  music: "музыка",
  afisha: "афиша",
};
for (const k of Object.keys(FIELD_RU)) {
  const miss = rows.filter((r) => !r.f[k]).length;
  console.log(`  ${FIELD_RU[k].padEnd(14)} нет у ${String(miss).padStart(4)}  ${pct(miss).padStart(4)}  ${"▓".repeat(Math.round((miss / rows.length) * 40))}`);
}

console.log("\nПО РЕГИОНАМ (готовы к витрине / всего)");
const byRegion = {};
for (const r of rows) {
  const b = (byRegion[r.region] ??= { total: 0, show: 0 });
  b.total++;
  if (r.level === "в витрине" || r.level === "в продаже") b.show++;
}
for (const [code, b] of Object.entries(byRegion).sort((a, c) => c[1].total - a[1].total))
  console.log(`  ${code.padEnd(10)} ${String(b.show).padStart(3)} / ${String(b.total).padStart(3)}  ${Math.round((b.show / b.total) * 100)}%`);

// Очередь наполнения: сперва те, кому до следующего уровня остался
// один шаг. Работать по алфавиту — значит весь день двигать площадки,
// которые всё равно не покажутся.
const cost = (r) => Object.values(r.f).filter((x) => !x).length;
const queue = rows
  .filter((r) => r.level !== "в продаже")
  .sort((a, b) => cost(a) - cost(b) || a.name.localeCompare(b.name));

console.log(`\nОЧЕРЕДЬ: ${queue.length} площадок не доведены. Ближайшие 20 (меньше всего работы):`);
for (const r of queue.slice(0, 20)) {
  const miss = Object.keys(FIELD_RU).filter((k) => !r.f[k]).map((k) => FIELD_RU[k]);
  console.log(`  ${r.id}  ${r.name.slice(0, 34).padEnd(34)} ${r.level.padEnd(11)} нет: ${miss.join(", ")}`);
}

const out = join(ROOT, "scripts", "venue-readiness.json");
writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 1));
console.log(`\nПолный разбор: ${out}`);
