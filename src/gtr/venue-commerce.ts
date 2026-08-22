// Коммерческий контур площадки: рассадка со столами и меню с ценами.
//
// Раньше и форма брони, и инструменты BRO импортировали cdm-reserve.json
// напрямую, а проверка «есть ли бронь» была сравнением с одним venueId.
// Данные Café del Mar лежали в коде восемью отдельными привязками, данные
// Catch — просто лежали, не подключённые ни к чему. Теперь площадка
// подключается одной записью в COMMERCE ниже, и её сразу видят оба входа:
// экран паспорта и голосовой BRO.
//
// Депозит стола — условие площадки, а не наша цена: часть или весь депозит
// возвращается гостю кредитом на еду и напитки. Оговорки про сервисный сбор
// и НДС у каждого заведения свои, поэтому живут рядом с меню, а не в общем
// тексте: назвать сумму, которой не окажется в счёте, — хуже, чем молчать.
import catchMenuRaw from "./data/catch-menu.json";
import catchReserveRaw from "./data/catch-reserve.json";
import cdmMenuRaw from "./data/cdm-menu.json";
import cdmReserveRaw from "./data/cdm-reserve.json";
import shamanMenuRaw from "./data/shaman-menu.json";

export type ReserveZone = {
  id: string;
  name: string;
  ru?: string;
  spaceId?: string;
  photo?: string;
  hours?: string;
  arrival?: string;
  desc?: string;
  best?: string;
  capacity?: string;
  amenities?: string[];
  /** Дни недели, когда зона работает; пусто — работает всегда. */
  days?: number[];
};

export type ReserveTable = {
  id: string;
  zone: string;
  name: string;
  ru?: string;
  pax: number;
  deposit: number;
  credit?: number;
  /** Депозит считается с человека, а не за стол. */
  perPerson?: boolean;
  extraPax?: number;
  extraPrice?: number;
  photo?: string;
  slots: string[];
  includes?: string[];
  available?: boolean;
  desc?: string;
  rating?: number;
  reviews?: number;
};

export type ReserveFile = {
  meta: {
    venueId: string;
    venueName: string;
    currency?: string;
    notes?: string;
    bookingContact?: string;
    responseTime?: string;
  };
  zones: ReserveZone[];
  tables: ReserveTable[];
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  desc?: string;
  photo?: string;
  unit?: string;
  rating?: number;
  opts?: { l: string; p: number }[];
};

export type MenuFile = {
  meta: { venueId: string; venueName?: string; note?: string };
  sections: {
    id: string;
    name: string;
    ru?: string;
    hours?: string;
    groups: { id?: string; name: string; ru?: string; items: MenuItem[] }[];
  }[];
};

export type VenueCommerce = {
  venueName: string;
  /** Меню с ценами. Есть не у всех: SHAMAN отдаёт меню, но не бронь. */
  menu?: MenuFile;
  /** Оговорка про налоги и сервис — своя у каждой площадки. */
  menuNote?: string;
  /** Рассадка: зоны и столы. Есть — значит, стол можно забронировать. */
  reserve?: ReserveFile;
};

/** Реестр площадок с коммерцией. Ключ — venueId из venues.json. */
export const COMMERCE: Record<string, VenueCommerce> = {
  [cdmReserveRaw.meta.venueId]: {
    venueName: cdmReserveRaw.meta.venueName,
    menu: cdmMenuRaw as unknown as MenuFile,
    menuNote: "Цены включают налоги и сервис.",
    reserve: cdmReserveRaw as unknown as ReserveFile,
  },
  [catchReserveRaw.meta.venueId]: {
    venueName: catchReserveRaw.meta.venueName,
    menu: catchMenuRaw as unknown as MenuFile,
    menuNote: "Цены включают налоги и сервисный сбор 10%.",
    reserve: catchReserveRaw as unknown as ReserveFile,
  },
  [shamanMenuRaw.meta.venueId]: {
    venueName: shamanMenuRaw.meta.venueName,
    menu: shamanMenuRaw as unknown as MenuFile,
    menuNote: "Сервис 10% и НДС 7% не включены в цены.",
  },
};

/** Место, которое нельзя забронировать: без слотов времени или без цены.
 *  В данных такие строки честные — барная стойка Catch работает walk-in, —
 *  но в форме брони им не место: гость выберет стол, а заявка уйдёт с
 *  пустым депозитом и без времени. Отсекаем на входе, один раз для всех. */
const bookable = (tb: ReserveTable): boolean =>
  Array.isArray(tb.slots) && tb.slots.length > 0 && typeof tb.deposit === "number" && tb.pax > 0;

/** Стол на этой площадке забронировать можно. */
export const hasReserve = (vid: string): boolean => Boolean(COMMERCE[vid]?.reserve);

export const reserveOf = (vid: string): ReserveFile | null => {
  const r = COMMERCE[vid]?.reserve;
  return r ? { ...r, tables: r.tables.filter(bookable) } : null;
};

export const menuOf = (vid: string): MenuFile | null => COMMERCE[vid]?.menu ?? null;

/** Зоны рассадки по id зала из venues.json — паспорт подтягивает фото
 *  и часы прямо в список «Нормализованные залы». */
export const zonesOfSpace = (vid: string, spaceId: string): ReserveZone[] =>
  (reserveOf(vid)?.zones ?? []).filter((z) => z.spaceId === spaceId);

/** Площадки с меню — для BRO: он ищет по имени, а не по id. */
export const menuVenues = (): { vid: string; venueName: string; menu: MenuFile; note: string }[] =>
  Object.entries(COMMERCE)
    .filter((e): e is [string, VenueCommerce & { menu: MenuFile }] => Boolean(e[1].menu))
    .map(([vid, c]) => ({ vid, venueName: c.venueName, menu: c.menu, note: c.menuNote ?? "" }));

/** Площадки с бронью — для BRO и для подсказок «где ещё можно стол». */
export const reserveVenues = (): { vid: string; venueName: string; reserve: ReserveFile }[] =>
  Object.entries(COMMERCE)
    .filter((e): e is [string, VenueCommerce & { reserve: ReserveFile }] => Boolean(e[1].reserve))
    // reserveOf, а не c.reserve: списку брони нужны только столы, которые
    // действительно бронируются.
    .map(([vid, c]) => ({ vid, venueName: c.venueName, reserve: reserveOf(vid) ?? c.reserve }));
