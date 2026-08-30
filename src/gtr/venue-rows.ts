// Строки конвейера: одна сборка на всех.
//
// Очередь наполнения нужна в двух местах — на экране команды и в
// утренней сводке, которую шлёт крон. Разойдись эти два расчёта хоть в
// мелочи, и разговор на планёрке превращается в спор о цифрах: у кого
// сколько площадок «в витрине» и почему по-разному. Поэтому строки
// собираются здесь, а экран и крон только показывают их по-своему.
//
// Правила готовности живут в venue-fill.ts и сети не знают. Здесь —
// подстановка данных: статика базы плюс то, что уже прислали сами
// площадки через магик-ссылку.
import type { KvNs } from "./kv-ns";
import { fillLevel, stepCost, venueGaps, type FillKey, type FillLevel } from "./venue-fill";

export type FillRowFull = {
  id: string;
  name: string;
  region: string;
  area: string;
  gaps: FillKey[];
  level: FillLevel;
  cost: number;
};

/** Собрать строки по всей базе. ns — хранилище подтверждений и фото от
 *  площадок; без него считаем по одной статике: очередь выйдет
 *  пессимистичнее, но не соврёт в другую сторону. */
export const buildFillRows = async (
  ns: KvNs | null,
  helpers: {
    kvListAll: (ns: KvNs, prefix: string) => Promise<string[]>;
    kvGetJson: <T>(ns: KvNs, key: string) => Promise<T | null>;
  },
): Promise<FillRowFull[]> => {
  const { PH, regionOf } = await import("./data/app-data");
  const geo = (await import("./data/venue-geo.json")).default as Record<string, unknown>;
  const rich = (await import("./data/rich.json")).default as Record<
    string,
    { hero?: string; gallery?: string[] }
  >;

  type Confirm = {
    contact?: { phone?: string; email?: string };
    capacity?: string;
  };
  const confirmed = new Map<string, Confirm>();
  const photos = new Map<string, number>();
  if (ns) {
    for (const k of await helpers.kvListAll(ns, "vconfirm:")) {
      const rec = await helpers.kvGetJson<Confirm>(ns, k);
      if (rec) confirmed.set(k.slice("vconfirm:".length), rec);
    }
    for (const k of await helpers.kvListAll(ns, "vphoto:")) {
      const vid = k.slice("vphoto:".length).split(":")[0];
      photos.set(vid, (photos.get(vid) ?? 0) + 1);
    }
  }

  return PH.venues.map((v) => {
    const c = confirmed.get(v.id);
    const r = rich[v.id] ?? {};
    const gaps = venueGaps(v, {
      hasGeo: Boolean(geo[v.id]),
      hero: r.hero,
      gallery: (r.gallery?.length ?? 0) + (photos.get(v.id) ?? 0),
      confirmedContact: Boolean(c?.contact?.phone || c?.contact?.email),
      confirmedCapacity: c?.capacity,
    });
    return {
      id: v.id,
      name: v.name,
      region: regionOf(v),
      area: v.area || "",
      gaps,
      level: fillLevel(gaps),
      cost: stepCost(gaps),
    };
  });
};
