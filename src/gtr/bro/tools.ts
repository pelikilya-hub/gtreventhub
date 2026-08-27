// Инструменты GTR BRO: строгие схемы и типизированные результаты.
//
// Главное правило здесь одно: модель не придумывает афишу. Всё, что
// касается текущих событий, цен и доступности, приходит из наших
// провайдеров, и каждый результат несёт статус достоверности. Если
// источника нет — результат честно говорит «unknown», а не молчит.
//
// Второе правило: карточки действий собираются из этих же типизированных
// результатов, а не разбираются из произнесённого текста. Разбор речи
// обратно в сущности — это способ показать пользователю несуществующее
// событие.

import artistsRaw from "../data/artists.json";
import artistStylesRaw from "../data/artist-genres.json";
import artistPlayersRaw from "../data/artist-players.json";
import broLessonsRaw from "../data/bro-lessons.json";
import broQaProRaw from "../data/bro-qa-pro.json";
import broQaRaw from "../data/bro-qa.json";
import cdmReserveRaw from "../data/cdm-reserve.json";
import clcReserveRaw from "../data/clc-reserve.json";
import equipmentRaw from "../data/equipment.json";
import geoRaw from "../data/venue-geo.json";
import labelLogosRaw from "../data/label-logos.json";
import packagesRaw from "../data/vendor-packages.json";
import ratesRaw from "../data/venue-rates.json";
import { nightOf, richOf, V, venueGraph, type EventDraft } from "../data/app-data";
import { hasReserve as venueHasReserve, menuVenues, reserveVenues } from "../venue-commerce";
import { capacityOf, forecast, pullScore } from "./forecast";
import { isTeam, TEAM_ROLES } from "./roles";
import { genreName, resolveGenre } from "../genres";
import { fitArtist, primeSlot, slotAt, soundOf } from "../venue-sound";

// ------------------------------------------------------------- типы

export type Verification = "confirmed" | "likely" | "unknown" | "sold_out" | "cancelled";

export type BroEvent = {
  event_id: string;
  title: string;
  venue: string;
  venue_id: string;
  start_at: string;
  distance_km: number | null;
  genre: string[];
  energy_level: number | null;
  price_from: number | null;
  currency: string;
  availability_status: "available" | "limited" | "sold_out" | "unknown";
  verification_status: Verification;
  poster: string | null;
  /** источник данных — показываем в карточке, чтобы демо не смешивалось */
  source: string;
};

export type ToolOk<T> = { ok: true; data: T; freshAt: string };
export type ToolErr = { ok: false; error: string; retryable: boolean };
export type ToolResult<T> = ToolOk<T> | ToolErr;

const now = () => new Date().toISOString();
const ok = <T,>(data: T): ToolOk<T> => ({ ok: true, data, freshAt: now() });
const err = (error: string, retryable = false): ToolErr => ({ ok: false, error, retryable });

// Тексты, пришедшие из чужих источников (названия событий, описания
// площадок), обрезаем и лишаем управляющих конструкций: описание события
// не должно уметь говорить модели, что ей делать.
const clean = (s: string, max = 160): string =>
  String(s ?? "")
    .replace(/[\x00-\x1f]/g, " ")
    .replace(/```|<\/?system>|<\/?instructions?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Сравнение имён площадок: диакритика убирается (Café → cafe), кириллица
// транслитерируется, к/c считаются роднёй. Совпадение — большинство слов.
const fold = (x: string): string =>
  x
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[а-яё]/g, (ch) => {
      const T: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
        й: "i", к: "c", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
        у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "",
        э: "e", ю: "u", я: "a",
      };
      return T[ch] ?? ch;
    });

const venueMatch = (venueName: string, query: string): boolean => {
  const name = fold(venueName);
  const words = fold(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return false;
  // «к» транслитерируется в c, но часть названий пишется через k — считаем
  // слово совпавшим в любой из двух форм.
  const hit = words.filter((w) => name.includes(w) || name.includes(w.replace(/c/g, "k"))).length;
  return hit * 2 >= words.length + 1;
};

const km = (a: [number, number], b: [number, number]): number => {
  const dLat = (b[0] - a[0]) * 110.574;
  const dLon = (b[1] - a[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.round(Math.hypot(dLat, dLon) * 10) / 10;
};

// -------------------------------------------------- описания для модели

export const TOOL_DEFS = [
  {
    type: "function" as const,
    name: "search_events",
    description:
      "Найти реальные события на Пхукете в заданном окне дат. Единственный законный источник текущей афиши. Возвращает статус достоверности каждого события.",
    parameters: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "ISO-дата начала окна, например 2026-08-17" },
        dateTo: { type: "string", description: "ISO-дата конца окна включительно" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        radiusKm: { type: "number" },
        district: { type: "string", description: "Патонг, Банг Тао, Камала, Карон, Старый город" },
        venue: {
          type: "string",
          description: "Название площадки, если спрашивают про конкретное место: Café del Mar, Illuzion",
        },
        genres: { type: "array", items: { type: "string" } },
        budgetMax: { type: "number" },
        partySize: { type: "integer" },
        limit: { type: "integer", description: "не больше 8" },
      },
      required: ["dateFrom", "dateTo"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_event_details",
    description: "Точные детали одного события: время, цена, площадка, статус.",
    parameters: {
      type: "object",
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_venue_live_status",
    description:
      "Живой статус площадки: сколько людей, какая музыка сейчас. Источник может быть не подключён — тогда честно вернётся unknown.",
    parameters: {
      type: "object",
      properties: { venueId: { type: "string" } },
      required: ["venueId"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "build_night_route",
    description:
      "Собрать маршрут вечера по площадкам с реальным расстоянием и временем в пути между ними (не выдуманным «плюс два часа»): порядок бери из stops как есть, время прибытия на каждую точку и переезд между ними считаются по настоящей географии острова.",
    parameters: {
      type: "object",
      properties: {
        stops: { type: "array", items: { type: "string" }, description: "id площадок по порядку" },
        startHour: { type: "integer" },
        partySize: { type: "integer" },
        safeTransportOnly: { type: "boolean" },
        startLat: { type: "number", description: "текущая широта гостя из session context — первый перегон тоже станет настоящим" },
        startLon: { type: "number", description: "текущая долгота гостя из session context" },
        dwellMin: { type: "integer", description: "сколько минут проводят на площадке до следующего переезда, по умолчанию 90" },
      },
      required: ["stops"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "open_in_app",
    description:
      "Открыть экран или сущность внутри GTR. Навигация, ничего не покупает. Только для экранов платформы: для музыки, клипов и внешних ссылок используй open_music, иначе человек уедет в случайный раздел вместо того, что просил.",
    parameters: {
      type: "object",
      properties: {
        route: {
          type: "string",
          enum: [
            "tonight", "map", "venueCard", "artists", "calendar", "promo", "aimatch",
            "base", "community", "events", "constructor", "vendors", "dash",
          ],
        },
        entityId: { type: "string" },
      },
      required: ["route"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "ask_gtr",
    description:
      "База знаний GTR: как устроен продукт (брони, предзаказ, роли, комьюнити) и что нужно знать про Пхукет — районы, сезоны, такси, законы о продаже алкоголя, дресс-код, безопасность на воде, деньги, еда. Зови на любой вопрос «как/почему/что такое», который не про сегодняшнюю афишу.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "вопрос человека как есть" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "search_venues",
    description:
      "Поиск по базе площадок GTR: клубы, бары, пляжные клубы, рестораны Пхукета по району, типу и музыке. Это единственный способ ответить на «какие клубы в Патонге», «найди пляжный клуб», «что есть в базе». Паспорт конкретного места — get_venue_profile.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "свободный запрос: название, слово из концепции" },
        district: { type: "string", description: "Патонг, Банг Тао, Камала, Карон, Ката, Сурин, Старый город" },
        kind: {
          type: "string",
          description: "тип места: клуб, бар, пляжный клуб, ресторан, лаундж, рooftop",
        },
        music: { type: "string", description: "жанр или стиль: техно, хаус, хип-хоп, лайв" },
        limit: { type: "integer", description: "не больше 8" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_venue_profile",
    description:
      "Полный паспорт площадки по названию: часы работы (hours), условия входа (entry), лучшие вечера (best), формат, звук по часам, вместимость, прайс-ориентир, сайт, контакты. «Во сколько открывается», «до скольки работает», «платный ли вход» — это сюда. Поле пустое (null) — значит мы не знаем: так и скажи, не выдумывай часы.",
    parameters: {
      type: "object",
      properties: { venue: { type: "string", description: "Название: Illuzion, Cafe del Mar" } },
      required: ["venue"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "find_artists",
    description:
      "Найти артистов в базе GTR по имени, жанру или категории. 312 профилей: диджеи, лайвы, агентства.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "имя или его часть" },
        genre: { type: "string", description: "жанр: техно, хаус, поп" },
        limit: { type: "integer", description: "не больше 8" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "search_vendors",
    description:
      "Каталог подрядчиков и оборудования GTR: звук, свет, LED-экраны, DJ-оборудование, пиротехника — с ценами и контактами.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "что ищем: LED, звук, XDJ, генератор" },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "create_event_draft",
    description:
      "Создать черновик события в календаре GTR: площадка, дата, название. Требует подтверждения пользователя в интерфейсе.",
    parameters: {
      type: "object",
      properties: {
        venue: { type: "string", description: "название площадки" },
        dateIso: { type: "string", description: "дата ГГГГ-ММ-ДД" },
        title: { type: "string", description: "название события" },
        format: { type: "string", description: "формат: клубная ночь, корпоратив, свадьба" },
        guests: { type: "string", description: "ожидаемое число гостей" },
      },
      required: ["venue", "dateIso", "title"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "call_taxi",
    description:
      "Собрать поездку до площадки: ссылки Grab/Bolt/карты с точкой назначения. Само не заказывает — открывает приложение такси с маршрутом.",
    parameters: {
      type: "object",
      properties: { venue: { type: "string", description: "куда едем: название площадки" } },
      required: ["venue"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "open_music",
    description:
      "Открыть музыку артиста снаружи: сеты и клипы на YouTube, треки в Spotify или SoundCloud. Именно этим инструментом отвечай на «включи», «послушать», «покажи сеты», «найди клип». open_in_app для музыки не годится — внутри платформы её нет.",
    parameters: {
      type: "object",
      properties: {
        artist: { type: "string", description: "имя артиста" },
        source: {
          type: "string",
          enum: ["youtube", "spotify", "soundcloud", "any"],
          description: "где слушать; youtube — для сетов и клипов",
        },
      },
      required: ["artist"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_artist_profile",
    description:
      "Досье артиста из базы GTR: кто он, откуда, стиль, статус на сцене и ссылки послушать — Spotify, SoundCloud, YouTube. Зови, когда речь про конкретное имя, про его музыку, сеты или клипы.",
    parameters: {
      type: "object",
      properties: {
        artist: { type: "string", description: "имя артиста" },
      },
      required: ["artist"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_venue_zones",
    description:
      "Рассадка площадки с полной схемой брони: Café del Mar (зоны, столы, вместимость, депозиты, кредит на еду и напитки, слоты времени), CLC Restaurant/Come Leo Come (Main Hall, Karaoke Hall, Private Lounge — вместимость и почасовая ставка Private Lounge, для остальных залов цена по запросу) и Place Coworking (переговорная — почасовая ставка и ставка на день; три событийных зала — цена и рассадка по заявке). Зови перед book_table.",
    parameters: {
      type: "object",
      properties: { venue: { type: "string", description: "название площадки" } },
      required: ["venue"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_menu",
    description:
      "Официальные меню с ценами в батах: Café del Mar (Камала), SHAMAN Lounge Cafe Bar (Банг Тао — европейская кухня, роллы, икра, бар, чайная карта) и CLC Restaurant / Come Leo Come (Чёнг Тале — итамеши-кухня, гриль вагю, японская кухня, авторские коктейли). Ищи по названию блюда или категории; venue сужает до одной площадки. Результат — точные позиции для предзаказа.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "что ищем: паста, устрицы, мохито, роллы…" },
        venue: { type: "string", description: "площадка: Café del Mar, SHAMAN или CLC; пусто — искать везде" },
        section: {
          type: "string",
          enum: ["food", "cocktails", "bar", "asia", "caviar", "tea", "starters", "salads-soups", "pasta-risotto", "mains", "desserts", "japanese"],
        },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "book_table",
    description:
      "Забронировать стол/зал или передать заявку. Со схемой рассадки работают Café del Mar (зона, тип стола, слот, предзаказ по меню), CLC Private Lounge (почасовая аренда, минимум 3 часа, укажи hours) и Place Coworking Meeting Room (почасово или на день) — там бронь закрепляется сразу. Три событийных зала Place Coworking (1st/4th/6th Floor) в эту схему не входят — по ним, как и по любой другой площадке из базы, уходит ЗАЯВКА, менеджер перезвонит гостю. В этом случае говори «передал заявку, с вами свяжутся», а не «стол забронирован». Минимум для заявки: venue, dateIso, phone. Требует подтверждения пользователя в интерфейсе; всё уходит менеджеру в Telegram.",
    parameters: {
      type: "object",
      properties: {
        venue: { type: "string", description: "название площадки" },
        table: { type: "string", description: "тип стола/зала из get_venue_zones, например Beach Bed или CLC Private Lounge" },
        dateIso: { type: "string", description: "дата ГГГГ-ММ-ДД" },
        slot: { type: "string", description: "время из слотов стола (Café del Mar) или время начала аренды (CLC), например 13:00" },
        hours: { type: "integer", description: "только для CLC: сколько часов арендуют зал, минимум 3" },
        guests: { type: "integer", description: "число гостей" },
        phone: { type: "string", description: "телефон гостя для связи" },
        note: { type: "string", description: "пожелания" },
        preorder: {
          type: "array",
          description: "предзаказ: точные названия позиций из get_menu",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              qty: { type: "integer" },
              opt: { type: "string", description: "вариант: бокал, бутылка, 6 шт…" },
            },
            required: ["item", "qty"],
            additionalProperties: false,
          },
        },
      },
      required: ["venue", "table", "dateIso", "guests"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "send_telegram",
    description:
      "Отправить сообщение в Telegram: команде GTR (boss) или в чат сообщества (chat). Требует подтверждения пользователя в интерфейсе.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["boss", "chat"] },
        text: { type: "string", description: "текст сообщения, до 500 символов" },
      },
      required: ["target", "text"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "forecast_attendance",
    description:
      "Только для команды GTR. Прогноз явки на вечер: сколько людей придёт на площадку в конкретную дату. Считает по вместимости, формату, дню недели, сезону Пхукета, тяге артиста, цене входа, промо и сроку анонса. Возвращает вилку low/expected/high, все множители с объяснением и слабое место сметы. Зови на «сколько придёт», «стоит ли делать вечер», «потянем ли пятницу».",
    parameters: {
      type: "object",
      properties: {
        venue: { type: "string", description: "название площадки" },
        date: { type: "string", description: "дата события ГГГГ-ММ-ДД" },
        artist: { type: "string", description: "хедлайнер, если известен" },
        price: { type: "integer", description: "вход в батах, 0 — свободный" },
        promo: { type: "string", description: "нет | слабое | обычное | сильное" },
      },
      required: ["venue", "date"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "artist_pull",
    description:
      "Только для команды GTR. Тяга артиста в баллах 0–100: цифровой след (слушатели), уровень в базе, приоритет сцены, верификация, прямые записи, сколько площадок Пхукета подходят по звуку. Зови на «насколько популярен», «потянет ли зал», «кого ставить хедлайнером».",
    parameters: {
      type: "object",
      properties: { artist: { type: "string", description: "имя артиста из базы GTR" } },
      required: ["artist"],
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

// ------------------------------------------------------ границы ролей
//
// Гость пришёл отдыхать, а не работать. Инструменты продакшена (смета,
// подрядчики, создание события, рабочие экраны) ему не просто запрещены
// на исполнении — он их вообще не видит: модель, которой не показали
// инструмент, не может его предложить и не может им соблазнить.

export { TEAM_ROLES, isTeam } from "./roles";

/** Инструменты, закрытые для гостя и артиста. */
const TEAM_ONLY_TOOLS = ["create_event_draft", "search_vendors", "forecast_attendance", "artist_pull"];

/** Экраны, куда гостя не пускает навигация BRO. */
export const TEAM_ONLY_ROUTES = ["events", "constructor", "vendors", "dash"];

/** Набор инструментов для роли — то, что уходит модели в схемах. */
export const toolsForRole = (role?: string) =>
  isTeam(role) ? TOOL_DEFS : TOOL_DEFS.filter((d) => !TEAM_ONLY_TOOLS.includes(d.name));

// --------------------------------------------------------- провайдеры

/** Источник афиши. Реализация читает наш KV-кэш разведки; демо-источника
 *  в продукте нет намеренно — лучше честное «ничего не нашёл», чем
 *  выдуманный вечер, за который пойдёт живой человек. */
export type EventsProvider = {
  id: string;
  search(args: {
    dateFrom: string;
    dateTo: string;
    vids?: string[];
  }): Promise<{ vid: string; events: { id?: string; title: string; dateIso: string; poster?: string; url?: string; artistIds?: string[] }[] }[]>;
};

// --------------------------------------------------------- обработчики

export type ToolCtx = {
  provider: EventsProvider;
  location?: { latitude?: number; longitude?: number; district?: string };
  /** Кто спрашивает: контакты и пишущие действия зависят от роли. */
  user?: { email: string; name: string; role: string; boss?: boolean };
  /** KV — только для пишущих инструментов. */
  kv?: {
    put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void>;
    /** Чтение нужно антиповтору: какой вариант ответа человек уже слышал. */
    get?: (k: string) => Promise<string | null>;
  };
  /** Отправка в Telegram — подключается маршрутизатором, чтобы тесты
   *  не тянули сеть. */
  tgSend?: (target: "boss" | "chat", text: string) => Promise<boolean>;
  /** Создание брони стола — маршрутизатор подключает реальный поток
   *  (KV + Telegram менеджеру); в тестах — заглушка. */
  book?: (b: {
    vid: string;
    dateIso: string;
    guests: number;
    name: string;
    phone: string;
    note?: string;
    zone?: string;
    tableType?: string;
    slot?: string;
    deposit?: number;
    credit?: number;
    preorder?: { id: string; name: string; opt?: string; qty: number; price: number }[];
  }) => Promise<{ ok: boolean; id?: string; reason?: string }>;
};

/** Пишущие инструменты: без подтверждения в интерфейсе не выполняются.
 *  Каждая запись — человеческое описание для окна подтверждения. */
export { WRITE_TOOLS } from "./write-tools";

const GEO = geoRaw as Record<string, { lat: number; lon: number }>;

// V() на неизвестный id возвращает пустой объект, а не null — он
// правдоподобно проходит проверку на истинность. Для BRO это опасно:
// пустая площадка превращается в карточку без названия, то есть в
// выдуманное место. Существование проверяем по наличию id.
const venue = (vid: string) => {
  const v = V(vid);
  return v && v.id ? v : null;
};
const venueLatLon = (vid: string): [number, number] | null => {
  const g = GEO[vid];
  return g ? [g.lat, g.lon] : null;
};

const genreIdsOfVenue = (vid: string): string[] => {
  const v = V(vid);
  const raw = `${v?.music ?? ""} ${v?.concept ?? ""}`.split(/[;,·]/);
  const out: string[] = [];
  for (const part of raw) {
    const id = resolveGenre(part);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

/** Служебные слова: в ключах базы знаний они не несут темы. Хранятся
 *  свёрнутыми (fold транслитерирует кириллицу), иначе сравнение промахнётся. */
const QA_STOP = new Set(
  [
    // Кириллица после fold удлиняется («что» → chto, «как» → cac), поэтому
    // фильтр по длине служебные слова не отсекает — только явный список.
    "что", "чем", "чём", "как", "где", "куда", "когда", "почему", "зачем",
    "такое", "такой", "какой", "какая", "какие", "который", "нужно", "надо",
    "можно", "стоит", "этот", "этом", "это", "есть", "будет", "делать", "тут",
  ].map(
    (w) => fold(w),
  ),
);

/** Запомнить вопрос, на который база знаний не ответила.
 *
 *  Ключ — нормализованный вопрос: «дресс-код?» и «дресс код» должны
 *  сойтись в одну строку, иначе счётчик размажется по вариантам
 *  написания и ни один не наберёт веса. Хранится 90 дней: тема, про
 *  которую не спрашивали квартал, перестала быть дырой.
 *
 *  Промах не должен ронять ответ: если KV недоступен, гость всё равно
 *  получит свой отказ, просто мы не узнаем про этот вопрос. */
async function noteMiss(ctx: ToolCtx, key: string, raw: string): Promise<void> {
  if (!ctx.kv?.put || !ctx.kv?.get || !key) return;
  const k = `broask:${key.slice(0, 80)}`;
  try {
    const prev = JSON.parse((await ctx.kv.get(k)) ?? "null") as { n?: number } | null;
    await ctx.kv.put(
      k,
      JSON.stringify({ q: raw, n: (prev?.n ?? 0) + 1, last: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 90 },
    );
  } catch {
    /* журнал промахов не важнее ответа */
  }
}

/** Тема базы знаний. Три слоя: базовый в коде, выученный из бэклога,
 *  рабочий — только для команды. */
export type QaItem = { id: string; keys: string[]; answers: string[]; tag: string };

/** Нормализация вопроса и ключа к одному виду.
 *
 *  Дефисы и знаки становятся пробелами: «дресс-код» и «дресс код» — один
 *  и тот же вопрос, а посимвольное сравнение считало их разными. */
export const qaNorm = (x: string) => fold(x).replace(/[^a-z0-9]+/g, " ").trim();

/** Собрать доступные темы. Гость не получает рабочий слой ни при каких
 *  формулировках: маркетинговые темы просто не попадают в перебор. */
export async function qaItems(
  team: boolean,
  kvGet?: (k: string) => Promise<string | null>,
): Promise<QaItem[]> {
  const items: QaItem[] = [...(broQaRaw as { items: QaItem[] }).items];
  if (kvGet) {
    const learned = await kvGet("broqa:learned").catch(() => null);
    if (learned) {
      try {
        const ids = new Set((JSON.parse(learned) as { ids?: string[] }).ids ?? []);
        for (const l of (broLessonsRaw as { lessons: QaItem[] }).lessons)
          if (ids.has(l.id)) items.push(l);
      } catch {
        // Битая запись в KV не должна ронять ответ на вопрос.
      }
    }
  }
  if (team) items.push(...(broQaProRaw as { items: QaItem[] }).items);
  return items;
}

/** Порог совпадения. Ниже — считаем, что темы нет: лучше честное «не
 *  знаю», чем уверенный ответ не про то. */
export const QA_MIN_SCORE = 6;

/** Найти тему под вопрос. Общая для инструмента ask_gtr и для подсказки,
 *  которую воркер кладёт в промпт до обращения к модели. Две копии этого
 *  перебора неизбежно разошлись бы, и «база знает» перестало бы значить
 *  «модель увидела». */
export function qaMatch(question: string, items: QaItem[]): { item: QaItem; score: number } | null {
  const q = qaNorm(question);
  if (!q) return null;
  let best: QaItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    let score = 0;
    for (const k of it.keys) {
      const fk = qaNorm(k);
      if (!fk) continue;
      // Целое вхождение ключа весит больше, чем совпадение слов:
      // «карта» внутри «карта или наличные» — не то же самое.
      if (q.includes(fk)) score += 10 + fk.length / 8;
      else {
        // Служебные слова из ключа выбрасываем. Иначе ключ «что такое
        // gtr» цеплялся за любое «что такое …»: значимым словом в нём
        // после фильтра длины оставалось одно «такое», и на вопрос про
        // b2b человек получал рассказ про продукт.
        const words = fk.split(" ").filter((w) => w.length > 3 && !QA_STOP.has(w));
        if (words.length && words.every((w) => q.includes(w))) score += 5 + words.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best && bestScore >= QA_MIN_SCORE ? { item: best, score: bestScore } : null;
}

export const handlers: Record<
  ToolName,
  (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult<unknown>>
> = {
  async search_events(args, ctx) {
    const dateFrom = String(args.dateFrom ?? "").slice(0, 10);
    const dateTo = String(args.dateTo ?? dateFrom).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return err("нужна дата в формате ГГГГ-ММ-ДД");
    const limit = Math.min(8, Math.max(1, Number(args.limit ?? 5)));
    const district = args.district ? clean(String(args.district), 40) : ctx.location?.district;
    // Вопрос про конкретное место: сверяем и латинское имя площадки, и
    // русское написание отсюда не угадать — поэтому вхождение по словам.
    const wantVenue = args.venue ? clean(String(args.venue), 60).toLowerCase() : "";
    const wantGenres = Array.isArray(args.genres)
      ? (args.genres as string[]).map((g) => resolveGenre(String(g))).filter(Boolean as unknown as (x: string | null) => x is string)
      : [];

    let byVenue;
    try {
      byVenue = await ctx.provider.search({ dateFrom, dateTo });
    } catch {
      return err("источник афиши не ответил", true);
    }

    const here: [number, number] | null =
      typeof args.latitude === "number" && typeof args.longitude === "number"
        ? [args.latitude as number, args.longitude as number]
        : ctx.location?.latitude !== undefined && ctx.location?.longitude !== undefined
          ? [ctx.location.latitude, ctx.location.longitude!]
          : null;

    const out: BroEvent[] = [];
    for (const row of byVenue) {
      const v = venue(row.vid);
      if (!v) continue;
      if (wantVenue) {
        if (!venueMatch(v.name, wantVenue)) continue;
      } else if (
        district &&
        !`${v.area} ${v.cluster} ${v.district}`.toLowerCase().includes(district.toLowerCase())
      )
        continue;
      const slot = primeSlot(row.vid);
      const vg = genreIdsOfVenue(row.vid);
      if (wantGenres.length && vg.length) {
        const fit = fitArtist(row.vid, wantGenres);
        if (fit.vetoed.length) continue;
      }
      const ll = venueLatLon(row.vid);
      for (const e of row.events) {
        if (e.dateIso < dateFrom || e.dateIso > dateTo) continue;
        out.push({
          event_id: e.id ? `${row.vid}:${e.id}` : `${row.vid}:${e.dateIso}`,
          title: clean(e.title, 90),
          venue: clean(v.name, 60),
          venue_id: row.vid,
          start_at: e.dateIso,
          distance_km: here && ll ? km(here, ll) : null,
          genre: vg.slice(0, 3).map((g) => genreName(g, "ru")),
          energy_level: slot?.energy ?? null,
          price_from: null,
          currency: "THB",
          // Наличие мест мы не знаем: билетной интеграции нет, и врать
          // об этом нельзя — человек поедет и упрётся в закрытую дверь.
          availability_status: "unknown",
          // Событие снято с официального сайта площадки — это «likely»:
          // афиша реальная, но подтверждения от площадки у нас нет.
          verification_status: "likely",
          poster: e.poster ?? null,
          source: ctx.provider.id,
        });
        if (out.length >= limit * 3) break;
      }
    }

    out.sort((a, b) => {
      if (a.start_at !== b.start_at) return a.start_at < b.start_at ? -1 : 1;
      const da = a.distance_km ?? 99;
      const db = b.distance_km ?? 99;
      return da - db;
    });
    // Пустой день — не поломка поиска, а факт про остров: в среду
    // афиша жиже, чем в субботу. Но отвечать «пусто» и замолкать нельзя:
    // человек решит, что инструмент сломан. Показываем ближайшее живое.
    if (!out.length) {
      // Смотрим со следующего дня после запрошенного окна: повторять
      // тот же день бессмысленно, он только что вернул пустоту.
      const from = new Date(`${dateTo}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() + 1);
      const nextFrom = from.toISOString().slice(0, 10);
      const ahead = new Date(`${dateTo}T00:00:00Z`);
      ahead.setUTCDate(ahead.getUTCDate() + 14);
      const nextTo = ahead.toISOString().slice(0, 10);
      let nextRows: Awaited<ReturnType<typeof ctx.provider.search>> = [];
      try {
        nextRows = await ctx.provider.search({ dateFrom: nextFrom, dateTo: nextTo });
      } catch {
        nextRows = [];
      }
      const nearest = [];
      for (const row of nextRows) {
        const v = venue(row.vid);
        if (!v) continue;
        for (const e of row.events) {
          if (e.dateIso <= dateTo) continue;
          nearest.push({
            event_id: e.id ?? `${row.vid}:${e.dateIso}`,
            title: clean(e.title, 90),
            venue: clean(v.name, 60),
            venue_id: row.vid,
            start_at: e.dateIso,
          });
        }
      }
      nearest.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));
      return ok({
        events: [],
        total: 0,
        source: ctx.provider.id,
        nearest: nearest.slice(0, 3),
        note: nearest.length
          ? "На запрошенные даты в базе пусто. Ближайшее живое — в nearest: предложи его, не молчи."
          : "На запрошенные даты в базе пусто и ближайших событий тоже нет.",
      });
    }
    return ok({ events: out.slice(0, limit), total: out.length, source: ctx.provider.id });
  },

  async get_event_details(args, ctx) {
    const id = clean(String(args.eventId ?? ""), 120);
    const vid = id.split(":")[0];
    const v = venue(vid);
    if (!v) return err("такого события нет в базе");
    const sound = soundOf(vid);
    const rich = richOf(vid);
    return ok({
      event_id: id,
      venue: clean(v.name, 60),
      venue_id: vid,
      area: clean(v.area, 40),
      format: sound?.label ?? null,
      audience: sound?.audience ?? null,
      slots:
        sound?.slots.map((s) => ({ role: s.role, from: s.from, to: s.to, bpm: s.bpm, energy: s.energy })) ??
        [],
      genres: genreIdsOfVenue(vid).map((g) => genreName(g, "ru")),
      photo: rich.hero ?? null,
      price_from: null,
      availability_status: "unknown" as const,
      verification_status: "likely" as const,
      note: "Цена и наличие мест не подключены — уточняются у площадки.",
      source: ctx.provider.id,
    });
  },

  async get_venue_live_status(args) {
    const vid = clean(String(args.venueId ?? ""), 20);
    if (!venue(vid)) return err("такой площадки нет в базе");
    // Источник живой посещаемости не подключён. Возвращаем это честно —
    // модель обязана сказать «не знаю», а не придумать толпу.
    return ok({
      venue_id: vid,
      crowd: null,
      music_now: null,
      queue: null,
      verification_status: "unknown" as const,
      note: "Живой статус площадок пока не подключён.",
    });
  },

  async build_night_route(args) {
    const stops = (Array.isArray(args.stops) ? (args.stops as string[]) : [])
      .map((s) => clean(String(s), 20))
      .filter((s) => venue(s))
      .slice(0, 5);
    if (!stops.length) return err("нужен хотя бы один id площадки");
    const startHour = Math.min(23, Math.max(11, Number(args.startHour ?? 19)));
    // Всё время держим в минутах от полуночи — переносы через час и через
    // сутки (после полуночи) считаются сами, без ручного деления с остатком
    // на каждом шаге.
    let totalMin = startHour * 60;
    // Точка отправления: геолокация гостя, если она есть в сессии, — тогда
    // первый перегон тоже настоящий, а не выдуманный «уже на месте».
    const startLat = typeof args.startLat === "number" ? args.startLat : null;
    const startLon = typeof args.startLon === "number" ? args.startLon : null;
    let prevLL: [number, number] | null =
      startLat !== null && startLon !== null ? [startLat, startLon] : null;
    // Средняя скорость передвижения по острову вечером: такси или Grab с
    // учётом трафика, светофоров, посадки-высадки — не трасса и не мотобайк
    // налегке. 26 км/ч — грубая, но честная оценка для Пхукета после заката.
    const SPEED_KMH = 26;
    // Сколько проводят на одной площадке до следующего перегона.
    const dwellMin = Math.min(180, Math.max(30, Number(args.dwellMin ?? 90)));
    let farHop = false;
    const legs = stops.map((vid) => {
      const v = venue(vid)!;
      const s = soundOf(vid);
      const ll = venueLatLon(vid);
      let distanceKm: number | null = null;
      let travelMin: number | null = null;
      if (prevLL && ll) {
        distanceKm = km(prevLL, ll);
        // Минимум 8 минут даже вплотную: не бывает мгновенной пересадки —
        // выйти, дойти до машины, доехать, зайти внутрь.
        travelMin = Math.max(8, Math.round((distanceKm / SPEED_KMH) * 60));
        if (distanceKm > 15) farHop = true;
        totalMin += travelMin;
      }
      const arriveHour = Math.floor(totalMin / 60) % 24;
      const arriveMinute = totalMin % 60;
      const slot = slotAt(vid, arriveHour) ?? primeSlot(vid);
      const leg = {
        venue_id: vid,
        venue: clean(v.name, 60),
        area: clean(v.area, 40),
        arrive_hour: arriveHour,
        arrive_time: `${String(arriveHour).padStart(2, "0")}:${String(arriveMinute).padStart(2, "0")}`,
        distance_km: distanceKm,
        travel_min: travelMin,
        slot_role: slot?.role ?? null,
        bpm: slot?.bpm ?? null,
        energy: slot?.energy ?? null,
        format: s?.label ?? null,
      };
      if (ll) prevLL = ll;
      totalMin += dwellMin;
      return leg;
    });
    return ok({
      legs,
      party_size: Number(args.partySize ?? 2),
      note: farHop
        ? "Между какими-то точками больше 15 км по прямой — закладывай 30-40 минут в дороге и предупреди компанию заранее."
        : null,
      // Транспорт не подключён: маршрут — это порядок и время, а не
      // заказанная машина.
      transport: args.safeTransportOnly
        ? { booked: false, note: "Заказ транспорта пока не подключён — вызовите такси в приложении." }
        : null,
    });
  },

  async ask_gtr(args, ctx) {
    const raw = clean(String(args.question ?? ""), 120);
    const q = qaNorm(raw);
    if (!q) return err("спроси словами — отвечу");
    const items = await qaItems(isTeam(ctx.user?.role), ctx.kv?.get);
    const hit = qaMatch(raw, items);
    if (!hit) {
      // Промах — самый ценный сигнал, какой у продукта есть: гость сам
      // сказал, чего ему не хватает. Раньше вопрос просто терялся, и
      // бэклог обучения пополнялся тем, что кто-то придумал за столом.
      // Теперь он копится из реального спроса, с счётчиком: один раз
      // спросили — случайность, двадцать — дыра в базе знаний.
      await noteMiss(ctx, q, raw);
      return err("такого в базе знаний нет — спроси иначе или уточни вопрос");
    }
    const best = hit.item;
    // Один и тот же ответ дважды подряд — главный признак болванчика.
    // Держим в KV, какой вариант человек уже слышал, и берём следующий.
    const key = ctx.user ? `broqa:${ctx.user.email}:${best.id}` : "";
    let idx = 0;
    if (key && ctx.kv?.get) {
      const prev = Number(await ctx.kv.get(key));
      idx = Number.isFinite(prev) ? (prev + 1) % best.answers.length : 0;
      await ctx.kv.put(key, String(idx), { expirationTtl: 7 * 24 * 3600 });
    }
    return ok({
      topic: best.id,
      tag: best.tag,
      answer: best.answers[idx],
      // Модели: не пересказывай своими словами то, чего тут нет.
      note: "Это готовый ответ из базы знаний GTR. Можешь сказать его своими словами, но фактов не добавляй.",
    });
  },

  async search_venues(args) {
    // База описана по-английски («Beach club», «Kamala»), а спрашивают
    // по-русски. Транслитерация тут не спасает: «пляжный клуб» никогда
    // не станет «beach club», а «Камала» после к→c расходится с Kamala.
    // Поэтому — явные словари, а латинский ввод идёт как есть.
    const DISTRICT_MAP: [RegExp, string[]][] = [
      [/патонг|patong/, ["patong"]],
      [/банг\s*тао|бангтао|лагун|bang\s*tao|laguna|cherng/, ["bang tao", "laguna", "cherng talay"]],
      [/камал|kamala/, ["kamala"]],
      [/карон|karon/, ["karon"]],
      [/ката|kata/, ["kata"]],
      [/сурин|surin/, ["surin"]],
      [/равай|rawai/, ["rawai"]],
      [/най\s*харн|naiharn|nai\s*harn/, ["nai harn"]],
      [/чалонг|chalong/, ["chalong"]],
      [/старый\s*город|таун|old\s*town|phuket\s*town/, ["old town", "phuket town", "town"]],
      [/панва|panwa/, ["panwa"]],
      [/май\s*кхао|mai\s*khao/, ["mai khao"]],
    ];
    const KIND_MAP: [RegExp, string[]][] = [
      [/пляжн[а-яё]*\s*клуб|бич|beach/, ["beach club", "beach"]],
      [/клуб|club/, ["club", "nightclub"]],
      [/бар|pub|паб/, ["bar", "pub"]],
      [/ресторан|поесть|dining|restaurant/, ["restaurant", "dining"]],
      [/лаундж|lounge|rooftop|руфтоп/, ["lounge", "rooftop"]],
    ];
    const MUSIC_MAP: [RegExp, string[]][] = [
      [/техно|techno/, ["techno"]],
      [/хаус|house/, ["house"]],
      [/афро|afro/, ["afro"]],
      [/хип|hip/, ["hip hop", "hip-hop"]],
      [/транс|trance/, ["trance"]],
      [/лайв|живая|live/, ["live"]],
      [/edm|коммерч/, ["edm", "commercial"]],
      [/диско|disco/, ["disco"]],
    ];
    const expand = (raw: string, map: [RegExp, string[]][]): string[] => {
      const low = raw.toLowerCase();
      for (const [re, words] of map) if (re.test(low)) return words;
      // Ввод латиницей — доверяем как есть: база на нём и написана.
      return /[a-z]/.test(low) ? [low] : [];
    };
    const { PH } = await import("../data/app-data");
    const q = args.query ? fold(clean(String(args.query), 60)) : "";
    const districts = args.district ? expand(clean(String(args.district), 40), DISTRICT_MAP) : [];
    const kinds = args.kind ? expand(clean(String(args.kind), 40), KIND_MAP) : [];
    const musics = args.music ? expand(clean(String(args.music), 40), MUSIC_MAP) : [];
    const limit = Math.min(8, Math.max(1, Number(args.limit ?? 5)));

    const out = [];
    for (const v of PH.venues) {
      // Карантинные и закрытые места гостю не показываем: отправить
      // человека в закрытый клуб — это тот же обман, что и выдумка.
      if (v.confidence === "Low" || /closed/i.test(v.status ?? "")) continue;
      const area = `${v.area} ${v.cluster} ${v.district}`.toLowerCase();
      const kindHay = `${v.type} ${v.tag} ${v.concept ?? ""} ${v.facilities ?? ""}`.toLowerCase();
      const musicHay = `${v.music ?? ""} ${v.concept ?? ""} ${v.events ?? ""}`.toLowerCase();
      const all = fold(`${v.name} ${v.type} ${v.area} ${v.concept ?? ""} ${v.music ?? ""}`);
      if (districts.length && !districts.some((d) => area.includes(d))) continue;
      if (kinds.length && !kinds.some((k) => kindHay.includes(k))) continue;
      if (musics.length && !musics.some((m) => musicHay.includes(m))) continue;
      if (q && !all.includes(q)) continue;
      // Релевантность: имя весит больше типа, точный тип — больше
      // случайного упоминания. Без этого «клуб» отдавал пляжные клубы
      // вперёд ночных, а поиск по имени — не то заведение.
      const nameFold = fold(v.name);
      let score = 0;
      if (q && nameFold === q) score += 100;
      else if (q && nameFold.includes(q)) score += 40;
      const typeLow = `${v.type} ${v.tag}`.toLowerCase();
      if (kinds.length && kinds.some((k) => typeLow.includes(k))) score += 20;
      // «клуб» без слова «пляж» — человек просит ночной клуб.
      if (kinds.includes("club") && !kinds.includes("beach club")) {
        if (/nightclub|night club/.test(typeLow)) score += 15;
        if (/beach/.test(typeLow)) score -= 10;
      }
      if (musics.length && musics.some((m) => musicHay.includes(m))) score += 10;
      score += Math.round((v.readiness?.score ?? 0) / 20);
      out.push({
        score,
        venue_id: v.id,
        name: clean(v.name, 60),
        type: clean(v.type, 60),
        area: clean(v.area, 40),
        music: clean(v.music ?? "", 80),
        about: clean(v.concept ?? "", 140),
        // Что гость может сделать здесь прямо сейчас.
        table_booking: venueHasReserve(v.id) ? "схема залов и столов" : "заявка через GTR",
        // Меню бывает и без рассадки — SHAMAN и CLC отдают прайс, но не столы.
        menu: Boolean(menuVenues().find((m) => m.vid === v.id)),
      });
    }
    if (!out.length)
      return err("по этим приметам в базе пусто — попробуй другой район или тип места");
    out.sort((a, b) => b.score - a.score);
    const venues = out.slice(0, limit).map(({ score: _s, ...rest }) => rest);
    return ok({ venues, total: out.length, source: "gtr-base" });
  },

  async get_venue_profile(args, ctx) {
    const q = clean(String(args.venue ?? ""), 60);
    // Ищем по всем площадкам тем же матчером, что и афиша.
    const { PH } = await import("../data/app-data");
    const hit = PH.venues.find((v) => venueMatch(v.name, q));
    if (!hit) return err("такой площадки в базе нет — уточни название");
    const sound = soundOf(hit.id);
    const rich = richOf(hit.id);
    // Часы, вход и чем место берёт. Данные собраны руками и лежат в
    // репозитории — но до сих пор не доходили до BRO вовсе, и на «во
    // сколько открывается» он не мог ответить даже там, где мы знаем.
    const night = nightOf(hit.id);
    const rate = (ratesRaw as { venueId: string; amount: number; unit: string; currency: string; covers: string; kind: string }[]).find(
      (r) => r.venueId === hit.id,
    );
    // Контакты — только команде: посетителю телефоны площадок не отдаём.
    const teamRole = ctx.user && ["gtr", "organizer", "pr", "owner", "sales"].includes(ctx.user.role);
    // Полная база с контактами живёт отдельным серверным модулем и
    // подгружается только тогда, когда контакт реально положен по роли.
    const contact = teamRole ? await (await import("../data/private-data")).venueContact(hit.id) : undefined;
    return ok({
      venue_id: hit.id,
      name: clean(hit.name, 60),
      area: clean(hit.area, 40),
      type: clean(hit.type ?? "", 40),
      concept: clean(hit.concept ?? "", 160),
      music: clean(hit.music ?? "", 120),
      capacity: hit.capacity ?? null,
      website: hit.website ?? null,
      format: sound?.label ?? null,
      audience: sound?.audience ?? null,
      slots: sound?.slots.map((sl) => ({ role: sl.role, from: sl.from, to: sl.to, bpm: sl.bpm })) ?? [],
      genres: genreIdsOfVenue(hit.id).map((g) => genreName(g, "ru")),
      // Прайс с честным происхождением: оценка GTR — не подтверждение.
      rate: rate
        ? { amount: rate.amount, unit: rate.unit, currency: rate.currency, covers: clean(rate.covers, 80), status: rate.kind }
        : null,
      // null, а не пустая строка: модель обязана увидеть разницу между
      // «работает круглосуточно» и «мы не знаем» — во втором случае она
      // должна сказать это вслух, а не промолчать.
      hours: night.hours || null,
      entry: night.entry || null,
      best: night.best || null,
      fact: night.fact || null,
      contact: contact ? { name: clean(contact.name ?? "", 60), phone: contact.phone ?? null } : null,
      photo: rich.hero ?? null,
    });
  },

  async find_artists(args, ctx) {
    const q = args.query ? fold(clean(String(args.query), 60)) : "";
    const wantGenre = args.genre ? clean(String(args.genre), 40).toLowerCase() : "";
    const limit = Math.min(8, Math.max(1, Number(args.limit ?? 5)));
    // В профилях лежат id из жанрового дерева — наружу отдаём русские
    // имена, а ищем и по имени, и по id.
    const styles = artistStylesRaw as Record<string, { ids?: string[] }>;
    const arts = (artistsRaw as { artists: { id: string; name: string; cat?: string; role?: string; base?: string; status?: string; email?: string; phone?: string; ig?: string }[] }).artists;
    const teamRole = ctx.user && ["gtr", "organizer", "pr", "owner", "sales"].includes(ctx.user.role);
    const out = [];
    for (const a of arts) {
      const ids = styles[a.id]?.ids ?? [];
      const st = ids.map((x) => genreName(x, "ru").toLowerCase());
      if (q && !fold(a.name).includes(q)) continue;
      if (
        wantGenre &&
        !st.some((x) => x.includes(wantGenre)) &&
        !ids.some((x) => x.includes(fold(wantGenre))) &&
        !String(a.role ?? "").toLowerCase().includes(wantGenre)
      )
        continue;
      out.push({
        artist_id: a.id,
        name: clean(a.name, 60),
        role: clean(a.role ?? a.cat ?? "", 90),
        base: clean(a.base ?? "", 40),
        styles: st.slice(0, 4),
        booking: clean(a.status ?? "", 60),
        // Прямые контакты — только команде.
        contact: teamRole ? { email: a.email || null, ig: a.ig || null } : null,
      });
      if (out.length >= limit) break;
    }
    if (!out.length) return err("в базе никого не нашёл — попробуй другое имя или жанр");
    return ok({ artists: out, total: out.length });
  },

  async search_vendors(args, ctx) {
    if (!isTeam(ctx.user?.role))
      return err("каталог подрядчиков — рабочий инструмент команды GTR");
    const q = args.query ? fold(clean(String(args.query), 60)) : "";
    const limit = Math.min(10, Math.max(1, Number(args.limit ?? 6)));
    type Eq = { group: string; name: string; spec?: string; price: number; unit: string; currency: string; vendor: string; contact?: string; kind?: string };
    type Pk = { vendor: string; contact?: string; system: string; package: string; price: number; unit: string };
    const items: { vendor: string; contact: string | null; item: string; detail: string; price: number | null; unit: string }[] = [];
    for (const e of equipmentRaw as Eq[]) {
      const hay = fold(`${e.group} ${e.name} ${e.spec ?? ""} ${e.vendor}`);
      if (q && !hay.includes(q)) continue;
      items.push({
        vendor: e.vendor,
        contact: e.contact ?? null,
        item: clean(`${e.group}: ${e.name}`, 80),
        detail: clean(e.spec ?? "", 90),
        // Цена 0 в каталоге значит «по запросу» — нулём её отдавать нельзя.
        price: e.price > 0 ? e.price : null,
        unit: e.price > 0 ? `${e.currency}/${e.unit}` : "по запросу",
      });
    }
    for (const pk of packagesRaw as Pk[]) {
      const hay = fold(`${pk.system} ${pk.package} ${pk.vendor}`);
      if (q && !hay.includes(q)) continue;
      items.push({
        vendor: pk.vendor,
        contact: pk.contact ?? null,
        item: clean(`${pk.system}: ${pk.package}`, 80),
        detail: "",
        price: pk.price > 0 ? pk.price : null,
        unit: pk.price > 0 ? `THB/${pk.unit}` : "по запросу",
      });
    }
    if (!items.length) return err("в каталоге такого нет — попробуй другими словами: звук, LED, DJ");
    return ok({ items: items.slice(0, limit), total: items.length });
  },

  async create_event_draft(args, ctx) {
    // Пишущий инструмент: сюда он попадает только после подтверждения в
    // интерфейсе — граница живёт в клиенте и в текстовом маршрутизаторе.
    if (!ctx.user || !ctx.kv) return err("создание события недоступно без входа");
    if (!["gtr", "organizer", "pr", "owner", "sales"].includes(ctx.user.role))
      return err("создавать события могут организаторы и команда GTR");
    const q = clean(String(args.venue ?? ""), 60);
    const { PH } = await import("../data/app-data");
    const hit = PH.venues.find((v) => venueMatch(v.name, q));
    if (!hit) return err("площадка не найдена — уточни название");
    const dateIso = String(args.dateIso ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return err("нужна дата в формате ГГГГ-ММ-ДД");
    const title = clean(String(args.title ?? ""), 80) || "Событие GTR";
    const id = `EV-${Date.now().toString(36).toUpperCase()}`;
    const draft: EventDraft = {
      id,
      venueId: hit.id,
      title,
      format: clean(String(args.format ?? "Клубная ночь"), 60),
      guests: clean(String(args.guests ?? ""), 20),
      date: dateIso,
      dateIso,
      author: ctx.user.name,
      owner: ctx.user.email,
      created: Date.now(),
      updated: Date.now(),
      // Граф собирает тот же генератор, что и конструктор — черновик
      // сразу открывается в нём полноценной схемой площадки.
      graph: venueGraph(hit.id),
      brief: {},
    };
    await ctx.kv.put(`draft:${id}`, JSON.stringify(draft));
    return ok({
      event_id: id,
      venue: clean(hit.name, 60),
      venue_id: hit.id,
      date: dateIso,
      title,
      note: "Черновик создан — открой конструктор, чтобы наполнить.",
    });
  },

  async call_taxi(args) {
    const q = clean(String(args.venue ?? ""), 60);
    const { PH } = await import("../data/app-data");
    const hit = PH.venues.find((v) => venueMatch(v.name, q));
    if (!hit) return err("не понял, куда ехать — назови площадку из базы");
    const g = GEO[hit.id];
    if (!g) return err("у площадки нет координат в базе");
    // Ссылки с точкой назначения: заказ подтверждает сам человек в
    // приложении такси — мы маршрут собираем, а не деньги тратим.
    return ok({
      venue: clean(hit.name, 60),
      venue_id: hit.id,
      area: clean(hit.area, 40),
      lat: g.lat,
      lon: g.lon,
      grab: `https://grab.onelink.me/2695613898?af_dp=${encodeURIComponent(`grab://open?screenType=BOOKING&dropOffLatitude=${g.lat}&dropOffLongitude=${g.lon}`)}`,
      bolt: `https://bolt.onelink.me/8XM1?af_dp=${encodeURIComponent(`bolt://action/rideRequest?destination_lat=${g.lat}&destination_lng=${g.lon}`)}`,
      maps: `https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lon}&travelmode=driving`,
      note: "Открой Grab или Bolt — точка назначения уже стоит, заказ подтверждаешь сам.",
    });
  },

  async send_telegram(args, ctx) {
    if (!ctx.user || !ctx.tgSend) return err("отправка недоступна без входа");
    const target = args.target === "chat" ? "chat" : "boss";
    // Чат сообщества — рупор: писать туда голосом могут только команда и
    // организаторы. Сообщение команде GTR доступно всем — это канал заявок.
    if (target === "chat" && !["gtr", "organizer"].includes(ctx.user.role))
      return err("в чат сообщества пишет только команда GTR");
    const text = clean(String(args.text ?? ""), 500);
    if (text.length < 3) return err("нечего отправлять — продиктуй текст");
    const sent = await ctx.tgSend(target, `${text}\n\n— ${ctx.user.name} через GTR BRO`);
    if (!sent) return err("Telegram не принял сообщение", true);
    return ok({ target, delivered: true, note: target === "boss" ? "Ушло команде GTR." : "Ушло в чат сообщества." });
  },

  async open_music(args) {
    const q = fold(clean(String(args.artist ?? ""), 60));
    if (!q) return err("назови артиста, чью музыку включить");
    type Art = { id: string; name: string; sp?: string; sc?: string; yt?: string };
    const arts = (artistsRaw as { artists: Art[] }).artists;
    const hit =
      arts.find((a) => fold(a.name) === q) ??
      arts.find((a) => fold(a.name).includes(q) || q.includes(fold(a.name)));
    if (!hit) return err("такого артиста в базе GTR нет — назови иначе");
    const want = String(args.source ?? "any");

    // Прямая ссылка и поисковая выдача — разные вещи. Человек просит
    // «включи» и ждёт, что заиграет, а не что откроется список чужих
    // роликов. Поэтому прямые ссылки идут первыми и помечены честно.
    const isSearch = (u: string) => /\/results\?|\/search(\?|\/|$)|open\.spotify\.com\/search/.test(u);
    const player = (artistPlayersRaw as Record<string, { kind: string; ref: string } | undefined>)[hit.id];
    const cand: { source: string; label: string; url?: string }[] = [
      { source: "youtube", label: "Сет на YouTube", url: hit.yt },
      // Плеер — результат офлайн-резолва по точному имени, он всегда прямой.
      player?.kind === "spotify"
        ? { source: "spotify", label: "Профиль в Spotify", url: `https://open.spotify.com/artist/${player.ref}` }
        : { source: "spotify", label: "Треки в Spotify", url: hit.sp },
      player?.kind === "deezer"
        ? { source: "deezer", label: "Треки на Deezer", url: `https://www.deezer.com/artist/${player.ref}` }
        : { source: "deezer", label: "", url: undefined },
      player?.kind === "sc"
        ? { source: "soundcloud", label: "Профиль на SoundCloud", url: player.ref }
        : { source: "soundcloud", label: "Микстейпы на SoundCloud", url: hit.sc },
      player?.kind === "mixcloud"
        ? { source: "mixcloud", label: "Микстейпы на Mixcloud", url: `https://www.mixcloud.com${player.ref}` }
        : { source: "mixcloud", label: "", url: undefined },
    ];
    const links = cand
      .filter((l): l is { source: string; label: string; url: string } => Boolean(l.url && l.label))
      .map((l) => ({
        ...l,
        direct: !isSearch(l.url),
        label: isSearch(l.url) ? l.label.replace(/^(Сет|Треки|Профиль|Микстейпы)/, "Поиск —") : l.label,
      }))
      .sort((a, b) => Number(b.direct) - Number(a.direct));
    if (!links.length) return err("у этого артиста в базе нет ссылок на музыку");
    // Просили конкретный сервис — отдаём его, но прямую ссылку предпочитаем
    // поисковой даже внутри одного сервиса.
    const primary =
      links.find((l) => l.source === want && l.direct) ??
      links.find((l) => l.source === want) ??
      links[0];
    return ok({
      artist_id: hit.id,
      artist: clean(hit.name, 60),
      open: primary,
      links,
      direct: primary.direct,
      note: primary.direct
        ? "Ссылка ведёт прямо на музыку — открывается снаружи, в приложении сервиса."
        : "Прямой ссылки у этого артиста пока нет — это поиск по сервису. Так и скажи.",
    });
  },

  async get_artist_profile(args, ctx) {
    const q = fold(clean(String(args.artist ?? ""), 60));
    if (!q) return err("назови имя артиста");
    type Art = {
      id: string; name: string; cat?: string; role?: string; base?: string;
      status?: string; tier?: string; bio?: string; venue?: string; rel?: string;
      evidence?: string; notes?: string; sp?: string; sc?: string; yt?: string;
      email?: string; ig?: string; web?: string; labels?: string[];
    };
    const arts = (artistsRaw as { artists: Art[] }).artists;
    const hit =
      arts.find((a) => fold(a.name) === q) ??
      arts.find((a) => fold(a.name).includes(q) || q.includes(fold(a.name)));
    if (!hit) return err("такого в базе GTR нет — назови иначе или спроси find_artists");
    const styles = artistStylesRaw as Record<string, { ids?: string[] }>;
    const st = (styles[hit.id]?.ids ?? []).map((x) => genreName(x, "ru"));
    const teamRole = ctx.user && ["gtr", "organizer", "pr", "owner", "sales"].includes(ctx.user.role);
    // Послужной список: то, что реально записано в базе. Придумывать
    // артисту резиденции и релизы нельзя — это живые люди.
    const track = [
      hit.tier && clean(hit.tier, 60),
      hit.venue && `резиденция: ${clean(hit.venue, 60)}`,
      hit.rel && clean(hit.rel, 80),
      hit.evidence && clean(hit.evidence, 160),
    ].filter(Boolean);
    const labelNames = (hit.labels ?? [])
      .map((lid) => (labelLogosRaw as Record<string, { name?: string }>)[lid]?.name)
      .filter((x): x is string => Boolean(x));
    return ok({
      artist_id: hit.id,
      name: clean(hit.name, 60),
      role: clean(hit.role ?? hit.cat ?? "", 120),
      base: clean(hit.base ?? "", 40),
      styles: st.slice(0, 6),
      bio: hit.bio ? clean(hit.bio, 400) : null,
      track_record: track,
      labels: labelNames.length ? labelNames : null,
      booking: teamRole ? clean(hit.status ?? "", 60) : null,
      listen: {
        spotify: hit.sp || null,
        soundcloud: hit.sc || null,
        youtube: hit.yt || null,
        site: hit.web || null,
      },
      note: "Ссылки открываются наружу. Профиль внутри платформы — open_in_app с route=artists.",
    });
  },

  async get_venue_zones(args) {
    const q = clean(String(args.venue ?? ""), 60);
    const clcName = clcReserveRaw.meta.venueName;
    if (venueMatch(clcName, q)) {
      const clcTables = clcReserveRaw.tables as Array<{
        id: string; zone: string; name: string; ru: string; pax: number; minPax?: number;
        bookable: boolean; minHours?: number; from?: string; rateBefore22?: number;
        rateAfter22?: number; requestNote?: string;
      }>;
      return ok({
        venue: clcName,
        venue_id: clcReserveRaw.meta.venueId,
        zones: clcReserveRaw.zones.map((z) => ({
          zone: z.name,
          ru: z.ru,
          hours: z.hours,
          about: z.desc,
          tables: clcTables
            .filter((tb) => tb.zone === z.id)
            .map((tb) => ({
              table: tb.name,
              pax: tb.pax,
              min_pax: tb.minPax ?? null,
              bookable: tb.bookable,
              rate_before_22_thb: tb.rateBefore22 ?? null,
              rate_after_22_thb: tb.rateAfter22 ?? null,
              min_hours: tb.minHours ?? null,
              from: tb.from ?? null,
              note: tb.requestNote ?? null,
            })),
        })),
        note: clcReserveRaw.meta.notes,
      });
    }
    // Площадку ищем по всему реестру рассадок, а не по одному имени:
    // список растёт данными, а не правкой этого файла. CLC выше — особый
    // случай: почасовая аренда, обычной ReserveTable не описывается.
    const all = reserveVenues();
    const hit = all.find((r) => venueMatch(r.venueName, q));
    if (!hit)
      return err(
        `полная рассадка пока есть у: ${clcName}, ${all.map((r) => r.venueName).join(", ")} — для остальных площадок бронь через общую заявку`,
      );
    const cdmVid = hit.vid;
    const cdmName = hit.venueName;
    const cdmReserveRaw = hit.reserve;
    const tables = cdmReserveRaw.tables;
    return ok({
      venue: cdmName,
      venue_id: cdmVid,
      zones: cdmReserveRaw.zones.map((z) => ({
        zone: z.name,
        ru: z.ru,
        hours: z.hours,
        arrival: z.arrival,
        about: z.desc,
        tables: tables
          .filter((tb) => tb.zone === z.id)
          .map((tb) => ({
            table: tb.name,
            pax: tb.pax,
            deposit_thb: tb.deposit,
            fnb_credit_thb: tb.credit,
            per_person: Boolean(tb.perPerson),
            slots: tb.slots,
          })),
      })),
      note: "Депозит зачитывается кредитом на еду и напитки. Бронь через book_table.",
    });
  },

  async get_menu(args) {
    const q = args.query ? fold(clean(String(args.query), 60)) : "";
    // Кириллическое «к» транслитерируется в c, а половина названий в меню
    // пишется через k или ch («паккери» → pacceri vs paccheri) — сравниваем
    // грубую форму: c→k, немое h долой.
    const rough = (s: string) => s.replace(/c/g, "k").replace(/h/g, "");
    const qk = rough(q);
    const hitQ = (hay: string) => !q || hay.includes(q) || rough(hay).includes(qk);
    const wantSec = args.section ? String(args.section) : "";
    const limit = Math.min(20, Math.max(1, Number(args.limit ?? 10)));
    // Меню площадок под одним инструментом: у каждой свой прайс и свои
    // правила про налоги — примечание обязано ехать вместе с ценами,
    // иначе BRO назовёт сумму, которой в счёте не окажется. Список берём
    // из реестра коммерции — подключение новой площадки данными сразу
    // открывает её меню здесь, без правки этого файла.
    type MenuFile = {
      meta: { venueName?: string; note?: string };
      sections: {
        id: string;
        groups: { name: string; ru?: string; items: unknown[] }[];
      }[];
    };
    const MENUS: { file: MenuFile; venueName: string; note: string }[] = menuVenues().map(
      (m) => ({ file: m.menu as unknown as MenuFile, venueName: m.venueName, note: m.note }),
    );
    const wantVenue = clean(String(args.venue ?? ""), 60);
    const menus = wantVenue ? MENUS.filter((m) => venueMatch(m.venueName, wantVenue)) : MENUS;
    if (!menus.length)
      return err(`меню с ценами есть у: ${MENUS.map((m) => m.venueName).join(", ")} — по другим площадкам зови get_venue_profile`);
    const multi = menus.length > 1;
    const out: {
      item: string; group: string; price_thb: number;
      venue?: string; options?: string; about?: string;
    }[] = [];
    for (const m of menus) {
      for (const sec of m.file.sections) {
        if (wantSec && sec.id !== wantSec) continue;
        for (const g of sec.groups) {
          for (const it of g.items as Array<{
            name: string; price: number; desc?: string; unit?: string;
            opts?: { l: string; p: number }[];
          }>) {
            if (!hitQ(fold(`${g.name} ${g.ru ?? ""} ${it.name} ${it.desc ?? ""}`)))
              continue;
            out.push({
              item: it.name,
              group: g.name,
              price_thb: it.price,
              venue: multi ? m.venueName : undefined,
              options: it.opts?.map((o) => `${o.l} ${o.p}`).join(" · "),
              about: it.desc ? clean(it.desc, 120) : undefined,
            });
            if (out.length >= limit) break;
          }
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    if (!out.length)
      return err(
        multi
          ? `такого не нашёл ни в одном из меню (${menus.map((m) => m.venueName).join(", ")}) — спроси иначе или назови категорию`
          : `в меню ${menus[0].venueName} такого не нашёл — спроси иначе или назови категорию`,
      );
    return ok({
      venue: multi ? menus.map((m) => m.venueName).join(" и ") : menus[0].venueName,
      items: out,
      currency: "THB",
      note: multi ? menus.map((m) => `${m.venueName}: ${m.note}`).join(" ") : menus[0].note,
    });
  },

  async book_table(args, ctx) {
    // Пишущий инструмент: исполняется только после подтверждения кнопкой.
    if (!ctx.user || !ctx.book) return err("бронь недоступна без входа");
    const q = clean(String(args.venue ?? ""), 60);
    if (venueMatch(clcReserveRaw.meta.venueName, q)) {
      const clcTables = clcReserveRaw.tables as Array<{
        id: string; zone: string; name: string; ru: string; pax: number; minPax?: number;
        bookable: boolean; minHours?: number; from?: string; rateBefore22?: number;
        rateAfter22?: number; requestNote?: string;
      }>;
      const wantTable = fold(clean(String(args.table ?? ""), 60));
      const table =
        clcTables.find((tb) => fold(tb.name) === wantTable) ??
        clcTables.find((tb) => venueMatch(tb.name, wantTable));
      if (!table) return err("такого зала в CLC нет — сверься с get_venue_zones");
      if (!table.bookable) return err(table.requestNote ?? "цена по запросу — свяжитесь с площадкой напрямую");
      const zone = clcReserveRaw.zones.find((z) => z.id === table.zone);
      const dateIso = String(args.dateIso ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return err("нужна дата в формате ГГГГ-ММ-ДД");
      const minHours = table.minHours ?? 1;
      const guests = Math.max(1, Math.min(table.pax, Math.round(Number(args.guests ?? 2)) || 2));
      if (table.minPax && guests < table.minPax) return err(`минимум ${table.minPax} гостей для этого зала`);
      const hours = Math.max(minHours, Math.round(Number(args.hours ?? minHours)) || minHours);
      const slot = clean(String(args.slot ?? table.from ?? "18:00"), 5);
      if (!/^\d{1,2}:\d{2}$/.test(slot)) return err("нужно время начала в формате ЧЧ:ММ");
      const startHour = Number(slot.split(":")[0]);
      // Тариф меняется в 22:00 — считаем по часам, каждый час своей ставкой.
      const afterMidnight = (h: number) => h >= 22 || h < 18;
      let deposit = 0;
      for (let i = 0; i < hours; i++) {
        const h = (startHour + i) % 24;
        deposit += afterMidnight(h) ? (table.rateAfter22 ?? table.rateBefore22 ?? 0) : (table.rateBefore22 ?? 0);
      }
      const phone = clean(String(args.phone ?? ""), 40);
      if (!phone) return err("нужен телефон гостя — спроси и повтори");
      const r = await ctx.book({
        vid: clcReserveRaw.meta.venueId,
        dateIso,
        guests,
        name: ctx.user.name,
        phone,
        note: args.note ? clean(String(args.note), 300) : undefined,
        zone: zone?.name,
        tableType: table.name,
        slot: `${slot} · ${hours} ч`,
        deposit,
      });
      if (!r.ok) return err(r.reason ?? "бронь не прошла", true);
      return ok({
        booking_id: r.id,
        venue: clcReserveRaw.meta.venueName,
        zone: zone?.name,
        table: table.name,
        date: dateIso,
        slot,
        hours,
        guests,
        deposit_thb: deposit,
        note: "Заявка ушла менеджеру площадки и команде GTR — подтверждение придёт в Telegram и в «Мои брони».",
      });
    }
    // Площадки без карты столов. Раньше здесь стоял отказ, и BRO разводил
    // руками по 107 заведениям из 110: карта залов есть только у трёх.
    //
    // Стол мы им действительно не выберем — схемы нет. Но заявку принять
    // можем: она ложится в тот же журнал и уходит тем же телеграмом с
    // кнопками, что и обычная бронь, а дальше человек звонит гостю.
    // «Передал, перезвонят» — это работающий консьерж; «не умею» — нет.
    //
    // Ни слова про подтверждённый стол в ответе: заявка и бронь — разные
    // вещи, и гость, приехавший на несуществующую бронь, не простит.
    // Реестр рассадок: тот же список, что и в get_venue_zones — подключение
    // новой площадки данными сразу открывает и просмотр столов, и саму бронь.
    const reserveHit = reserveVenues().find((r) => venueMatch(r.venueName, q));
    if (!reserveHit) {
      const { PH } = await import("../data/app-data");
      const hit = PH.venues.find((v) => venueMatch(v.name, q));
      if (!hit) return err("такой площадки в базе нет — уточни название");
      const dateIso = String(args.dateIso ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return err("нужна дата в формате ГГГГ-ММ-ДД");
      const phone = clean(String(args.phone ?? ""), 40);
      if (!phone) return err("нужен телефон гостя — спроси и повтори");
      const guests = Math.max(1, Math.min(100, Math.round(Number(args.guests ?? 2)) || 2));
      // Пожелание про зал не теряем: схемы нет, но менеджеру эта строка
      // говорит ровно то, что нужно — куда гость хочет сесть.
      const wish = clean(String(args.table ?? ""), 60);
      const slot = clean(String(args.slot ?? ""), 5);
      const note = [
        wish ? `пожелание по залу: ${wish}` : "",
        slot ? `время: ${slot}` : "",
        args.note ? clean(String(args.note), 300) : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 300);
      const r = await ctx.book({
        vid: hit.id,
        dateIso,
        guests,
        name: ctx.user.name,
        phone,
        note: note || undefined,
      });
      if (!r.ok) return err(r.reason ?? "заявка не прошла", true);
      return ok({
        request_id: r.id,
        venue: hit.name,
        date: dateIso,
        guests,
        status: "заявка передана, стол пока НЕ забронирован",
        note:
          "Схемы столов у этой площадки нет, поэтому это заявка, а не бронь. " +
          "Менеджер свяжется по указанному телефону и подтвердит. " +
          "Скажи гостю именно так — не обещай готовый стол.",
      });
    }
    const cdmReserveRaw = reserveHit;
    const tables = cdmReserveRaw.reserve.tables;
    const wantTable = fold(clean(String(args.table ?? ""), 60));
    const table =
      tables.find((tb) => fold(tb.name) === wantTable) ??
      tables.find((tb) => venueMatch(tb.name, wantTable));
    if (!table) return err("такого стола нет — сверься с get_venue_zones");
    const zone = cdmReserveRaw.reserve.zones.find((z) => z.id === table.zone);
    const dateIso = String(args.dateIso ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return err("нужна дата в формате ГГГГ-ММ-ДД");
    const zDays = (zone as { days?: number[] } | undefined)?.days;
    if (zDays && !zDays.includes(new Date(`${dateIso}T12:00:00Z`).getUTCDay()))
      return err("Club Room работает только со среды по субботу — предложи другую дату");
    const guests = Math.max(1, Math.min(table.pax + (table.extraPax ?? 0), Math.round(Number(args.guests ?? 2)) || 2));
    const slot = clean(String(args.slot ?? table.slots[0] ?? ""), 10);
    if (!table.slots.includes(slot))
      return err(`у этого стола слоты: ${table.slots.join(", ")}`);
    // предзаказ резолвим по точным названиям из меню — цену модель не диктует.
    // Меню — той же площадки, что и стол: предзаказ по чужому прайсу ушёл бы
    // менеджеру суммой, которой в его счёте не существует.
    const menuItems: Array<{ id: string; name: string; price: number; opts?: { l: string; p: number }[] }> = [];
    for (const sec of menuVenues().find((m) => m.vid === cdmReserveRaw.vid)?.menu.sections ?? [])
      for (const g of sec.groups) menuItems.push(...(g.items as typeof menuItems));
    const preorder: { id: string; name: string; opt?: string; qty: number; price: number }[] = [];
    for (const raw of Array.isArray(args.preorder) ? (args.preorder as Array<Record<string, unknown>>).slice(0, 20) : []) {
      // Только точное имя или имя-с-запасом («Aperol Spritz» найдёт
      // «Aperol Spritz · 7L»). Обратное включение запрещено: длинная
      // мусорная строка от модели не должна цеплять короткую позицию.
      const wname = fold(clean(String(raw.item ?? ""), 80));
      const wk = wname.replace(/c/g, "k");
      const hit =
        menuItems.find((it) => fold(it.name) === wname) ??
        menuItems.find((it) => {
          const n = fold(it.name);
          return n.includes(wname) || n.replace(/c/g, "k").includes(wk);
        });
      if (!hit) return err(`«${clean(String(raw.item ?? ""), 40)}» в меню нет — проверь через get_menu`);
      const opt = raw.opt ? hit.opts?.find((o) => fold(o.l) === fold(String(raw.opt))) : undefined;
      preorder.push({
        id: hit.id,
        name: hit.name,
        opt: opt?.l,
        qty: Math.max(1, Math.min(99, Math.round(Number(raw.qty ?? 1)) || 1)),
        price: opt ? opt.p : hit.price,
      });
    }
    const phone = clean(String(args.phone ?? ""), 40);
    if (!phone) return err("нужен телефон гостя — спроси и повтори");
    const r = await ctx.book({
      vid: cdmReserveRaw.vid,
      dateIso,
      guests,
      name: ctx.user.name,
      phone,
      note: args.note ? clean(String(args.note), 300) : undefined,
      zone: zone?.name,
      tableType: table.name,
      slot,
      deposit: table.perPerson ? table.deposit * guests : table.deposit,
      // Кредит на еду есть не у каждого стола — иначе в заявку уедет NaN.
      credit: table.perPerson ? (table.credit ?? 0) * guests : table.credit,
      preorder: preorder.length ? preorder : undefined,
    });
    if (!r.ok) return err(r.reason ?? "бронь не прошла", true);
    return ok({
      booking_id: r.id,
      venue: cdmReserveRaw.venueName,
      zone: zone?.name,
      table: table.name,
      date: dateIso,
      slot,
      guests,
      deposit_thb: table.perPerson ? table.deposit * guests : table.deposit,
      preorder_total_thb: preorder.reduce((s, l) => s + l.price * l.qty, 0) || undefined,
      note: "Заявка ушла менеджеру площадки и команде GTR — подтверждение придёт в Telegram и в «Мои брони».",
    });
  },

  async open_in_app(args, ctx) {
    const route = String(args.route ?? "");
    const allowed = [
      "tonight", "map", "venueCard", "artists", "calendar", "promo", "aimatch",
      "base", "community", "events", "constructor", "vendors", "dash",
    ];
    if (!allowed.includes(route)) return err("неизвестный экран");
    // Рабочие экраны — только команде: гостю там нечего делать, и
    // показывать ему кухню продукта мы не будем.
    if (TEAM_ONLY_ROUTES.includes(route) && !isTeam(ctx.user?.role))
      return err("этот экран для команды GTR — гостю он не нужен");
    const entityId = args.entityId ? clean(String(args.entityId), 40) : undefined;
    if (route === "venueCard" && (!entityId || !venue(entityId.split(":")[0])))
      return err("для карточки площадки нужен её id");
    return ok({ route, entityId: entityId?.split(":")[0] });
  },

  // ------------------------------------------------- рабочий контур GTR
  //
  // Дальше — инструменты команды. Гость их не видит вовсе (TEAM_ONLY_TOOLS),
  // но проверка роли стоит и здесь: список инструментов приходит от модели,
  // а на роль полагается опираться там, где действие исполняется.

  async artist_pull(args, ctx) {
    if (!isTeam(ctx.user?.role)) return err("это рабочий инструмент команды GTR");
    const q = fold(clean(String(args.artist ?? ""), 60));
    if (!q) return err("назови артиста");
    type Art = {
      id: string; name: string; tier?: string; prio?: string; verified?: string;
      styles?: string[]; sp?: string; sc?: string; yt?: string;
    };
    const arts = (artistsRaw as { artists: Art[] }).artists;
    const hit =
      arts.find((a) => fold(a.name) === q) ??
      arts.find((a) => fold(a.name).includes(q) || q.includes(fold(a.name)));
    if (!hit) return err("такого артиста в базе GTR нет");

    // Слушатели берутся живьём из Deezer (публичный API, ключа не требует)
    // и лежат в KV неделю: цифра меняется медленно, а бюджет запросов у
    // воркера общий на всех.
    const player = (artistPlayersRaw as Record<string, { kind: string; ref: string } | undefined>)[hit.id];
    let fans: number | null = null;
    if (player?.kind === "deezer") {
      const key = `pull:dz:${player.ref}`;
      const cached = ctx.kv?.get ? await ctx.kv.get(key).catch(() => null) : null;
      if (cached !== null && cached !== undefined && cached !== "") fans = Number(cached);
      else {
        try {
          const r = await fetch(`https://api.deezer.com/artist/${player.ref}`, {
            signal: AbortSignal.timeout(4000),
          });
          const d = (await r.json()) as { nb_fan?: number };
          if (typeof d.nb_fan === "number") {
            fans = d.nb_fan;
            await ctx.kv?.put(key, String(fans), { expirationTtl: 7 * 24 * 3600 }).catch(() => {});
          }
        } catch {
          // Deezer не ответил — считаем без цифрового следа и скажем об этом.
        }
      }
    }

    const isSearch = (u?: string) => !u || /\/results\?|\/search(\?|\/|$)|open\.spotify\.com\/search/.test(u);
    const directLinks =
      (player ? 1 : 0) + (isSearch(hit.yt) ? 0 : 1) + (isSearch(hit.sp) ? 0 : 1) + (isSearch(hit.sc) ? 0 : 1);

    // Сколько площадок острова совпадают с артистом по звуку — это и есть
    // его рабочая ёмкость на Пхукете, а не абстрактная популярность.
    const styles = ((artistStylesRaw as Record<string, { ids?: string[] }>)[hit.id]?.ids ?? []).slice(0, 4);
    let venuesFit = 0;
    if (styles.length) {
      const { PH } = await import("../data/app-data");
      for (const v of PH.venues) {
        const ids = genreIdsOfVenue(v.id);
        if (ids.some((g) => styles.includes(g))) venuesFit += 1;
      }
    }

    const out = pullScore({
      fans,
      tier: hit.tier,
      prio: hit.prio,
      verified: String(hit.verified ?? "").toLowerCase() === "yes" || hit.verified === "true",
      directLinks,
      venuesFit,
    });
    return ok({
      artist_id: hit.id,
      artist: clean(hit.name, 60),
      score: out.score,
      band: out.band,
      parts: out.parts,
      fans,
      venues_fit: venuesFit,
      note: "Тяга — это оценка по нашим данным, а не билеты. Слушатели в стриминге не равны гостям на входе: на острове решают день, сезон и промо.",
    });
  },

  async forecast_attendance(args, ctx) {
    if (!isTeam(ctx.user?.role)) return err("это рабочий инструмент команды GTR");
    const date = String(args.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("нужна дата в формате ГГГГ-ММ-ДД");
    const q = clean(String(args.venue ?? ""), 60);
    const { PH } = await import("../data/app-data");
    const hit = PH.venues.find((v) => venueMatch(v.name, q));
    if (!hit) return err("такой площадки в базе нет — уточни название");
    const capacity = capacityOf(hit.capacity);
    if (!capacity) return err("у этой площадки в базе не записана вместимость — без неё прогноз будет выдумкой");

    // Тяга артиста — тем же инструментом, что и отдельно: два разных
    // ответа про одного человека в одном продукте недопустимы.
    let pull: number | undefined;
    let artistName: string | undefined;
    if (args.artist) {
      const r = await handlers.artist_pull({ artist: args.artist }, ctx);
      if (r.ok) {
        const d = r.data as { score: number; artist: string };
        pull = d.score;
        artistName = d.artist;
      }
    }

    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const out = forecast({
      capacity,
      type: hit.type ?? "",
      tag: hit.tag ?? "",
      date,
      today,
      price: args.price === undefined ? undefined : Number(args.price),
      promo: args.promo === undefined ? undefined : String(args.promo),
      pull,
    });
    return ok({
      venue_id: hit.id,
      venue: clean(hit.name, 60),
      date,
      artist: artistName ?? null,
      ...out,
      note: "Прогноз по семи факторам нашей модели, а не касса. Факторы видны — спорь с ними, а не с числом.",
    });
  },
};
