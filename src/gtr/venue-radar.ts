// Радар новых площадок: агрегаторы видят открытия раньше нас.
//
// Новое место почти никогда не начинает с сайта. Первым его выдаёт
// агрегатор: вечеринка на Resident Advisor, строчка в городском
// календаре. Раньше сбор афиш такие события выбрасывал — «площадки нет
// в базе» — и открытие проходило мимо. Замер 26.10.2026: из 160 событий
// ленты RA по стране 108 стояли у площадок, которых в базе нет.
//
// Теперь каждое такое событие — находка радара. Находки сводятся по
// имени площадки в черновик (venuedraft:<slug>), тот же, что заводит
// приёмник пересланных постов, и попадают на экран «Черновики». Решает
// человек: половина «новых площадок» — это «Secret Location» или
// торговый центр. Вечера, с которыми площадку принесли, лежат в самом
// черновике и переезжают в её календарь при одобрении.
//
// Бюджет записи KV здесь главное ограничение: бесплатный тариф даёт
// тысячу записей в сутки, а сбор афиш идёт каждые два часа. Поэтому
// черновик пишется, только когда в нём что-то изменилось (новый вечер
// или новый источник), и не больше RADAR_WRITES_PER_RUN за прогон.
import { pickVenueByName, slugOf, type DraftEvent, type VenueDraft } from "./intake";
import { kvGetJson, kvListAll, type KvNs } from "./kv-ns";

export type RadarSighting = {
  /** Имя площадки, как его написал агрегатор. */
  name: string;
  region: string;
  /** Хост агрегатора: ra.co, www.phuket.net. */
  source: string;
  event: { id: string; dateIso: string; title: string; url: string };
  address?: string;
  lat?: number;
  lon?: number;
};

/** Сколько черновиков радар пишет за прогон. Первый прогон найдёт
 *  несколько десятков площадок, и разойдутся они за пару прогонов;
 *  дальше изменений единицы. */
export const RADAR_WRITES_PER_RUN = 25;

/** Вечеров в черновике: чтобы решить, хватает первых нескольких. */
const EVENTS_PER_DRAFT = 12;

/** Не площадки: место скрыто, разбросано или его нет вовсе. */
const NOT_A_PLACE =
  /^(tba|tbc|tba\s*-.*|to be announced|secret( location| venue)?|various( venues| locations)?|multiple venues|online|livestream|live stream|private( location| villa| party)?|location tba|venue tba|address on ticket)$/i;

/** Имя площадки, пригодное для черновика, или пустая строка. */
export function radarName(raw: string): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 80) return "";
  if (NOT_A_PLACE.test(name) || /^\d+$/.test(name)) return "";
  return name;
}

const eventKey = (e: { dateIso: string; title: string }) => `${e.dateIso}|${slugOf(e.title)}`;

/** Черновик после очередного прогона, или null, если писать нечего.
 *
 *  Отклонённую площадку («Не наша») радар не воскрешает: иначе она
 *  возвращалась бы каждые два часа, пока у неё идут вечеринки. */
export function mergeRadarDraft(
  prev: VenueDraft | null,
  slug: string,
  sightings: readonly RadarSighting[],
  today: string,
  now: number,
): VenueDraft | null {
  if (prev?.status === "skip" || !sightings.length) return null;
  const first = sightings[0];

  const events = new Map<string, DraftEvent>();
  for (const e of prev?.events ?? []) if (e.dateIso >= today) events.set(eventKey(e), e);
  for (const s of sightings)
    if (s.event.dateIso >= today && !events.has(eventKey(s.event)))
      events.set(eventKey(s.event), { ...s.event, source: s.source });
  const nextEvents = [...events.values()]
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
    .slice(0, EVENTS_PER_DRAFT);

  const seenIn = [...new Set([...(prev?.seenIn ?? []), ...sightings.map((s) => s.source)])].slice(0, 5);
  const geo = sightings.find((s) => s.lat !== undefined && s.lon !== undefined);
  const address = sightings.find((s) => s.address)?.address;

  const changed =
    !prev ||
    JSON.stringify(nextEvents.map(eventKey)) !== JSON.stringify((prev.events ?? []).map(eventKey)) ||
    seenIn.length !== prev.seenIn.length ||
    (!prev.lat && !!geo) ||
    (!prev.address && !!address);
  if (!changed) return null;

  return {
    ...prev,
    slug,
    name: prev?.name ?? first.name,
    seenAt: now,
    firstSeenAt: prev?.firstSeenAt ?? prev?.seenAt ?? now,
    seenIn,
    status: prev?.status ?? "new",
    region: prev?.region ?? first.region,
    lat: prev?.lat ?? geo?.lat,
    lon: prev?.lon ?? geo?.lon,
    address: prev?.address ?? address,
    events: nextEvents,
  };
}

/** Что записать за прогон. Вперёд идут площадки с наибольшим числом
 *  вечеров: за ними стоит программа, а не разовый концерт. */
export function planRadar(
  sightings: readonly RadarSighting[],
  prevBySlug: ReadonlyMap<string, VenueDraft>,
  today: string,
  now: number,
): { writes: VenueDraft[]; fresh: VenueDraft[] } {
  const groups = new Map<string, RadarSighting[]>();
  for (const s of sightings) {
    const name = radarName(s.name);
    const slug = name ? slugOf(name) : "";
    if (!slug) continue;
    groups.set(slug, [...(groups.get(slug) ?? []), { ...s, name }]);
  }
  const writes: VenueDraft[] = [];
  for (const [slug, list] of groups) {
    const next = mergeRadarDraft(prevBySlug.get(slug) ?? null, slug, list, today, now);
    if (next) writes.push(next);
  }
  writes.sort((a, b) => (b.events?.length ?? 0) - (a.events?.length ?? 0));
  const capped = writes.slice(0, RADAR_WRITES_PER_RUN);
  return { writes: capped, fresh: capped.filter((d) => !prevBySlug.has(d.slug)) };
}

/** Прогон радара. Возвращает черновики, заведённые впервые, — для
 *  служебного дайджеста. */
export async function runRadar(
  ns: KvNs,
  sightings: readonly RadarSighting[],
  today: string,
  now = Date.now(),
): Promise<VenueDraft[]> {
  if (!sightings.length) return [];

  // Принятые площадки (venueadd:VEN-9xxx) в статичную базу ещё не
  // вошли, и сбор афиш их не узнаёт. Без этой сверки радар заводил бы
  // одобренную площадку черновиком заново на следующем же прогоне.
  const approved: { id: string; name: string }[] = [];
  for (const k of await kvListAll(ns, "venueadd:")) {
    const v = await kvGetJson<{ id?: string; name?: string }>(ns, k);
    if (v?.id && v.name) approved.push({ id: v.id, name: v.name });
  }
  const unknown = approved.length
    ? sightings.filter((s) => !pickVenueByName(s.name, approved))
    : sightings;

  const existing = new Set(await kvListAll(ns, "venuedraft:"));
  const prev = new Map<string, VenueDraft>();
  for (const slug of new Set(unknown.map((s) => slugOf(radarName(s.name))).filter(Boolean))) {
    if (!existing.has(`venuedraft:${slug}`)) continue;
    const d = await kvGetJson<VenueDraft>(ns, `venuedraft:${slug}`);
    if (d) prev.set(slug, d);
  }

  const { writes, fresh } = planRadar(unknown, prev, today, now);
  for (const d of writes) await ns.put(`venuedraft:${d.slug}`, JSON.stringify(d));
  return fresh;
}
