// Конвейер наполнения: чего не хватает площадке, чтобы её показали.
//
// Замер по базе (scripts/venue-readiness.mjs) показал, где мы стоим:
// из 354 площадок 56 невидимы гостю вовсе, ещё 143 стоят на карте
// точкой без фото — то есть в списке их пролистывают не глядя. Реклама
// на такую базу льёт деньги в половину карточек.
//
// «Наполнять по 20 в день» работает только с очередью, и очередь должна
// быть не алфавитной. Площадка, которой не хватает одного поля, стоит
// пятнадцати минут; площадка, которой не хватает шести, — целого дня.
// Поэтому здесь считается не «готово/не готово», а лесенка уровней и
// цена шага до следующего.
//
// Модуль чистый: ни сети, ни React, ни KV. Сервер подставляет сюда
// статику вместе с тем, что уже прислали сами площадки.

/** Поля, по которым меряется готовность. Порядок — порядок разговора
 *  с площадкой: сперва «где вы», потом «как выглядите», потом «что у
 *  вас есть». */
export const FILL_FIELDS = [
  { key: "geo", label: "координата", why: "без неё нет ни на карте, ни в «рядом со мной»" },
  { key: "type", label: "категория", why: "иначе точка серая и не попадает в фильтры" },
  { key: "photo", label: "главное фото", why: "карточку без картинки пролистывают" },
  { key: "concept", label: "описание", why: "по нему гость выбирает между двумя соседями" },
  { key: "contact", label: "контакт", why: "без него заявку некому передать" },
  { key: "capacity", label: "вместимость", why: "первый вопрос организатора" },
  { key: "music", label: "музыка", why: "по ней работает подбор под вкус гостя" },
  { key: "gallery", label: "галерея 3+", why: "витрина заведения, а не одна картинка" },
] as const;

export type FillKey = (typeof FILL_FIELDS)[number]["key"];

/** Уровни идут лесенкой: каждый следующий включает предыдущий.
 *
 *  Смысл лесенки в том, что она совпадает с тем, где площадку видно.
 *  «На карте» — точка есть. «В списке» — есть картинка, и карточка
 *  перестаёт быть строкой текста. «В витрине» — есть что читать.
 *  «В продаже» — есть кому звонить и что предложить организатору. */
export const FILL_LEVELS = ["невидима", "на карте", "в списке", "в витрине", "в продаже"] as const;
export type FillLevel = (typeof FILL_LEVELS)[number];

export type FillInput = {
  tag?: string;
  concept?: string;
  phone?: string;
  email?: string;
  website?: string;
  capacity?: string;
  music?: string;
};

/** Что уже прислали сами площадки или залила команда — поверх статики. */
export type FillExtra = {
  hasGeo?: boolean;
  hero?: string;
  gallery?: number;
  /** контакт и вместимость из подтверждения по магик-ссылке */
  confirmedContact?: boolean;
  confirmedCapacity?: string;
};

const has = (s?: string) => typeof s === "string" && s.trim().length > 0;
/** Описание считаем настоящим, а не отпиской: «—» и одно слово не в счёт. */
const realText = (s: string | undefined, min: number) =>
  has(s) && s!.trim().length >= min && !/^[-—–\s]+$/.test(s!.trim());

/** Какие поля пусты. Возвращает ключи в порядке FILL_FIELDS. */
export const venueGaps = (v: FillInput, extra: FillExtra = {}): FillKey[] => {
  const ok: Record<FillKey, boolean> = {
    geo: Boolean(extra.hasGeo),
    type: has(v.tag) && v.tag !== "Other",
    photo: has(extra.hero),
    concept: realText(v.concept, 40),
    contact: Boolean(extra.confirmedContact) || has(v.phone) || has(v.email) || has(v.website),
    capacity:
      (has(extra.confirmedCapacity) && /\d/.test(extra.confirmedCapacity!)) ||
      (has(v.capacity) && /\d/.test(String(v.capacity))),
    music: realText(v.music, 10),
    gallery: (extra.gallery ?? 0) >= 3,
  };
  return FILL_FIELDS.filter((f) => !ok[f.key]).map((f) => f.key);
};

export const fillLevel = (gaps: readonly FillKey[]): FillLevel => {
  const missing = new Set(gaps);
  if (missing.has("geo") || missing.has("type")) return "невидима";
  if (missing.has("photo")) return "на карте";
  if (missing.has("concept")) return "в списке";
  if (missing.has("contact") || missing.has("capacity")) return "в витрине";
  return "в продаже";
};

/** Что закрыть прямо сейчас, чтобы площадка поднялась на ступень.
 *
 *  Это не то же самое, что все её пробелы. У площадки без координаты и
 *  без галереи пробелов два, а шаг один: координата. Показывать оба
 *  одинаково — значит заставлять менеджера каждый раз соображать, что
 *  из списка сегодняшнее, а что потом. */
export const stepGaps = (gaps: readonly FillKey[]): FillKey[] => {
  const missing = new Set(gaps);
  const pick = (...keys: FillKey[]) => keys.filter((k) => missing.has(k));
  const visible = pick("geo", "type");
  if (visible.length) return visible;
  if (missing.has("photo")) return ["photo"];
  if (missing.has("concept")) return ["concept"];
  const sale = pick("contact", "capacity");
  if (sale.length) return sale;
  return pick("music", "gallery");
};

/** Сколько полей осталось до следующей ступени — цена шага.
 *
 *  Именно по ней сортируется очередь: закрыть одно поле у двадцати
 *  площадок выгоднее, чем шесть полей у трёх. */
export const stepCost = (gaps: readonly FillKey[]): number => stepGaps(gaps).length;

export type FillRow = {
  id: string;
  name: string;
  region: string;
  area: string;
  gaps: FillKey[];
  level: FillLevel;
  cost: number;
};

/** Очередь наполнения: сперва дешёвые шаги, при равной цене — те, кто
 *  ниже по лесенке.
 *
 *  Второе правило важнее, чем кажется. Пятнадцать минут на фото для
 *  площадки «на карте» выводят её в список, где её вообще начнут видеть.
 *  Те же пятнадцать минут на описание для площадки «в списке» лишь
 *  улучшают то, что уже показывается. При равной цене выгоднее первое.
 *
 *  Доведённые до «в продаже» из очереди уходят: они уже работают, и
 *  держать их в списке дел — значит прятать за ними настоящую работу. */
export const fillQueue = (rows: readonly FillRow[]): FillRow[] =>
  rows
    .filter((r) => r.level !== "в продаже")
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        FILL_LEVELS.indexOf(a.level) - FILL_LEVELS.indexOf(b.level) ||
        a.gaps.length - b.gaps.length ||
        a.name.localeCompare(b.name),
    );

/** Сводка по уровням — то, что показывает движение день ко дню. */
export const fillSummary = (rows: readonly FillRow[]): Record<FillLevel, number> => {
  const out = Object.fromEntries(FILL_LEVELS.map((l) => [l, 0])) as Record<FillLevel, number>;
  for (const r of rows) out[r.level]++;
  return out;
};
