// Ветвящийся бриф события.
// Первый вопрос каждого формата — вайб: художественное направление с палитрой
// и музыкальным ориентиром. Выбранный вайб окрашивает событие в списке и в
// конструкторе, а ответы превращаются в блоки события. Вопросы двуязычные:
// организаторы на Пхукете часто англоязычные, панель переключается RU/EN.
import type { NodeKind } from "./app-data";

export type BriefLang = "ru" | "en";

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
  labelEn?: string;
  hint?: string;
  hintEn?: string;
  colors?: [string, string]; // палитра вайба — градиент карточки и окрас события
  modules?: ModuleSpec[];
};

export type BriefQuestion = {
  id: string;
  q: string;
  qEn?: string;
  hint?: string;
  hintEn?: string;
  kind?: "vibe"; // вайб рендерится карточками с палитрой, не чипами
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

// Блок арт-дирекшна: вайб ложится в граф события отдельным модулем,
// чтобы направление не потерялось между брифом и подрядчиками
const vibeMod = (label: string, colors: [string, string], music: string): ModuleSpec =>
  mod("promo", "Арт-дирекшн: " + label, "Направление события из брифа", "ВАЙБ", [
    ["НАПРАВЛЕНИЕ", label],
    ["ПАЛИТРА", colors.join(" → ")],
    ["МУЗЫКА", music || "по формату"],
    ["СТАТУС", "Из брифа"],
    ["ЧТО НУЖНО", "Референсы, декор и дресс-код под направление"],
  ]);

const vibe = (
  id: string,
  label: string,
  labelEn: string,
  colors: [string, string],
  hint: string,
  hintEn: string,
  music = "",
): BriefOption => ({
  id,
  label,
  labelEn,
  colors,
  hint,
  hintEn,
  modules: [vibeMod(label, colors, music)],
});

// ---------- банк вопросов ----------
export const BRIEF: BriefQuestion[] = [
  // ===== вайб: первый вопрос каждого формата =====
  {
    id: "vibe_club",
    q: "Какой вайб у ночи?",
    qEn: "What is the vibe of the night?",
    kind: "vibe",
    required: true,
    formats: ["Клубная ночь"],
    options: [
      vibe("neon", "Неоновый андеграунд", "Neon Underground", ["#7B4DFF", "#00C2FF"],
        "Техно, стробоскопы, дым и бас. Минимум декора — максимум звука.",
        "Techno, strobes, haze and bass. Minimal decor, maximum sound.", "Техно / андеграунд"),
      vibe("tropic", "Тропик-хаус на закате", "Sunset Tropic House", ["#2ECC71", "#FFD166"],
        "Лёгкий хаус, пальмы, золотой час и коктейли у бассейна.",
        "Laid-back house, palms, golden hour and poolside cocktails.", "Хаус / бич-клаб"),
      vibe("hiphop", "Хип-хоп люкс", "Hip-Hop Luxe", ["#E5231B", "#F5A623"],
        "Тяжёлый бит, VIP-столы, шампанское и золото.",
        "Heavy beats, VIP tables, champagne and gold.", "Хип-хоп / R&B"),
      vibe("disco", "Ретро-диско", "Retro Disco", ["#FF8FA3", "#7B4DFF"],
        "Зеркальный шар, фанк, глиттер и дресс-код 70-х.",
        "Mirror ball, funk, glitter and a 70s dress code.", "Диско / фанк"),
    ],
  },
  {
    id: "vibe_wed",
    q: "Каким видите день?",
    qEn: "How do you picture the day?",
    kind: "vibe",
    required: true,
    formats: ["Свадьба"],
    options: [
      vibe("boho", "Босиком по песку", "Barefoot Boho", ["#F5A623", "#FFD166"],
        "Церемония у воды, макраме, живой гитарист и закат.",
        "Waterside ceremony, macramé, live guitar and sunset.", "Акустика / лаунж"),
      vibe("classic", "Белая классика", "Timeless White", ["#FFFFFF", "#C0C8D8"],
        "Белые цветы, стекло и свечи, струнный квартет.",
        "White florals, glass and candles, a string quartet.", "Классика / лайв"),
      vibe("garden", "Тропический сад", "Tropical Garden", ["#2ECC71", "#22D3C7"],
        "Монстера и орхидеи, зелёные арки, естественный свет.",
        "Monstera and orchids, greenery arches, natural light.", "Лаунж / поп"),
      vibe("glam", "Золотой вечер", "Golden Glam", ["#F5A623", "#E5231B"],
        "Свечи и золото, чёрный дресс-код, вечер как гала.",
        "Candles and gold, black-tie dress code, a gala evening.", "Лайв / диско"),
    ],
  },
  {
    id: "vibe_corp",
    q: "Тон мероприятия",
    qEn: "Tone of the event",
    kind: "vibe",
    required: true,
    formats: ["Корпоратив", "Конференция"],
    options: [
      vibe("lux", "Строгий люкс", "Sleek & Formal", ["#C0C8D8", "#7B4DFF"],
        "Тёмный зал, точечный свет, лаконичная сцена.",
        "Dark room, pin-spot lighting, minimal stage.", "Фон / лаунж"),
      vibe("tropicana", "Тропикана", "Tropicana", ["#2ECC71", "#FFD166"],
        "Гавайские рубашки, коктейли, живой перкуссионист.",
        "Aloha shirts, cocktails, live percussion.", "Латино / хаус"),
      vibe("white", "Белая вечеринка", "White Party", ["#FFFFFF", "#22D3C7"],
        "Все в белом, светлый декор, закатный диджей-сет.",
        "All-white dress code, bright decor, sunset DJ set.", "Хаус"),
      vibe("neon_f", "Неон и футуризм", "Neon Futurism", ["#00C2FF", "#7B4DFF"],
        "LED-экраны, лазеры, технологичная сцена.",
        "LED walls, lasers, a tech-forward stage.", "Электроника"),
    ],
  },
  {
    id: "vibe_party",
    q: "Настроение вечеринки",
    qEn: "Party mood",
    kind: "vibe",
    required: true,
    formats: ["Частная вечеринка"],
    options: [
      vibe("sunset", "Закат и лаунж", "Sunset Lounge", ["#FF8FA3", "#F5A623"],
        "Медленный вечер: вид, вино и мягкий грув.",
        "A slow evening: views, wine and soft grooves.", "Лаунж"),
      vibe("pool", "Пул-пати", "Pool Party", ["#22D3C7", "#00C2FF"],
        "Бассейн, диджей у воды, надувные фламинго.",
        "Pool, poolside DJ, inflatable flamingos.", "Хаус / поп"),
      vibe("gastro", "Гастро-ужин", "Chef's Dinner", ["#F5A623", "#E5231B"],
        "Длинный стол, сет от шефа, винные пары.",
        "One long table, chef's tasting menu, wine pairings.", "Акустика"),
      vibe("allnight", "Танцы до утра", "Dance Till Dawn", ["#7B4DFF", "#E5231B"],
        "Танцпол, диджей и никаких речей.",
        "Dance floor, DJ and zero speeches.", "Клубная электроника"),
    ],
  },
  {
    id: "vibe_brand",
    q: "Характер активации",
    qEn: "Activation character",
    kind: "vibe",
    required: true,
    formats: ["Бренд-активация"],
    options: [
      vibe("futur", "Технофутуризм", "Tech Futurism", ["#00C2FF", "#7B4DFF"],
        "Интерактив, LED, дополненная реальность.",
        "Interactive tech, LED, augmented reality.", "Электроника"),
      vibe("eco", "Эко и крафт", "Eco & Craft", ["#2ECC71", "#F5A623"],
        "Натуральные материалы, крафт-зоны, дневной свет.",
        "Natural materials, craft corners, daylight.", "Акустика"),
      vibe("pop", "Яркий поп", "Bold Pop", ["#E5231B", "#FF8FA3"],
        "Цветные зоны, фотоповоды на каждом шагу.",
        "Colour-blocked zones, photo moments everywhere.", "Поп"),
    ],
  },
  {
    id: "vibe_concert",
    q: "Формат шоу",
    qEn: "Show format",
    kind: "vibe",
    required: true,
    formats: ["Концерт / шоу"],
    options: [
      vibe("festival", "Фестивальная сцена", "Festival Stage", ["#E5231B", "#F5A623"],
        "Большая сцена, полный райдер, свет и экраны.",
        "Big stage, full rider, lights and screens.", "Лайв / электроника"),
      vibe("acoustic", "Камерная акустика", "Intimate Acoustic", ["#FFD166", "#2ECC71"],
        "Малый зал, тёплый свет, музыка вблизи.",
        "Small room, warm light, music up close.", "Акустика"),
      vibe("theatrical", "Шоу-постановка", "Theatrical Show", ["#7B4DFF", "#FF8FA3"],
        "Номера, костюмы, режиссура и сценография.",
        "Staged acts, costumes, direction and scenography.", "Шоу-программа"),
    ],
  },

  // ===== общие =====
  {
    id: "guests",
    q: "Сколько гостей ожидаете?",
    qEn: "How many guests?",
    hint: "От этого зависит выбор зала и требования к безопасности",
    hintEn: "Defines the room and the safety requirements",
    required: true,
    options: [
      { id: "s", label: "До 50", labelEn: "Up to 50" },
      { id: "m", label: "50–150", labelEn: "50–150" },
      { id: "l", label: "150–500", labelEn: "150–500" },
      { id: "xl", label: "Больше 500", labelEn: "500+" },
    ],
  },
  {
    id: "daypart",
    q: "Когда проводим?",
    qEn: "When does it happen?",
    required: true,
    options: [
      { id: "day", label: "Днём", labelEn: "Daytime" },
      { id: "evening", label: "Вечером", labelEn: "Evening" },
      { id: "night", label: "Ночью до утра", labelEn: "Night till dawn" },
      { id: "full", label: "Весь день", labelEn: "All day" },
    ],
  },
  {
    id: "audience",
    q: "На каком языке событие?",
    qEn: "Event language?",
    hint: "Влияет на ведущего, навигацию и промо",
    hintEn: "Affects the MC, signage and promo",
    options: [
      { id: "ru", label: "Русскоязычные гости", labelEn: "Russian-speaking" },
      { id: "en", label: "Англоязычные гости", labelEn: "English-speaking" },
      {
        id: "int",
        label: "Интернациональная аудитория",
        labelEn: "International mix",
        modules: [
          mod("staff", "Двуязычный ведущий / MC", "RU + EN на площадке", "MC",
            todo("Найти MC с двумя языками, согласовать сценарий")),
        ],
      },
    ],
  },
  {
    id: "fnb",
    q: "Еда и напитки",
    qEn: "Food & drinks",
    multi: true,
    options: [
      {
        id: "bar", label: "Бар", labelEn: "Bar",
        modules: [mod("money", "Бар и напитки", "Минимальный спенд по бару", "F&B", todo("Согласовать барный минимум с площадкой"))],
      },
      {
        id: "buffet", label: "Фуршет", labelEn: "Canapés",
        modules: [mod("money", "Фуршет", "Кейтеринг: фуршетное меню", "F&B", todo("Меню и цена на гостя"))],
      },
      {
        id: "banquet", label: "Банкет", labelEn: "Seated dinner",
        modules: [mod("money", "Банкет", "Кейтеринг: сет-меню", "F&B", todo("Сет-меню, посадка, цена на гостя"))],
      },
      { id: "none", label: "Без F&B", labelEn: "No F&B" },
    ],
  },

  // ===== клубная ночь / концерт =====
  {
    id: "headliner",
    q: "Кто хедлайнер?",
    qEn: "Who is the headliner?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    required: true,
    options: [
      {
        id: "touring", label: "Привозной артист", labelEn: "Touring artist",
        hint: "Гонорар, перелёт, райдер", hintEn: "Fee, flights, rider",
        modules: [
          mod("artist", "Хедлайнер — привоз", "Артист не выбран", "ХЕДЛАЙНЕР", todo("Выбрать артиста в базе, согласовать гонорар и райдер")),
          mod("doc", "Договор с артистом", "Гонорар, райдер, перелёт", "ДОГОВОР", todo("Контракт, аванс, тех-райдер")),
        ],
      },
      {
        id: "local", label: "Локальный резидент", labelEn: "Local resident",
        modules: [mod("artist", "Резидент", "Артист не выбран", "АРТИСТ", todo("Выбрать резидента в базе"))],
      },
      { id: "residents", label: "Резиденты площадки", labelEn: "Venue residents" },
    ],
  },
  {
    id: "tickets",
    q: "Как попадают гости?",
    qEn: "How do guests get in?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    options: [
      {
        id: "paid", label: "Платный билет", labelEn: "Paid ticket",
        modules: [mod("promo", "Продажа билетов", "Тираж, цены, каналы", "БИЛЕТЫ", todo("Тираж, цена, площадка продаж, эквайринг"))],
      },
      { id: "guest", label: "Гостевой список", labelEn: "Guest list" },
      { id: "free", label: "Свободный вход", labelEn: "Free entry" },
    ],
  },
  {
    id: "stage",
    q: "Что на сцене?",
    qEn: "What is on stage?",
    formats: ["Клубная ночь", "Концерт / шоу"],
    options: [
      {
        id: "booth", label: "DJ-стойка", labelEn: "DJ booth",
        modules: [mod("sound", "Звук: DJ-сетап", "Пакет не выбран", "ЗВУК", todo("Выбрать DJ-пакет в каталоге"))],
      },
      {
        id: "fullstage", label: "Сцена с райдером", labelEn: "Full stage & rider",
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
    qEn: "Where is the ceremony?",
    formats: ["Свадьба"],
    required: true,
    options: [
      {
        id: "beach", label: "На пляже", labelEn: "On the beach",
        modules: [mod("doc", "Разрешение на пляж", "Согласование зоны и времени", "РАЗРЕШЕНИЕ", todo("Разрешение площадки и муниципалитета"))],
      },
      { id: "garden", label: "В саду", labelEn: "In the garden" },
      { id: "hall", label: "В зале", labelEn: "Indoors" },
      { id: "none", label: "Только банкет", labelEn: "Reception only" },
    ],
  },
  {
    id: "wed_music",
    q: "Музыка на свадьбе",
    qEn: "Wedding music",
    formats: ["Свадьба"],
    options: [
      {
        id: "band", label: "Живая группа", labelEn: "Live band",
        modules: [
          mod("artist", "Живой состав", "Артист не выбран", "ЛАЙВ", todo("Выбрать лайв-состав, согласовать райдер")),
          mod("sound", "Звук под лайв", "Пакет не выбран", "ЗВУК", todo("Бэклайн, мониторы, пульт")),
        ],
      },
      { id: "dj", label: "DJ", labelEn: "DJ", modules: [mod("artist", "DJ", "Артист не выбран", "DJ", todo("Выбрать диджея в базе"))] },
      { id: "playlist", label: "Плейлист без артиста", labelEn: "Playlist only" },
    ],
  },
  {
    id: "wed_decor",
    q: "Оформление",
    qEn: "Decor",
    formats: ["Свадьба"],
    multi: true,
    options: [
      { id: "arch", label: "Арка и цветы", labelEn: "Arch & florals", modules: [mod("decor", "Флористика и арка", "Подрядчик не выбран", "ДЕКОР", todo("Флорист, арка, композиции"))] },
      { id: "textile", label: "Текстиль и мебель", labelEn: "Textiles & furniture", modules: [mod("decor", "Мебель и текстиль", "Подрядчик не выбран", "ДЕКОР", todo("Стулья, столы, драпировки"))] },
      { id: "lightdeco", label: "Световое оформление", labelEn: "Decorative lighting", modules: [mod("light", "Декоративный свет", "Подрядчик не выбран", "СВЕТ", todo("Гирлянды, подсветка, пин-спот"))] },
    ],
  },

  // ===== частная вечеринка =====
  {
    id: "party_music",
    q: "Кто за музыку?",
    qEn: "Who plays the music?",
    formats: ["Частная вечеринка"],
    options: [
      { id: "dj", label: "DJ", labelEn: "DJ", modules: [mod("artist", "DJ", "Артист не выбран", "DJ", todo("Выбрать диджея в базе"))] },
      {
        id: "live", label: "Живая музыка", labelEn: "Live music",
        modules: [
          mod("artist", "Живой состав", "Артист не выбран", "ЛАЙВ", todo("Выбрать состав в базе")),
          mod("sound", "Звук под лайв", "Пакет не выбран", "ЗВУК", todo("Бэклайн, мониторы")),
        ],
      },
      { id: "playlist", label: "Плейлист", labelEn: "Playlist" },
    ],
  },

  // ===== корпоратив и конференция =====
  {
    id: "corp_format",
    q: "Формат мероприятия",
    qEn: "Event format",
    formats: ["Корпоратив"],
    required: true,
    options: [
      { id: "gala", label: "Гала-ужин", labelEn: "Gala dinner" },
      { id: "team", label: "Тимбилдинг", labelEn: "Team building" },
      { id: "conf", label: "Конференция", labelEn: "Conference" },
      { id: "offsite", label: "Выездная сессия", labelEn: "Offsite" },
    ],
  },
  {
    id: "seating",
    q: "Рассадка",
    qEn: "Seating",
    formats: ["Конференция", "Корпоратив"],
    options: [
      { id: "theatre", label: "Театр", labelEn: "Theatre" },
      { id: "class", label: "Класс", labelEn: "Classroom" },
      { id: "rounds", label: "Круглые столы", labelEn: "Rounds" },
      { id: "ushape", label: "П-образная", labelEn: "U-shape" },
    ],
  },
  {
    id: "av",
    q: "Техническое оснащение",
    qEn: "Technical setup",
    formats: ["Конференция", "Корпоратив", "Бренд-активация"],
    multi: true,
    options: [
      { id: "projector", label: "Проектор и экран", labelEn: "Projector & screen", modules: [mod("tech", "Проектор и экран", "Оборудование площадки или аренда", "ТЕХНИКА", todo("Уточнить у площадки, иначе аренда"))] },
      { id: "led", label: "LED-экран", labelEn: "LED wall", modules: [mod("light", "LED-экран", "Подрядчик не выбран", "LED", todo("Размер, шаг пикселя, монтаж"))] },
      { id: "translation", label: "Синхроперевод", labelEn: "Interpretation", modules: [mod("tech", "Синхроперевод", "Кабины, приёмники, переводчики", "ПЕРЕВОД", todo("Языки, число приёмников"))] },
      { id: "stream", label: "Стриминг и запись", labelEn: "Stream & recording", modules: [mod("content", "Стриминг и запись", "Подрядчик не выбран", "СТРИМ", todo("Платформа, число камер, запись"))] },
    ],
  },

  // ===== бренд-активация =====
  {
    id: "activation",
    q: "Механика активации",
    qEn: "Activation mechanics",
    formats: ["Бренд-активация"],
    multi: true,
    options: [
      { id: "photozone", label: "Фотозона", labelEn: "Photo zone", modules: [mod("decor", "Фотозона", "Подрядчик не выбран", "ФОТОЗОНА", todo("Конструкция, брендирование, свет"))] },
      { id: "interactive", label: "Интерактив", labelEn: "Interactive", modules: [mod("tech", "Интерактивная зона", "Оборудование не выбрано", "ИНТЕРАКТИВ", todo("Механика, оборудование, оператор"))] },
      { id: "sampling", label: "Сэмплинг", labelEn: "Sampling" },
      { id: "show", label: "Шоу-программа", labelEn: "Show acts", modules: [mod("artist", "Шоу-программа", "Артист не выбран", "ШОУ", todo("Выбрать шоу в базе"))] },
    ],
  },

  // ===== съёмка =====
  {
    id: "media",
    q: "Съёмка события",
    qEn: "Event coverage",
    formats: ["Клубная ночь", "Концерт / шоу", "Свадьба", "Корпоратив", "Частная вечеринка", "Бренд-активация"],
    options: [
      { id: "photo", label: "Фото", labelEn: "Photo", modules: [mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге"))] },
      {
        id: "photovideo", label: "Фото и видео", labelEn: "Photo & video",
        modules: [
          mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге")),
          mod("content", "Видеосъёмка", "Пакет не выбран", "ВИДЕО", todo("Выбрать пакет в каталоге")),
        ],
      },
      {
        id: "drone", label: "Фото, видео и дрон", labelEn: "Photo, video & drone",
        modules: [
          mod("content", "Фотосъёмка", "Пакет не выбран", "ФОТО", todo("Выбрать пакет в каталоге")),
          mod("content", "Видеосъёмка", "Пакет не выбран", "ВИДЕО", todo("Выбрать пакет в каталоге")),
          mod("content", "Съёмка с дрона", "Доп. опция подрядчика", "ДРОН", todo("Проверить разрешение на полёт в зоне площадки")),
        ],
      },
      { id: "none", label: "Без съёмки", labelEn: "No coverage" },
    ],
  },

  // ===== ветвление по прошлым ответам =====
  {
    id: "security",
    q: "Безопасность и медпомощь",
    qEn: "Security & medical",
    hint: "Спрашиваем, потому что гостей больше 150",
    hintEn: "Asked because you expect 150+ guests",
    multi: true,
    when: (a) => (a.guests ?? []).some((x) => x === "l" || x === "xl"),
    options: [
      { id: "door", label: "Охрана на входе", labelEn: "Door security", modules: [mod("staff", "Охрана на входе", "Контроль доступа и гостевой список", "ОХРАНА", todo("Число постов, смена, подрядчик"))] },
      { id: "floor", label: "Охрана в зале", labelEn: "Floor security", modules: [mod("staff", "Охрана в зале", "Контроль по площадке", "ОХРАНА", todo("Число постов, смена"))] },
      { id: "medic", label: "Медпункт", labelEn: "Medic on site", modules: [mod("staff", "Медпункт", "Дежурный медик на событии", "МЕДИК", todo("Подрядчик, время дежурства"))] },
    ],
  },
  {
    id: "noise",
    q: "Ночной слот согласован?",
    qEn: "Late-night slot approved?",
    hint: "Спрашиваем, потому что событие идёт до утра",
    hintEn: "Asked because the event runs till dawn",
    when: (a) => (a.daypart ?? []).includes("night"),
    options: [
      { id: "ok", label: "Согласование есть", labelEn: "Approved" },
      {
        id: "need", label: "Нужно согласовать", labelEn: "Needs approval",
        modules: [mod("doc", "Согласование шума и времени", "Поздний слот на площадке", "РЕГЛАМЕНТ", todo("Разрешение площадки, лимит по шуму, время закрытия"))],
      },
      { id: "unknown", label: "Пока не знаю", labelEn: "Not sure yet" },
    ],
  },
  {
    id: "xl_logistics",
    q: "Логистика большого события",
    qEn: "Large-event logistics",
    hint: "Спрашиваем, потому что гостей больше 500",
    hintEn: "Asked because you expect 500+ guests",
    multi: true,
    when: (a) => (a.guests ?? []).includes("xl"),
    options: [
      { id: "power", label: "Генератор", labelEn: "Generator", modules: [mod("tech", "Генератор", "Резервное питание события", "ПИТАНИЕ", todo("Мощность, топливо, подключение"))] },
      { id: "transfer", label: "Трансферы гостей", labelEn: "Guest transfers", modules: [mod("staff", "Трансферы", "Подвоз и развоз гостей", "ТРАНСФЕР", todo("Число машин, маршруты, время"))] },
      { id: "toilets", label: "Санитарные модули", labelEn: "Portable restrooms", modules: [mod("tech", "Санитарные модули", "Дополнительные санузлы", "САНУЗЛЫ", todo("Число кабин, обслуживание"))] },
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

// Выбранный вайб события — окрашивает карточку события и шапку конструктора
export const vibeOf = (format: string, answers: BriefAnswers): BriefOption | null => {
  for (const q of visibleQuestions(format, answers)) {
    if (q.kind !== "vibe") continue;
    const id = (answers[q.id] ?? [])[0];
    return q.options.find((o) => o.id === id) ?? null;
  }
  return null;
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
