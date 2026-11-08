// Билетные площадки: Megatix и Ticketmelon.
//
// Вечеринку с входным билетом организатор почти всегда выкладывает на
// билетную площадку раньше, чем на свой сайт, а у половины площадок сайта
// с афишей нет вовсе. Билетная площадка отдаёт то, чего нет у агрегаторов:
// цену, точное начало и постер. Проверено живой загрузкой 08.11.2026:
//
//   • Megatix — открытая ручка поиска /api/v2/events/search, сотня
//     событий на страницу, пять страниц на всю страну. Координат нет,
//     город угадываем по названию площадки, вечера и организатора.
//   • Ticketmelon — карта сайта (sitemap-event1..5, ~500 ссылок) и
//     страница события с __NEXT_DATA__: дата в миллисекундах, площадка
//     с адресом по-тайски и точкой на карте. Ручки API закрыты (403).
//   • Eventpop не подключён: на любой запрос отвечает проверкой
//     Cloudflare «Just a moment», читать там нечего.
//
// Бюджет: бесплатный тариф Workers даёт около пятидесяти подзапросов на
// вызов, а сбор афиш и так на пределе. Поэтому билеты собирает отдельная
// дневная задача (/api/tickets), а сбор афиш читает готовый результат из
// KV и не тратит на него ни одного запроса. Страницы Ticketmelon дорогие
// (одна страница — один подзапрос), их держим в кэше и дочитываем
// понемногу за прогон: новые ссылки и те, у которых сменился lastmod.
import { regionFromRa } from "./afisha-ra-area";
import { isJunkEventTitle } from "./afisha-clean";
import { bkkToday } from "./afisha-parse";
import { pickVenueByName, slugOf } from "./intake";
import { kvGetJson, type KvNs } from "./kv-ns";

export const TICKETS_KEY = "routeevents:tickets";
const TM_CACHE_KEY = "tickets:tmcache";
/** Megatix продаёт и рождественские ужины за полтора месяца: дальше
 *  четырёх месяцев — уже не афиша, а анонс. */
const WINDOW_DAYS = 120;
const MX_MAX_PAGES = 6;
/** Страниц Ticketmelon за прогон. Вместе с картой сайта (шесть запросов)
 *  и Megatix (до шести) выходит около сорока подзапросов — с запасом
 *  под сторожа, который идёт на том же тике. */
export const TM_PAGES_PER_RUN = 24;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export type TicketSource = "megatix.in.th" | "ticketmelon.com";

export type TicketEvent = {
  id: string; // mx-<id> | tm-<event_id>
  title: string;
  dateIso: string;
  time?: string;
  price?: string;
  poster?: string;
  url: string; // страница покупки билета
  venue: string;
  region: string;
  vid?: string; // площадка из нашей базы
  venueAddress?: string;
  venueGeo?: [number, number];
  source: TicketSource;
};
export type TicketsStore = { events: TicketEvent[]; syncedAt: number; counts?: Record<string, number> };
/** Кэш страниц Ticketmelon: ссылка → lastmod из карты сайта и разбор.
 *  Без события (e нет) — страница прочитана, но это не наш вечер:
 *  прошедший, скрытый, без даты. Повторно её не читаем, пока не сменится
 *  lastmod или ссылка не уйдёт из карты сайта. */
type TmCache = { rows: Record<string, { m: string; e?: TicketEvent }> };

type Venue = { id: string; name: string; region?: string };

// Тайские названия провинций: Ticketmelon пишет адрес по-тайски.
// Порядок тот же, что у английских: острова раньше, Пханг-Нга раньше
// Пхукета (Zamna «Phuket» на деле стоит в Пханг-Нге).
const THAI_RX: [string, RegExp][] = [
  ["pgn", /พะงัน/],
  ["smu", /สมุย/],
  ["pna", /พังงา/],
  ["phuket", /ภูเก็ต/],
  ["pty", /พัทยา|บางละมุง/],
  ["cnx", /เชียงใหม่/],
  ["ayt", /อยุธยา/],
  ["bkk", /กรุงเทพ/],
];

/** Регион по имени площадки, адресу и точке. Сначала английский адрес и
 *  точные координаты (тот же разбор, что у ленты RA), потом тайский. */
export function ticketRegion(name: string, address = "", lat?: number, lon?: number): string | null {
  const r = regionFromRa({
    name,
    address,
    location: lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined,
  });
  if (r) return r;
  const text = `${name} ${address}`;
  for (const [code, rx] of THAI_RX) if (rx.test(text)) return code;
  return null;
}

/** Площадку сводим с базой только внутри своего региона — как у RA — и
 *  строже, чем RA: одно имя должно целиком входить в другое. Билетные
 *  площадки пишут площадку как попало, и двух общих слов не хватает:
 *  живой прогон 08.11.2026 приписал «Oxa Koh Phangan» к Sabai Corner
 *  Koh Phangan, а рождественский ужин Amari Koh Samui — к Club Seen. */
export function attach(venue: string, region: string, venues: readonly Venue[]): string | undefined {
  if (!venue) return undefined;
  const hit = pickVenueByName(venue, venues.filter((v) => (v.region || "phuket") === region));
  if (!hit) return undefined;
  const [q, n] = [`-${slugOf(venue)}-`, `-${slugOf(hit.name)}-`];
  return q.includes(n) || n.includes(q) ? hit.id : undefined;
}

/** Не вечер: Megatix продаёт через ту же витрину трансферы, спа, туры и
 *  столы VIP к уже выставленной вечеринке. */
const NOT_EVENT =
  /\b(airport|transfer|shuttle|voucher|gift ?card|hamper|membership|day ?pass|daypass|vip tables?|package|spa|yoga|cooking class|island tour|city tour|day trip|excursion|cruise|tubing|content review|work from|exclusive deals?|early bird offer|buy 1 get 1)\b/i;

const clean = (s: unknown) =>
  String(s ?? "").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\s+/g, " ").trim();

export type MxItem = {
  id: number | string;
  name?: string;
  slug?: string;
  promoter_name?: string;
  venue_name?: string;
  is_published?: boolean;
  visibility?: string;
  cover?: string;
  display_price?: string;
  start_datetime?: string;
};

/** «฿300.00 - ฿25,000.00» → «฿300 - ฿25,000». */
const mxPrice = (p: unknown) => clean(p).replace(/\.00\b/g, "") || undefined;

/** Ответ поиска Megatix → вечера. Чистая функция: её и тестируем. */
export function parseMegatix(items: readonly MxItem[], today: string, venues: readonly Venue[] = [], until = "9999-12-31"): TicketEvent[] {
  const out: TicketEvent[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it?.id || it.is_published === false || (it.visibility && it.visibility !== "Public")) continue;
    const title = clean(it.name);
    const venue = clean(it.venue_name);
    const start = String(it.start_datetime ?? "");
    const dateIso = start.slice(0, 10);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || dateIso < today || dateIso > until) continue;
    if (NOT_EVENT.test(title) || isJunkEventTitle(title)) continue;
    // «Alexa Beach Club» у «Alexa Beach Club» — витрина заведения, а не вечер
    if (venue && title.toLowerCase() === venue.toLowerCase()) continue;
    // сначала площадка, потом вечер и организатор: Kolour из Бангкока
    // возит вечеринки и на Пхукет, и «Phuket» в названии соседнего вечера
    // не должен увезти Cloud 11 из столицы
    const region = ticketRegion(venue) ?? ticketRegion(`${title} ${clean(it.promoter_name)}`);
    if (!region) continue; // город не узнан — лучше не показать, чем показать не там
    const id = `mx-${it.id}`;
    const twin = `${dateIso}|${slugOf(title).slice(0, 14)}`;
    if (seen.has(id) || seen.has(twin)) continue;
    seen.add(id).add(twin);
    const time = start.slice(11, 16);
    const cover = String(it.cover ?? "");
    out.push({
      id,
      title,
      dateIso,
      time: /^\d{2}:\d{2}$/.test(time) && time !== "00:00" ? time : undefined,
      price: mxPrice(it.display_price),
      poster: /^https:\/\//.test(cover) && !cover.endsWith("/images/cover.png") ? cover : undefined,
      url: `https://megatix.in.th/events/${encodeURIComponent(String(it.slug ?? it.id))}`,
      venue,
      region,
      vid: attach(venue, region, venues),
      source: "megatix.in.th",
    });
  }
  return out.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

export type TmEvent = {
  event_id?: string;
  name?: string;
  show_starttime?: number;
  show_endtime?: number;
  timezone?: { offset?: number };
  img_poster?: string;
  img_banner?: string;
  status?: string;
  is_hide_web?: boolean;
  venue?: { name?: string; formatted_address?: string; latitude?: number; longitude?: number } | null;
};

/** __NEXT_DATA__ страницы события Ticketmelon → props.pageProps.event. */
export function tmEventFromHtml(html: string): TmEvent | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return (JSON.parse(m[1]) as { props?: { pageProps?: { event?: TmEvent } } }).props?.pageProps?.event ?? null;
  } catch {
    return null;
  }
}

/** Событие Ticketmelon → вечер, или null, если показывать нечего. */
export function parseTicketmelon(e: TmEvent | null, url: string, today: string, venues: readonly Venue[] = [], until = "9999-12-31"): TicketEvent | null {
  if (!e?.event_id || !e.name || e.status !== "publish" || e.is_hide_web) return null;
  const start = Number(e.show_starttime);
  if (!Number.isFinite(start) || start <= 0) return null;
  // время площадки: смещение в минутах, по умолчанию Бангкок (UTC+7)
  const local = new Date(start + (e.timezone?.offset ?? 420) * 60e3).toISOString();
  const dateIso = local.slice(0, 10);
  if (dateIso < today || dateIso > until) return null;
  const title = clean(e.name);
  if (NOT_EVENT.test(title) || isJunkEventTitle(title)) return null;
  const venue = clean(e.venue?.name);
  const address = clean(e.venue?.formatted_address);
  const lat = Number(e.venue?.latitude);
  const lon = Number(e.venue?.longitude);
  const geo = Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? ([lat, lon] as [number, number]) : undefined;
  const region = ticketRegion(venue, address, geo?.[0], geo?.[1]);
  if (!region) return null;
  const time = local.slice(11, 16);
  const poster = [e.img_poster, e.img_banner].find((p) => /^https:\/\//.test(String(p ?? "")));
  const vid = attach(venue, region, venues);
  return {
    id: `tm-${e.event_id}`,
    title,
    dateIso,
    time: time !== "00:00" ? time : undefined,
    poster,
    url,
    venue,
    region,
    vid,
    ...(vid ? {} : { venueAddress: address || undefined, venueGeo: geo }),
    source: "ticketmelon.com",
  };
}

/** Ссылки из карты сайта с lastmod. */
export function sitemapEntries(xml: string): { loc: string; m: string }[] {
  const out: { loc: string; m: string }[] = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (loc) out.push({ loc, m: block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? "" });
  }
  return out;
}

/** Курортные организаторы и вечера — вперёд: маршрут тура идёт по
 *  островам, а Бангкок Ticketmelon покрывает и без нас с избытком. */
const RESORT = /phuket|patong|kata|kamala|surin|bangtao|samui|phangan|pha-?ngan|khao-?lak|pattaya|chiang-?mai|krabi|zamna|illuzion|kolour|fullmoon|full-moon/i;

/** Какие страницы Ticketmelon читать в этот прогон. Новые раньше
 *  изменившихся, курортные раньше прочих, свежие раньше старых. */
export function tmToFetch(entries: readonly { loc: string; m: string }[], cache: TmCache["rows"], limit = TM_PAGES_PER_RUN): string[] {
  return entries
    .filter((x) => !cache[x.loc] || (x.m && cache[x.loc].m !== x.m))
    .map((x) => ({ ...x, fresh: cache[x.loc] ? 1 : 0, resort: RESORT.test(x.loc) ? 0 : 1 }))
    .sort((a, b) => a.fresh - b.fresh || a.resort - b.resort || b.m.localeCompare(a.m))
    .slice(0, limit)
    .map((x) => x.loc);
}

async function getText(url: string, accept = "text/html"): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept } });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.text();
}

async function fetchMegatix(today: string, until: string, venues: readonly Venue[]): Promise<TicketEvent[]> {
  const items: MxItem[] = [];
  for (let page = 1; page <= MX_MAX_PAGES; page++) {
    const j = JSON.parse(await getText(`https://megatix.in.th/api/v2/events/search?page=${page}`, "application/json")) as {
      data?: MxItem[];
      meta?: { last_page?: number };
    };
    items.push(...(j.data ?? []));
    if (!j.data?.length || page >= (j.meta?.last_page ?? 1)) break;
  }
  return parseMegatix(items, today, venues, until);
}

/** Собрать билетные площадки и положить в KV одним ключом. */
export async function syncTickets(ns: KvNs): Promise<Record<string, number>> {
  const { PH } = await import("./data/app-data");
  const venues = PH.venues as Venue[];
  const today = bkkToday();
  const until = bkkToday(WINDOW_DAYS);
  const prev = await kvGetJson<TicketsStore>(ns, TICKETS_KEY);
  const counts: Record<string, number> = {};

  // Megatix: прилёг — оставляем вчерашние вечера, кроме прошедших
  let mx: TicketEvent[];
  try {
    mx = await fetchMegatix(today, until, venues);
    counts.megatix = mx.length;
  } catch {
    mx = (prev?.events ?? []).filter((e) => e.source === "megatix.in.th" && e.dateIso >= today);
    counts.megatix = -1;
  }

  // Ticketmelon: карта сайта → кэш страниц → дочитываем понемногу
  const cache = (await kvGetJson<TmCache>(ns, TM_CACHE_KEY))?.rows ?? {};
  let cacheChanged = false;
  try {
    const index = sitemapEntries(await getText("https://www.ticketmelon.com/sitemap.xml", "application/xml"));
    const entries: { loc: string; m: string }[] = [];
    for (const s of index.filter((x) => /sitemap-event\d*\.xml$/.test(x.loc)).slice(0, 8))
      entries.push(...sitemapEntries(await getText(s.loc, "application/xml")));
    if (entries.length) {
      // ушло из карты сайта — снято с продажи, в кэше не держим
      const live = new Set(entries.map((x) => x.loc));
      for (const loc of Object.keys(cache))
        if (!live.has(loc)) {
          delete cache[loc];
          cacheChanged = true;
        }
      const lastmod = new Map(entries.map((x) => [x.loc, x.m]));
      let read = 0;
      for (const loc of tmToFetch(entries, cache)) {
        try {
          const e = parseTicketmelon(tmEventFromHtml(await getText(loc)), loc, today, venues, until);
          cache[loc] = { m: lastmod.get(loc) ?? "", ...(e ? { e } : {}) };
          cacheChanged = true;
          read++;
        } catch {
          // одна страница не открылась — дочитаем в следующий прогон
        }
      }
      counts["ticketmelon-read"] = read;
      counts["ticketmelon-left"] = tmToFetch(entries, cache, Infinity).length;
    }
  } catch {
    counts["ticketmelon-read"] = -1;
  }
  // база площадок растёт — сводим кэшированные вечера с ней заново
  const tm: TicketEvent[] = [];
  for (const row of Object.values(cache)) {
    const e = row.e;
    if (!e || e.dateIso < today) continue;
    const vid = attach(e.venue, e.region, venues);
    tm.push(vid ? { ...e, vid, venueAddress: undefined, venueGeo: undefined } : { ...e, vid: undefined });
  }
  counts.ticketmelon = tm.length;
  if (cacheChanged) await ns.put(TM_CACHE_KEY, JSON.stringify({ rows: cache } satisfies TmCache));

  const events = [...mx, ...tm].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  // пустой итог не затирает прошлый: обе площадки прилегли — не повод
  // показывать гостям пустой маршрут
  if (events.length)
    await ns.put(TICKETS_KEY, JSON.stringify({ events, syncedAt: Date.now(), counts } satisfies TicketsStore));
  counts.total = events.length;
  return counts;
}

/** Вечера с билетных площадок из KV. Без сети: сеть — дело дневной задачи. */
export async function readTickets(ns: KvNs): Promise<TicketEvent[]> {
  const today = bkkToday();
  return ((await kvGetJson<TicketsStore>(ns, TICKETS_KEY))?.events ?? []).filter((e) => e.dateIso >= today);
}
