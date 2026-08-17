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

export const loadVenuesFull = () =>
  import("./venues.json").then((m) => m.default as unknown as VenuesFull);

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
