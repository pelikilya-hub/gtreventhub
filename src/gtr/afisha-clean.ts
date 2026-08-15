// Чистка афиши: названия событий приходят сырыми — слаги сайтов с датой
// внутри («mr sour 15 aug 2026»), развёрнутые заголовки со своей же площадкой
// («LION at Illuzion Phuket on August 14, 2026») и мусорные страницы
// («Restaurant», «feed»). Посетитель должен видеть только имя программы:
// дата и площадка на карточке и так есть отдельными строками.
// Функции чистые — их зовут и серверные fn, и экраны.

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DAY_NUM = "\\d{1,2}(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s*20\\d{2})?";

const DATE_PATTERNS = [
  // Сначала "15 aug 2026" / "16 august" / "21 aug": день-месяц идёт первым,
  // иначе месячный паттерн съедает "mar 16" внутри имён вроде "del mar 16 august"
  new RegExp(`\\b${DAY_NUM}\\s+(?:of\\s+)?${MONTH}${YEAR}\\b`, "gi"),
  // затем "on August 14, 2026" / "aug 19 2026" / "august 14th"
  new RegExp(`\\b(?:on\\s+)?${MONTH}\\s+${DAY_NUM}${YEAR}\\b`, "gi"),
  // одинокий год («Festive Season 2026» → «Festive Season»).
  // Дни недели НЕ трогаем: «Sunday Sessions» — настоящее имя вечеринки.
  /\b20\d{2}\b/g,
];

// Страницы сайтов, которые скрейпер принял за события
const JUNK = new Set([
  "restaurant", "beach club", "feed", "menu", "home", "contact", "contacts",
  "about", "about us", "gallery", "events", "event", "news", "blog",
  "booking", "bookings", "reservation", "reservations", "shop", "faq",
  "privacy policy", "terms",
]);

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function isJunkEventTitle(raw: string): boolean {
  const s = fold(raw).replace(/\s+/g, " ").trim();
  return s.length < 3 || JUNK.has(s);
}

export function cleanEventTitle(raw: string, venueName?: string): string {
  let s = String(raw)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@]\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // " at <площадка>" и просто имя площадки (без учёта регистра и акцентов),
  // с необязательным хвостом "phuket" — сайты любят дописывать город
  if (venueName) {
    const vn = fold(venueName).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (vn.length >= 4) {
      const esc = vn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      s = s.replace(new RegExp(`\\b(?:at\\s+|@\\s*)?${esc}(?:\\s+phuket)?\\b`, "gi"), " ");
    }
  }
  for (const re of DATE_PATTERNS) s = s.replace(re, " ");
  // осиротевшие связки и разделители по краям
  s = s
    .replace(/\s+/g, " ")
    .replace(/\b(?:at|on|in)\s*$/i, "")
    .replace(/^[\s\-–—·•|,:]+|[\s\-–—·•|,:]+$/g, "")
    .trim();

  if (s.length < 3) return String(raw).replace(/\s+/g, " ").trim();
  return s;
}
