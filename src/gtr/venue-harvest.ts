// Паспорт площадки из её собственных машиночитаемых данных.
//
// В базе 110 площадок, и заполнены они неровно: часы работы известны про
// две, адрес про треть, телефон про половину. Это ровно те поля, которые
// гость спрашивает первыми, и на которые BRO честно отвечает «не знаю».
//
// Придумывать их нельзя: приехать к закрытым дверям хуже, чем услышать
// «уточни звонком». Но и придумывать не нужно — большинство площадок
// публикует это сами, разметкой schema.org в <script type="application/
// ld+json">. Это данные ОТ площадки, а не разбор её вёрстки: они
// переживают редизайн и не требуют модели.
//
// Здесь только извлечение: сеть и запись живут в скрипте прогона, а этот
// модуль разбирает готовый HTML и потому закрыт тестами.

/** Типы schema.org, под которыми площадки описывают себя.
 *
 *  Organization здесь не лишний: половина сайтов — на конструкторах, и
 *  контакты площадки лежат именно в этом узле. Пустой такой узел ничего
 *  не портит — он не наберёт очков и не будет выбран. */
const BIZ_TYPES = new Set([
  "localbusiness", "restaurant", "nightclub", "barorpub", "bar", "cafe",
  "hotel", "resort", "lodgingbusiness", "entertainmentbusiness",
  "foodestablishment", "eventvenue", "place", "winery", "brewery",
  "organization", "corporation", "internetcafe", "touristattraction",
  "spa", "healthandbeautybusiness", "sportsactivitylocation", "casino",
  "amusementpark", "artgallery", "museum", "store",
]);

type LdNode = {
  "@type"?: string | string[];
  "@graph"?: LdNode[];
  name?: string;
  telephone?: string;
  email?: string;
  url?: string;
  openingHours?: string | string[];
  openingHoursSpecification?: unknown;
  address?: unknown;
};

export type VenueFacts = {
  hours?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Откуда взято. Без этого факт непроверяем, а значит бесполезен. */
  source: string;
  fetchedAt: string;
};

const asArray = <T,>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Все узлы разметки со страницы, включая вложенные в @graph. */
export const ldNodes = (html: string): LdNode[] => {
  const nodes: LdNode[] = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const parsed = JSON.parse(m[1]) as LdNode | LdNode[];
      nodes.push(...asArray(parsed));
    } catch {
      // Битая разметка — не наша ошибка, идём к следующему блоку.
    }
  }
  const flat: LdNode[] = [];
  for (const n of nodes) flat.push(n, ...(n["@graph"] ?? []));
  return flat;
};

const DAYS: Record<string, string> = {
  monday: "пн", tuesday: "вт", wednesday: "ср", thursday: "чт",
  friday: "пт", saturday: "сб", sunday: "вс",
  mo: "пн", tu: "вт", we: "ср", th: "чт", fr: "пт", sa: "сб", su: "вс",
};

const dayRu = (d: string): string => {
  const k = String(d).toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
  return DAYS[k] ?? DAYS[k.slice(0, 2)] ?? k;
};

const hhmm = (t: unknown): string => String(t ?? "").slice(0, 5);

/** Одна запись расписания: дни и промежуток. Разметка бывает двух видов —
 *  строками «Mo-Fr 18:00-02:00» и объектами openingHoursSpecification, —
 *  но дальше мы работаем с ними одинаково. */
type Entry = { days: string[]; from: string; to: string };

/** Ночь, разрезанная полуночью, — это одна смена, а не две.
 *  Клубы публикуют «20:30–00:00» и «00:00–03:00» отдельными записями,
 *  потому что так требует формат. Гостю нужно «с 20:30 до 03:00». */
const mergeMidnight = (es: Entry[]): Entry[] => {
  const out = [...es];
  for (let i = 0; i < out.length; i++) {
    const night = out[i];
    if (night.from !== "00:00") continue;
    const j = out.findIndex(
      (e, k) =>
        k !== i &&
        (e.to === "00:00" || e.to === "24:00") &&
        e.days.join() === night.days.join(),
    );
    if (j < 0) continue;
    out[j] = { days: night.days, from: out[j].from, to: night.to };
    out.splice(i, 1);
    i = -1;
  }
  return out;
};

const render = (es: Entry[]): string | undefined => {
  const parts = [...new Set(es.map((e) => oneLine(e.days, spanOf(e.from, e.to))))];
  if (!parts.length) return undefined;
  // Одинаковое расписание у всех дней — не перечисляем семь раз.
  const times = new Set(parts.map((p) => p.split(" ").pop()));
  if (times.size === 1 && es.length >= 6) return `${[...times][0]} · ежедневно`;
  return parts.join("; ");
};

export const readHours = (n: LdNode): string | undefined => {
  const es: Entry[] = [];
  for (const s of asArray(n.openingHoursSpecification as Record<string, unknown>[])) {
    if (!s || typeof s !== "object") continue;
    const from = hhmm(s.opens);
    const to = hhmm(s.closes);
    if (!from || !to) continue;
    es.push({ days: orderDays(asArray(s.dayOfWeek as string | string[]).map(dayRu)), from, to });
  }
  if (!es.length) {
    for (const raw of asArray(n.openingHours).map((x) => String(x).trim()).filter(Boolean)) {
      const e = plainEntry(raw);
      if (e) es.push(e);
    }
  }
  return es.length ? render(mergeMidnight(es)) : undefined;
};

/** Порядок недели: нужен, чтобы разворачивать диапазоны и складывать
 *  дни обратно в понятную человеку строку. */
const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Дни из куска строки до времени. Понимает и перечисление через
 *  запятую, и диапазон: «Mo-Th» это понедельник ПО четверг, а не два
 *  отдельных дня — прочитать его списком значит потерять середину. */
const readDays = (chunk: string): string[] => {
  const out: string[] = [];
  for (const part of chunk.split(/[,;/]+/)) {
    const toks = (part.match(/[a-zа-яё]+/gi) ?? []).map(dayRu).filter((d) => WEEK.includes(d));
    if (!toks.length) continue;
    if (/[-–—]/.test(part) && toks.length >= 2) {
      const a = WEEK.indexOf(toks[0]);
      const b = WEEK.indexOf(toks[toks.length - 1]);
      for (let i = a; ; i = (i + 1) % 7) {
        out.push(WEEK[i]);
        if (i === b) break;
      }
    } else {
      out.push(...toks);
    }
  }
  return [...new Set(out)].sort((x, y) => WEEK.indexOf(x) - WEEK.indexOf(y));
};

/** Дни строкой: подряд идущие сворачиваем в диапазон. */
const daysLabel = (days: string[]): string => {
  const idx = days.map((d) => WEEK.indexOf(d));
  const solid = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return solid && days.length > 2 ? `${days[0]}–${days[days.length - 1]}` : days.join(", ");
};

/** Дни в порядке недели, без повторов: разметка перечисляет их как
 *  придётся, а читать паспорт человеку. */
const orderDays = (days: string[]): string[] =>
  [...new Set(days.filter((d) => WEEK.includes(d)))].sort(
    (x, y) => WEEK.indexOf(x) - WEEK.indexOf(y),
  );

/** Промежуток времени. Сутки напролёт называем словом: «00:00–23:59» —
 *  это способ записи, а не расписание. */
const spanOf = (from: string, to: string): string =>
  from === "00:00" && (to === "23:59" || to === "24:00" || to === "00:00")
    ? "круглосуточно"
    : `${from}–${to}`;

/** Дни и время одной строкой — одинаково для обоих форматов разметки.
 *  Вся неделя разом это «ежедневно», а не перечисление семи дней:
 *  площадки пишут так сплошь, и без этого паспорт читается как выгрузка. */
const oneLine = (days: string[], span: string): string => {
  if (!days.length) return span;
  if (days.length >= 7) return span === "круглосуточно" ? span : `${span} · ежедневно`;
  return `${daysLabel(days)} ${span}`;
};

/** Строка вида «Monday,Tuesday,… 0:00-03:00» к тому же виду, что и
 *  объектный формат. Сайты пишут дни то полными словами, то сокращённо,
 *  то диапазоном — в паспорте площадки это должно выглядеть одинаково,
 *  иначе гость видит не данные, а следы того, как их собирали. */
/** Строка вида «Monday,Tuesday,… 0:00-03:00» в ту же запись, что и
 *  объектный формат. Сайты пишут дни то полными словами, то сокращённо,
 *  то диапазоном — в паспорте площадки это должно выглядеть одинаково,
 *  иначе гость видит не данные, а следы того, как их собирали. */
const plainEntry = (raw: string): Entry | undefined => {
  const m = /(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/.exec(raw);
  // Времени нет — это не часы. Сайты публикуют и голый перечень дней:
  // выглядит как знание, пользы ноль.
  if (!m) return undefined;
  const pad = (t: string) => {
    const [h, mm] = t.replace(".", ":").split(":");
    return `${h.padStart(2, "0")}:${mm}`;
  };
  return { days: readDays(raw.slice(0, m.index)), from: pad(m[1]), to: pad(m[2]) };
};

/** Та же строка, но сразу готовым видом — для тестов и разовых разборов. */
export const normalizePlain = (raw: string): string | undefined => {
  const e = plainEntry(raw);
  return e ? oneLine(e.days, spanOf(e.from, e.to)) : undefined;
};

/** Значение, которого на самом деле нет: сайты кладут в разметку и
 *  пустую строку, и слово null. В паспорте это выглядит как факт. */
const JUNK = new Set(["none", "null", "n/a", "na", "-", "—", "undefined"]);

/** Адрес одной строкой. Части повторяются сплошь и рядом — сайты
 *  дублируют полный адрес в каждом поле, — а повтор читается как ошибка
 *  в наших данных, даже когда он пришёл из чужой разметки. */
const tidyAddress = (bits: string[]): string | undefined => {
  const out: string[] = [];
  for (const raw of bits.flatMap((b) => b.split(","))) {
    const part = raw.trim().replace(/\s+/g, " ");
    if (!part || JUNK.has(part.toLowerCase())) continue;
    // Кусок, который уже есть внутри собранного, — это повтор поля, а не
    // новая часть адреса: «…Phuket 83150, Thailand» плюс отдельные
    // «Phuket» и «83150» читаются как наша ошибка.
    if (out.join(", ").toLowerCase().includes(part.toLowerCase())) continue;
    out.push(part);
  }
  return out.length ? out.join(", ") : undefined;
};

export const readAddress = (n: LdNode): string | undefined => {
  const a = n.address as Record<string, unknown> | string | undefined;
  if (!a) return undefined;
  if (typeof a === "string") return tidyAddress([a]);
  return tidyAddress(
    [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].map((x) => String(x ?? "")),
  );
};

/** Приметы места: Таиланд, тайский индекс или район Пхукета. Список
 *  районов взят из нашей же базы площадок, а не придуман. */
const LOCAL =
  /thailand|thai|phuket|krabi|bangkok|phang|patong|kamala|karon|kata|rawai|chalong|kathu|thalang|surin|layan|laguna|bang\s*tao|cherng|choeng|nai\s*harn|naithon|mai\s*khao|panwa|yamu|ao\s*yon|kalim|tri\s*trang|\b8\d{4}\b/i;

/** Адрес говорит про наше место? Все площадки базы на Пхукете, и если
 *  разметка описывает Флориду — это не она, а головной офис сети.
 *  Такой паспорт не «неполный», а чужой, и брать из него нельзя ничего.
 *  Адреса нет вовсе — не повод отбрасывать: часы и телефон ещё годятся. */
export const looksLocal = (address: string | undefined): boolean =>
  !address || LOCAL.test(address);

/** Телефон в международном виде. Тайские сайты пишут местный номер с
 *  ведущим нулём — гостю с иностранной симкой по нему не дозвониться.
 *  Чужая страна в коде значит, что номер не этой площадки. */
const cleanPhone = (raw: unknown): string | undefined => {
  let s = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return undefined;
  if (s.startsWith("+")) {
    if (!s.startsWith("+66")) return undefined;
    s = `+66${s.slice(3).replace(/^0+/, "")}`;
  } else {
    s = `+66${s.replace(/^66/, "").replace(/^0+/, "")}`;
  }
  const digits = s.replace(/\D/g, "").length;
  // Меньше девяти цифр — это не телефон, а обрывок разметки.
  return digits >= 10 && digits <= 13 ? s : undefined;
};

const cleanEmail = (raw: unknown): string | undefined => {
  const s = String(raw ?? "").replace(/^mailto:/i, "").trim();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : undefined;
};

/** Собрать паспорт площадки со страницы.
 *
 *  Берём узел, который описывает саму площадку. Если их несколько —
 *  предпочитаем тот, у которого больше нужных нам полей: у сайтов часто
 *  висит и WebSite, и Organization, и сам ресторан. */
export const factsFromHtml = (
  html: string,
  source: string,
  fetchedAt: string,
): VenueFacts | null => {
  let best: VenueFacts | null = null;
  let bestScore = 0;
  for (const n of ldNodes(html)) {
    const types = asArray(n["@type"]).map((t) => String(t).toLowerCase());
    if (!types.some((t) => BIZ_TYPES.has(t))) continue;
    const address = readAddress(n);
    // Узел про другую страну описывает не нашу площадку: у сетей на общем
    // домене висит разметка головного офиса. Его часы и телефон в паспорте
    // хуже пустоты — гость по ним поедет и позвонит.
    if (!looksLocal(address)) continue;
    const facts: VenueFacts = {
      hours: readHours(n),
      address,
      phone: cleanPhone(n.telephone),
      email: cleanEmail(n.email),
      source,
      fetchedAt,
    };
    const score =
      (facts.hours ? 2 : 0) + (facts.address ? 1 : 0) + (facts.phone ? 1 : 0) + (facts.email ? 1 : 0);
    if (score > bestScore) {
      best = facts;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
};
