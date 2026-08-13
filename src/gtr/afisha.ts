// Агент афиш: собирает календари событий площадок с их официальных сайтов
// в KV (venueevents:<venueId>). Запуск — cron воркера каждые 6 часов или
// кнопкой в паспорте площадки. Постеры — og:image событийных страниц.
import artistsRaw from "./data/artists.json";
import type { KvNs } from "./kv-ns";

export type VenueAfishaEvent = {
  id: string;
  title: string;
  dateIso: string; // YYYY-MM-DD
  poster?: string;
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

// событийная страница → карточка события
async function eventFromPage(url: string, slug: string, source: string, room?: string) {
  const dateIso = dateFromSlug(slug);
  if (!dateIso) return null; // резидентские страницы без даты пропускаем
  try {
    const html = await fetchText(url);
    const title = (og(html, "title") || slug.replace(/-/g, " ")).replace(/\s*[|–-]\s*(Café del Mar|Illuzion).*/i, "").trim();
    const poster = og(html, "image");
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
    .slice(0, 18);
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
  ].slice(0, 18);
  const out: VenueAfishaEvent[] = [];
  for (const url of links) {
    const slug = url.split("/event/")[1].replace(/\/$/, "");
    const ev = await eventFromPage(url, slug, "illuzionphuket.com", /shelter/.test(slug) ? "Shelter" : undefined);
    if (ev) out.push(ev);
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

// Полный проход: по адаптеру на площадку. Возвращает счётчики для отчёта.
export async function syncAfisha(ns: KvNs): Promise<Record<string, number>> {
  const jobs: [string, () => Promise<VenueAfishaEvent[]>][] = [
    ["VEN-0002", syncCafeDelMar],
    ["VEN-0013", syncIlluzion],
  ];
  const counts: Record<string, number> = {};
  for (const [vid, run] of jobs) {
    try {
      const events = dedupe(await run());
      counts[vid] = events.length;
      await ns.put(
        `venueevents:${vid}`,
        JSON.stringify({ events, syncedAt: Date.now(), source: events[0]?.source ?? "" } satisfies VenueAfisha),
      );
    } catch (e) {
      counts[vid] = -1; // источник недоступен — прошлые данные не трогаем
    }
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
