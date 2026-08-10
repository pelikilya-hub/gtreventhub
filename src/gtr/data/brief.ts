// Ветвящийся бриф события.
// Вопросы зависят от формата и от предыдущих ответов: свадьбу спрашиваем про
// церемонию и первый танец, клубную ночь — про хедлайнера и билеты. Ответы не
// оседают текстом, а превращаются в модули события, поэтому у каждого варианта
// есть готовая заготовка блока.
import type { NodeKind } from "./app-data";

export type BriefAnswers = Record<string, string[]>;

export type ModuleSpec = {
  kind: NodeKind;
  title: string;
  sub: string;
  badge: string;
  fields: [string, string][];
};

export type BriefOption = {
  id: string;
  label: string;
  hint?: string;
  modules?: ModuleSpec[];
};

export type BriefQuestion = {
  id: string;
  q: string;
  hint?: string;
  multi?: boolean;
  required?: boolean;
  formats?: string[]; // пусто — вопрос общий для всех форматов
  when?: (a: BriefAnswers) => boolean; // ветвление по прошлым ответам
  options: BriefOption[];
};

const mod = (
  kind: NodeKind,
  title: string,
  sub: string,
  badge: string,
  fields: [string, string][],
): ModuleSpec => ({ kind, title, sub, badge, fields });

const todo = (what: string): [string, string][] => [
  ["ИСТОЧНИК", "Бриф события"],
  ["СТАТУС", "Из брифа"],
  ["ЧТО НУЖНО", what],
];

// ---------- банк вопросов ----------
export const BRIEF: BriefQuestion[] = [
  // ===== общие =====
  {
    id: "guests",
    q: "Сколько гостей ожидаете?",
    hint: "От этого зависит выбор зала и требования к безопасности",
    required: true,
    options: [
      { id: "s", label: "До 50" },
      { id: "m", label: "50–150" },
      { id: "l", label: "150–500" },
      { id: "xl", label: "Больше 500" },
    ],
  },
  {
    id: "daypart",
    q: "Когда проводим?",
    required: true,
    options: [
      { id: "day", label: "Днём" },
      { id: "evening", label: "Вечером" },
      { id: "night", label: "Ночью до утра" },
      { id: "full", label: "Весь день" },
    ],
  },
  {
    id: "fnb",
    q: "Еда и напитки",
    multi: true,
    options: [
      {
        id: "bar",
        label: "Бар",
        modules: [mod("money", "Бар и напитки", "Минимальный спенд по бару", "F&B", todo("Согласовать барный минимум с площадкой"))],
      },
      {
        id: "buffet",
        label: "Фуршет",
        modules: [mod("money", "Фуршет", "Кейтеринг: фуршетное меню", "F&B", todo("Меню и цена на гостя"))],
      },
      {
        id: "banquet",
        label: "Банкет",
        modules: [mod("money", "Банкет", "Кейтеринг: сет-меню", "F&B", todo("Сет-меню, посадка, цена на гостя"))],
      },
      { id: "none", label: "Без F&B" },
    ],
  },

  // ===== клубная ночь =====
  {
    id: "headliner",
    q: "Кто хедлайнер?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    required: true,
    options: [
      {
        id: "touring",
        label: "Привозной артист",
        hint: "Гонорар, перелёт, райдер",
        modules: [
          mod("artist", "Хедлайнер — привоз", "Артист не выбран", "ХЕДЛАЙНЕР", todo("Выбрать артиста в базе, согласовать гонорар и райдер")),
          mod("doc", "Договор с артистом", "Гонорар, райдер, перелёт", "ДОГОВОР", todo("Контракт, аванс, тех-райдер")),
        ],
      },
      {
        id: "local",
        label: "Локальный резидент",
        modules: [mod("artist", "Резидент", "Артист не выбран", "АРТИСТ", todo("Выбрать резидента в базе"))],
      },
      { id: "residents", label: "Без хедлайнера, резиденты площадки" },
    ],
  },
  {
    id: "tickets",
    q: "Как попадают гости?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    options: [
      {
        id: "paid",
        label: "Платный билет",
        modules: [mod("promo", "Продажа билетов", "Тираж, цены, каналы", "БИЛЕТЫ", todo("Тираж, цена, площадка продаж, эквайринг"))],
      },
      { id: "guest", label: "Гостевой список" },
      { id: "free", label: "Свободный вход" },
    ],
  },
  {
    id: "stage",
    q: "Что на сцене?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    options: [
      {
        id: "booth",
        label: "DJ-стойка",
        modules: [mod("sound", "Звук: DJ-сетап", "Пакет не выбран", "ЗВУК", todo("Выбрать DJ-пакет в каталоге"))],
      },
      {
        id: "fullstage",
        label: "Сцена с райдером",
        modules: [
          mod("sound", "Звук: концертный", "Пакет не выбран", "ЗВУК", todo("Line-array, мониторы, пульт — по райдеру")),
          mod("light", "Свет и сцена", "Пакет не выбран", "СВЕТ", todo("Свет, ферма, LED-экран")),
        ],
      },
    ],
  },

  // ===== свадьба =====
  {
    id: "ceremony",
    q: "Где церемония?",
    formats: ["Свадьба"],
    required: true,
    options: [
      { id: "beach", label: "На пляже", modules: [mod("doc", "Разрешение на пляж", "Согласование зоны и времени", "РАЗРЕШЕНИЕ", todo("Разрешение площадки и муниципалитета"))] },
      { id: "garden", label: "В саду" },
      { id: "hall", label: "В зале" },
      { id: "none", label: "Без церемонии, только банкет" },
    ],
  },
  {
    id: "wed_music",
    q: "Музыка на свадьбе",
    formats: ["Свадьба"],
    options: [
      {
        id: "band",
        label: "Живая группа",
        modules: [
          mod("artist", "Живой состав", "Артист не выбран", "ЛАЙВ", todo("Выбрать лайв-состав, согласовать райдер")),
          mod("sound", "Звук под лайв", "Пакет не выбран", "ЗВУК", todo("Бэклайн, мониторы, пульт")),
        ],
      },
      { id: "dj", label: "DJ", modules: [mod("artist", "DJ", "Артист не выбран", "DJ", todo("Выбрать диджея в базе"))] },
      { id: "playlist", label: "Плейлист без артиста" },
    ],
  },
  {
    id: "wed_decor",
    q: "Оформление",
    formats: ["Свадьба"],
    multi: true,
    options: [
      { id: "arch", label: "Арка и цветы", modules: [mod("decor", "Флористика и арка", "Подрядчик не выбран", "ДЕКОР", todo("Флорист, арка, композиции"))] },
      { id: "textile", label: "Текстиль и мебель", modules: [mod("decor", "Мебель и текстиль", "Подрядчик не выбран", "ДЕКОР", todo("Стулья, столы, драпировки"))] },
      { id: "lightdeco", label: "Световое оформление", modules: [mod("light", "Декоративный свет", "Подрядчик не выбран", "СВЕТ", todo("Гирлянды, подсветка, пин-спот"))] },
    ],
  },

  // ===== корпоратив и конференция =====
  {
    id: "corp_format",
    q: "Формат мероприятия",
    formats: ["Корпоратив"],
    required: true,
    options: [
      { id: "gala", label: "Гала-ужин" },
      { id: "team", label: "Тимбилдинг" },
      { id: "conf", label: "Конференция" },
      { id: "offsite", label: "Выездная сессия" },
    ],
  },
  {
    id: "seating",
    q: "Рассадка",
    formats: ["Конференция", "Корпоратив"],
    options: [
      { id: "theatre", label: "Театр" },
      { id: "class", label: "Класс" },
      { id: "rounds", label: "Круглые столы" },
      { id: "ushape", label: "П-образная" },
    ],
  },
  {
    id: "av",
    q: "Техническое оснащение",
    formats: ["Конференция", "Корпоратив", "Бренд-активация"],
    multi: true,
    options: [
      { id: "projector", label: "Проектор и экран", modules: [mod("tech", "Проектор и экран", "Оборудование площадки или аренда", "ТЕХНИКА", todo("Уточнить у площадки, иначе аренда"))] },
      { id: "led", label: "LED-экран", modules: [mod("light", "LED-экран", "Подрядчик не выбран", "LED", todo("Размер, шаг пикселя, монтаж"))] },
      { id: "translation", label: "Синхроперевод", modules: [mod("tech", "Синхроперевод", "Кабины, приёмники, переводчики", "ПЕРЕВОД", todo("Языки, число приёмников"))] },
      { id: "stream", label: "Стриминг и запись", modules: [mod("content", "Стриминг и запись", "Подрядчик не выбран", "СТРИМ", todo("Платформа, число камер, запись"))] },
    ],
  },

  // ===== бренд-активация =====
  {
    id: "activation",
    q: "Механика активации",
    formats: ["Бренд-активация"],
    multi: true,
    options: [
      { id: "photozone", label: "Фотозона", modules: [mod("decor", "Фотозона", "Подрядчик не выбран", "ФОТОЗОНА", todo("Конструкция, брендирование, свет"))] },
      { id: "interactive", label: "Интерактив", modules: [mod("tech", "Интерактивная зона", "Оборудование не выбрано", "ИНТЕРАКТИВ", todo("Механика, оборудование, оператор"))] },
      { id: "sampling", label: "Сэмплинг" },
      { id: "show", label: "Шоу-программа", modules: [mod("artist", "Шоу-программа", "Артист не выбран", "ШОУ", todo("Выбрать шоу в базе"))] },
    ],
  },

  // ===== частная вечеринка =====
  {
    id: "party_vibe",
    q: "Настроение вечера",
    formats: ["Частная вечеринка"],
    options: [
      { id: "dinner", label: "Ужин с музыкой" },
      { id: "dance", label: "Танцы" },
      { id: "pool", label: "Вечеринка у бассейна" },
    ],
  },

  // ===== съёмка: общий, но не для конференции =====
  {
    id: "media",
    q: "Съёмка события",
    formats: ["Клубная ночь", "Концерт / шоу", "Свадьба", "Корпоратив", "Частная вечеринка", "Бренд-активация"],
    options: [
      { id: "photo", label: "Фото", modules: [mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге"))] },
      {
        id: "photovideo",
        label: "Фото и видео",
        modules: [
          mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге")),
          mod("content", "Видеосъёмка", "Пакет не выбран", "ВИДЕО", todo("Выбрать пакет в каталоге")),
        ],
      },
      {
        id: "drone",
        label: "Фото, видео и дрон",
        modules: [
          mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге")),
          mod("content", "Видеосъёмка", "Пакет не выбран", "ВИДЕО", todo("Выбрать пакет в каталоге")),
          mod("content", "Съёмка с дрона", "Доп. опция подрядчика", "ДРОН", todo("Проверить разрешение на полёт в зоне площадки")),
        ],
      },
      { id: "none", label: "Без съёмки" },
    ],
  },

  // ===== ветвление по прошлым ответам =====
  {
    id: "security",
    q: "Безопасность и медпомощь",
    hint: "Спрашиваем, потому что гостей больше 150",
    multi: true,
    when: (a) => (a.guests ?? []).some((x) => x === "l" || x === "xl"),
    options: [
      { id: "door", label: "Охрана на входе", modules: [mod("staff", "Охрана на входе", "Контроль доступа и гостевой список", "ОХРАНА", todo("Число постов, смена, подрядчик"))] },
      { id: "floor", label: "Охрана в зале", modules: [mod("staff", "Охрана в зале", "Контроль по площадке", "ОХРАНА", todo("Число постов, смена"))] },
      { id: "medic", label: "Медпункт", modules: [mod("staff", "Медпункт", "Дежурный медик на событии", "МЕДИК", todo("Подрядчик, время дежурства"))] },
    ],
  },
  {
    id: "noise",
    q: "Ночной слот согласован?",
    hint: "Спрашиваем, потому что событие идёт до утра",
    when: (a) => (a.daypart ?? []).includes("night"),
    options: [
      { id: "ok", label: "Согласование есть" },
      {
        id: "need",
        label: "Нужно согласовать",
        modules: [mod("doc", "Согласование шума и времени", "Поздний слот на площадке", "РЕГЛАМЕНТ", todo("Разрешение площадки, лимит по шуму, время закрытия"))],
      },
      { id: "unknown", label: "Пока не знаю" },
    ],
  },
  {
    id: "xl_logistics",
    q: "Логистика большого события",
    hint: "Спрашиваем, потому что гостей больше 500",
    multi: true,
    when: (a) => (a.guests ?? []).includes("xl"),
    options: [
      { id: "power", label: "Генератор", modules: [mod("tech", "Генератор", "Резервное питание события", "ПИТАНИЕ", todo("Мощность, топливо, подключение"))] },
      { id: "transfer", label: "Трансферы гостей", modules: [mod("staff", "Трансферы", "Подвоз и развоз гостей", "ТРАНСФЕР", todo("Число машин, маршруты, время"))] },
      { id: "toilets", label: "Санитарные модули", modules: [mod("tech", "Санитарные модули", "Дополнительные санузлы", "САНУЗЛЫ", todo("Число кабин, обслуживание"))] },
    ],
  },
];

// Видимые вопросы: фильтр по формату и по ветвлению от уже данных ответов
export const visibleQuestions = (format: string, answers: BriefAnswers): BriefQuestion[] =>
  BRIEF.filter((q) => {
    if (q.formats?.length && !q.formats.includes(format)) return false;
    if (q.when && !q.when(answers)) return false;
    return true;
  });

export const briefProgress = (format: string, answers: BriefAnswers) => {
  const qs = visibleQuestions(format, answers);
  const done = qs.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const required = qs.filter((q) => q.required);
  const missing = required.filter((q) => !(answers[q.id] ?? []).length);
  return { total: qs.length, done, missing };
};

// Модули, которые следуют из ответов. Дубли по названию отсеиваются:
// «Фотосъёмка» из двух разных ответов добавляется один раз.
export const modulesFromBrief = (format: string, answers: BriefAnswers): ModuleSpec[] => {
  const out: ModuleSpec[] = [];
  for (const q of visibleQuestions(format, answers)) {
    for (const id of answers[q.id] ?? []) {
      const opt = q.options.find((o) => o.id === id);
      for (const m of opt?.modules ?? []) {
        if (!out.some((x) => x.title === m.title)) out.push(m);
      }
    }
  }
  return out;
};
