// Агент афиш: собирает календари событий площадок с их официальных сайтов
// в KV (venueevents:<venueId>). Запуск — cron воркера каждые 6 часов или
// кнопкой в паспорте площадки. Постеры — og:image событийных страниц.
import artistsRaw from "./data/artists.json";
import venuesRaw from "./data/venues.json";
import { kvGetJson, type KvNs } from "./kv-ns";

export type VenueAfishaEvent = {
  id: string;
  title: string;
  dateIso: string; // YYYY-MM-DD
  poster?: string; // наш кэш /api/poster?k=… либо внешний URL до кэширования
  posterSrc?: string; // оригинальный URL постера — провенанс и корпус стиля
  url: string;
  room?: string;
  artistIds: string[]; // совпадения с нашей базой
  source: string;
};

export type VenueAfisha = { events: VenueAfishaEvent[]; syncedAt: number; source: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

// дата из слуга: hebdonis-13-aug | lonner-22-aug-2026 | bliss-wednesdays-aug-19-2026
function dateFromSlug(slug: string): string | null {
  let m = slug.match(/(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)(?:-(\d{2,4}))?/);
  let day = "", mon = "", yr = "";
  if (m) {
    day = m[1]; mon = MONTHS[m[2]]; yr = m[3] ?? "";
  } else {
    m = slug.match(/(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)-(\d{1,2})(?:-(\d{2,4}))?/);
    if (!m) return null;
    mon = MONTHS[m[1]]; day = m[2]; yr = m[3] ?? "";
  }
  const now = new Date();
  let year = yr ? (yr.length === 2 ? 2000 + parseInt(yr, 10) : parseInt(yr, 10)) : now.getFullYear();
  const iso = `${year}-${mon}-${day.padStart(2, "0")}`;
  // без года: если дата уже прошла больше месяца назад — следующий год
  if (!yr && new Date(iso).getTime() < now.getTime() - 35 * 86400e3) year += 1;
  return `${year}-${mon}-${day.padStart(2, "0")}`;
}

type ArtistLite = { id: string; name: string };
const ARTISTS: ArtistLite[] = ((artistsRaw as { artists?: ArtistLite[] }).artists ?? [])
  .map((a) => ({ id: a.id, name: a.name }));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type VenueLite = { id: string; website?: string };
const VENUES: VenueLite[] = ((venuesRaw as { venues?: VenueLite[] }).venues ?? []).map((v) => ({
  id: v.id,
  website: v.website,
}));

function matchArtists(text: string): string[] {
  const t = " " + norm(text) + " ";
  const hits: string[] = [];
  for (const a of ARTISTS) {
    const n = norm(a.name);
    if (n.length >= 4 && t.includes(" " + n + " ")) hits.push(a.id);
  }
  return hits.slice(0, 4);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const og = (html: string, prop: string) => {
  const m =
    html.match(new RegExp(`property=["']og:${prop}["'][^>]*content=["']([^"']+)`)) ||
    html.match(new RegExp(`content=["']([^"']+)["'][^>]*property=["']og:${prop}`));
  return m ? m[1] : "";
};

// Постер страницы: og:image, иначе первый контентный <img> (Webflow-сайты
// вроде Café del Mar og-тегов не ставят — постер лежит просто в разметке)
function pickPoster(html: string): string {
  const meta = og(html, "image");
  if (meta) return meta;
  const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)].map(
    (x) => x[1],
  );
  return imgs.find((u) => !/logo|icon|favicon|arrow|badge|32x32|256x256/i.test(u)) ?? "";
}

// событийная страница → карточка события
async function eventFromPage(url: string, slug: string, source: string, room?: string) {
  const dateIso = dateFromSlug(slug);
  if (!dateIso) return null; // резидентские страницы без даты пропускаем
  try {
    const html = await fetchText(url);
    const title = (og(html, "title") || slug.replace(/-/g, " ")).replace(/\s*[|–-]\s*(Café del Mar|Illuzion).*/i, "").trim();
    const poster = pickPoster(html);
    return {
      id: slug,
      title,
      dateIso,
      poster: poster || undefined,
      url,
      room,
      artistIds: matchArtists(`${slug.replace(/-/g, " ")} ${title}`),
      source,
    } satisfies VenueAfishaEvent;
  } catch {
    return null;
  }
}

async function syncCafeDelMar(): Promise<VenueAfishaEvent[]> {
  const html = await fetchText("https://phuket.cafedelmar.com/events");
  const slugs = [...new Set(html.match(/events\/[a-z0-9-]+/g) ?? [])]
    .map((s) => s.slice("events/".length))
    .filter((s) => s && s !== "events")
    .slice(0, 12);
  const out: VenueAfishaEvent[] = [];
  for (const slug of slugs) {
    const ev = await eventFromPage(
      `https://phuket.cafedelmar.com/events/${slug}`,
      slug,
      "phuket.cafedelmar.com",
    );
    if (ev) out.push(ev);
  }
  return out;
}


// Дата из HTML страницы: «December 31», «August 28, 2026» — для сайтов,
// которые не кладут дату в слуг (WordPress/Webflow-лендинги событий)
function dateFromHtml(html: string): string | null {
  const m = html.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
  );
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day = m[2];
  const now = new Date();
  let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
  const iso = `${year}-${mon}-${day.padStart(2, "0")}`;
  if (!m[3] && new Date(iso).getTime() < now.getTime() - 35 * 86400e3) year += 1;
  return `${year}-${mon}-${day.padStart(2, "0")}`;
}

// Carpe Diem: события — страницы в корне сайта, дата в теле страницы
async function syncCarpeDiem(): Promise<VenueAfishaEvent[]> {
  const html = await fetchText("https://carpediemphuket.com/events/");
  const links = [...new Set(html.match(/https:\/\/carpediemphuket\.com\/[a-z0-9-]+\//g) ?? [])]
    .filter(
      (u) =>
        !/\/(events|event|contact|menu|menus|about|gallery|privacy|terms|booking|reservations|blog|category|tag|wp-[a-z]+)\/$/.test(
          u,
        ),
    )
    .slice(0, 8);
  const out: VenueAfishaEvent[] = [];
  for (const url of links) {
    const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
    try {
      const page = await fetchText(url);
      const dateIso = dateFromSlug(slug) ?? dateFromHtml(page);
      if (!dateIso) continue; // еженедельные резидентства без даты пропускаем
      const title = (og(page, "title") || slug.replace(/-/g, " "))
        .replace(/\s*[|–-]\s*Carpe Diem.*/i, "")
        .trim();
      const poster = pickPoster(page);
      out.push({
        id: slug,
        title,
        dateIso,
        poster: poster || undefined,
        url,
        artistIds: matchArtists(`${slug.replace(/-/g, " ")} ${title}`),
        source: "carpediemphuket.com",
      });
    } catch {
      // страница недоступна — пропускаем
    }
  }
  return out;
}

// Заголовок из слуга приходит строчными («zoo del mar»), а из og:title —
// как повезёт. Приводим к виду, пригодному для витрины: каждое слово с
// заглавной, но аббревиатуры и цифры не трогаем.
const titleCase = (raw: string) => {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return t;
  // уже есть заглавные — автор постарался, не портим
  if (/[A-ZА-ЯЁ]/.test(t.slice(1))) return t;
  return t
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
};

// Площадки переиспользуют один промо-постер на всех резидентских страницах:
// у Café del Mar «Zoo del Mar» и «Bliss Wednesdays» приходили с одинаковой
// картинкой и в ленте выглядели дублями одного события. Постер оставляем
// самому раннему событию, остальным честнее показать карточку без него,
// чем повторять чужую афишу.
const unshareposters = (list: VenueAfishaEvent[]) => {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
    .map((e) => {
      const key = e.posterSrc ?? e.poster;
      if (!key) return e;
      if (seen.has(key)) return { ...e, poster: undefined, posterSrc: undefined };
      seen.add(key);
      return e;
    });
};

const dedupe = (list: VenueAfishaEvent[]) => {
  const seen = new Set<string>();
  return unshareposters(list.map((e) => ({ ...e, title: titleCase(e.title) })))
    .filter((e) => {
      const k = `${e.dateIso}:${norm(e.title)}:${norm(e.room ?? "")}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
};

// ---------- кэш постеров: чужой og:image → наш KV, отдаётся /api/poster ----------
// Хотлинк на сайты площадок ненадёжен (защита, переезды, https). Скачиваем
// постер один раз в KV (base64) — и он же становится корпусом стиля площадки
// для будущего генератора афиш. Лимит на прогон — бюджет subrequests воркера.

const POSTER_MAX_BYTES = 2_500_000;
const POSTERS_PER_RUN = 10;

const toB64 = (buf: ArrayBuffer) => {
  const u8 = new Uint8Array(buf);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH)
    s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
};

async function cachePosters(ns: KvNs, vid: string, events: VenueAfishaEvent[], budget: { left: number }) {
  const have = new Set(await kvListAllLocal(ns, `poster:${vid}:`));
  for (const ev of events) {
    const src = ev.posterSrc ?? ev.poster;
    if (!src || !/^https?:/.test(src)) continue;
    ev.posterSrc = src;
    const key = `poster:${vid}:${ev.id}`;
    if (have.has(key)) {
      ev.poster = `/api/poster?k=${encodeURIComponent(`${vid}:${ev.id}`)}`;
      continue;
    }
    if (budget.left <= 0) continue; // докачаем в следующий прогон крона
    budget.left--;
    try {
      const res = await fetch(src, { headers: { "user-agent": UA } });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "image/jpeg";
      if (!ct.startsWith("image/")) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > POSTER_MAX_BYTES) continue;
      await ns.put(key, JSON.stringify({ ct, b64: toB64(buf) }));
      ev.poster = `/api/poster?k=${encodeURIComponent(`${vid}:${ev.id}`)}`;
    } catch {
      // постер не скачался — остаётся внешний URL, попробуем в другой раз
    }
  }
}

// локальная копия kvListAll — не тянем kv-api в воркерный модуль
async function kvListAllLocal(ns: KvNs, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await ns.list({ prefix, cursor });
    names.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

// Полный проход: по адаптеру на площадку. Возвращает счётчики для отчёта.
// Resident Advisor: открытый GraphQL, событList по id площадки. Даёт
// подтверждённые международные лайнапы — организаторы видят занятые даты.
// Карта id собрана автоматически точным поиском по каталогу (ra-map).
import raMapRaw from "./data/ra-venues.json";
const RA_VENUES: [string, number][] = Object.entries(
  raMapRaw as Record<string, { raId: number }>,
).map(([vid, m]) => [vid, m.raId]);

async function syncResidentAdvisor(raId: number): Promise<VenueAfishaEvent[]> {
  const res = await fetch("https://ra.co/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      referer: "https://ra.co/",
    },
    body: JSON.stringify({
      query: `query { venue(id: ${raId}) { name events(limit: 12, type: LATEST) { id title date contentUrl artists { name } images { filename } } } }`,
    }),
  });
  if (!res.ok) throw new Error(`ra ${res.status}`);
  const j = (await res.json()) as {
    data?: {
      venue?: {
        events?: {
          id: string;
          title: string;
          date: string;
          contentUrl?: string;
          artists?: { name: string }[];
          images?: { filename: string }[];
        }[];
      };
    };
  };
  const today = new Date().toISOString().slice(0, 10);
  return (j.data?.venue?.events ?? [])
    .map((e) => {
      const dateIso = String(e.date).slice(0, 10);
      const names = (e.artists ?? []).map((a) => a.name).join(", ");
      return {
        id: `ra-${e.id}`,
        title: e.title + (names && !e.title.includes(names.split(",")[0]) ? ` · ${names}` : ""),
        dateIso,
        poster: e.images?.[0]?.filename,
        posterSrc: e.images?.[0]?.filename,
        url: e.contentUrl ? `https://ra.co${e.contentUrl}` : "https://ra.co",
        artistIds: matchArtists(`${e.title} ${names}`),
        source: "ra.co",
      } satisfies VenueAfishaEvent;
    })
    .filter((e) => e.dateIso >= today)
    .slice(0, 12);
}



// ---------- авторазведка источников афиш по всей базе ----------
// Раньше афиша была там, где я вручную написал адаптер: четыре площадки из
// ста десяти. Дальше так не масштабируется. Большинство сайтов заведений —
// WordPress, и у него есть машинные ручки: The Events Calendar отдаёт
// события структурой (дата, время, зал, постер), а кастомные типы — списком.
// Движок сам обходит базу, находит рабочую ручку, запоминает её в KV и
// дальше ходит только туда.

type SrcKind = "tribe" | "wp-events" | "wp-tribe" | "jsonld" | "none";
type SrcRec = { kind: SrcKind; url?: string; checkedAt: string; found: number };
const srcKey = (vid: string) => `afishasrc:${vid}`;

// Сколько площадок разведываем за один прогон. Ограничение — не наша лень,
// а лимит подзапросов воркера: разведка одной площадки это до трёх ручек.
const PROBE_PER_RUN = 12;
// Как часто перепроверяем площадку, у которой ручек не нашлось: сайты
// переезжают на WordPress и заводят календари, это не приговор навсегда.
const RECHECK_DAYS = 14;

// Сайты гостиничных сетей и агрегаторов: даже если там WordPress, это
// корпоративный портал, а не афиша конкретной площадки на Пхукете.
const SKIP_HOSTS = [
  "marriott.com", "ihg.com", "banyantree.com", "trip.com", "booking.com",
  "hilton.com", "accor.com", "hyatt.com", "agoda.com", "radissonhotels.com",
];

const siteRoot = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
};

const jsonOrNull = async (url: string) => {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// The Events Calendar: самый частый плагин афиш на WordPress. Отдаёт всё,
// что нам нужно, включая зал — у Illuzion так различаются Main и Shelter.
type TribeEvent = {
  id?: number | string;
  title?: string;
  url?: string;
  start_date?: string;
  image?: string | { url?: string };
  venue?: { venue?: string };
};

function fromTribe(list: TribeEvent[], host: string): VenueAfishaEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  return list
    .map((e) => {
      const dateIso = String(e.start_date ?? "").slice(0, 10);
      const img = typeof e.image === "string" ? e.image : e.image?.url;
      const title = decodeEntities(String(e.title ?? "")).trim();
      return {
        id: `tribe-${e.id ?? title}-${dateIso}`,
        title,
        dateIso,
        poster: img || undefined,
        posterSrc: img || undefined,
        url: e.url || `https://${host}`,
        room: e.venue?.venue || undefined,
        artistIds: matchArtists(title),
        source: host,
      } satisfies VenueAfishaEvent;
    })
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.dateIso) && e.dateIso >= today);
}

const decodeEntities = (s: string) =>
  s
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// Дата из заголовка: «… | 29.08», «Sam Collins 22 August», «AUG 21».
// Заголовку доверяем больше, чем слугу: слуг остаётся от первой публикации
// и расходится с реальной датой, если событие переносили.
function dateFromTitle(raw: string): string | null {
  const now = Date.now();
  const bump = (year: number, mon: string, day: string) => {
    let iso = `${year}-${mon}-${day.padStart(2, "0")}`;
    if (new Date(iso).getTime() < now - 35 * 86400e3)
      iso = `${year + 1}-${mon}-${day.padStart(2, "0")}`;
    return iso;
  };
  const dot = raw.match(/(\d{1,2})\.(\d{2})(?:\.(\d{4}))?\s*$/);
  if (dot) {
    const year = dot[3] ? Number(dot[3]) : new Date().getFullYear();
    return dot[3] ? `${year}-${dot[2]}-${dot[1].padStart(2, "0")}` : bump(year, dot[2], dot[1]);
  }
  const named = raw.match(
    /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{4})?/i,
  );
  if (named) {
    const mon = MONTHS[named[2].toLowerCase().slice(0, 4)] ?? MONTHS[named[2].toLowerCase().slice(0, 3)];
    if (mon) {
      const year = named[3] ? Number(named[3]) : new Date().getFullYear();
      return named[3] ? `${year}-${mon}-${named[1].padStart(2, "0")}` : bump(year, mon, named[1]);
    }
  }
  const rev = raw.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:\s*,?\s*(\d{4}))?/i,
  );
  if (rev) {
    const mon = MONTHS[rev[1].toLowerCase().slice(0, 4)] ?? MONTHS[rev[1].toLowerCase().slice(0, 3)];
    if (mon) {
      const year = rev[3] ? Number(rev[3]) : new Date().getFullYear();
      return rev[3] ? `${year}-${mon}-${rev[2].padStart(2, "0")}` : bump(year, mon, rev[2]);
    }
  }
  return null;
}

// Кастомный тип записей WordPress (events / tribe_events): дату берём из
// заголовка или слуга, постер — со страницы события, но не больше четырёх
// страниц за прогон, иначе съедим бюджет подзапросов на одной площадке.
async function fromWpCpt(
  list: { slug?: string; link?: string; title?: { rendered?: string } }[],
  host: string,
  posterLimit = 4,
): Promise<VenueAfishaEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out: VenueAfishaEvent[] = [];
  let posters = posterLimit;
  for (const e of list) {
    const raw = decodeEntities(e.title?.rendered ?? "").trim();
    const dateIso = dateFromTitle(raw) ?? (e.slug ? dateFromSlug(e.slug) : null);
    if (!dateIso || dateIso < today) continue;
    const title = raw.replace(/\s*[|·–-]\s*\d{1,2}\.\d{2}(\.\d{4})?\s*$/, "").trim() || raw;
    let poster = "";
    if (posters > 0 && e.link) {
      posters--;
      try {
        poster = pickPoster(await fetchText(e.link));
      } catch {
        // страница события не открылась — покажем событие без постера
      }
    }
    out.push({
      id: e.slug ?? `${host}-${dateIso}`,
      title,
      dateIso,
      poster: poster || undefined,
      posterSrc: poster || undefined,
      url: e.link ?? `https://${host}`,
      artistIds: matchArtists(title),
      source: host,
    });
  }
  return out;
}

// ---------- JSON-LD: разметка schema.org Event в HTML ----------
// Wix, Tilda, Squarespace и самописные сайты мимо WordPress-разведки, но
// многие из них размечают события для Google — <script type="application/
// ld+json"> с @type Event. Читаем её: это машинные данные от самой
// площадки, а не скрейпинг вёрстки, и они переживают любой редизайн.

const LD_EVENT_TYPES = new Set([
  "event", "musicevent", "danceevent", "socialevent", "festival",
  "foodevent", "theaterevent", "comedyevent", "screeningevent",
]);

type LdNode = {
  "@type"?: string | string[];
  "@graph"?: LdNode[];
  name?: string;
  startDate?: string;
  url?: string;
  image?: string | string[] | { url?: string } | { url?: string }[];
};

const ldImage = (img: LdNode["image"]): string | undefined => {
  const one = Array.isArray(img) ? img[0] : img;
  if (!one) return undefined;
  return typeof one === "string" ? one : one.url || undefined;
};

/** Вытащить будущие события из ld+json блоков страницы. Экспорт — для
 *  тестов: сеть в них не ходит, разбирается готовый HTML. */
export function eventsFromJsonLd(html: string, host: string): VenueAfishaEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const nodes: LdNode[] = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const parsed = JSON.parse(m[1]) as LdNode | LdNode[];
      nodes.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // битый блок разметки — не наша ошибка, идём к следующему
    }
  }
  const flat: LdNode[] = [];
  for (const n of nodes) flat.push(n, ...(n["@graph"] ?? []));
  const out: VenueAfishaEvent[] = [];
  for (const n of flat) {
    const types = (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"] ?? ""]).map((t) =>
      String(t).toLowerCase(),
    );
    if (!types.some((t) => LD_EVENT_TYPES.has(t))) continue;
    const dateIso = String(n.startDate ?? "").slice(0, 10);
    const title = decodeEntities(String(n.name ?? "")).replace(/\s+/g, " ").trim().slice(0, 90);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || dateIso < today) continue;
    const img = ldImage(n.image);
    out.push({
      id: `ld-${dateIso}-${title.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").slice(0, 40)}`,
      title,
      dateIso,
      poster: img,
      posterSrc: img,
      url: n.url || `https://${host}`,
      artistIds: matchArtists(title),
      source: host,
    });
  }
  return dedupe(out).slice(0, 12);
}

// Где искать разметку: корень и типовые адреса афиш. Больше трёх страниц
// на площадку не смотрим — бюджет подзапросов воркера не резиновый.
const LD_PATHS = ["", "/events", "/afisha"];

async function probeJsonLd(site: string, host: string): Promise<SrcRec | null> {
  for (const path of LD_PATHS) {
    try {
      const url = `${site}${path}`;
      const ev = eventsFromJsonLd(await fetchText(url), host);
      if (ev.length)
        return { kind: "jsonld", url, checkedAt: new Date().toISOString().slice(0, 10), found: ev.length };
    } catch {
      // страницы нет или сайт лёг — пробуем следующий адрес
    }
  }
  return null;
}

async function readSource(site: string, rec: SrcRec): Promise<VenueAfishaEvent[]> {
  const host = new URL(site).host;
  if (rec.kind === "jsonld") return eventsFromJsonLd(await fetchText(rec.url!), host);
  if (rec.kind === "tribe") {
    const j = (await jsonOrNull(rec.url!)) as { events?: TribeEvent[] } | null;
    return j?.events ? fromTribe(j.events, host) : [];
  }
  const j = (await jsonOrNull(rec.url!)) as
    | { slug?: string; link?: string; title?: { rendered?: string } }[]
    | null;
  return Array.isArray(j) ? fromWpCpt(j, host) : [];
}

// Разведка: пробуем ручки по убыванию качества данных и останавливаемся
// на первой, которая вернула хотя бы одно будущее событие.
async function probeSite(site: string): Promise<SrcRec> {
  const host = new URL(site).host;
  const today = new Date().toISOString().slice(0, 10);
  const checkedAt = today;

  const tribeUrl = `${site}/wp-json/tribe/events/v1/events?per_page=12&start_date=${today}`;
  const t = (await jsonOrNull(tribeUrl)) as { events?: TribeEvent[] } | null;
  if (t?.events?.length) {
    const ev = fromTribe(t.events, host);
    if (ev.length) return { kind: "tribe", url: tribeUrl, checkedAt, found: ev.length };
  }

  for (const type of ["events", "tribe_events"] as const) {
    const url = `${site}/wp-json/wp/v2/${type}?per_page=12`;
    const j = (await jsonOrNull(url)) as
      | { slug?: string; link?: string; title?: { rendered?: string } }[]
      | null;
    if (Array.isArray(j) && j.length) {
      const ev = await fromWpCpt(j, host, 0); // на разведке постеры не тянем
      if (ev.length)
        return {
          kind: type === "events" ? "wp-events" : "wp-tribe",
          url,
          checkedAt,
          found: ev.length,
        };
    }
  }
  // Не WordPress или ручки закрыты — последняя надежда на разметку
  // schema.org, которую сайты держат ради Google.
  const ld = await probeJsonLd(site, new URL(site).host);
  if (ld) return ld;
  return { kind: "none", checkedAt, found: 0 };
}

const daysBetween = (iso: string) =>
  Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);

/** Один прогон разведки: обновляет известные источники и добирает новые.
 *  Очередь важна: за прогон разведываем ограниченное число площадок, поэтому
 *  вперёд идут те, кого не смотрели ни разу, а следом — самые давние. Иначе
 *  хвост базы никогда не дождётся своей очереди. */
async function syncDiscovered(
  ns: KvNs,
  skip: Set<string>,
): Promise<Map<string, VenueAfishaEvent[]>> {
  const found = new Map<string, VenueAfishaEvent[]>();
  const candidates = VENUES.filter(
    (v) =>
      !skip.has(v.id) &&
      /^https?:\/\//.test(v.website ?? "") &&
      !SKIP_HOSTS.some((h) => (v.website ?? "").includes(h)),
  );

  type Row = { vid: string; site: string; rec: SrcRec | null };
  const rows: Row[] = [];
  for (const v of candidates) {
    const site = siteRoot(v.website!);
    if (site) rows.push({ vid: v.id, site, rec: await kvGetJson<SrcRec>(ns, srcKey(v.id)) });
  }

  // известные источники обновляем всегда — это дёшево и это основной улов
  for (const r of rows.filter((x) => x.rec && x.rec.kind !== "none")) {
    try {
      const ev = await readSource(r.site, r.rec!);
      if (ev.length) found.set(r.vid, ev);
      await ns.put(
        srcKey(r.vid),
        JSON.stringify({ ...r.rec!, checkedAt: new Date().toISOString().slice(0, 10), found: ev.length }),
      );
    } catch {
      // сайт прилёг — прошлые данные не трогаем, вернёмся в следующий прогон
    }
  }

  // Непроверенные идут первыми, и внутри них — свежедобавленные площадки
  // (id по убыванию). Иначе новая площадка ждёт полного круга разведки:
  // 110 сайтов по 12 за прогон — это почти сутки. Так добавленная сегодня
  // площадка попадает в очередь на ближайшем же кроне, а старый хвост
  // всё равно дочерпывается — множество непроверенных только сокращается.
  const queue = [
    ...rows.filter((x) => !x.rec).sort((a, b) => b.vid.localeCompare(a.vid)),
    ...rows
      .filter((x) => x.rec?.kind === "none" && daysBetween(x.rec.checkedAt) >= RECHECK_DAYS)
      .sort((a, b) => a.rec!.checkedAt.localeCompare(b.rec!.checkedAt)),
  ].slice(0, PROBE_PER_RUN);

  for (const r of queue) {
    try {
      const next = await probeSite(r.site);
      await ns.put(srcKey(r.vid), JSON.stringify(next));
      if (next.kind !== "none") {
        const ev = await readSource(r.site, next);
        if (ev.length) found.set(r.vid, ev);
      }
    } catch {
      // недоступен — не запоминаем как «источника нет», попробуем ещё раз
    }
  }
  return found;
}

// ---------- Instagram площадок через Meta Graph ----------
// Анонимно инстаграм закрыт наглухо: профиль без входа отдаёт пустую
// оболочку. Легальный путь один — Graph API к бизнес-аккаунту площадки,
// привязанному к её Facebook-странице, по токену, который площадка выдала
// нам сама. Токен уже лежит в vmeta:<vid> с магик-формы подтверждения.
async function syncInstagramBusiness(
  pageId: string,
  token: string,
): Promise<VenueAfishaEvent[]> {
  const acc = (await fetch(
    `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(token)}`,
  ).then((r) => r.json())) as { instagram_business_account?: { id?: string } };
  const igId = acc.instagram_business_account?.id;
  if (!igId) return [];
  const media = (await fetch(
    `https://graph.facebook.com/v21.0/${igId}/media?fields=caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=25&access_token=${encodeURIComponent(token)}`,
  ).then((r) => r.json())) as {
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
    }[];
  };
  const today = new Date().toISOString().slice(0, 10);
  const out: VenueAfishaEvent[] = [];
  for (const m of media.data ?? []) {
    const cap = (m.caption ?? "").replace(/\s+/g, " ").trim();
    if (!cap) continue;
    // дату ищем в первых строках подписи — там её и пишут афиши
    const head = cap.slice(0, 160);
    const dateIso = dateFromTitle(head);
    if (!dateIso || dateIso < today) continue;
    const title =
      head
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#[\wЀ-ӿ]+/g, "")
        .split(/[\n·|]/)[0]
        .trim()
        .slice(0, 80) || "Вечеринка";
    const img = m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url;
    out.push({
      id: `ig-${m.id}`,
      title,
      dateIso,
      poster: img,
      posterSrc: img,
      url: m.permalink ?? "https://instagram.com",
      artistIds: matchArtists(cap),
      source: "instagram",
    });
  }
  return out;
}

// Занятость площадки: даты, на которые у неё уже стоит своя программа.
// Отдельным ключом, потому что это спрашивают календарь и конструктор —
// им не нужен весь список событий, нужен ответ «свободно или нет».
export const busyKey = (vid: string) => `venuebusy:${vid}`;
export type VenueBusy = { dates: string[]; updatedAt: number };

export async function syncAfisha(ns: KvNs): Promise<Record<string, number>> {
  const jobs: [string, () => Promise<VenueAfishaEvent[]>][] = [
    ["VEN-0002", syncCafeDelMar],
    ["VEN-0003", syncCarpeDiem],
  ];
  const counts: Record<string, number> = {};
  const posterBudget = { left: POSTERS_PER_RUN };
  const byVid = new Map<string, VenueAfishaEvent[]>();
  for (const [vid, run] of jobs) {
    try {
      byVid.set(vid, dedupe(await run()));
    } catch (e) {
      counts[vid] = -1; // источник недоступен — прошлые данные не трогаем
    }
  }
  // FB-события площадок, давших доступ к своей странице (vmeta:*):
  // официальный Graph API, токены вечные, события — прямо от источника
  for (const key of await kvListAllLocal(ns, "vmeta:")) {
    const vid = key.slice("vmeta:".length);
    try {
      const vm = JSON.parse((await ns.get(key)) ?? "null") as {
        pageId: string;
        token: string;
      } | null;
      if (!vm?.token) continue;
      const j = (await fetch(
        `https://graph.facebook.com/v21.0/${vm.pageId}/events?fields=id,name,start_time,cover,ticket_uri&limit=12&access_token=${encodeURIComponent(vm.token)}`,
      ).then((r) => r.json())) as {
        data?: { id: string; name: string; start_time?: string; cover?: { source?: string }; ticket_uri?: string }[];
      };
      const today = new Date().toISOString().slice(0, 10);
      const fbEvents: VenueAfishaEvent[] = (j.data ?? [])
        .map((e) => ({
          id: `fb-${e.id}`,
          title: e.name,
          dateIso: String(e.start_time ?? "").slice(0, 10),
          poster: e.cover?.source,
          posterSrc: e.cover?.source,
          url: e.ticket_uri || `https://www.facebook.com/events/${e.id}`,
          artistIds: matchArtists(e.name),
          source: "facebook",
        }))
        .filter((e) => e.dateIso >= today);
      if (fbEvents.length) {
        const cur = byVid.get(vid) ?? [];
        const fresh = fbEvents.filter((e) => !cur.some((c) => c.dateIso === e.dateIso && c.title.toLowerCase().slice(0, 10) === e.title.toLowerCase().slice(0, 10)));
        byVid.set(vid, dedupe([...cur, ...fresh]));
      }
      // тем же токеном читаем инстаграм площадки: афиши там появляются
      // раньше, чем на сайте, а часто вместо сайта
      const igEvents = await syncInstagramBusiness(vm.pageId, vm.token).catch(() => []);
      if (igEvents.length) {
        const cur = byVid.get(vid) ?? [];
        const fresh = igEvents.filter(
          (e) => !cur.some((c) => c.dateIso === e.dateIso),
        );
        byVid.set(vid, dedupe([...cur, ...fresh]));
      }
    } catch {}
  }

  // Разведка по остальной базе: площадки, для которых адаптер не написан
  // руками. Идёт после ручных источников, поэтому ничего не затирает.
  // исключаем только рукописные адаптеры: Resident Advisor не источник
  // площадки, а внешний агрегатор — он дополняет сайт, а не заменяет его
  const covered = new Set(jobs.map(([vid]) => vid));
  try {
    for (const [vid, ev] of await syncDiscovered(ns, covered)) {
      const cur = byVid.get(vid) ?? [];
      byVid.set(vid, dedupe([...cur, ...ev]));
    }
  } catch {
    // разведка — необязательный слой, её падение не ломает основной прогон
  }

  // Resident Advisor поверх сайтов: одинаковые события (та же дата и
  // пересечение названий) не дублируем — RA дополняет, а не затирает
  for (const [vid, raId] of RA_VENUES) {
    try {
      const ra = await syncResidentAdvisor(raId);
      const cur = byVid.get(vid) ?? [];
      const fresh = ra.filter(
        (e) =>
          !cur.some(
            (c) =>
              c.dateIso === e.dateIso &&
              (c.title.toLowerCase().includes(e.title.toLowerCase().slice(0, 8)) ||
                e.title.toLowerCase().includes(c.title.toLowerCase().slice(0, 8))),
          ),
      );
      byVid.set(vid, dedupe([...cur, ...fresh]));
    } catch {
      if (!byVid.has(vid)) counts[vid] = counts[vid] ?? -1;
    }
  }
  for (const [vid, events] of byVid) {
    // события, добавленные командой вручную, переживают пересборку
    const prev = await kvGetJson<VenueAfisha>(ns, `venueevents:${vid}`);
    const manual = (prev?.events ?? []).filter(
      (e) =>
        e.source === "manual" &&
        !events.some((n) => n.dateIso === e.dateIso && n.title.toLowerCase() === e.title.toLowerCase()),
    );
    const all = dedupe([...events, ...manual]).sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    counts[vid] = all.length;
    await cachePosters(ns, vid, all, posterBudget);
    await ns.put(
      `venueevents:${vid}`,
      JSON.stringify({ events: all, syncedAt: Date.now(), source: all[0]?.source ?? "" } satisfies VenueAfisha),
    );
    // и сразу закрываем эти даты: календарь и конструктор спрашивают
    // «свободно ли», а не «покажи все события»
    await ns.put(
      busyKey(vid),
      JSON.stringify({
        dates: [...new Set(all.map((e) => e.dateIso))].sort(),
        updatedAt: Date.now(),
      } satisfies VenueBusy),
    );
  }
  return counts;
}

// Ключ ручного/кронового запуска — производная от секрета сессий
export async function afishaKey(): Promise<string> {
  const base =
    (typeof process !== "undefined" && process.env?.GTR_SESSION_SECRET) || "gtr-dev";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`afisha:${base}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}
