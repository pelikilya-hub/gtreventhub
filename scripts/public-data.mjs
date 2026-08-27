// Разделение базы на публичную и рабочую части.
//
// Приложение — обычный сайт: всё, что импортирует экран, уезжает в
// браузер целиком и скачивается прямой ссылкой на бандл, без всякого
// входа. Проверено на своём же проде: файл с базой артистов отдавался
// анонимно, а внутри лежали 26 почт и 35 телефонов букинга.
//
// Каталог (имена, стили, ссылки) в браузере быть обязан — его показывают
// на экране. Контакты, менеджмент, райдеры, заметки разведки и источники
// показываются только команде и потому не имеют права там оказаться:
// теперь они приходят server-функцией с проверкой роли.
//
// Скрипт запускается перед сборкой и переписывает *.public.json.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

/** Отпечаток витрины. Копирование каталога целиком оставляет в копии наш
 *  идентификатор — это не защита, а доказательство происхождения. */
const fingerprint = (payload) =>
  "GTR-" + createHash("sha256").update(payload).digest("hex").slice(0, 12);

/** Поля артиста, которые видит браузер. Всё, чего нет в списке, остаётся
 *  на сервере — принцип «разрешено только перечисленное». */
const ARTIST_PUBLIC = [
  "id", "name", "cat", "catRu", "kind", "role", "roleRu", "base", "baseRu",
  "status", "statusRu", "prio", "tier", "group", "styles", "styleIds", "genre",
  "venue", "web", "ig", "fb", "sp", "sc", "yt", "bp", "twitch", "bio",
  "verified", "quality", "rel", "relRu", "labels",
];

/** Поля площадки, которые видит браузер. Телефон и почта площадки —
 *  рабочий контакт команды, в публичной части их нет. */
const VENUE_PUBLIC = [
  "id", "name", "type", "tag", "area", "cluster", "district", "concept",
  "events", "facilities", "capacity", "catering", "music", "website", "social",
  "address", "gallery", "readiness", "status", "verified",
  // Провенанс данных — метка качества, которую интерфейс показывает
  // команде: откуда взяли и насколько уверены. Секрета в ней нет, а без
  // неё падал экран базы: код читал confidence без защиты.
  "confidence", "source", "sourceType",
  "capacityKind", "capacityOriginal", "capacitySource",
];

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// ---- артисты
const A = JSON.parse(readFileSync("src/gtr/data/artists.json", "utf8"));
const artistsPub = {
  ...A,
  meta: {
    ...(A.meta ?? {}),
    scope: "public",
    note: "Публичная витрина GTR Event: контакты и разведка живут на сервере.",
    rights: "© GTR Event. Каталог собран командой GTR; копирование и машинный сбор запрещены.",
    fingerprint: fingerprint(JSON.stringify(A.artists.map((a) => a.id))),
  },
  artists: A.artists.map((a) => pick(a, ARTIST_PUBLIC)),
};
writeFileSync("src/gtr/data/artists.public.json", JSON.stringify(artistsPub, null, 2));

// ---- площадки
const V = JSON.parse(readFileSync("src/gtr/data/venues.json", "utf8"));
const venuesPub = {
  meta: {
    ...(V.meta ?? {}),
    scope: "public",
    note: "Публичная витрина GTR Event: контакты и разведка живут на сервере.",
    rights: "© GTR Event. Каталог собран командой GTR; копирование и машинный сбор запрещены.",
    fingerprint: fingerprint(JSON.stringify(V.venues.map((v) => v.id))),
  },
  venues: V.venues.map((v) => pick(v, VENUE_PUBLIC)),
  // Залы нужны карточке площадки — они и так на экране.
  spaces: V.spaces ?? [],
  // Контакты и разведка в браузер не уезжают вовсе.
  contacts: [],
  research: [],
};
writeFileSync("src/gtr/data/venues.public.json", JSON.stringify(venuesPub, null, 2));

// ---- регионы: те же правила разделения, файл на регион
// Источник — data/regions/<code>.json (полный, с контактами), выход —
// <code>.public.json рядом. Контакты и разведка в браузер не уезжают.
const REG_DIR = "src/gtr/data/regions";
if (existsSync(REG_DIR)) {
  for (const f of readdirSync(REG_DIR)) {
    if (!/^[a-z]{3}\.json$/.test(f)) continue;
    const code = f.slice(0, 3);
    const R = JSON.parse(readFileSync(`${REG_DIR}/${f}`, "utf8"));
    const pub = {
      meta: {
        ...(R.meta ?? {}),
        region: code,
        scope: "public",
        rights: "© GTR Event. Каталог собран командой GTR; копирование и машинный сбор запрещены.",
        fingerprint: fingerprint(JSON.stringify((R.venues ?? []).map((v) => v.id))),
      },
      venues: (R.venues ?? []).map((v) => ({ ...pick(v, VENUE_PUBLIC), region: code })),
      spaces: R.spaces ?? [],
      contacts: [],
      research: [],
    };
    writeFileSync(`${REG_DIR}/${code}.public.json`, JSON.stringify(pub, null, 1) + "\n");
    console.log(`регион ${code}: площадок ${pub.venues.length}, контактов снято ${R.contacts?.length ?? 0}`);
  }
}

const dropped = (full, pub) => {
  const a = new Set(Object.keys(full));
  for (const k of Object.keys(pub)) a.delete(k);
  return [...a];
};
console.log(
  `публичная база: артистов ${artistsPub.artists.length} (снято полей: ${dropped(A.artists[0], artistsPub.artists[0]).join(", ")})`,
);
console.log(
  `публичная база: площадок ${venuesPub.venues.length}, контактов снято ${V.contacts?.length ?? 0}, записей разведки ${V.research?.length ?? 0}`,
);

// ---- подрядчики: цены остаются, контакты и источники — на сервере
const P = JSON.parse(readFileSync("src/gtr/data/vendor-packages.json", "utf8"));
const packsPub = P.map((x) => {
  const { contact: _c, source: _s, ...rest } = x;
  return rest;
});
writeFileSync("src/gtr/data/vendor-packages.public.json", JSON.stringify(packsPub, null, 2));
console.log(`публичная база: пакетов подрядчиков ${packsPub.length}, контактов снято ${P.filter((x) => x.contact).length}`);

// ---- каталог оборудования: спецификации и цены нужны смете, контакты
// поставщиков — нет
const E = JSON.parse(readFileSync("src/gtr/data/equipment.json", "utf8"));
const eqPub = E.map((x) => {
  const { contact: _c, source: _s, ...rest } = x;
  return rest;
});
writeFileSync("src/gtr/data/equipment.public.json", JSON.stringify(eqPub, null, 2));
console.log(`публичная база: позиций оборудования ${eqPub.length}, контактов снято ${E.filter((x) => x.contact).length}`);
