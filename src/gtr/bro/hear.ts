// Починка того, что послышалось.
//
// Все имена в наших базах — латиницей: Catch Beach Club, XANA, Illuzion,
// Café del Mar. Гость произносит их по-русски, и распознавание честно
// отдаёт кириллицу: «кетч бич клаб», «ксана», «иллюжн», «кафе дель мар».
// Дальше эта строка идёт двумя путями, и оба ломаются: она печатается на
// табло как услышанное — человек видит, что его не поняли; и она уходит
// в поиск, где по «кетч» не находится ничего.
//
// Мост между двумя записями — согласный скелет. Гласные при переносе
// между языками плывут сильнее всего («catch» против «кетч»), а согласные
// держатся: ktch и там и там. Поэтому имя сводится к согласным с
// сохранением диграфов, и совпадение ищется по нему.
//
// Замена делается только при ОДНОЗНАЧНОМ совпадении: два разных места с
// одним скелетом — повод не трогать текст вовсе. Испортить услышанное
// хуже, чем оставить как есть: неверную догадку человек прочтёт на табло
// как нашу ошибку, а не как свою.

/** Кириллица в латиницу — по звучанию, а не по ГОСТу. */
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "u", я: "a",
};

const translit = (s: string): string =>
  [...s.toLowerCase()].map((c) => (c in CYR ? CYR[c] : c)).join("");

/** Согласный скелет имени: то общее, что переживает перевод на слух. */
export const skeleton = (raw: string): string => {
  let s = translit(
    raw
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // é → e
      .toLowerCase(),
  );
  s = s.replace(/[^a-z]+/g, "");
  // Диграфы — до сжатия: иначе sh и ch рассыплются на отдельные буквы и
  // перестанут совпадать с ш и ч.
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sh")
    .replace(/tch/g, "ch")
    .replace(/th/g, "t")
    .replace(/sh/g, "S")
    .replace(/ch/g, "C")
    .replace(/kh/g, "h");
  // Латинские причуды к общему знаменателю.
  s = s
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/c/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    // Illuzion слышится как «иллюжн»: з и ж на слух между языками одно и
    // то же, и различать их тут значит терять совпадение.
    .replace(/j/g, "z");
  s = s.replace(/[aeiou]/g, "");
  s = s.replace(/(.)\1+/g, "$1"); // ll → l
  return s;
};

/** Слова, которые сами по себе именем не бывают: слишком часты в речи и
 *  дают ложные срабатывания на коротком скелете. */
const STOP = new Set([
  "beach", "club", "bar", "the", "phuket", "sky", "lounge", "resort",
  "hotel", "cafe", "house", "place", "star", "point", "yacht", "dj",
  "бич", "клаб", "бар", "пхукет", "кафе", "клуб", "отель",
]);

/** Хвосты названий, которые ничего не различают: почти у каждого второго
 *  места есть Beach Club и Phuket в имени. Гость говорит «ксана», а не
 *  «ксана бич клаб пхукет», и узнавать нужно именно короткую часть. */
const GENERIC = new Set([
  "beach", "club", "bar", "phuket", "resort", "hotel", "lounge", "restaurant",
  "the", "at", "and", "cafe", "café", "house", "sky", "villas", "villa",
  "pool", "kitchen", "grill", "rooftop", "seaside", "by",
]);

/** Отличительная часть названия: без общих хвостов. */
const head = (name: string): string => {
  const parts = name.split(/[\s/·,–—-]+/).filter(Boolean);
  const keep: string[] = [];
  for (const p of parts) {
    if (GENERIC.has(p.toLowerCase())) break;
    keep.push(p);
  }
  return keep.join(" ");
};

export type HeardIndex = Map<string, string | null>;

/** Индекс «скелет → каноническое имя». null означает неоднозначность:
 *  такой скелет мы не трогаем. */
export const buildHeardIndex = (names: string[]): HeardIndex => {
  const ix: HeardIndex = new Map();
  const put = (key: string, canonical: string) => {
    // Скелет короче трёх согласных совпадает со слишком многим.
    if (key.length < 3) return;
    const prev = ix.get(key);
    if (prev === undefined) ix.set(key, canonical);
    else if (prev !== canonical) ix.set(key, null);
  };
  const clean = names.map((n) => n.trim()).filter(Boolean);
  // Полные имена first: они точнее, и на их ключи короткие не посягают.
  for (const name of clean) put(skeleton(name), name);
  // Короткая часть — только если ключ ещё свободен. Иначе «Catch» из
  // «Catch Beach Club» перебило бы одноимённое место с полным именем.
  for (const name of clean) {
    const h = head(name);
    if (!h || h === name) continue;
    const key = skeleton(h);
    if (key.length < 3) continue;
    if (!ix.has(key)) ix.set(key, name);
    else if (ix.get(key) !== name) ix.set(key, null);
  }
  return ix;
};

const words = (s: string): { w: string; i: number }[] => {
  const out: { w: string; i: number }[] = [];
  const re = /[\p{L}\p{N}'’-]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ w: m[0], i: m.index });
  return out;
};

/** Заменить услышанное на то, как это называется на самом деле.
 *
 *  Идём по фразам от длинных к коротким: «кетч бич клаб» должно стать
 *  «Catch Beach Club» целиком, а не «Catch» плюс два случайных слова. */
export const fixHeard = (text: string, ix: HeardIndex, maxWords = 4): string => {
  const ws = words(text);
  if (!ws.length) return text;
  const taken = new Array(ws.length).fill(false);
  const edits: { from: number; to: number; with: string }[] = [];

  for (let n = Math.min(maxWords, ws.length); n >= 1; n--) {
    for (let i = 0; i + n <= ws.length; i++) {
      if (taken.slice(i, i + n).some(Boolean)) continue;
      const span = ws.slice(i, i + n);
      const phrase = span.map((x) => x.w).join(" ");
      // Одно слово из стоп-листа именем не считаем.
      if (n === 1 && STOP.has(span[0].w.toLowerCase())) continue;
      const key = skeleton(phrase);
      if (key.length < 3) continue;
      const hit = ix.get(key);
      if (!hit) continue;
      // Уже написано правильно — не переписываем.
      if (phrase.toLowerCase() === hit.toLowerCase()) {
        for (let k = i; k < i + n; k++) taken[k] = true;
        continue;
      }
      const from = span[0].i;
      const last = span[n - 1];
      edits.push({ from, to: last.i + last.w.length, with: hit });
      for (let k = i; k < i + n; k++) taken[k] = true;
    }
  }

  if (!edits.length) return text;
  edits.sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.with + out.slice(e.to);
  return out;
};
