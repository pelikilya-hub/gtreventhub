// Модуль постеров: у каждого события есть афиша.
//
// Раньше картинка события была везде разная и часто никакая. Парсер клал в
// `poster` то, что нашёл в разметке, — а находил он чаще всего относительный
// путь `/wp-content/uploads/...`. В браузере такой путь резолвился уже от
// НАШЕГО домена, и гость видел битую картинку; кэш KV его тоже пропускал,
// потому что качать умел только `https://…`. Плюс ключ `/api/poster` был
// сужен до латиницы, а id событий из schema.org собираются из названия — с
// кириллицей и тайским. Итог: «афиши не подтягиваются к мероприятиям».
//
// Здесь собран весь путь картинки в одном месте:
//   absImg()     — что бы ни лежало в разметке, наружу уходит абсолютный URL;
//   posterSlug() — ключ, который переживает KV и строку запроса на любом языке;
//   posterUrl()  — ЕДИНСТВЕННЫЙ адрес картинки события для интерфейса;
//   posterSvg()  — афиша в стиле площадки, когда картинки нет вообще.
//
// Ключевое решение — единый адрес. Интерфейс не выбирает между кэшем,
// внешней ссылкой и заглушкой: он всегда просит `/api/poster?k=…`, а ручка
// сама отдаёт кэшированный постер, если он есть, и рисует афишу, если нет.
// Поэтому лента не бывает дырявой, а когда крон дотянет настоящий постер,
// та же ссылка молча начнёт отдавать его — без правок в интерфейсе.

// ---------- ключи ----------

// Хэш для тех id, которые нельзя положить в ключ как есть. FNV-1a: короткий,
// синхронный, одинаковый на воркере и в браузере. Криптостойкость здесь не
// нужна — нужна стабильность: один и тот же id обязан дать один и тот же ключ
// и через год, иначе кэш постеров осыпется на ровном месте.
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;

/** Безопасная часть ключа постера.
 *
 *  Латинские id (а это почти все слуги сайтов) проходят насквозь — старый кэш
 *  остаётся рабочим. Всё остальное — кириллица, тайский, проценты от
 *  URL-кодирования — складывается в читаемый огрызок плюс хэш оригинала. */
export const posterSlug = (id: string): string => {
  const raw = String(id ?? "").trim();
  if (!raw) return "none";
  if (SAFE_ID.test(raw)) return raw;
  const ascii = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${ascii || "ev"}-${fnv1a(raw)}`;
};

/** `<vid>:<slug>` — то, что уезжает в `?k=` и в ключ KV. */
export const posterKey = (vid: string, eventId: string) => `${vid}:${posterSlug(eventId)}`;

/** Ключ кэша в KV. */
export const posterKvKey = (vid: string, eventId: string) => `poster:${posterKey(vid, eventId)}`;

/** Единственный адрес картинки события для интерфейса и для Telegram. */
export const posterUrl = (vid: string, eventId: string) =>
  `/api/poster?k=${encodeURIComponent(posterKey(vid, eventId))}`;

/** Разбор ключа обратно: ручка `/api/poster` получает его строкой. */
export const parsePosterKey = (k: string): { vid: string; slug: string } | null => {
  const i = String(k ?? "").indexOf(":");
  if (i <= 0) return null;
  const vid = k.slice(0, i);
  const slug = k.slice(i + 1);
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(vid) || !SAFE_ID.test(slug)) return null;
  return { vid, slug };
};

// ---------- адреса картинок ----------

/** Абсолютный адрес картинки относительно страницы, где она найдена.
 *
 *  Возвращает "" для всего, что нельзя скачать позже отдельным запросом:
 *  data:, blob:, пустая строка. Именно из-за отсутствия этой функции постеры
 *  с половины сайтов не доезжали ни до кэша, ни до экрана. */
export function absImg(src: string | undefined | null, pageUrl: string): string {
  const s = String(src ?? "").trim();
  if (!s || /^(data|blob|javascript):/i.test(s)) return "";
  try {
    const u = new URL(s, pageUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

// ---------- афиша, когда картинки нет ----------

const xml = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Перенос по словам на глаз: точной метрики на сервере нет, считаем по
 *  средней ширине знака (0.56 кегля для плотного гротеска). Длинное слово,
 *  которое не влезает целиком, режем — иначе строка вылезет за холст. */
export function wrapTitle(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let left = 0; // сколько слов не поместилось
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const probe = cur ? `${cur} ${w}` : w;
    if (probe.length <= maxChars) {
      cur = probe;
      continue;
    }
    if (cur) lines.push(cur);
    if (lines.length >= maxLines) {
      cur = "";
      left = words.length - i;
      break;
    }
    cur = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  else if (cur) left += 1;
  if (left && lines.length) {
    const last = lines[lines.length - 1];
    if (!last.endsWith("…"))
      lines[lines.length - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines;
}

const hexRgb = (hex: string): [number, number, number] => {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#E5231B";
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
};
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export type PosterArt = {
  title: string;
  dateIso: string;
  venueName: string;
  /** цвет категории площадки — единственное, что отличает афиши друг от друга */
  accent?: string;
  room?: string;
  /** подпись внизу; по умолчанию адрес приложения */
  foot?: string;
};

/** Афиша события в фирменном строе: чёрное поле, разлом, крупная дата.
 *
 *  Это не «заглушка вместо картинки», а нормальная афиша: у половины
 *  заведений Таиланда постера нет в природе — они пишут программу текстом в
 *  сторис. Событию всё равно нужно лицо в ленте, и лучше честная типографика
 *  в стиле площадки, чем серый прямоугольник.
 *
 *  SVG, а не canvas: воркеру нечем растрировать, а браузеру и Telegram
 *  векторный постер обходится в единицы килобайт. Шрифты — только системные
 *  стеки: подключить свой в картинку, вставленную через <img>, всё равно
 *  нельзя. */
export function posterSvg(o: PosterArt): string {
  const W = 1080;
  const H = 1350;
  const accent = /^#[0-9a-f]{6}$/i.test(o.accent ?? "") ? (o.accent as string) : "#E5231B";
  const title = String(o.title ?? "").trim().toUpperCase();
  // Кегль подбираем под длину, а ширину знака считаем щедро (0.64 кегля):
  // на телефоне и в Telegram афишу рисуют системными гротесками, и узкая
  // оценка выносила длинные названия за правое поле.
  const size = title.length > 44 ? 68 : title.length > 24 ? 88 : 112;
  const maxChars = Math.max(8, Math.floor((W - 160) / (size * 0.64)));
  const lines = wrapTitle(title, maxChars, 3);
  const dd = o.dateIso?.slice(8, 10) ?? "";
  const mon = MON[Number(o.dateIso?.slice(5, 7)) - 1] ?? "";
  const face =
    "'Helvetica Neue',Helvetica,Arial,'Noto Sans Thai','Noto Sans',sans-serif";

  // Три этажа: шапка площадки сверху, название в середине, дата над подвалом.
  // Название центрируем по своему блоку — одна строка не должна висеть у
  // верхнего края, а три не должны наезжать на дату.
  const lh = size * 1.08;
  const bandTop = 360;
  const bandBottom = H - 400;
  const titleTop = bandTop + (bandBottom - bandTop - (lines.length - 1) * lh) / 2;

  const rows = lines
    .map(
      (ln, i) =>
        `<text x="80" y="${Math.round(titleTop + i * lh)}" font-family="${face}" font-size="${size}" font-weight="800" letter-spacing="-1.5" fill="#FFFFFF">${xml(ln)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(title)}">
  <defs>
    <radialGradient id="g" cx="78%" cy="12%" r="82%">
      <stop offset="0%" stop-color="${rgba(accent, 0.42)}"/>
      <stop offset="58%" stop-color="${rgba(accent, 0.08)}"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="2" fill="rgba(255,255,255,.022)"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#0A0B0D"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <path d="M760 0 L980 0 L400 ${H} L180 ${H} Z" fill="${rgba(accent, 0.14)}"/>
  <path d="M1006 0 L1058 0 L742 520 L690 520 Z" fill="${rgba(accent, 0.1)}"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>

  <rect x="80" y="120" width="120" height="6" fill="${accent}"/>
  <text x="80" y="196" font-family="${face}" font-size="34" font-weight="700" letter-spacing="6" fill="${accent}">${xml(
    (o.venueName || "GTR EVENT").toUpperCase().slice(0, 30),
  )}</text>
  ${o.room ? `<text x="80" y="242" font-family="${face}" font-size="26" letter-spacing="3" fill="rgba(255,255,255,.62)">${xml(o.room.toUpperCase().slice(0, 34))}</text>` : ""}

  ${rows}

  <text x="80" y="${H - 250}" font-family="${face}" font-size="170" font-weight="800" letter-spacing="-6" fill="#FFFFFF">${xml(dd)}</text>
  <text x="80" y="${H - 208}" font-family="${face}" font-size="52" font-weight="700" letter-spacing="10" fill="${accent}" text-anchor="start" transform="translate(${dd ? 210 : 0},0)">${xml(mon)}</text>

  <rect x="80" y="${H - 190}" width="${W - 160}" height="2" fill="rgba(255,255,255,.16)"/>
  <g transform="translate(80,${H - 148})">
    <rect x="0" y="0" width="8" height="72" fill="#FFFFFF"/>
    <rect x="0" y="0" width="30" height="7" fill="#FFFFFF"/>
    <rect x="0" y="65" width="30" height="7" fill="#FFFFFF"/>
    <text x="52" y="52" font-family="${face}" font-size="46" font-weight="800" letter-spacing="4" fill="#FFFFFF">GTR</text>
  </g>
  <text x="${W - 80}" y="${H - 96}" text-anchor="end" font-family="${face}" font-size="30" letter-spacing="3" fill="rgba(255,255,255,.62)">${xml(
    o.foot || "gtrevent.com",
  )}</text>
</svg>`;
}
