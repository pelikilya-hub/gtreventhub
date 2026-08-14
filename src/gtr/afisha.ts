// Агент афиш: собирает календари событий площадок с их официальных сайтов
// в KV (venueevents:<venueId>). Запуск — cron воркера каждые 6 часов или
// кнопкой в паспорте площадки. Постеры — og:image событийных страниц.
import artistsRaw from "./data/artists.json";
import type { KvNs } from "./kv-ns";

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

async function syncIlluzion(): Promise<VenueAfishaEvent[]> {
  const html = await fetchText("https://www.illuzionphuket.com/events/");
  const links = [
    ...new Set(html.match(/https:\/\/www\.illuzionphuket\.com\/event\/[a-z0-9-]+\//g) ?? []),
  ].slice(0, 12);
  const out: VenueAfishaEvent[] = [];
  for (const url of links) {
    const slug = url.split("/event/")[1].replace(/\/$/, "");
    const ev = await eventFromPage(url, slug, "illuzionphuket.com", /shelter/.test(slug) ? "Shelter" : undefined);
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

const dedupe = (list: VenueAfishaEvent[]) => {
  const seen = new Set<string>();
  return list
    .filter((e) => {
      const k = `${e.dateIso}:${norm(e.title)}`;
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

export async function syncAfisha(ns: KvNs): Promise<Record<string, number>> {
  const jobs: [string, () => Promise<VenueAfishaEvent[]>][] = [
    ["VEN-0002", syncCafeDelMar],
    ["VEN-0013", syncIlluzion],
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
    counts[vid] = events.length;
    await cachePosters(ns, vid, events, posterBudget);
    await ns.put(
      `venueevents:${vid}`,
      JSON.stringify({ events, syncedAt: Date.now(), source: events[0]?.source ?? "" } satisfies VenueAfisha),
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
