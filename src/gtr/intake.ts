// Приёмник афиш: чужой пост → наши факты → календарь площадки.
//
// Работает от любого источника, где текст доходит до бота: пересланный
// пост в личке, сообщение в группе, где бот состоит, пост площадки в её
// собственном канале. Разбор один и тот же — меняется только адрес входа.
//
// Чужую картинку постера не берём и чужие знаки не перекрываем. Факты —
// дата, площадка, лайнап — авторским правом не охраняются, макет —
// охраняется. Свою афишу рисуем сами.
import type { VenueAfisha, VenueAfishaEvent } from "./afisha";
import { parsePost, type ParsedEvent } from "./afisha-parse";
import { kvGetJson, type KvNs } from "./kv-ns";

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[а-яё]/g, (c) => {
      const T: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
        и: "i", й: "i", к: "c", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
        с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh",
        ъ: "", ы: "y", ь: "", э: "e", ю: "u", я: "a",
      };
      return T[c] ?? c;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const slugOf = (s: string) => fold(s).replace(/\s+/g, "-").slice(0, 40);

/** Площадка по названию из поста. Требуем совпадения по значимым словам:
 *  «Illuzion» находит Illuzion Phuket, а «Beach Club» — никого, потому
 *  что пляжных клубов на острове десятки и угадывать нельзя. */
export const matchVenue = async (query: string): Promise<{ id: string; name: string } | null> => {
  if (!query || query.length < 3) return null;
  const { PH } = await import("./data/app-data");
  const q = fold(query);
  const words = q.split(" ").filter((w) => w.length > 2 && !/^(the|bar|pub|club|beach|phuket)$/.test(w));
  if (!words.length) return null;
  let best: { id: string; name: string; score: number } | null = null;
  for (const v of PH.venues) {
    const n = fold(v.name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.includes(q) || q.includes(n)) score = 60;
    else score = words.filter((w) => n.includes(w)).length * 20;
    if (score >= 40 && (!best || score > best.score)) best = { id: v.id, name: v.name, score };
  }
  return best ? { id: best.id, name: best.name } : null;
};

/** Артисты лайнапа против базы. Порог высокий: приписать чужому вечеру
 *  нашего артиста хуже, чем не узнать его вовсе. */
export const matchArtists = async (
  names: string[],
): Promise<{ known: { id: string; name: string }[]; unknown: string[] }> => {
  const { loadArtists } = await import("./data/app-data");
  const base = await loadArtists();
  const known: { id: string; name: string }[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const q = fold(raw);
    if (q.length < 3) continue;
    const hit = base.artists.find((a) => fold(a.name) === q);
    if (hit) known.push({ id: hit.id, name: hit.name });
    else unknown.push(raw);
  }
  return { known, unknown };
};

export type VenueDraft = {
  slug: string;
  name: string;
  seenAt: number;
  seenIn: string[];
  lat?: number;
  lon?: number;
  kind?: string;
  address?: string;
  hours?: string;
  website?: string;
  status: "new" | "approved" | "skip";
};

/** Обогащение новой площадки по OpenStreetMap: координаты, тип заведения,
 *  адрес, часы. Ключей не требует. Остальное — сайт, соцсети, фото,
 *  контакты — добирает человек: угадывать телефон площадки нельзя. */
export const enrichVenue = async (name: string): Promise<Partial<VenueDraft>> => {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${name} Phuket`)}&format=json&limit=1&extratags=1&addressdetails=1`,
      {
        headers: { "user-agent": "GTR-Event/1.0 (pelikilya@gmail.com)" },
        signal: AbortSignal.timeout(6000),
      },
    );
    const d = (await r.json()) as {
      lat?: string;
      lon?: string;
      type?: string;
      extratags?: { website?: string; opening_hours?: string };
      address?: Record<string, string>;
    }[];
    const x = d?.[0];
    if (!x) return {};
    const a = x.address ?? {};
    return {
      lat: x.lat ? Number(x.lat) : undefined,
      lon: x.lon ? Number(x.lon) : undefined,
      kind: x.type,
      hours: x.extratags?.opening_hours,
      website: x.extratags?.website,
      address: [a.road, a.town || a.city, a.province].filter(Boolean).join(", ") || undefined,
    };
  } catch {
    return {};
  }
};

export type IntakeResult = {
  ok: boolean;
  reason?: string;
  event?: ParsedEvent;
  venueId?: string;
  venueName?: string;
  newVenue?: VenueDraft;
  knownArtists: { id: string; name: string }[];
  newArtists: string[];
};

/** Разобрать пост и разложить по местам. Площадка известна — событие в её
 *  календарь; неизвестна — черновик карточки, а событие ждёт в очереди,
 *  чтобы не потеряться. */
export const intakePost = async (ns: KvNs, text: string, source: string): Promise<IntakeResult> => {
  const ev = parsePost(text);
  if (!ev)
    return { ok: false, reason: "в посте нет даты — это не афиша", knownArtists: [], newArtists: [] };

  const venue = await matchVenue(ev.venueQuery);
  const { known, unknown } = await matchArtists(ev.artistNames);

  // Незнакомые имена копим отдельно: часть из них — реальные артисты,
  // часть — названия вечеринок. Решает человек, не автомат.
  for (const n of unknown) {
    const key = `artistdraft:${slugOf(n)}`;
    const prev = await kvGetJson<{ seen: number }>(ns, key);
    await ns.put(
      key,
      JSON.stringify({ name: n, seen: (prev?.seen ?? 0) + 1, at: Date.now(), source, status: "new" }),
      { expirationTtl: 90 * 24 * 3600 },
    );
  }

  if (!venue) {
    const slug = slugOf(ev.venueQuery || ev.title);
    const key = `venuedraft:${slug}`;
    const prev = await kvGetJson<VenueDraft>(ns, key);
    const draft: VenueDraft = {
      slug,
      name: ev.venueQuery || ev.title,
      seenAt: Date.now(),
      seenIn: [...new Set([...(prev?.seenIn ?? []), source])].slice(0, 5),
      status: prev?.status ?? "new",
      ...(prev?.lat ? prev : await enrichVenue(ev.venueQuery || ev.title)),
    };
    await ns.put(key, JSON.stringify(draft));
    await ns.put(`intakewait:${slug}:${ev.dateIso}`, JSON.stringify({ ...ev, source, at: Date.now() }), {
      expirationTtl: 120 * 24 * 3600,
    });
    return { ok: true, event: ev, newVenue: draft, knownArtists: known, newArtists: unknown };
  }

  // Площадка есть — событие в её календарь. Дубли по дате и названию не
  // плодим: один вечер приходит из трёх источников подряд.
  const cur = (await kvGetJson<VenueAfisha>(ns, `venueevents:${venue.id}`)) ?? {
    events: [],
    syncedAt: 0,
    source: "",
  };
  const same = cur.events.find((e) => e.dateIso === ev.dateIso && fold(e.title) === fold(ev.title));
  if (!same) {
    const item: VenueAfishaEvent = {
      id: `intake-${ev.dateIso}-${slugOf(ev.title).slice(0, 20)}`,
      title: ev.title,
      dateIso: ev.dateIso,
      url: "",
      artistIds: known.map((a) => a.id),
      source: "intake",
    };
    cur.events = [...cur.events, item].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
    cur.syncedAt = Date.now();
    await ns.put(`venueevents:${venue.id}`, JSON.stringify(cur));
    await ns.put(
      `venuebusy:${venue.id}`,
      JSON.stringify({
        dates: [...new Set(cur.events.map((e) => e.dateIso))].sort(),
        updatedAt: Date.now(),
      }),
    );
  }
  return {
    ok: true,
    event: ev,
    venueId: venue.id,
    venueName: venue.name,
    knownArtists: known,
    newArtists: unknown,
  };
};

/** Короткий отчёт о разборе — им отвечает бот и его же видит BOSS. */
export const intakeReport = (r: IntakeResult): string => {
  if (!r.ok || !r.event) return `Не разобрал: ${r.reason ?? "неизвестно"}`;
  const e = r.event;
  const lines = [
    `📅 <b>${e.dateIso}</b>${e.timeText ? ` · ${e.timeText}` : ""} — ${e.title}`,
    r.venueId
      ? `🏠 ${r.venueName} — событие в календаре площадки`
      : `🆕 Площадки нет в базе: <b>${r.newVenue?.name ?? "?"}</b>${r.newVenue?.address ? ` (${r.newVenue.address})` : ""} — черновик заведён`,
  ];
  if (r.knownArtists.length) lines.push(`🎧 Наши: ${r.knownArtists.map((a) => a.name).join(", ")}`);
  if (r.newArtists.length) lines.push(`➕ Новые имена: ${r.newArtists.join(", ")}`);
  if (e.priceText) lines.push(`🎟 ${e.priceText}`);
  return lines.join("\n");
};
