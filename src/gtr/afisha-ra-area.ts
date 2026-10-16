// Афиша по всему Таиланду из Resident Advisor — для витрины маршрута
// (bangtaostyle.com, /api/route-events).
//
// Своя афиша GTR Event собирается по площадкам и сегодня покрывает
// только Пхукет: у площадок Самуи, Пангана, Бангкока и Паттайи нет ни
// адаптеров, ни карты RA. Тур при этом идёт кольцом через все эти города,
// и витрина показывала «афиша ещё не вышла» на каждом этапе, кроме первого.
// У RA есть общая лента страны (area 67 «Thailand · All»): одним запросом
// она отдаёт клубные вечера Бангкока, Пангана, Чиангмая и Пхукета.
//
// Хранится отдельным ключом, а не в venueevents:<vid>. Те ключи читают
// дайджест «Куда пойти на Пхукете», /tonight и мозг BRO — бангкокским
// вечерам там не место. Если площадка RA совпала с нашей базой, у события
// есть vid, и витрина ведёт гостя на карточку площадки в GTR Event.
import { isJunkEventTitle } from "./afisha-clean";
import { bkkToday } from "./afisha-parse";
import { pickVenueByName } from "./intake";
import { kvGetJson, type KvNs } from "./kv-ns";

export const RA_ROUTE_KEY = "routeevents:ra";
/** Лента страны целиком: в «Bangkok» (453) только столица, в «Phuket»
 *  (694) пусто — площадки острова RA записывает в общую ленту. */
const RA_THAILAND_AREA = 67;
const WINDOW_DAYS = 60;
const PAGE_SIZE = 100;
const MAX_PAGES = 4;
/** Как часто витрина может сама обновить ленту, если крон не успел. */
export const RA_ROUTE_TTL_MS = 6 * 3600e3;

export type RaRouteEvent = {
  id: string; // ra-<id>, тот же формат, что у адаптера площадок RA
  title: string;
  dateIso: string;
  time?: string;
  poster?: string;
  url: string; // страница события на ra.co
  venue: string;
  region: string;
  vid?: string; // площадка из нашей базы, если имя совпало
};
export type RaRouteStore = { events: RaRouteEvent[]; syncedAt: number };

type RaVenue = {
  id?: string;
  name?: string;
  address?: string;
  area?: { name?: string };
  location?: { latitude?: number; longitude?: number };
};
type RaListing = {
  event?: {
    id: string;
    title: string;
    date: string;
    startTime?: string;
    contentUrl?: string;
    venue?: RaVenue;
    images?: { filename?: string }[];
    artists?: { name: string }[];
  };
};

// Регион по адресу. Порядок важен: Панган и Самуи оба пишутся «Surat
// Thani», поэтому острова проверяются раньше; «Phang Nga» — не «Phangan».
const ADDRESS_RX: [string, RegExp][] = [
  ["pgn", /phang ?an\b|pha-?ngan|haad rin|hat rin|thong ?sala|ban tai|srithanu|sri thanu/i],
  ["smu", /samui|chaweng|lamai|bo ?phut|mae ?nam|choeng mon/i],
  ["pna", /phang[ -]?nga|khao ?lak|takua ?pa/i],
  ["phuket", /phuket|patong|kamala|\bkata\b|karon|rawai|surin beach|bang ?tao|cherng ?talay|thalang|kathu|chalong|bangla/i],
  ["pty", /pattaya|jomtien|na ?klua|bang ?lamung/i],
  ["cnx", /chiang ?mai|nimman|\bcnx\b/i],
  ["ayt", /ayutthaya/i],
  ["bkk", /bangkok|\bbkk\b|sukhumvit|silom|thong ?lor?\b|ekkamai|sathorn|bang ?rak|watthana|wattana|khlong ?tan|pathum ?wan|ratchathewi|phra ?nakhon|yan ?nawa|chatuchak|huai ?khwang/i],
];

// Запасной путь — координаты, но только точные: RA часто отдаёт 0,0 или
// округлённые 14,101, а это поле в Сиамском заливе, а не адрес.
const BOXES: [string, number, number, number, number][] = [
  ["phuket", 7.74, 8.21, 98.24, 98.48],
  ["pna", 8.21, 9.1, 98.2, 98.75],
  ["smu", 9.38, 9.62, 99.88, 100.13],
  ["pgn", 9.65, 9.82, 99.95, 100.12],
  ["bkk", 13.5, 14.05, 100.3, 100.95],
  ["pty", 12.6, 13.15, 100.75, 101.05],
  ["cnx", 18.6, 19.05, 98.8, 99.15],
  ["ayt", 14.2, 14.5, 100.4, 100.7],
];

export function regionFromRa(v: RaVenue | undefined): string | null {
  if (!v) return null;
  const text = `${v.name ?? ""} ${v.address ?? ""}`;
  for (const [code, rx] of ADDRESS_RX) if (rx.test(text)) return code;
  if (/bangkok/i.test(v.area?.name ?? "")) return "bkk";
  const lat = v.location?.latitude ?? 0;
  const lon = v.location?.longitude ?? 0;
  const precise = !Number.isInteger(lat) && !Number.isInteger(lon);
  if (precise) for (const [code, a, b, c, d] of BOXES) if (lat >= a && lat <= b && lon >= c && lon <= d) return code;
  return null;
}

/** Невидимые символы направления текста: RA пропускает их из копипасты
 *  организаторов, и «Vinyl» на экране превращается в «Vi‬‬‬nyl». */
const clean = (s: string) => String(s ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/\s+/g, " ").trim();

/** Имя площадки RA без хвоста «(Koh Phangan)» и пометки «TBA - …». */
const venueName = (raw: string) => raw.replace(/^TBA\s*-\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Ответ eventListings → события витрины. Чистая функция: её и тестируем. */
export function parseRaListings(
  listings: RaListing[],
  today: string,
  venues: readonly { id: string; name: string; region?: string }[] = [],
): RaRouteEvent[] {
  const out: RaRouteEvent[] = [];
  const seen = new Set<string>();
  for (const { event: e } of listings) {
    if (!e?.id || !e.title) continue;
    const dateIso = String(e.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || dateIso < today) continue;
    const region = regionFromRa(e.venue);
    if (!region) continue; // город не узнан — лучше не показать, чем показать не там
    const id = `ra-${e.id}`;
    if (seen.has(id)) continue;
    const names = (e.artists ?? []).map((a) => clean(a.name)).filter(Boolean);
    const base = clean(e.title);
    const title = base + (names.length && !base.toLowerCase().includes(names[0].toLowerCase()) ? ` · ${names.slice(0, 3).join(", ")}` : "");
    if (isJunkEventTitle(title)) continue;
    seen.add(id);
    const time = String(e.startTime ?? "").slice(11, 16);
    const name = venueName(e.venue?.name ?? "");
    // сводим с базой только внутри своего региона: «Illuzion» на Пхукете
    // не должен забрать одноимённый бар в Бангкоке
    const hit = name ? pickVenueByName(name, venues.filter((v) => (v.region || "phuket") === region)) : null;
    const img = e.images?.[0]?.filename;
    out.push({
      id,
      title,
      dateIso,
      time: time && time !== "00:00" ? time : undefined,
      poster: img && /^https:\/\//.test(img) ? img : undefined,
      url: e.contentUrl ? `https://ra.co${e.contentUrl}` : "https://ra.co/events/th/all",
      venue: name || e.venue?.name || "",
      region,
      vid: hit?.id,
    });
  }
  return out.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

async function fetchListingsPage(from: string, to: string, page: number) {
  const query = `query { eventListings(filters: { areas: { eq: ${RA_THAILAND_AREA} }, listingDate: { gte: "${from}", lte: "${to}" } }, pageSize: ${PAGE_SIZE}, page: ${page}) { totalResults data { event { id title date startTime contentUrl venue { id name address area { name } location { latitude longitude } } images { filename } artists { name } } } } }`;
  const res = await fetch("https://ra.co/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      referer: "https://ra.co/",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`ra ${res.status}`);
  const j = (await res.json()) as { data?: { eventListings?: { totalResults?: number; data?: RaListing[] } } };
  return j.data?.eventListings ?? { totalResults: 0, data: [] };
}

/** Забрать ленту страны и положить в KV. Возвращает число событий. */
export async function syncRaRoute(ns: KvNs): Promise<number> {
  const { PH } = await import("./data/app-data");
  const today = bkkToday();
  const until = bkkToday(WINDOW_DAYS);
  const listings: RaListing[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchListingsPage(today, until, page);
    listings.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < PAGE_SIZE || listings.length >= (r.totalResults ?? 0)) break;
  }
  const events = parseRaListings(listings, today, PH.venues as { id: string; name: string; region?: string }[]);
  // пустой ответ не затирает вчерашнюю ленту: RA прилёг — не повод
  // показывать гостям пустой маршрут
  if (!events.length) return 0;
  await ns.put(RA_ROUTE_KEY, JSON.stringify({ events, syncedAt: Date.now() } satisfies RaRouteStore));
  return events.length;
}

/** Лента для витрины: из KV, а если её нет или крон давно не приходил —
 *  обновляем на месте. Ошибка RA не роняет витрину: отдаём что есть. */
export async function readRaRoute(ns: KvNs): Promise<RaRouteEvent[]> {
  const cur = await kvGetJson<RaRouteStore>(ns, RA_ROUTE_KEY);
  if (cur && Date.now() - cur.syncedAt < RA_ROUTE_TTL_MS) return cur.events;
  try {
    if (await syncRaRoute(ns)) return (await kvGetJson<RaRouteStore>(ns, RA_ROUTE_KEY))?.events ?? [];
  } catch {
    // RA недоступен — ниже вернём прошлую ленту
  }
  return cur?.events ?? [];
}
