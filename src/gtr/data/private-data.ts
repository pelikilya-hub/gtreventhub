// Рабочая часть базы: контакты, менеджмент, райдеры, разведка.
//
// ВАЖНО: этот модуль можно импортировать ТОЛЬКО из серверного кода —
// server-функций, api-роутов и инструментов BRO. Любой импорт из экрана
// затянет полные json в браузерный бандл, и вся работа по разделению
// базы окажется бессмысленной: файл бандла отдаётся анонимно, по прямой
// ссылке, без всякого входа.
//
// Публичная витрина живёт в app-data (venues.public.json / artists.public.json)
// и содержит только то, что и так показывается на экране.

export type VenueContact = {
  id: string;
  venueId: string;
  venue?: string;
  type?: string;
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  channel?: string;
  status?: string;
  verified?: string;
  notes?: string;
};

type VenuesFull = {
  venues: { id: string; phone?: string; email?: string; telegram?: string }[];
  contacts: VenueContact[];
  research?: unknown[];
};

type ArtistsFull = {
  artists: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    wa?: string;
    waRu?: string;
    mgmt?: string;
    mgmtRu?: string;
    person?: string;
    rider?: string;
    riderName?: string;
    notes?: string;
    notesRu?: string;
    evidence?: string;
    evidenceRu?: string;
  }[];
};

// Полные файлы регионов (с контактами и разведкой) — только на сервере.
// Глоб ленивый: код региона грузится при первом обращении, .public-файлы
// отфильтрованы — они и так уезжают в браузер через app-data.
const regionFullModules = import.meta.glob("./regions/*.json");

export const loadVenuesFull = async (): Promise<VenuesFull> => {
  const base = (await import("./venues.json")).default as unknown as VenuesFull;
  const out: VenuesFull = {
    venues: [...base.venues],
    contacts: [...base.contacts],
    research: base.research,
  };
  for (const [path, load] of Object.entries(regionFullModules)) {
    if (path.includes(".public.")) continue;
    const m = (await load()) as { default: Partial<VenuesFull> };
    out.venues.push(...(m.default.venues ?? []));
    out.contacts.push(...(m.default.contacts ?? []));
  }
  return out;
};

export const loadArtistsFull = () =>
  import("./artists.json").then((m) => m.default as unknown as ArtistsFull);

/** Контакт площадки для рабочего контура. */
export const venueContact = async (venueId: string): Promise<VenueContact | undefined> => {
  const full = await loadVenuesFull();
  const c = full.contacts.find((x) => x.venueId === venueId);
  if (c) return c;
  // У части площадок отдельной карточки контакта нет — только телефон и
  // почта в самой записи. Для команды это тот же рабочий контакт.
  const v = full.venues.find((x) => x.id === venueId);
  if (v && (v.phone || v.email))
    return { id: `VEN-INLINE-${venueId}`, venueId, phone: v.phone, email: v.email, type: "Venue" };
  return undefined;
};
