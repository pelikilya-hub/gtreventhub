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

/** Адрес постера, пригодный для Telegram.
 *
 *  Telegram не умеет SVG в sendPhoto и sendMediaGroup: нарисованная афиша
 *  туда не годится, а один негодный элемент роняет весь альбом целиком.
 *  Поэтому здесь строгая гарантия растра — адрес отдаётся только тогда,
 *  когда за ним точно стоит картинка:
 *
 *    • постер уже в нашем кэше (`/api/poster?k=…` в записи события) — он
 *      попал туда скачиванием, то есть это настоящий файл площадки;
 *    • у площадки есть фото в /venues — ручка отдаст его редиректом.
 *
 *  Внешняя ссылка без кэша сюда не проходит: она может не скачаться в
 *  момент отправки, и тогда ручка нарисует SVG — пост уйдёт битым.
 *  Пустая строка означает «этому событию картинки в Telegram не будет». */
export function posterPhoto(
  appUrl: string,
  vid: string,
  ev: { id: string; poster?: string },
  venueHero?: string,
): string {
  const cached = ev.poster?.startsWith("/api/poster");
  const hero = venueHero?.startsWith("/venues/");
  if (!cached && !hero) return "";
  return `${appUrl}${posterUrl(vid, ev.id)}`;
}

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

/** Смешать цвет с подложкой: k — доля подложки. Нужен, чтобы яркий цвет
 *  категории стал ночным фоном, а не заливкой из палитры «весёлые обои». */
const mix = (hex: string, onto: string, k: number) => {
  const [r, g, b] = hexRgb(hex);
  const [r2, g2, b2] = hexRgb(onto);
  const c = (a: number, b3: number) => Math.round(a * (1 - k) + b3 * k);
  return `rgb(${c(r, r2)},${c(g, g2)},${c(b, b2)})`;
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

  // Ночная сцена без фотографии: широкий цветовой замес площадки, косой
  // световой луч и гигантское число даты за названием. Плоская чёрная
  // плашка с белым текстом выглядела как страница договора — событию нужен
  // свет, поэтому цвет здесь работает во всю площадь, а не полоской.
  const marquee = (o.venueName || "GTR EVENT").toUpperCase().slice(0, 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(title)}">
  <defs>
    <linearGradient id="base" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${mix(accent, "#05060A", 0.72)}"/>
      <stop offset="46%" stop-color="${mix(accent, "#05060A", 0.86)}"/>
      <stop offset="100%" stop-color="#05060A"/>
    </linearGradient>
    <radialGradient id="glow" cx="24%" cy="88%" r="86%">
      <stop offset="0%" stop-color="${rgba(accent, 0.55)}"/>
      <stop offset="46%" stop-color="${rgba(accent, 0.16)}"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${rgba(accent, 0.5)}"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(5,6,10,0)"/>
      <stop offset="100%" stop-color="rgba(5,6,10,.92)"/>
    </linearGradient>
    <pattern id="scan" width="5" height="5" patternUnits="userSpaceOnUse">
      <rect width="5" height="2" fill="rgba(255,255,255,.03)"/>
    </pattern>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <!-- лучи со сцены: два косых снопа света от верхней кромки -->
  <path d="M680 -40 L860 -40 L470 ${H} L250 ${H} Z" fill="url(#beam)" opacity=".5"/>
  <path d="M950 -40 L1010 -40 L742 700 L676 700 Z" fill="url(#beam)" opacity=".35"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>

  <!-- бегущая строка площадки по диагонали: фактура и подпись разом -->
  <g transform="rotate(-90 0 0)" opacity=".16">
    <text x="${-H + 90}" y="${W - 34}" font-family="${face}" font-size="30" font-weight="700" letter-spacing="14" fill="#FFFFFF">${xml(
      `${marquee} · ${marquee} · ${marquee}`,
    )}</text>
  </g>

  <!-- дата гигантом за названием: контур, чтобы не спорил с заголовком -->
  <text x="${W - 40}" y="${H - 330}" text-anchor="end" font-family="${face}" font-size="440" font-weight="800" letter-spacing="-24" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3">${xml(
    dd,
  )}</text>

  <rect x="80" y="118" width="132" height="7" fill="#FFFFFF"/>
  <text x="80" y="198" font-family="${face}" font-size="34" font-weight="700" letter-spacing="7" fill="#FFFFFF">${xml(
    (o.venueName || "GTR EVENT").toUpperCase().slice(0, 30),
  )}</text>
  ${o.room ? `<text x="80" y="246" font-family="${face}" font-size="26" letter-spacing="4" fill="rgba(255,255,255,.7)">${xml(o.room.toUpperCase().slice(0, 34))}</text>` : ""}

  <rect y="${H - 560}" width="${W}" height="560" fill="url(#floor)"/>
  ${rows}

  <g transform="translate(80,${H - 214})">
    <rect x="0" y="-4" width="7" height="86" fill="${accent}"/>
    <text x="30" y="66" font-family="${face}" font-size="92" font-weight="800" letter-spacing="-3" fill="#FFFFFF">${xml(
      dd,
    )}</text>
    <text x="${dd ? 168 : 30}" y="66" font-family="${face}" font-size="50" font-weight="700" letter-spacing="9" fill="#FFFFFF">${xml(
      mon,
    )}</text>
  </g>

  <rect x="80" y="${H - 118}" width="${W - 160}" height="2" fill="rgba(255,255,255,.22)"/>
  <g transform="translate(80,${H - 92})">
    <rect x="0" y="0" width="7" height="56" fill="#FFFFFF"/>
    <rect x="0" y="0" width="24" height="6" fill="#FFFFFF"/>
    <rect x="0" y="50" width="24" height="6" fill="#FFFFFF"/>
    <text x="44" y="42" font-family="${face}" font-size="38" font-weight="800" letter-spacing="4" fill="#FFFFFF">GTR</text>
  </g>
  <text x="${W - 80}" y="${H - 50}" text-anchor="end" font-family="${face}" font-size="28" letter-spacing="3" fill="rgba(255,255,255,.7)">${xml(
    o.foot || "gtrevent.com",
  )}</text>
</svg>`;
}
