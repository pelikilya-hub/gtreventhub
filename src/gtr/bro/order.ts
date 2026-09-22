// Нить разговора про бронь.
//
// Бронь — не одна фраза, а несколько: площадка, день, сколько человек,
// какой стол, телефон. Раньше каждая реплика разбиралась с нуля, и то,
// что человек сказал минуту назад, для продукта не существовало: на
// «закажи стол» он отвечал списком своих умений, как при знакомстве.
//
// Здесь живёт то, что уже известно про текущую бронь, и правило, чего
// не хватает. Спрашиваем ровно одно недостающее поле за раз и никогда
// не переспрашиваем то, что уже услышали.

/** Поля брони в том порядке, в каком их спрашивают у гостя. */
export const FIELDS = ["venue", "dateIso", "guests", "table", "phone"] as const;
export type Field = (typeof FIELDS)[number];

export type Order = {
  venue?: string;
  dateIso?: string;
  guests?: number;
  table?: string;
  slot?: string;
  phone?: string;
  note?: string;
  /** Что спросили последним: короткий ответ «в субботу» читается только
   *  вместе с вопросом, на который он дан. */
  awaiting?: Field;
  /** Когда нить последний раз трогали. Разговор остывает. */
  touchedAt: number;
};

/** Через сколько молчания нить перестаёт быть текущей. Полчаса — это
 *  примерно переезд между площадками: вернуться к той же брони человек
 *  ещё может, а через два часа он уже про другое. */
export const COLD_MS = 30 * 60_000;

export const isCold = (o: Order | null, now: number): boolean =>
  !o || now - o.touchedAt > COLD_MS;

/** Просьба забронировать. Отдельно от поиска афиши: «что сегодня» и
 *  «займи стол» — разные разговоры. */
// Между глаголом и предметом человек вставляет что угодно: «забей нам
// стол», «закажи пожалуйста столик на двоих». Пропускаем несколько слов.
const BOOK_RE =
  /(заброн|бронь|бронир|забей|займи|закаж|заказать|резерв|reserve|book)[а-яё]*(\s+[а-яёa-z0-9+]+){0,3}\s+(стол|столик|лежак|зон|vip|вип|место|беседк|шатер|шатёр|зал)|(заброн|забей|займи|закаж)[а-яё]*\s+(стол|столик|лежак|зон|vip|вип|место|беседк|зал)|^(стол|столик|лежак)(?![а-яё])/i;

// Вопрос про бронь — это не бронь. «Как забронировать стол» человек
// спрашивает про порядок, и открывать ему заявку значит не услышать.
const ASKING_RE =
  /^(как|каким образом|почему|зачем|что такое|что за|правда ли|можно ли|нужно ли|надо ли|обязательно ли|за сколько|сколько стоит)(?![а-яё])/i;

export const isBooking = (raw: string): boolean => {
  const q = raw.trim();
  return !ASKING_RE.test(q) && BOOK_RE.test(q);
};

/** Отмена: человек передумал и не хочет, чтобы мы дальше вели эту бронь. */
// Хвост (?![а-яё]) обязателен: \b в JS не считает границей конец
// кириллического слова, и «отмена» мимо такого шаблона проходит молча.
export const isCancel = (raw: string): boolean =>
  /^(отмен[аеиы]?|отменяй|сброс|стоп|забудь|не надо|передумал[аи]?)(?![а-яё])/i.test(raw.trim());

const DOW = ["воскрес", "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот"];

/** Дата из живой речи. Возвращает ГГГГ-ММ-ДД или ничего. */
export const readDate = (raw: string, today: string): string | undefined => {
  const q = raw.toLowerCase();
  const iso = q.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const day = (shift: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + shift * 86_400_000).toISOString().slice(0, 10);
  if (/послезавтра/.test(q)) return day(2);
  if (/завтра/.test(q)) return day(1);
  if (/сегодня|сейчас|вечером|ночью/.test(q)) return day(0);
  // «в субботу» — ближайшая суббота, включая сегодня.
  for (let i = 0; i < DOW.length; i++) {
    if (!new RegExp(DOW[i]).test(q)) continue;
    const cur = new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay();
    return day((i - cur + 7) % 7);
  }
  return undefined;
};

const WORD_N: Record<string, number> = {
  один: 1, одного: 1, вдвоём: 2, вдвоем: 2, двое: 2, двоих: 2, два: 2, две: 2,
  трое: 3, троих: 3, три: 3, четверо: 4, четверых: 4, четыре: 4,
  пятеро: 5, пятерых: 5, пять: 5, шестеро: 6, шестерых: 6, шесть: 6,
  семь: 7, восемь: 8, девять: 9, десять: 10,
};

/** Сколько гостей. Отсекаем то, что числом гостей быть не может:
 *  время, год и телефон читаются как количество людей только по ошибке. */
export const readGuests = (raw: string): number | undefined => {
  const q = raw.toLowerCase();
  for (const [w, n] of Object.entries(WORD_N)) if (new RegExp(`(^|[^а-яё])${w}([^а-яё]|$)`).test(q)) return n;
  const m = q.match(/(?:^|[^\d:.+])(\d{1,2})\s*(?:чел|человек|гост|перс|нас\b)?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 40) return undefined;
  // Голое число принимаем только когда именно его и спросили, либо когда
  // рядом стоит слово про людей — иначе «в 10» станет десятью гостями.
  if (/чел|человек|гост|перс|нас\b|вдво|втро|вчетв/.test(q)) return n;
  return /^\s*\d{1,2}\s*$/.test(raw) ? n : undefined;
};

/** Время начала: «в 21:00», «к девяти», «в 9 вечера». */
export const readSlot = (raw: string): string | undefined => {
  const m = raw.match(/(?:^|\D)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const h = raw.toLowerCase().match(/(?:в|к|около)\s*([01]?\d|2[0-3])\s*(?:час[а-яё]*)?\s*(вечера|ночи|дня|утра)?/);
  if (!h) return undefined;
  let n = Number(h[1]);
  if (h[2] === "вечера" && n < 12) n += 12;
  if (h[2] === "ночи" && n < 6) n += 24 - 24; // 2 ночи — это 02:00
  return `${String(n).padStart(2, "0")}:00`;
};

/** Телефон. Меньше девяти цифр — это не телефон, а номер стола. */
export const readPhone = (raw: string): string | undefined => {
  const m = raw.match(/\+?\d[\d\s()\-]{7,}\d/);
  if (!m) return undefined;
  const s = m[0].replace(/[^\d+]/g, "");
  return s.replace(/\D/g, "").length >= 9 ? s : undefined;
};

const TABLE_WORDS: [string, RegExp][] = [
  ["лежак", /лежак|sunbed|bed\b/i],
  ["VIP", /vip|вип/i],
  ["беседка", /беседк|cabana|кабан/i],
  ["зал", /зал|lounge|лаундж/i],
  ["стол", /стол(ик)?/i],
];

export const readTable = (raw: string): string | undefined => {
  for (const [name, re] of TABLE_WORDS) if (re.test(raw)) return name;
  return undefined;
};

/** Служебные слова, которые в ответе на «какая площадка» именем не являются. */
const VENUE_STOP =
  /^(в|во|на|туда|там|это|давай|давайте|хочу|можно|плиз|пожалуйста|стол|столик|лежак|бронь|забронируй|закажи)$/i;

export const readVenue = (raw: string): string | undefined => {
  const name = raw
    .trim()
    .split(/[\s,.;!?]+/)
    .filter((w) => w && !VENUE_STOP.test(w))
    .join(" ")
    .trim();
  return name.length >= 2 ? name : undefined;
};

/** Впитать в нить всё, что нашлось в реплике.
 *
 *  Короткий ответ читается в паре с вопросом: «в субботу» — это дата,
 *  а «Café del Mar» — площадка, только потому что мы про них спросили. */
export const absorb = (
  prev: Order,
  raw: string,
  today: string,
  now: number,
): Order => {
  const next: Order = { ...prev, awaiting: undefined, touchedAt: now };
  const date = readDate(raw, today);
  if (date) next.dateIso = date;
  const guests = prev.awaiting === "guests" ? readGuests(raw) ?? bare(raw) : readGuests(raw);
  if (guests) next.guests = guests;
  const phone = readPhone(raw);
  if (phone) next.phone = phone;
  const slot = readSlot(raw);
  if (slot) next.slot = slot;
  const table = readTable(raw);
  if (table) next.table = table;
  // Название площадки берём только когда именно его и ждали: в свободной
  // речи «в патонге» — это район, а не заведение, и угадывать тут нельзя.
  if (prev.awaiting === "venue") {
    const v = readVenue(raw);
    if (v) next.venue = v;
  }
  if (prev.awaiting === "table" && !table) {
    const v = readVenue(raw);
    if (v) next.table = v;
  }
  return next;
};

const bare = (raw: string): number | undefined => {
  const m = raw.trim().match(/^(\d{1,2})$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 40 ? n : undefined;
};

/** Чего ещё не хватает, в порядке спрашивания. */
export const missing = (o: Order): Field[] =>
  FIELDS.filter((f) => {
    const v = o[f as keyof Order];
    return v === undefined || v === "" || v === null;
  });

export const ready = (o: Order): boolean => missing(o).length === 0;

/** Один вопрос про одно поле. Спрашиваем по-человечески и по одному:
 *  анкета из пяти пунктов в чате — это не разговор. */
export const QUESTION: Record<Field, string> = {
  venue: "Куда бронируем? Скажи название площадки.",
  dateIso: "На какой день?",
  guests: "Сколько вас будет?",
  table: "Что берём — стол, лежак, VIP или зал?",
  phone: "Телефон для связи оставь — менеджер наберёт.",
};

/** Что уже известно — одной строкой. Идёт и человеку, и модели: она
 *  обязана видеть собранное, иначе спросит то же самое второй раз. */
export const recap = (o: Order): string => {
  const bits: string[] = [];
  if (o.venue) bits.push(o.venue);
  if (o.dateIso) bits.push(o.dateIso);
  if (o.slot) bits.push(o.slot);
  if (o.guests) bits.push(`${o.guests} гост${o.guests === 1 ? "ь" : o.guests < 5 ? "я" : "ей"}`);
  if (o.table) bits.push(o.table);
  if (o.phone) bits.push(o.phone);
  return bits.join(", ");
};

export const empty = (now: number): Order => ({ touchedAt: now });
