// Разбор афишного поста в событие.
//
// Пост из чужой ленты — это свободный текст: «22 августа | Illuzion |
// Notorious Friday | DJ Meet, LUTANG | вход 500฿». Здесь он превращается
// в факты: дата, площадка, лайнап, время, цена. Факты авторским правом
// не охраняются — их можно брать и хранить; чужой макет постера — нет,
// поэтому картинка сюда не попадает вовсе.
//
// Никаких нейросетей: разбор правилами предсказуем, работает без денег
// на счету провайдера и не выдумывает событие, которого в тексте не было.

export type ParsedEvent = {
  dateIso: string;
  title: string;
  venueQuery: string;
  artistNames: string[];
  timeText?: string;
  priceText?: string;
};

const MONTHS: Record<string, string> = {
  янв: "01", фев: "02", мар: "03", апр: "04", мая: "05", май: "05", июн: "06",
  июл: "07", авг: "08", сен: "09", окт: "10", ноя: "11", дек: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Дата на Пхукете (UTC+7) со сдвигом в днях. */
export const bkkToday = (shift = 0, now = Date.now()): string =>
  new Date(now + 7 * 3_600_000 + shift * 86_400_000).toISOString().slice(0, 10);

/** Дата из текста поста. Год в афишах почти никогда не пишут: без него
 *  берём ближайшее будущее, иначе августовский пост в декабре улетел бы
 *  в прошлое и не попал бы ни в один календарь. */
export const parseDate = (text: string, now = Date.now()): string | null => {
  const t = text.toLowerCase();
  // \b в JavaScript опирается на ASCII: перед кириллицей границы слова
  // для него не существует, и «сегодня» мимо такого шаблона проходит.
  // Границы задаём руками — на этой грабле продукт стоял уже не раз.
  if (/(^|[^а-яё])(сегодня)([^а-яё]|$)|\btonight\b|\btoday\b/.test(t)) return bkkToday(0, now);
  if (/(^|[^а-яё])(завтра)([^а-яё]|$)|\btomorrow\b/.test(t)) return bkkToday(1, now);

  // 22 августа | 22 авг | 22.08 | 22/08 | 2026-08-22 | aug 22
  const iso = t.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  let day = "";
  let mon = "";
  const ru = t.match(/(\d{1,2})\s*(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)/);
  const en = t.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  const enFirst = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})/);
  const dots = t.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?![\d:])/);
  if (ru) {
    day = ru[1];
    mon = MONTHS[ru[2]];
  } else if (en) {
    day = en[1];
    mon = MONTHS[en[2]];
  } else if (enFirst) {
    day = enFirst[2];
    mon = MONTHS[enFirst[1]];
  } else if (dots) {
    day = dots[1];
    mon = String(Number(dots[2])).padStart(2, "0");
  } else return null;
  if (!mon) return null;

  const today = bkkToday(0, now);
  const year = Number(today.slice(0, 4));
  const mk = (y: number) => `${y}-${mon}-${day.padStart(2, "0")}`;
  // Прошедшая дата без года — это следующий год, а не позавчерашний вечер.
  return mk(year) < today ? mk(year + 1) : mk(year);
};

/** Время начала: 22:00, в 23.00, from 21:00. */
export const parseTime = (text: string): string | undefined => {
  const m = text.match(/(?:^|[^\d])([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
};

/** Цена входа как её написали: 500฿, 1000 THB, free, вход свободный. */
export const parsePrice = (text: string): string | undefined => {
  if (/free entry|вход свободн|бесплатн|no entry fee/i.test(text)) return "вход свободный";
  const m = text.match(/(\d[\d\s]{1,6})\s*(฿|thb|бат)/i);
  return m ? `${m[1].replace(/\s+/g, " ").trim()} ฿` : undefined;
};

// Служебные слова афиш — они не имена артистов и не названия площадок.
const NOISE =
  /^(афиша|вечеринка|party|club|clubs|beach|night|nightlife|музыка|music|вход|entry|ticket|билет|бронь|booking|info|инфо|подробн|детали|тел|phone|whatsapp|instagram|telegram|подписывайся|подписка|реклама|advertising|сегодня|завтра|today|tonight|tomorrow|dj|live|set|сет|лайв)$/i;

/** Строка с площадкой: «📍 Illuzion», «Место: Café del Mar», «@ Illuzion».
 *  Берём именно строку-указатель, а не любое латинское слово: в посте их
 *  десятки, и половина — хэштеги. */
export const parseVenue = (text: string): string => {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(
      /^(?:📍|🏠|🎪|@|место|локация|площадка|venue|location|где)\s*[:\-—]?\s*(.{2,60})$/i,
    );
    if (m) return m[1].replace(/[|•·].*$/, "").replace(/[#@].*$/, "").trim();
  }
  // Формат «Illuzion | Notorious Friday»: площадка идёт первой ячейкой.
  const bar = lines.find((l) => l.includes("|"));
  if (bar) {
    const first = bar.split("|")[0].trim();
    if (first.length > 2 && !NOISE.test(first) && !/^\d/.test(first)) return first;
  }
  return "";
};

/** Имена из лайнапа. Здесь важно не «угадать артиста», а собрать
 *  кандидатов: сверку с базой делает вызывающий код, а незнакомые имена
 *  уходят в черновики на проверку человеком. */
export const parseArtists = (text: string): string[] => {
  const out: string[] = [];
  const push = (raw: string) => {
    const n = raw
      .replace(/^[\s\-—•·*]+|[\s\-—•·*]+$/g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/[«»"']/g, "")
      .trim();
    if (n.length < 2 || n.length > 40) return;
    if (NOISE.test(n)) return;
    if (/^\d+$/.test(n)) return;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  for (const l of text.split(/[\n\r]+/)) {
    const line = l.trim();
    // Строка-лайнап: «Line up: A, B, C» или «🎧 DJ Meet, LUTANG»
    const m = line.match(/^(?:🎧|🎤|🎵|line\s*-?up|лайнап|лайн-ап|артисты|dj[s]?)\s*[:\-—]?\s*(.+)$/i);
    if (m) {
      for (const part of m[1].split(/[,/&+]|\s\+\s|\sx\s|\bvs\b/i)) push(part);
      continue;
    }
    // «22:00 — LUTANG» тоже лайнап, но с таймингом
    const tm = line.match(/^\d{1,2}[:.]\d{2}\s*[-—–]\s*(.+)$/);
    if (tm) push(tm[1]);
  }
  return out.slice(0, 8);
};

/** Заголовок: первая содержательная строка без эмодзи-указателей. */
export const parseTitle = (text: string): string => {
  for (const l of text.split(/[\n\r]+/)) {
    const line = l.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    if (line.length < 3) continue;
    if (/^(📍|место|локация|venue|line\s*-?up|лайнап|вход|entry)/i.test(line)) continue;
    const clean = line.split("|")[line.includes("|") ? 1 : 0]?.trim() || line;
    if (clean.length >= 3) return clean.slice(0, 80);
  }
  return "Вечеринка";
};

/** Разбор поста целиком. Без даты события не бывает: пост без неё —
 *  это реклама или объявление, и в календарь ему нельзя. */
export const parsePost = (text: string, now = Date.now()): ParsedEvent | null => {
  const dateIso = parseDate(text, now);
  if (!dateIso) return null;
  const venueQuery = parseVenue(text);
  return {
    dateIso,
    title: parseTitle(text),
    venueQuery,
    artistNames: parseArtists(text),
    timeText: parseTime(text),
    priceText: parsePrice(text),
  };
};
