// Статические данные GTR Event, извлечённые из дизайн-хендоффа (GTR EVENT.dc.html)
import venuesRaw from "./venues.json";
import richRaw from "./rich.json";
import vendorPackagesRaw from "./vendor-packages.json";
import venueRatesRaw from "./venue-rates.json";

export type Venue = {
  id: string;
  name: string;
  type: string;
  tag: string;
  area: string;
  cluster: string;
  district: string;
  concept: string;
  events: string;
  facilities: string;
  capacity: string;
  catering: string;
  music: string;
  phone: string;
  email: string;
  website: string;
  social: string;
  source: string;
  sourceType: string;
  confidence: string;
  status: string;
  verified: string;
  notes: string;
  address?: string;
  gallery?: string;
  readiness: null | {
    score: number;
    state: string;
    rate: string;
    avail: string;
    contract: string;
    payment: string;
    photo: string;
    rider: string;
    contactVerified: string;
  };
  [k: string]: unknown;
};

export type Space = {
  id: string;
  venueId: string;
  name: string;
  type: string;
  sqm?: number | string;
  capTheatre?: number | string;
  capCocktail?: number | string;
  bookable?: string;
  notes?: string;
  currency?: string;
  verification?: string;
  [k: string]: unknown;
};

// Поля соответствуют venues.json: там name/role, а не person/roleTitle —
// из-за расхождения реальный контакт площадки нигде не подхватывался.
export type Contact = {
  venueId: string;
  id?: string;
  name?: string;
  role?: string;
  type?: string;
  phone?: string;
  email?: string;
  channel?: string;
  status?: string;
  verified?: string;
  action?: string;
  priority?: string;
  notes?: string;
  [k: string]: unknown;
};

export type Research = {
  cluster: string;
  task: string;
  missing: string;
  priority: string;
  [k: string]: unknown;
};

export type RichVenue = {
  src?: string;
  credit?: string;
  hero?: string;
  video?: string;
  gallery?: string[];
  afisha?: string[][];
  artists?: string[];
  artistsNote?: string;
  badge?: string;
};

type PhuketBase = {
  meta: { updated: string; total: number; spaces: number; contacts: number };
  venues: Venue[];
  spaces: Space[];
  contacts: Contact[];
  research: Research[];
};

export const PH = venuesRaw as unknown as PhuketBase;
export const RICH_ALL = richRaw as unknown as Record<string, RichVenue>;

export const V = (id: string): Venue => PH.venues.find((v) => v.id === id) ?? ({} as Venue);
export const SPACES = (id: string) => PH.spaces.filter((s) => s.venueId === id);
export const CONTACT = (id: string) => PH.contacts.find((c) => c.venueId === id);

// ---------- цвета статусов ----------
export const GREEN = "#2ECC71";
export const AMBER = "#F5A623";
export const RED = "#E5231B";

// ---------- роли ----------
export type RoleId = "pr" | "owner" | "sales" | "gtr";
export const ROLES: [RoleId, string, string, string][] = [
  ["pr", "PR-директор", "VEN-0013", "ПД"],
  ["owner", "Владелец", "VEN-0061", "ВЛ"],
  ["sales", "Event-продажи", "VEN-0033", "ПР"],
  ["gtr", "GTR-админ", "", "АД"],
];

// ---------- навигация ----------
export type ScreenId =
  | "dash"
  | "calendar"
  | "events"
  | "constructor"
  | "inquiries"
  | "spaces"
  | "venue"
  | "finance"
  | "artists"
  | "vendors"
  | "base"
  | "venueCard"
  | "access"
  | "admin";

export const NAV_VENUE: [ScreenId, string, string, string][] = [
  ["dash", "Дашборд", "M3 3h7v7H3z M14 3h7v4h-7z M14 10h7v11h-7z M3 14h7v7H3z", ""],
  ["calendar", "Календарь и программа", "M3 6h18v15H3z M8 3v5 M16 3v5 M3 11h18", ""],
  [
    "events",
    "События",
    "M4 4h16v16H4z M4 9h16 M9 13h6 M9 17h3",
    "",
  ],
  [
    "constructor",
    "Конструктор события",
    "M5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M7 8h6a3 3 0 0 1 3 3v3",
    "",
  ],
  ["inquiries", "Заявки организаторов", "M4 4h16v12H9l-5 4z", "5"],
  ["spaces", "Залы и прайс", "M3 21V8l9-5 9 5v13 M9 21v-7h6v7", ""],
  [
    "venue",
    "Паспорт площадки",
    "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z M12 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    "",
  ],
  [
    "finance",
    "Финансы",
    "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7V6a2 2 0 0 1 2-2h12",
    "",
  ],
];

export const NAV_NET: [ScreenId, string, string, string][] = [
  [
    "artists",
    "Артисты и диджеи",
    "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    "312",
  ],
  [
    "vendors",
    "Каталог подрядчиков",
    "M4 13a8 8 0 0 1 16 0 M4 13v5a2 2 0 0 0 2 2h2v-7H4z M20 13v5a2 2 0 0 1-2 2h-2v-7h4z",
    "12",
  ],
  [
    "base",
    "База · Пхукет",
    "M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
    "97",
  ],
  ["access", "Доступы и роли", "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z M12 15v3", ""],
  ["admin", "GTR-админ", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", ""],
];

// ---------- залы по площадкам ----------
export const ROOMS: Record<string, [string, string, string][]> = {
  "VEN-0013": [
    ["main", "Main Room", "#E5231B"],
    ["empire", "Empire", "#F5A623"],
    ["shelter", "Shelter", "#7B4DFF"],
  ],
  "VEN-0061": [
    ["f1", "1-й этаж", "#2ECC71"],
    ["f4", "4-й этаж", "#E5231B"],
    ["f6", "6-й этаж", "#4285F4"],
  ],
  "VEN-0033": [
    ["arlang", "Arlang Ballroom", "#E5231B"],
    ["ava", "Ava", "#F5A623"],
    ["api", "Api", "#4285F4"],
  ],
};

// ---------- сид событий календаря ----------
export type CalEvent = {
  id: string;
  venueId: string;
  day: number;
  month: number;
  year: number;
  title: string;
  room: string;
  start: string;
  end: string;
  status: "confirmed" | "hold" | "request";
};

const SEED_RAW: Record<string, [number, string, string, string, string, CalEvent["status"]][]> = {
  "VEN-0013": [
    [7, "DEFECTED PHUKET", "main", "21:00", "04:00", "confirmed"],
    [8, "JOE ROLÉT", "main", "21:00", "04:00", "confirmed"],
    [8, "Бренд-активация · LED-стена", "main", "15:00", "18:00", "request"],
    [21, "VIP приватное событие", "empire", "21:00", "01:00", "request"],
    [22, "SAM COLLINS", "main", "21:00", "04:00", "confirmed"],
    [22, "SAM COLLINS · Shelter", "shelter", "23:30", "05:00", "confirmed"],
  ],
  "VEN-0061": [
    [4, "Воркшоп · дневной блок", "f1", "10:00", "13:00", "confirmed"],
    [6, "Нетворкинг-завтрак", "f6", "08:30", "10:30", "confirmed"],
    [11, "Конференция · главный зал", "f4", "09:00", "18:00", "confirmed"],
    [13, "Тренинг", "f1", "14:00", "17:00", "hold"],
    [18, "Приватное бизнес-событие", "f4", "18:00", "22:00", "request"],
    [20, "Лекции · руфтоп", "f6", "17:00", "20:00", "confirmed"],
    [25, "Воркшоп", "f1", "10:00", "13:00", "hold"],
  ],
  "VEN-0033": [
    [5, "Гала-ужин · Arlang", "arlang", "19:00", "23:00", "confirmed"],
    [9, "Корпоративный семинар", "ava", "09:00", "17:00", "confirmed"],
    [12, "Свадебный приём · пляж", "arlang", "17:00", "23:00", "hold"],
    [16, "Совет директоров", "api", "10:00", "15:00", "confirmed"],
    [19, "Запуск продукта", "arlang", "18:00", "22:00", "request"],
    [26, "Конференция · день 1", "arlang", "08:30", "18:00", "hold"],
  ],
};

export const seedEvents = (): CalEvent[] =>
  Object.entries(SEED_RAW).flatMap(([venueId, rows]) =>
    rows.map(([day, title, room, start, end, status], i) => ({
      id: `seed-${venueId}-${i}`,
      venueId,
      day,
      month: 7,
      year: 2026,
      title,
      room,
      start,
      end,
      status,
    })),
  );

export const CAL_PALETTE: Record<string, [string, string, string, string, string][]> = {
  "VEN-0013": [
    ["Клубная ночь", "main", "22:00", "04:00", "Main Room · до 5 000 гостей"],
    ["Техно-шоукейс", "shelter", "23:00", "05:00", "Shelter · андеграунд"],
    ["Хип-хоп ночь", "empire", "22:30", "03:00", "Empire · хип-хоп зал"],
    ["Шоу артиста / концерт", "main", "21:00", "02:00", "Main Room · 100 м² LED"],
    ["Бренд-активация", "main", "19:00", "21:30", "Дневной слот, LED + звук"],
    ["VIP приватное событие", "empire", "21:00", "01:00", "Закрытый формат"],
  ],
  "VEN-0061": [
    ["Воркшоп", "f1", "10:00", "13:00", "1-й этаж · THB/час"],
    ["Конференция", "f4", "09:00", "18:00", "4-й этаж · крупнейший зал"],
    ["Нетворкинг", "f6", "08:30", "10:30", "6-й этаж · руфтоп"],
    ["Тренинг", "f1", "14:00", "17:00", "1-й этаж"],
    ["Приватное бизнес-событие", "f4", "18:00", "22:00", "4-й этаж"],
  ],
  "VEN-0033": [
    ["Гала-ужин", "arlang", "19:00", "23:00", "Arlang · 300 коктейль"],
    ["Конференция", "arlang", "08:30", "18:00", "Arlang · 220 театр"],
    ["Семинар", "ava", "09:00", "17:00", "Ava · 95 м², 60 театр"],
    ["Совет директоров", "api", "10:00", "15:00", "Api · 42 м², 24 места"],
    ["Пляжное событие", "arlang", "17:00", "23:00", "Pine Beach Bar / пляж"],
  ],
};

export const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

// ---------- райдеры ----------
export const RIDERS: Record<string, { label: string; tech: string[]; hosp: string[] }> = {
  dj: {
    label: "DJ-сет · резидент / гость",
    tech: [
      "2 × Pioneer CDJ-2000NXS2 или новее, синхронизированы по LINK",
      "Микшер Pioneer DJM-900NXS2 / DJM-A9",
      "DJ-стол высотой 100–110 см, ширина от 180 см",
      "2 booth-монитора с независимой регулировкой",
      "Питание: 2 линии 220 В с заземлением, стабилизированные",
      "Комплект RCA и XLR, запасной набор",
      "Подсветка пульта и место под ноутбук (USB-C 60 Вт)",
    ],
    hosp: [
      "Зона артиста рядом со сценой или отдельная гримёрка",
      "Вода без газа 4 × 0,5 л, лёд, полотенца 2 шт.",
      "Трансфер отель — площадка — отель",
      "Саундчек 30 минут до открытия дверей",
      "Гостевой лист: 2 человека",
      "Фото- и видеосъёмка сета по согласованию",
    ],
  },
  headliner: {
    label: "Хедлайнер · электронная сцена",
    tech: [
      "4 × Pioneer CDJ-3000 + микшер DJM-A9 (либо аналог по контракту)",
      "Основная система Funktion-One / L-Acoustics с запасом по SPL",
      'Отдельный booth-мониторинг, минимум 2 × 12" + саб',
      "Технический прогон и линия-чек за 2 часа до дверей",
      "Штатный звукорежиссёр и светооператор на весь сет",
      "Резервный источник питания на сценический блок",
      "Соблюдение лимита SPL и кривой площадки, подтверждается письменно",
    ],
    hosp: [
      "Отдельная гримёрная с кондиционером и зеркалом, закрывается на ключ",
      "Security 2 человека: гримёрка и маршрут сцена — выход",
      "Трансфер бизнес-класса, встреча в аэропорту",
      "Размещение 5* по числу человек в туре",
      "Питание и напитки по списку контракта",
      "Гостевой лист: до 10 человек",
      "Съёмка и трансляция — только по письменному разрешению",
    ],
  },
  band: {
    label: "Лайв-состав · группа / дуэт",
    tech: [
      "Сцена от 6 × 4 м, высота подиума 40–60 см",
      "Backline: ударная установка, басовый и гитарный комбо, клавишная стойка",
      "Пульт от 16 каналов, 4 независимые мониторные линии",
      "3 вокальных микрофона (2 радио), стойки, DI-боксы по составу",
      "Саундчек 2 часа, отдельный прогон вокала",
      "Подключение фонограмм / бэк-треков по райдеру состава",
    ],
    hosp: [
      "Гримёрка на весь состав, вешалки и зеркало",
      "Горячее питание на состав, вода и лёгкие закуски",
      "Парковка для транспорта с оборудованием у сцены",
      "Разгрузка не позднее чем за 3 часа до старта",
      "Гостевой лист: 6 человек",
    ],
  },
  show: {
    label: "Шоу-программа · через агентство",
    tech: [
      "Полный технический райдер предоставляет агентство до подписания",
      "Сцена, звук, свет, LED и монитор-инженер — по контракту",
      "Backline по списку артиста, аренда согласуется отдельно",
      "Не менее 2 гримёрных зон",
      "Тайминг монтажа и саундчека фиксируется в BEO",
    ],
    hosp: [
      "Размещение, трансферы и питание — по контракту агентства",
      "Security по протоколу артиста",
      "Приветственный сет-ап в гримёрке",
      "Гостевой лист согласуется за 7 дней",
      "Съёмка и пресс-подход — по разрешению менеджмента",
    ],
  },
};

// ---------- конструктор ----------
export const NODE_W = 196;
export const NODE_H = 104;

// Первая свободная ячейка сетки канваса 196×104 с шагом 246×150 — общая для
// конструктора и сборщиков графа, чтобы блоки из разных источников не
// накладывались и не расходились при смене сетки.
export const freeGridCell = (nodes: GraphNode[]) => {
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 30 + col * (NODE_W + 50);
      const y = 26 + row * (NODE_H + 46);
      const busy = nodes.some((n) => Math.abs(n.x - x) < NODE_W && Math.abs(n.y - y) < NODE_H);
      if (!busy) return { x, y };
    }
  }
  return { x: 30, y: 26 };
};

export type NodeKind =
  | "venue"
  | "room"
  | "slot"
  | "tech"
  | "promo"
  | "money"
  | "doc"
  | "artist"
  | "staff"
  | "sound"
  | "light"
  | "decor"
  | "content";

// [подпись, цвет, фон, svg-путь]
export const KINDS: Record<NodeKind, [string, string, string, string]> = {
  venue: [
    "ПЛОЩАДКА",
    "#E5231B",
    "rgba(229,35,27,.14)",
    "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z",
  ],
  room: ["ЗАЛ", "#F5A623", "rgba(245,166,35,.14)", "M3 21V8l9-5 9 5v13 M9 21v-7h6v7"],
  slot: [
    "СЛОТ",
    "#4285F4",
    "rgba(66,133,244,.14)",
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  ],
  tech: [
    "ТЕХНИКА",
    "#7B4DFF",
    "rgba(123,77,255,.14)",
    "M4 13a8 8 0 0 1 16 0 M4 13v5a2 2 0 0 0 2 2h2v-7H4z M20 13v5a2 2 0 0 1-2 2h-2v-7h4z",
  ],
  promo: ["ПРОМО", "#2ECC71", "rgba(46,204,113,.14)", "M3 10v4l11 4V6L3 10z M14 7l5-2v14l-5-2"],
  money: [
    "ФИНАНСЫ",
    "#E5231B",
    "rgba(229,35,27,.14)",
    "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7V6a2 2 0 0 1 2-2h12",
  ],
  doc: ["ДОГОВОР", "#fff", "rgba(255,255,255,.09)", "M13 3H7v18h11V8z M13 3v5h5"],
  artist: [
    "АРТИСТ",
    "#7B4DFF",
    "rgba(123,77,255,.14)",
    "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  ],
  staff: [
    "КОМАНДА",
    "#F5A623",
    "rgba(245,166,35,.14)",
    "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 21v-1a6 6 0 0 1 12 0v1 M16 11a3 3 0 1 0 0-6",
  ],
  sound: [
    "ЗВУК",
    "#22D3C7",
    "rgba(34,211,199,.14)",
    "M11 5L6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13",
  ],
  light: [
    "СВЕТ",
    "#FFD166",
    "rgba(255,209,102,.16)",
    "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-6 6c0 2.7 1.4 4.2 2.4 5.2.4.4.6.9.6 1.5v.3h6v-.3c0-.6.2-1.1.6-1.5C16.6 13.2 18 11.7 18 9a6 6 0 0 0-6-6z",
  ],
  decor: [
    "ДЕКОР",
    "#FF8FA3",
    "rgba(255,143,163,.16)",
    "M12 8a3 3 0 1 0-3-3c0 1.7 1.3 3 3 3z M12 8a3 3 0 1 1 3-3c0 1.7-1.3 3-3 3z M12 8v13 M5 13h14v3H5z",
  ],
  content: [
    "КОНТЕНТ",
    "#00C2FF",
    "rgba(0,194,255,.14)",
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ],
};

export type Vendor = { name: string; meta: string; price: string; contact: string; source: string };

export const VENDOR_CATALOG: Partial<Record<NodeKind, Vendor[]>> = {
  sound: [
    {
      name: "SoundWave Phuket",
      meta: "DJ-оборудование (CDJ/XDJ) и PA-система",
      price: "฿4 000–31 000 / день",
      contact: "+66 65 204 7442",
      source: "soundwavephuket.com",
    },
    {
      name: "Phuket Sound",
      meta: "Backline: контроллеры, гитары, комбо-усилители, проектор",
      price: "по запросу",
      contact: "+66 89 587 1841",
      source: "phuketsound.com",
    },
    {
      name: "MS Media Thailand",
      meta: "Готовый пакет LED + свет + звук (party / concert)",
      price: "฿100 000–350 000 / пакет",
      contact: "+66 80 591 9292",
      source: "msmediathailand.com",
    },
  ],
  light: [
    {
      name: "Phuket Sound and Lighting",
      meta: "LED PAR, moving head, лазер, дым-машина, экран",
      price: "по запросу",
      contact: "081 891 9920",
      source: "phuketsoundandlighting.com",
    },
    {
      name: "PMI / Lotus Arena",
      meta: "Концертный AV: line-array, GrandMA2, LED-экран, ферма",
      price: "по запросу",
      contact: "+66 82 151 1406",
      source: "pmi.team",
    },
    {
      name: "MS Media Thailand",
      meta: "Готовый пакет LED + свет + звук",
      price: "฿50 000–350 000 / пакет",
      contact: "+66 80 591 9292",
      source: "msmediathailand.com",
    },
  ],
  decor: [
    {
      name: "Art of Events Phuket",
      meta: "Мебель и декор: стулья Chiavari, посуда, оформление",
      price: "по запросу",
      contact: "+66 82 703 0303",
      source: "arteventsphuket.com",
    },
    {
      name: "Phuket Event Company",
      meta: "Мебель, подиум, тенты, AV и декор",
      price: "по запросу",
      contact: "+66 65 749 5221",
      source: "phuketeventcompany.com",
    },
    {
      name: "Southern Media",
      meta: "Стенды, ковры, тенты, мебель, генераторы",
      price: "по запросу",
      contact: "+66 89 873 1652",
      source: "southerngroup.asia",
    },
  ],
  content: [
    {
      name: "Noi Chanthasri",
      meta: "Фотосъёмка события, 1–8 часов",
      price: "฿5 000–22 000 / пакет",
      contact: "официальная форма",
      source: "photographerphuketthailand.com",
    },
    {
      name: "CADO07",
      meta: "Фотосъёмка 1–3 часа, дрон-аддон",
      price: "฿7 000–16 000 / пакет",
      contact: "официальный сайт",
      source: "cado07.com",
    },
    {
      name: "Phuket Photography by Wasan",
      meta: "Видео, 2 оператора + дрон, 5–12 часов",
      price: "฿35 000–65 000 / пакет",
      contact: "официальный сайт",
      source: "phuketphotography.com",
    },
  ],
};

export const CX_PALETTE: [NodeKind, string][] = [
  ["room", "Зал / зона"],
  ["artist", "Артист / лайнап"],
  ["sound", "Подрядчик · звук"],
  ["light", "Подрядчик · свет"],
  ["decor", "Декор и оформление"],
  ["content", "Фото и видео"],
  ["promo", "Промо и билеты"],
  ["money", "Бюджет"],
  ["slot", "Слот времени"],
  ["doc", "Договор"],
  ["staff", "Команда"],
];

// Статус узла: часть выводится из данных автоматически, часть выставляет
// участник вручную (задержка, проблема на площадке и т.п.).
export type NodeStatus = "ok" | "warn" | "problem" | "delay";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  title: string;
  sub: string;
  badge: string;
  fields: [string, string][];
  status?: NodeStatus; // ручной статус (override); нет — берётся авто-оценка
  note?: string; // комментарий участника к статусу (что пошло не так)
};
export type GraphLink = { from: string; to: string };

// Стадия события и запись истории (кто/когда/что) — цикл: черновик →
// отправлено → утверждено; после утверждения событие остаётся редактируемым.
export type EventStage = "draft" | "sent" | "approved";
export type LogEntry = { ts: number; actor: string; action: string };
export type Graph = {
  nodes: GraphNode[];
  links: GraphLink[];
  stage?: EventStage;
  log?: LogEntry[];
};

// ---------- событие как самостоятельная сущность ----------
// Раньше граф хранился как graphs[venueId] — ровно одно событие на площадку
// навсегда, без возможности начать новое. Теперь событие живёт отдельной
// записью с собственным id, и на одной площадке их может быть сколько угодно.
export type EventDraft = {
  id: string;
  venueId: string;
  title: string;
  format: string; // формат из брифа: клубная ночь, свадьба, корпоратив…
  guests: string;
  date: string;
  author: string; // кто создал — GTR-админ или роль площадки
  created: number;
  updated: number;
  graph: Graph;
  brief: Record<string, string[]>; // ответы ветвящегося брифа
};

export const draftTitle = (d: EventDraft) => d.title || d.format || "Событие без названия";

export const STAGE_LABEL: Record<EventStage, string> = {
  draft: "Черновик",
  sent: "Отправлено",
  approved: "Утверждено",
};
export const STAGE_COLOR: Record<EventStage, string> = {
  draft: "rgba(255,255,255,.5)",
  sent: AMBER,
  approved: GREEN,
};

type RawNode = [string, NodeKind, number, number, string, string, string, [string, string][]];

const mkGraph = (nodes: RawNode[], links: [string, string][]): Graph => ({
  nodes: nodes.map(([id, kind, x, y, title, sub, badge, fields]) => ({
    id,
    kind,
    x,
    y,
    title,
    sub,
    badge,
    fields,
  })),
  links: links.map(([from, to]) => ({ from, to })),
});

export const GRAPH_SEED: Record<string, Graph> = {
  "VEN-0013": mkGraph(
    [
      [
        "n1",
        "venue",
        30,
        32,
        "Illuzion Phuket",
        "Bangla Road, Patong · 6 500 м²",
        "VEN-0013",
        [
          ["ID", "VEN-0013"],
          ["ТИП", "Ночной клуб / концертная площадка"],
          ["ИСТОЧНИК", "illuzionphuket.com"],
          ["ГОТОВНОСТЬ", "68 / 100"],
        ],
      ],
      [
        "n2",
        "room",
        276,
        26,
        "Main Room",
        "До 5 000 гостей · 100 м² LED",
        "5 000",
        [
          ["ЗАЛ", "Illuzion Main Room"],
          ["ПЛОЩАДЬ", "6 500 м²"],
          ["ВМЕСТИМОСТЬ", "5 000 стоя"],
          ["СТАТУС", "Онбординг партнёра"],
        ],
      ],
      [
        "n3",
        "room",
        276,
        176,
        "Shelter",
        "Андеграунд-техно · VEN-0015",
        "—",
        [
          ["ЗАЛ", "Shelter"],
          ["ВМЕСТИМОСТЬ", "не заявлена"],
          ["УПРАВЛЕНИЕ", "Illuzion Group"],
          ["СТАТУС", "Требует данных"],
        ],
      ],
      [
        "n4",
        "slot",
        276,
        332,
        "Слот 22:00–04:00",
        "8 августа 2026 · ICT",
        "8.08",
        [
          ["ДАТА", "08.08.2026"],
          ["ВРЕМЯ", "22:00–04:00"],
          ["ЗАЛ", "Main Room"],
          ["СТАТУС", "Подтверждён"],
        ],
      ],
      [
        "n5",
        "tech",
        528,
        26,
        "Звук и свет",
        "Funktion-One · L-Acoustics · Outline",
        "OK",
        [
          ["ЗВУК", "Funktion-One, L-Acoustics, Outline"],
          ["ЭКРАН", "LED 100 м²"],
          ["ИСТОЧНИК", "Опубликованные характеристики"],
          ["РАЙДЕР", "Опубликованы характеристики"],
        ],
      ],
      [
        "n6",
        "promo",
        528,
        176,
        "Промо и билеты",
        "Каналы площадки + организатор",
        "—",
        [
          ["КАНАЛЫ", "Сайт площадки, афиша"],
          ["INSTAGRAM", "источник не верифицирован"],
          ["БИЛЕТЫ", "Через организатора"],
          ["СТАТУС", "Черновик"],
        ],
      ],
      [
        "n7",
        "money",
        528,
        332,
        "Бюджет и комиссия",
        "Прайс-лист отсутствует",
        "НЕТ",
        [
          ["ПРАЙС-ЛИСТ", "Нет"],
          ["КОМИССИЯ", "Не согласована"],
          ["ДЕПОЗИТ", "Не определён"],
          ["ПРИОРИТЕТ", "P0"],
        ],
      ],
      [
        "n8",
        "doc",
        780,
        176,
        "Договор",
        "Презентация приватной аренды не получена",
        "P0",
        [
          ["ДОГОВОР", "Нет"],
          ["УСЛОВИЯ ОПЛАТЫ", "Нет"],
          ["ПРАВИЛА", "Правила промоутеров — запросить"],
          ["ВЛАДЕЛЕЦ", "Illuzion Group"],
        ],
      ],
    ],
    [
      ["n1", "n2"],
      ["n1", "n3"],
      ["n2", "n4"],
      ["n2", "n5"],
      ["n4", "n6"],
      ["n5", "n7"],
      ["n6", "n8"],
      ["n7", "n8"],
    ],
  ),
  "VEN-0061": mkGraph(
    [
      [
        "n1",
        "venue",
        30,
        32,
        "Place Coworking",
        "Chalong · 1 645 м²",
        "VEN-0061",
        [
          ["ID", "VEN-0061"],
          ["ТИП", "Коворкинг / event-пространство"],
          ["ИСТОЧНИК", "placecoworking.com"],
          ["ГОТОВНОСТЬ", "85 / 100"],
        ],
      ],
      [
        "n2",
        "room",
        276,
        26,
        "Event-зал 4-го этажа",
        "Крупнейшее пространство",
        "THB/час",
        [
          ["ЗАЛ", "Event-зал 4-го этажа"],
          ["ТАРИФ", "THB / час"],
          ["СТАТУС", "Ставка опубликована / request"],
          ["ЗАМЕТКА", "Крупнейшее пространство Place"],
        ],
      ],
      [
        "n3",
        "room",
        276,
        176,
        "Event-зал 1-го этажа",
        "Воркшопы и тренинги",
        "THB/час",
        [
          ["ЗАЛ", "Event-зал 1-го этажа"],
          ["ТАРИФ", "THB / час"],
          ["СТАТУС", "Ставка опубликована / request"],
          ["ЗАМЕТКА", "Готовый к работе состав залов"],
        ],
      ],
      [
        "n4",
        "slot",
        276,
        332,
        "Слот 09:00–18:00",
        "11 августа · конференция",
        "11.08",
        [
          ["ДАТА", "11.08.2026"],
          ["ВРЕМЯ", "09:00–18:00"],
          ["ЗАЛ", "4-й этаж"],
          ["СТАТУС", "Подтверждён"],
        ],
      ],
      [
        "n5",
        "promo",
        528,
        26,
        "Продвижение",
        "Networking-аудитория Chalong",
        "—",
        [
          ["КАНАЛЫ", "Сайт, рассылка резидентов"],
          ["ФОРМАТЫ", "Воркшопы, конференции"],
          ["СТАТУС", "Активно"],
        ],
      ],
      [
        "n6",
        "money",
        528,
        176,
        "Тариф и депозит",
        "Ставка THB/час опубликована",
        "ЕСТЬ",
        [
          ["ПРАЙС-ЛИСТ", "Опубликован"],
          ["ДЕПОЗИТ", "Согласовать"],
          ["ОТМЕНА", "Согласовать"],
          ["КОМИССИЯ", "P0"],
        ],
      ],
      [
        "n7",
        "doc",
        780,
        176,
        "Пилотный договор",
        "Быстрый пилот bookable",
        "P0",
        [
          ["ЗАДАЧА", "Быстрый пилот bookable"],
          ["НУЖНО", "Живой календарь, депозит, отмена, комиссия"],
          ["КАНАЛ", "Телефон + встреча"],
        ],
      ],
    ],
    [
      ["n1", "n2"],
      ["n1", "n3"],
      ["n2", "n4"],
      ["n4", "n5"],
      ["n4", "n6"],
      ["n6", "n7"],
    ],
  ),
  "VEN-0033": mkGraph(
    [
      [
        "n1",
        "venue",
        30,
        32,
        "InterContinental Phuket",
        "Kamala · курорт",
        "VEN-0033",
        [
          ["ID", "VEN-0033"],
          ["ТИП", "Резорт / бальный зал / пляжная площадка"],
          ["ИСТОЧНИК", "phuket.intercontinental.com"],
          ["ГОТОВНОСТЬ", "58 / 100"],
        ],
      ],
      [
        "n2",
        "room",
        276,
        26,
        "Arlang Ballroom",
        "304 м² · 220 театр / 300 коктейль",
        "300",
        [
          ["ЗАЛ", "Arlang Ballroom"],
          ["ПЛОЩАДЬ", "304 м²"],
          ["ТЕАТР", "220"],
          ["КОКТЕЙЛЬ", "300"],
        ],
      ],
      [
        "n3",
        "room",
        276,
        176,
        "Ava",
        "95 м² · 60 театр / 90 коктейль",
        "90",
        [
          ["ЗАЛ", "Ava"],
          ["ПЛОЩАДЬ", "95 м²"],
          ["ТЕАТР", "60"],
          ["КОКТЕЙЛЬ", "90"],
        ],
      ],
      [
        "n4",
        "slot",
        276,
        332,
        "Слот 19:00–23:00",
        "5 августа · гала-ужин",
        "5.08",
        [
          ["ДАТА", "05.08.2026"],
          ["ВРЕМЯ", "19:00–23:00"],
          ["ЗАЛ", "Arlang Ballroom"],
          ["СТАТУС", "Подтверждён"],
        ],
      ],
      [
        "n5",
        "staff",
        528,
        26,
        "Команда курорта",
        "Отдел встреч и событий",
        "P0",
        [
          ["КОНТАКТ", "Отдел встреч и событий"],
          ["ТЕЛЕФОН", "+66 76 629 999"],
          ["ПРИОРИТЕТ", "P0"],
          ["ЗАДАЧА", "Capacity chart и net rates"],
        ],
      ],
      [
        "n6",
        "money",
        528,
        176,
        "Net-ставки",
        "Прайс-лист — нет",
        "НЕТ",
        [
          ["ПРАЙС-ЛИСТ", "Нет"],
          ["NET-СТАВКИ", "Запрошены"],
          ["ПАКЕТЫ", "Не получены"],
          ["ПРИОРИТЕТ", "P0"],
        ],
      ],
      [
        "n7",
        "doc",
        780,
        176,
        "Партнёрское соглашение",
        "Комиссия не согласована",
        "P0",
        [
          ["ДОГОВОР", "Нет"],
          ["КОМИССИЯ", "Нет"],
          ["УСЛОВИЯ ОПЛАТЫ", "Missing"],
        ],
      ],
    ],
    [
      ["n1", "n2"],
      ["n1", "n3"],
      ["n2", "n4"],
      ["n4", "n5"],
      ["n5", "n6"],
      ["n6", "n7"],
    ],
  ),
};

// ---------- генерация графа события из базы ----------
// Для трёх пилотных площадок граф собран вручную (GRAPH_SEED) — он богаче.
// Для остальных 94 граф строится из venues.json + spaces: площадка → залы →
// слот. Так конструктор открывается на любой площадке базы, а не на трёх.

const ROOM_COLORS = ["#E5231B", "#F5A623", "#4285F4", "#7B4DFF", "#2ECC71", "#22D3C7"];
const MAX_AUTO_ROOMS = 6;

const intOf = (x: unknown): number => {
  const n = parseInt(String(x ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const host = (url?: string) =>
  (url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") || "";

// Максимальная заявленная вместимость зала по любой из рассадок
export const spaceCapacity = (s: Space) =>
  Math.max(intOf(s.capTheatre), intOf(s.capCocktail), intOf(s.capBanquet));

// У посадочных единиц бич-клубов (кабана, дейбед, сала) поле sqm хранит не
// площадь, а число гостей: «1–3». Трактовать его как метры нельзя — получится
// «кабана 3 м²». Отличаем по типу зала.
const SEAT_UNIT = /sunbed|seating|cabana|daybed|sala/i;
const isSeatUnit = (s: Space) => SEAT_UNIT.test(String(s.type ?? ""));

// Площадь в м² — только для настоящих залов
export const spaceArea = (s: Space) => (isSeatUnit(s) ? 0 : intOf(s.sqm));

// Вместимость как её заявила площадка: число либо диапазон «1–3»
export const spacePax = (s: Space): string => {
  const declared = spaceCapacity(s);
  if (declared) return declared.toLocaleString("ru-RU");
  const raw = String(s.sqm ?? "").trim();
  if (isSeatUnit(s) && raw) return raw;
  return "";
};

// База сама помечает свои пробелы в notes («Capacity missing.») — показываем
// это как есть, а не додумываем цифру.
export const spaceGap = (s: Space): string => {
  const m = String(s.notes ?? "").match(/·\s*([^·]*missing[^·]*)$/i);
  return m ? m[1].trim() : "";
};

const spaceSub = (s: Space) => {
  const pax = spacePax(s);
  const area = spaceArea(s);
  return [
    pax ? `${pax} гостей` : "вместимость не заявлена",
    area ? `${area.toLocaleString("ru-RU")} м²` : "",
    String(s.inOut ?? ""),
  ]
    .filter(Boolean)
    .join(" · ");
};

// Залы площадки для календаря и палитры: вручную заданные или из базы
export const roomsOf = (venueId: string): [string, string, string][] => {
  const manual = ROOMS[venueId];
  if (manual) return manual;
  return SPACES(venueId)
    .slice(0, MAX_AUTO_ROOMS)
    .map((s, i) => [String(s.id), String(s.name), ROOM_COLORS[i % ROOM_COLORS.length]]);
};

// Граф события для площадки: вручную собранный сид либо генерация из базы
export const venueGraph = (venueId: string): Graph => {
  const seed = GRAPH_SEED[venueId];
  if (seed) return structuredClone(seed);

  const v = V(venueId);
  if (!v.id) return { nodes: [], links: [] };

  const rd = v.readiness;
  const nodes: GraphNode[] = [
    {
      id: "n1",
      kind: "venue",
      x: 30,
      y: 32,
      title: v.name,
      sub: [v.area, v.cluster].filter(Boolean).join(" · ") || v.district || "Пхукет",
      badge: v.id,
      fields: [
        ["ID", v.id],
        ["ТИП", v.type || "—"],
        ["ИСТОЧНИК", host(v.website) || v.source || "—"],
        ["ГОТОВНОСТЬ", rd ? `${rd.score} / 100` : "не оценена"],
      ],
    },
  ];
  const links: GraphLink[] = [];

  const spaces = SPACES(venueId).slice(0, MAX_AUTO_ROOMS);
  spaces.forEach((s, i) => {
    const id = `r${i + 1}`;
    const pax = spacePax(s);
    const area = spaceArea(s);
    const gap = spaceGap(s);
    nodes.push({
      id,
      kind: "room",
      x: 276,
      y: 26 + i * 150,
      title: String(s.name),
      sub: spaceSub(s),
      badge: pax || "—",
      fields: [
        ["ЗАЛ", String(s.name)],
        ["ПЛОЩАДЬ", area ? `${area.toLocaleString("ru-RU")} м²` : "не заявлена"],
        ["ВМЕСТИМОСТЬ", pax ? `${pax} гостей` : "не заявлена"],
        ["БРОНИРОВАНИЕ", String(s.bookable ?? "по запросу")],
        ...(gap ? ([["ТРЕБУЕТ ДАННЫХ", gap]] as [string, string][]) : []),
      ],
    });
    links.push({ from: "n1", to: id });
  });

  // Слот-заглушка: дата события заполняется организатором, но блок есть всегда,
  // иначе смета и заявка уходят без даты.
  const slotY = spaces.length ? 26 + (spaces.length - 1) * 150 : 32;
  nodes.push({
    id: "s1",
    kind: "slot",
    x: 528,
    y: slotY,
    title: "Слот не выбран",
    sub: "Укажите дату и время",
    badge: "—",
    fields: [
      ["ДАТА", "—"],
      ["ВРЕМЯ", "—"],
      ["ЗАЛ", spaces.length ? String(spaces[0].name) : "—"],
      ["СТАТУС", "Черновик"],
    ],
  });
  if (spaces.length) links.push({ from: "r1", to: "s1" });
  else links.push({ from: "n1", to: "s1" });

  return { nodes, links };
};

// ---------- доступ к данным площадки без подмены чужими ----------
// Заявки, финансы и программа — факты конкретной площадки. Раньше для
// незасеянных площадок отдавались данные Illuzion, и владелец отеля видел
// заявки ночного клуба как свои. Теперь недостающее отдаётся пустым.

export const inqOf = (venueId: string): InqRow[] => INQ[venueId] ?? [];

export const finKpiOf = (venueId: string): [string, string, string, string][] =>
  FIN_KPI[venueId] ?? [];

export const finBlockerOf = (venueId: string): string =>
  FIN_BLOCKER[venueId] ??
  "Финансовые данные по этой площадке ещё не собраны. Заполните ставку и условия в паспорте площадки.";

// Форматы событий для календаря. Это предложение GTR, а не факт о площадке,
// поэтому для незасеянных площадок список строится из их же залов.
export const calPaletteOf = (venueId: string): [string, string, string, string, string][] => {
  const manual = CAL_PALETTE[venueId];
  if (manual) return manual;
  const rooms = roomsOf(venueId);
  if (!rooms.length) return [];
  const formats: [string, string, string][] = [
    ["Приватное событие", "18:00", "23:00"],
    ["Корпоратив", "10:00", "17:00"],
    ["Свадьба / банкет", "16:00", "23:00"],
    ["Дневная активация", "12:00", "16:00"],
    ["Вечерний приём", "19:00", "22:00"],
  ];
  return formats.map(([name, from, to], i) => {
    const [key, label] = rooms[i % rooms.length];
    return [name, key, from, to, label];
  });
};

// ---------- пресеты модулей события ----------
// Категории без каталога подрядчиков раньше добавлялись пустой карточкой
// «Заполните данные блока». Теперь у каждой есть готовые варианты: залы,
// слоты и бюджет берутся из данных площадки, а договоры, промо и роли —
// это стандартный набор GTR, одинаковый для всех площадок.

export type ModulePreset = {
  key: string;
  title: string;
  sub: string;
  badge: string;
  fields: [string, string][];
  fromBase: boolean; // взято из базы площадки, а не из типового набора
};

const docPresets = (): ModulePreset[] =>
  [
    ["Договор аренды площадки", "Основной договор с площадкой", "Аренда"],
    ["Технический райдер", "Согласование звука, света и сцены", "Техника"],
    ["Страхование мероприятия", "Ответственность перед гостями и площадкой", "Страховка"],
    ["Согласование времени работы", "Поздние часы и уровень звука", "Регламент"],
  ].map(([title, sub, badge]) => ({
    key: `doc-${title}`,
    title,
    sub,
    badge: badge.toUpperCase(),
    fields: [
      ["ДОКУМЕНТ", title],
      ["СТАТУС", "Не начат"],
      ["ОТВЕТСТВЕННЫЙ", "—"],
      ["СРОК", "—"],
    ] as [string, string][],
    fromBase: false,
  }));

const promoPresets = (): ModulePreset[] =>
  [
    ["Афиша и анонсы", "Публикации площадки и артистов"],
    ["Продажа билетов", "Тираж, цены, каналы продаж"],
    ["Таргет и соцсети", "Платное продвижение события"],
    ["Работа с медиа", "Пресса, блогеры, партнёрские анонсы"],
  ].map(([title, sub]) => ({
    key: `promo-${title}`,
    title,
    sub,
    badge: "ПРОМО",
    fields: [
      ["КАНАЛ", title],
      ["СТАТУС", "Не начат"],
      ["БЮДЖЕТ", "—"],
      ["ОТВЕТСТВЕННЫЙ", "—"],
    ] as [string, string][],
    fromBase: false,
  }));

const staffPresets = (venueId: string): ModulePreset[] => {
  const c = CONTACT(venueId);
  const list: ModulePreset[] = [];
  // Реальный контакт площадки, если он есть в базе
  if (c?.name) {
    list.push({
      key: `staff-${c.name}`,
      title: String(c.name),
      sub: [c.role, "контакт площадки"].filter(Boolean).join(" · "),
      badge: "ПЛОЩАДКА",
      fields: [
        ["РОЛЬ", String(c.role || "Контакт площадки")],
        ["ТЕЛЕФОН", String(c.phone || "—")],
        ["EMAIL", String(c.email || "—")],
        ["КАНАЛ", String(c.channel || "—")],
        ["ПРОВЕРЕН", String(c.verified || "—")],
      ],
      fromBase: true,
    });
  }
  const roles: [string, string][] = [
    ["Менеджер площадки", "Согласование площадки и слота"],
    ["Технический директор", "Звук, свет, сцена"],
    ["Промоутер", "Продвижение и билеты"],
    ["Координатор GTR", "Ведение события со стороны GTR"],
  ];
  roles.forEach(([title, sub]) =>
    list.push({
      key: `staff-${title}`,
      title,
      sub,
      badge: "РОЛЬ",
      fields: [
        ["РОЛЬ", title],
        ["ИМЯ", "—"],
        ["КОНТАКТ", "—"],
        ["СТАТУС", "Не назначен"],
      ],
      fromBase: false,
    }),
  );
  return list;
};

const moneyPresets = (venueId: string): ModulePreset[] => {
  const rate = rateOf(venueId);
  const list: ModulePreset[] = [];
  if (rate) {
    list.push({
      key: "money-venue",
      title: "Аренда площадки",
      sub: `${rate.covers} · ${RATE_LABEL[rate.kind]}`,
      badge: "АРЕНДА",
      fields: [
        ["СУММА", fmtThb(rate.amount)],
        ["ЧТО ВХОДИТ", rate.covers],
        ["СТАТУС ЦЕНЫ", RATE_LABEL[rate.kind]],
        ["ИСТОЧНИК", rate.source || "не указан"],
      ],
      fromBase: true,
    });
  }
  list.push(
    {
      key: "money-commission",
      title: `Комиссия GTR · ${COMMISSION_PCT}%`,
      sub: "Начисляется на подытог сметы",
      badge: "КОМИССИЯ",
      fields: [
        ["СТАВКА", `${COMMISSION_PCT}%`],
        ["БАЗА", "Подытог сметы"],
        ["СТАТУС", "Стандартная"],
      ],
      fromBase: false,
    },
    {
      key: "money-deposit",
      title: "Депозит / предоплата",
      sub: "Условия и сроки внесения",
      badge: "ОПЛАТА",
      fields: [
        ["СУММА", "—"],
        ["СРОК", "—"],
        ["УСЛОВИЯ", "уточняются у площадки"],
      ],
      fromBase: false,
    },
    {
      key: "money-fnb",
      title: "Бар и F&B",
      sub: "Минимальный спенд по еде и напиткам",
      badge: "F&B",
      fields: [
        ["МИН. СПЕНД", "—"],
        ["ФОРМАТ", "—"],
        ["СТАТУС", "по запросу"],
      ],
      fromBase: false,
    },
  );
  return list;
};

const roomPresets = (venueId: string): ModulePreset[] =>
  SPACES(venueId).map((s) => {
    const pax = spacePax(s);
    const area = spaceArea(s);
    const gap = spaceGap(s);
    return {
      key: String(s.id),
      title: String(s.name),
      sub: [pax ? `${pax} гостей` : "вместимость не заявлена", String(s.type ?? "")]
        .filter(Boolean)
        .join(" · "),
      badge: pax || "—",
      fields: [
        ["ЗАЛ", String(s.name)],
        ["ПЛОЩАДЬ", area ? `${area.toLocaleString("ru-RU")} м²` : "не заявлена"],
        ["ВМЕСТИМОСТЬ", pax ? `${pax} гостей` : "не заявлена"],
        ["БРОНИРОВАНИЕ", String(s.bookable ?? "по запросу")],
        ...(gap ? ([["ТРЕБУЕТ ДАННЫХ", gap]] as [string, string][]) : []),
      ],
      fromBase: true,
    };
  });

const slotPresets = (venueId: string): ModulePreset[] =>
  calPaletteOf(venueId).map(([name, , from, to, where]) => ({
    key: `slot-${name}`,
    title: `${name} · ${from}–${to}`,
    sub: where,
    badge: from,
    fields: [
      ["ДАТА", "—"],
      ["ВРЕМЯ", `${from}–${to}`],
      ["ЗАЛ", where],
      ["СТАТУС", "Черновик"],
    ] as [string, string][],
    fromBase: false,
  }));

// Готовые варианты блока для категории палитры
export const presetsFor = (kind: NodeKind, venueId: string): ModulePreset[] => {
  switch (kind) {
    case "room":
      return roomPresets(venueId);
    case "slot":
      return slotPresets(venueId);
    case "money":
      return moneyPresets(venueId);
    case "doc":
      return docPresets();
    case "promo":
      return promoPresets();
    case "staff":
      return staffPresets(venueId);
    default:
      return [];
  }
};

// ---------- rich-контент Illuzion ----------
const ILZ = "https://www.illuzionphuket.com/wp-content/uploads/";
export const ILZ_RICH: RichVenue = {
  src: "ILLUZIONPHUKET.COM/EVENTS",
  credit: "Illuzion Phuket · официальная галерея",
  hero: ILZ + "2020/06/Illuzion-Club-Phuket-Party-Events-1.jpg",
  video: "https://cwsdn.b-cdn.net/Illuzion/illuzion-intro-2025.mp4",
  gallery: ["9", "6", "1", "41", "36", "39", "50", "34"].map(
    (n) => ILZ + "2024/08/Illuzion-best-club-in-thailand-and-in-asia-" + n + "-1024x683.jpg",
  ),
  afisha: [
    [
      "7 АВГ",
      "DEFECTED PHUKET",
      "21:00 · Main Room · билеты ฿500",
      ILZ + "2026/07/2026_08_07_DEFECTED__IG_FEED-scaled.jpg",
      "ПОДТВЕРЖДЕНО",
    ],
    [
      "8 АВГ",
      "JOE ROLÉT",
      "21:00 · Main Room · билеты ฿500",
      ILZ + "ninja-forms/6/2026_08_08_JOE-ROLET_IG_FEED.jpg",
      "ПОДТВЕРЖДЕНО",
    ],
    [
      "22 АВГ",
      "SAM COLLINS",
      "21:00 · Main Room · билеты ฿500",
      ILZ + "ninja-forms/6/2026_08_22_SAM_COLLINS_IG_FEED.jpg",
      "ПОДТВЕРЖДЕНО",
    ],
    [
      "22 АВГ",
      "SAM COLLINS · SHELTER",
      "23:30 · Shelter · билеты ฿500",
      ILZ + "ninja-forms/6/2026_08_22_SAM_COLLINS_IG_FEED-1.jpg",
      "ПОДТВЕРЖДЕНО",
    ],
  ],
  artists: [
    "Martin Garrix",
    "Tiësto",
    "Steve Aoki",
    "Marshmello",
    "Afrojack",
    "Wiz Khalifa",
    "Jason Derulo",
    "DJ Snake",
    "Adam Beyer",
    "Meduza",
    "James Hype",
    "Claptone",
    "Fisher",
    "Alok",
    "Timmy Trumpet",
    "Marco Carola",
  ],
  artistsNote:
    "Тематические ночи: Notorious Friday (hip-hop live) · Elevation (tech-house). 300+ VIP-столов.",
  badge: "DJ MAG TOP-9 В МИРЕ · №1 В АЗИИ",
};

export const richOf = (vid: string): RichVenue =>
  vid === "VEN-0013" ? ILZ_RICH : (RICH_ALL[vid] ?? {});

// ---------- заявки организаторов ----------
export type InqRow = [number, string, string, string, string, string, string, string, string];
export const INQ: Record<string, InqRow[]> = {
  "VEN-0013": [
    [
      8,
      "АВГ",
      "Бренд-активация · дневной слот",
      "Main Room · 400 гостей · LED-стена · монтаж с 14:00",
      "—",
      "SLA 4 Ч",
      "НУЖЕН ПРАЙС",
      RED,
      "Ответить",
    ],
    [
      14,
      "АВГ",
      "Шоу артиста · концерт",
      "Main Room · 3 000 гостей · райдер артиста",
      "—",
      "SLA 12 Ч",
      "НОВАЯ",
      RED,
      "Ответить",
    ],
    [
      21,
      "АВГ",
      "VIP приватное событие",
      "Empire · 150 гостей · закрытый формат",
      "—",
      "ОТВЕЧЕНО",
      "БРОНЬ",
      AMBER,
      "Открыть",
    ],
    [
      29,
      "АВГ",
      "Клубная ночь · промоутер",
      "Main Room · договор промоутера",
      "—",
      "ЖДЁТ УСЛОВИЙ",
      "ПЕРЕГОВОРЫ",
      AMBER,
      "Открыть",
    ],
    [5, "СЕН", "Техно-шоукейс", "Shelter · 300 гостей", "—", "SLA 24 Ч", "НОВАЯ", RED, "Ответить"],
  ],
  "VEN-0061": [
    [
      11,
      "АВГ",
      "Конференция на 4-м этаже",
      "09:00–18:00 · 120 участников · кофе-брейки",
      "THB / час",
      "ПОДТВЕРЖДЕНО",
      "ПОДТВЕРЖДЕНО",
      GREEN,
      "Открыть",
    ],
    [
      18,
      "АВГ",
      "Приватное бизнес-событие",
      "4-й этаж · 18:00–22:00",
      "THB / час",
      "SLA 6 Ч",
      "НОВАЯ",
      RED,
      "Ответить",
    ],
    [
      25,
      "АВГ",
      "Воркшоп",
      "1-й этаж · 10:00–13:00",
      "THB / час",
      "ЖДЁТ ОПЛАТЫ",
      "БРОНЬ",
      AMBER,
      "Открыть",
    ],
  ],
  "VEN-0033": [
    [
      5,
      "АВГ",
      "Гала-ужин · Arlang",
      "19:00–23:00 · 260 гостей · банкет",
      "ЗАПРОС NET",
      "ОТВЕЧЕНО",
      "ПРЕДЛОЖЕНИЕ",
      AMBER,
      "Открыть",
    ],
    [
      12,
      "АВГ",
      "Свадебная церемония",
      "Пляж + Arlang · 180 гостей",
      "ЗАПРОС NET",
      "SLA 8 Ч",
      "НОВАЯ",
      RED,
      "Ответить",
    ],
    [
      16,
      "АВГ",
      "Совет директоров · Api",
      "10:00–15:00 · 20 участников",
      "ЗАПРОС NET",
      "ПОДТВЕРЖДЕНО",
      "ПОДТВЕРЖДЕНО",
      GREEN,
      "Открыть",
    ],
    [
      19,
      "АВГ",
      "Запуск продукта",
      "Arlang · 300 cocktail · AV-пакет",
      "ЗАПРОС NET",
      "SLA 24 Ч",
      "НОВАЯ",
      RED,
      "Ответить",
    ],
    [
      26,
      "АВГ",
      "Конференция, день 1",
      "Arlang · 220 театр",
      "ЗАПРОС NET",
      "ЖДЁТ ЗАЛОВ",
      "ПЕРЕГОВОРЫ",
      AMBER,
      "Открыть",
    ],
  ],
};

// ---------- финансы ----------
export const FIN_KPI: Record<string, [string, string, string, string][]> = {
  "VEN-0013": [
    ["ОПУБЛИКОВАННЫЙ ПРАЙС", "НЕТ", RED, "Прайс-лист — нет"],
    ["КОМИССИЯ GTR", "—", RED, "Не согласована"],
    ["ДЕПОЗИТ", "—", RED, "Не определён"],
    ["ВЫПЛАТЫ", "НЕ НАСТРОЕН", AMBER, "Нужны реквизиты юрлица"],
  ],
  "VEN-0061": [
    ["ОПУБЛИКОВАННЫЙ ПРАЙС", "THB / ЧАС", GREEN, "Ставка есть в источнике"],
    ["КОМИССИЯ GTR", "СОГЛАСОВАТЬ", AMBER, "Пилот bookable"],
    ["ДЕПОЗИТ", "СОГЛАСОВАТЬ", AMBER, "Условие пилота"],
    ["ВЫПЛАТЫ", "НЕ НАСТРОЕН", AMBER, "Следующий шаг"],
  ],
  "VEN-0033": [
    ["ОПУБЛИКОВАННЫЙ ПРАЙС", "НЕТ", RED, "Net rates запрошены"],
    ["КОМИССИЯ GTR", "—", RED, "Не согласована"],
    ["ДЕПОЗИТ", "—", RED, "Не определён"],
    ["ВЫПЛАТЫ", "НЕ НАСТРОЕН", AMBER, "После договора"],
  ],
};

export const FIN_BLOCKER: Record<string, string> = {
  "VEN-0013":
    "Illuzion Group: нет презентации приватной аренды, комиссии, правил промоутеров и тех-райдера. Пока условия не зафиксированы, площадка остаётся в статусе «бронь по запросу».",
  "VEN-0061":
    "Пилот bookable: нужны живой календарь, депозит, условия отмены и комиссия. Это единственная площадка базы, готовая к прямому бронированию.",
  "VEN-0033":
    "Нет матрицы вместимости и net-ставок от команды продаж курорта. Без них расчёт для организатора невозможен.",
};

// ---------- техника залов ----------
export const SPACES_TECH: Record<string, string> = {
  "VEN-0013":
    "6 500 м² общей площади. Main Room, Empire (хип-хоп), Shelter (техно). LED-стена 100 м². Звуковые системы Funktion-One, L-Acoustics и Outline — по опубликованным характеристикам площадки.",
  "VEN-0061":
    "1 645 м² общей площади: три event-пространства, переговорные и руфтоп. Оснащение под воркшопы, конференции и networking — уточняется у площадки.",
  "VEN-0033":
    "Безколонный бальный зал Arlang 304 м², переговорные Ava, Api, Arun и VIP-комната, пляжные и садовые сетапы для церемоний. AV-пакет и тех-райдер — в запросе у команды продаж курорта.",
};

// ---------- артисты (ленивая загрузка) ----------
export type Artist = {
  id: string;
  name: string;
  cat: string;
  kind: string;
  role: string;
  base: string;
  rel: string;
  prio: string;
  status: string;
  web: string;
  ig: string;
  fb: string;
  email: string;
  phone: string;
  wa: string;
  mgmt: string;
  evidence: string;
  verified: string;
  group: string;
  styles: string[];
  tier: string;
  rider: string;
  sp: string;
  sc: string;
  yt: string;
  bp: string;
  venue: string;
  riderName: string;
  [k: string]: unknown;
};

export type ArtistBase = {
  meta: {
    updated: string;
    total: number;
    byKind: Record<string, number>;
    byGroup: Record<string, number>;
    styles: [string, number][];
  };
  artists: Artist[];
};

// ---------- исполнители и контрагенты ----------
// В базе 312 записей, но выступают только 269: остальные — лейблы, агентства,
// менеджмент и площадки-промоутеры, то есть каналы букинга, а не артисты.
// Раньше поиск в конструкторе их не различал, и лейбл попадал в событие
// артистом — вместе с гонораром по тиру в смете.
export const PERFORMER_KINDS = ["artist", "live"] as const;
export const COUNTERPARTY_KINDS = ["team", "agency", "venue", "community"] as const;

export const isPerformer = (a: { kind?: string }) =>
  (PERFORMER_KINDS as readonly string[]).includes(String(a.kind));

export const ENTITY_KIND_LABEL: Record<string, string> = {
  artist: "Артист / DJ",
  live: "Лайв-состав",
  team: "Лейбл / менеджмент",
  agency: "Агентство",
  venue: "Площадка-промоутер",
  community: "Комьюнити",
};

// Цветовые метки типов: артисты в фиолетовом языке KINDS.artist, площадки —
// в красном KINDS.venue, чтобы список читался так же, как канвас события.
export const ENTITY_KIND_COLOR: Record<string, string> = {
  artist: "#7B4DFF",
  live: "#22D3C7",
  team: "#00C2FF",
  agency: "#F5A623",
  venue: "#E5231B",
  community: "#2ECC71",
};

export const entityColor = (kind?: string) =>
  ENTITY_KIND_COLOR[String(kind)] ?? "rgba(255,255,255,.35)";

export const loadArtists = () =>
  import("./artists.json").then((m) => m.default as unknown as ArtistBase);

// ---------- ценовая модель и смета события ----------
// Все суммы в тайских батах (THB). Оценки — консервативная нижняя граница
// диапазона, помечаются как «оценка» в UI; точные ставки приходят от площадки.
export const COMMISSION_PCT = 15;

// Гонорар артиста по тиру (нижняя граница event-ставки, THB)
export const ARTIST_TIER_FEE: Record<string, number> = {
  Хедлайнер: 250000,
  "Ростер агентства": 80000,
  "Ростер лейбла": 60000,
  "Гость площадки": 30000,
  "Резидент Пхукета": 15000,
  "Локальная сцена": 8000,
};
export const ARTIST_FEE_DEFAULT = 20000;

// ---------- ставки площадок ----------
// Каждая ставка несёт провенанс: откуда взята, когда и насколько твёрдая.
// published — опубликована площадкой, quoted — прислана в ответ на запрос,
// gtr-estimate — ориентир GTR, inquiry — ставки нет, только запрос.
// Смета обязана показывать разницу: ориентир ≠ подтверждённая цена.
export type RateKind = "published" | "quoted" | "gtr-estimate" | "inquiry";

export type VenueRate = {
  venueId: string;
  amount: number;
  unit: string; // час / день / событие — без этого «฿1 000» читается как цена всего события
  currency: string;
  covers: string;
  kind: RateKind;
  source: string;
  collected: string;
  note?: string;
};

export const RATE_LABEL: Record<RateKind, string> = {
  published: "Опубликованная ставка",
  quoted: "Подтверждено площадкой",
  "gtr-estimate": "Ориентир GTR",
  inquiry: "По запросу",
};

export const RATE_COLOR: Record<RateKind, string> = {
  published: GREEN,
  quoted: GREEN,
  "gtr-estimate": AMBER,
  inquiry: "rgba(255,255,255,.35)",
};

export const VENUE_RATES = venueRatesRaw as VenueRate[];

export const rateOf = (venueId: string): VenueRate | null =>
  VENUE_RATES.find((r) => r.venueId === venueId && r.amount > 0) ?? null;

export const artistFee = (tier?: string) => (tier && ARTIST_TIER_FEE[tier]) || ARTIST_FEE_DEFAULT;

export type QuoteLine = {
  group: "venue" | "artist" | "sound" | "light" | "decor" | "content" | "other";
  label: string;
  note: string;
  amount: number;
  estimate: boolean;
  kind: RateKind; // насколько твёрдая цифра — показывается в смете
};

export type Quote = {
  lines: QuoteLine[];
  subtotal: number;
  commissionPct: number;
  commission: number;
  total: number;
  hasEstimates: boolean;
  missing: string[]; // чего не хватает для точной сметы
};

const thb = (str?: string) => {
  if (!str) return 0;
  const m = String(str).match(/[\d][\d\s]*/);
  return m ? parseInt(m[0].replace(/\s/g, ""), 10) : 0;
};

// Считает смету из графа конструктора: площадка + артисты + подрядчики,
// плюс комиссия GTR. Возвращает построчную разбивку.
export const computeQuote = (graph: Graph, venueId: string): Quote => {
  const lines: QuoteLine[] = [];
  const missing: string[] = [];

  const venueNode = graph.nodes.find((n) => n.kind === "venue");
  const rate = rateOf(venueId);
  if (venueNode) {
    if (rate) {
      const perUnit = rate.unit && rate.unit !== "событие";
      lines.push({
        group: "venue",
        label: venueNode.title,
        note: perUnit
          ? `${rate.covers} · ставка за ${rate.unit}`
          : rate.covers || "Аренда площадки",
        amount: rate.amount,
        estimate: rate.kind !== "published" && rate.kind !== "quoted",
        kind: rate.kind,
      });
      if (rate.kind === "gtr-estimate") {
        missing.push(`Ставка «${venueNode.title}» — ориентир GTR, нужен запрос площадке`);
      }
      // Почасовая или посуточная ставка без длительности даёт неверный итог
      if (perUnit) {
        missing.push(
          `«${venueNode.title}» — ставка за ${rate.unit}, в смете учтён один. Задайте длительность события`,
        );
      }
    } else {
      lines.push({
        group: "venue",
        label: venueNode.title,
        note: "Аренда площадки — ставка не опубликована",
        amount: 0,
        estimate: true,
        kind: "inquiry",
      });
      missing.push(`Ставка аренды «${venueNode.title}» — по запросу`);
    }
  }

  for (const n of graph.nodes.filter((x) => x.kind === "artist")) {
    const tier = n.fields.find((f) => f[0] === "УРОВЕНЬ")?.[1];
    const fee = artistFee(tier);
    lines.push({
      group: "artist",
      label: n.title,
      note: `Гонорар · ${tier || "артист"}`,
      amount: fee,
      estimate: true,
      kind: "gtr-estimate",
    });
  }

  const VK: ("sound" | "light" | "decor" | "content")[] = ["sound", "light", "decor", "content"];
  for (const k of VK) {
    for (const n of graph.nodes.filter((x) => x.kind === k)) {
      // Конкретный пакет подрядчика кладёт точную цену в ЦЕНА_THB.
      // Строка ЦЕНА — человекочитаемая («฿4 000–31 000 / день») и для
      // расчёта не годится: из диапазона парсится нижняя граница.
      const exact = intOf(n.fields.find((f) => f[0] === "ЦЕНА_THB")?.[1]);
      const price = n.fields.find((f) => f[0] === "ЦЕНА")?.[1];
      const amount = exact || thb(price);
      const kind: RateKind = exact ? "published" : amount ? "gtr-estimate" : "inquiry";
      lines.push({
        group: k,
        label: n.title,
        note: `${KINDS[k][0]} · ${price || "по запросу"}`,
        amount,
        estimate: !exact,
        kind,
      });
      if (amount === 0) missing.push(`Цена подрядчика: ${n.title}`);
      else if (!exact) missing.push(`«${n.title}» — цена по нижней границе вилки, нужен пакет`);
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const commission = Math.round((subtotal * COMMISSION_PCT) / 100);
  return {
    lines,
    subtotal,
    commissionPct: COMMISSION_PCT,
    commission,
    total: subtotal + commission,
    hasEstimates: lines.some((l) => l.estimate),
    missing,
  };
};

export const fmtThb = (n: number) => "฿" + n.toLocaleString("ru-RU");

// ---------- запрос организатора (сторона спроса) ----------
export type OrgRequestStatus = "new" | "seen" | "accepted" | "declined";

export type OrgRequest = {
  id: string;
  draftId?: string; // событие, из которого собрана заявка
  venueId: string;
  venueName: string;
  organizerName: string;
  organizerContact: string;
  title: string; // формат события
  date: string; // желаемая дата/слот
  guests: string; // ожидаемое число гостей
  note: string;
  quoteSubtotal: number;
  quoteCommission: number;
  quoteTotal: number;
  lines: { label: string; note: string; amount: number }[];
  status: OrgRequestStatus;
  ts: number;
};

// ---------- каталог подрядчиков как модуль ----------
export type VendorPackage = {
  system: string;
  package: string;
  vendor: string;
  price: number;
  unit: string;
  contact: string;
  source: string;
  verified: string; // дата, когда цена подтверждена на сайте подрядчика; пусто — не подтверждена
  note?: string;
};

// Подтверждённая цена весомее перенесённой: в смете это разный статус
export const packageRateKind = (p: VendorPackage): RateKind =>
  p.verified ? "published" : "gtr-estimate";

export const VENDOR_PACKAGES = vendorPackagesRaw as VendorPackage[];

export const packagesOf = (vendorName: string) =>
  VENDOR_PACKAGES.filter((p) => p.vendor === vendorName);

export const UNIT_LABEL: Record<string, string> = {
  day: "день",
  package: "пакет",
  "add-on": "доп. опция",
  hour: "час",
};

export const unitLabel = (u: string) => UNIT_LABEL[u] ?? u;

// Подпись пакета в смете и палитре: «฿13 000 / день»
export const packagePrice = (p: VendorPackage) =>
  `${fmtThb(p.price)} / ${unitLabel(p.unit)}`;

// Русские подписи категорий подрядчиков
export const VENDOR_CAT_LABEL: Record<"sound" | "light" | "decor" | "content", string> = {
  sound: "Звук и сцена",
  light: "Свет и LED",
  decor: "Декор и мебель",
  content: "Фото и видео",
};

export type CatalogVendor = Vendor & {
  category: "sound" | "light" | "decor" | "content";
  id: string;
  packages: VendorPackage[];
  priceFrom: number; // минимальная известная цена пакета, 0 = по запросу
};

// Плоский каталог: разворачиваем VENDOR_CATALOG в список карточек с
// прикреплёнными прайс-пакетами и минимальной ценой.
export const VENDORS_FLAT: CatalogVendor[] = (["sound", "light", "decor", "content"] as const)
  .flatMap((category) =>
    (VENDOR_CATALOG[category] ?? []).map((v, i) => {
      const packages = packagesOf(v.name);
      const prices = packages.map((p) => p.price).filter(Boolean);
      return {
        ...v,
        category,
        id: `VND-${category}-${i}`,
        packages,
        priceFrom: prices.length ? Math.min(...prices) : 0,
      };
    }),
  )
  // уникальные подрядчики (MS Media встречается в звуке и свете — оставляем оба контекста)
  .filter(
    (v, i, arr) => arr.findIndex((x) => x.name === v.name && x.category === v.category) === i,
  );

// ---------- здоровье графа: статусы, связи, оповещения ----------
export const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: GREEN,
  warn: AMBER,
  problem: RED,
  delay: "#FF7A00",
};
export const STATUS_LABEL: Record<NodeStatus, string> = {
  ok: "В порядке",
  warn: "Внимание",
  problem: "Проблема",
  delay: "Задержка",
};

const BAD = /нет|missing|не\s?соглас|не\s?определ|отсут|черновик|запрош|требует|—/i;
const field = (n: GraphNode, key: string) => n.fields.find((f) => f[0] === key)?.[1] ?? "";

// Авто-оценка статуса узла по заполненности данных (правильно → зелёный).
export const deriveStatus = (n: GraphNode): { status: NodeStatus; reason: string } => {
  switch (n.kind) {
    case "money": {
      const price = field(n, "ПРАЙС-ЛИСТ") || field(n, "ТАРИФ") || field(n, "NET-СТАВКИ");
      if (BAD.test(price) || BAD.test(field(n, "КОМИССИЯ")))
        return { status: "problem", reason: "Прайс-лист или комиссия не согласованы" };
      return { status: "ok", reason: "Бюджет и ставки на месте" };
    }
    case "doc": {
      if (BAD.test(field(n, "ДОГОВОР")) || BAD.test(field(n, "УСЛОВИЯ ОПЛАТЫ")))
        return { status: "problem", reason: "Договор или условия оплаты не подписаны" };
      return { status: "ok", reason: "Договор в порядке" };
    }
    case "artist": {
      if (BAD.test(field(n, "РАЙДЕР")))
        return { status: "warn", reason: "Райдер артиста не подтверждён" };
      if (BAD.test(field(n, "КОНТАКТ")))
        return { status: "warn", reason: "Нет прямого контакта артиста" };
      return { status: "ok", reason: "Артист подтверждён" };
    }
    case "sound":
    case "light":
    case "decor":
    case "content": {
      if (BAD.test(field(n, "ЦЕНА")))
        return { status: "warn", reason: `Цена подрядчика «${n.title}» не зафиксирована` };
      return { status: "ok", reason: "Подрядчик подтверждён" };
    }
    case "slot": {
      if (BAD.test(field(n, "ДАТА")) || BAD.test(field(n, "ВРЕМЯ")))
        return { status: "warn", reason: "Дата/время слота не заданы" };
      return { status: "ok", reason: "Слот назначен" };
    }
    case "room":
    case "venue":
    case "promo":
    case "tech":
    case "staff":
    default:
      return { status: "ok", reason: "" };
  }
};

// Итоговый статус узла: ручной override приоритетнее авто-оценки.
export const nodeStatus = (
  n: GraphNode,
): { status: NodeStatus; reason: string; manual: boolean } => {
  if (n.status) {
    return {
      status: n.status,
      reason: n.note || STATUS_LABEL[n.status] + " — отмечено участником",
      manual: true,
    };
  }
  return { ...deriveStatus(n), manual: false };
};

const RANK: Record<NodeStatus, number> = { ok: 0, warn: 1, delay: 2, problem: 3 };

// Цвет связи по здоровью концов: зелёный только если оба ок.
export const linkStatus = (a?: GraphNode, b?: GraphNode): NodeStatus => {
  const sa = a ? nodeStatus(a).status : "ok";
  const sb = b ? nodeStatus(b).status : "ok";
  return RANK[sa] >= RANK[sb] ? sa : sb;
};

export type Alert = {
  severity: NodeStatus; // warn | problem | delay
  nodeId?: string;
  title: string;
  reason: string;
};

// Казус-проверки уровня события: вместимость, время/шум, разрешения, бюджет.
const capNum = (s?: string) => {
  const m = String(s || "").match(/(\d[\d\s]*)/);
  return m ? parseInt(m[1].replace(/\s/g, ""), 10) : 0;
};

export const eventAlerts = (
  g: Graph,
  venue: Venue | undefined,
  ctx?: { guests?: string; budget?: number; quoteTotal?: number },
): Alert[] => {
  const alerts: Alert[] = [];

  // 1. статусы узлов
  for (const n of g.nodes) {
    const s = nodeStatus(n);
    if (s.status !== "ok")
      alerts.push({ severity: s.status, nodeId: n.id, title: n.title, reason: s.reason });
  }

  // 2. вместимость: гостей больше, чем вмещает площадка/зал
  const guests = capNum(ctx?.guests);
  const venueCap = capNum(venue?.capacity);
  const roomCap = Math.max(
    0,
    ...g.nodes.filter((n) => n.kind === "room").map((n) => capNum(n.badge)),
  );
  const cap = roomCap || venueCap;
  if (guests && cap && guests > cap)
    alerts.push({
      severity: "problem",
      title: "Вместимость превышена",
      reason: `Ожидается ${guests} гостей при вместимости ~${cap}. Выберите зал побольше или уменьшите список.`,
    });

  // 3. поздний слот на пляже/в клубе → лимит по шуму/времени
  const lateSlot = g.nodes.find(
    (n) => n.kind === "slot" && /0[0-5]:|04:|05:|03:|02:/.test(field(n, "ВРЕМЯ")),
  );
  const noisy = /beach|club|rooftop|бич|клуб|руфтоп/i.test(`${venue?.type} ${venue?.tag}`);
  if (lateSlot && noisy)
    alerts.push({
      severity: "warn",
      nodeId: lateSlot.id,
      title: "Лимит по времени/шуму",
      reason: "Поздний слот на открытой площадке — проверьте разрешение на шум и время закрытия.",
    });

  // 4. пляж/марина без блока «Договор/разрешение»
  const permitVenue = /beach|marina|пляж|марин|яхт/i.test(`${venue?.type} ${venue?.tag}`);
  if (permitVenue && !g.nodes.some((n) => n.kind === "doc"))
    alerts.push({
      severity: "warn",
      title: "Нужно разрешение площадки",
      reason: "Пляж/марина требуют договора и разрешений — добавьте блок «Договор».",
    });

  // 5. смета превышает заявленный бюджет
  if (ctx?.budget && ctx?.quoteTotal && ctx.quoteTotal > ctx.budget)
    alerts.push({
      severity: "warn",
      title: "Смета выше бюджета",
      reason: `Смета ${fmtThb(ctx.quoteTotal)} превышает бюджет ${fmtThb(ctx.budget)}.`,
    });

  return alerts.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
};

// Сводка здоровья: сколько ok/warn/problem, общий вердикт.
export const graphHealth = (alerts: Alert[]) => {
  const problems = alerts.filter((a) => a.severity === "problem").length;
  const delays = alerts.filter((a) => a.severity === "delay").length;
  const warns = alerts.filter((a) => a.severity === "warn").length;
  const verdict: NodeStatus = problems ? "problem" : delays ? "delay" : warns ? "warn" : "ok";
  return { problems, delays, warns, verdict, clean: alerts.length === 0 };
};

// ---------- умные вопросы организатору (чтобы без казусов) ----------
export type EventQuestion = {
  id: string;
  q: string;
  hint: string;
  required: boolean;
  // выполнено ли условие (на что смотрит вопрос) — если нет, вопрос «горит»
  satisfied: (g: Graph) => boolean;
};

export const EVENT_QUESTIONS: EventQuestion[] = [
  {
    id: "slot",
    q: "Когда событие?",
    hint: "Добавьте блок «Слот времени» с датой и временем.",
    required: true,
    satisfied: (g) => g.nodes.some((n) => n.kind === "slot"),
  },
  {
    id: "room",
    q: "В каком зале/зоне?",
    hint: "Свяжите площадку с конкретным залом.",
    required: true,
    satisfied: (g) => g.nodes.some((n) => n.kind === "room"),
  },
  {
    id: "lineup",
    q: "Кто выступает?",
    hint: "Добавьте артиста из базы или лайнапа.",
    required: false,
    satisfied: (g) => g.nodes.some((n) => n.kind === "artist"),
  },
  {
    id: "sound",
    q: "Звук обеспечен?",
    hint: "Добавьте подрядчика по звуку из каталога.",
    required: true,
    satisfied: (g) => g.nodes.some((n) => n.kind === "sound"),
  },
  {
    id: "light",
    q: "Свет/сцена есть?",
    hint: "Добавьте подрядчика по свету.",
    required: false,
    satisfied: (g) => g.nodes.some((n) => n.kind === "light"),
  },
  {
    id: "content",
    q: "Кто снимает фото/видео?",
    hint: "Добавьте подрядчика по контенту.",
    required: false,
    satisfied: (g) => g.nodes.some((n) => n.kind === "content"),
  },
  {
    id: "doc",
    q: "Договор и оплата оформлены?",
    hint: "Добавьте блок «Договор» и согласуйте условия.",
    required: true,
    satisfied: (g) => g.nodes.some((n) => n.kind === "doc"),
  },
];
