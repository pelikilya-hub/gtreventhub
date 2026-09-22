// Текстовый режим GTR BRO: командная строка на табло.
//
// Здесь нет никакой нейросети — и это осознанно. Инструменты (афиша,
// детали, маршрут, навигация) выполняет наш воркер по нашим данным, а
// разбор команды — обычные правила. Значит, текстовый режим работает
// даже когда у голосового провайдера кончились деньги, и не может ни
// выдумать событие, ни сжечь бюджет.
//
// Реплики BRO здесь — заготовки в его характере. Они не притворяются
// ответами модели: факты в них только из результатов инструментов.

import { isBooking, isCancel } from "./order";

export type TextPlan =
  | { kind: "help" }
  | { kind: "greet" }
  | { kind: "search"; dateFrom: string; dateTo: string; district?: string; label: string }
  | { kind: "details"; index: number }
  | { kind: "route" }
  | { kind: "open"; route: string }
  | { kind: "music"; artist: string; source: "youtube" | "spotify" | "soundcloud" | "any" }
  | { kind: "venues"; district?: string; kind2?: string; label: string }
  | { kind: "faq"; question: string }
  | { kind: "forecast"; venue: string; date: string }
  | { kind: "pull"; artist: string }
  | { kind: "book" }
  | { kind: "cancel" }
  | { kind: "unknown" };

/** Дата на Пхукете (UTC+7) со сдвигом в днях. Часовой пояс телефона
 *  может быть каким угодно — афиша живёт по времени острова. */
export const bkkDate = (shiftDays = 0): string =>
  new Date(Date.now() + 7 * 3_600_000 + shiftDays * 86_400_000).toISOString().slice(0, 10);

const bkkDow = (shiftDays = 0): number =>
  new Date(Date.now() + 7 * 3_600_000 + shiftDays * 86_400_000).getUTCDay();

// Районы: алиасы → каноническое имя, которое поймёт фильтр инструмента
// (он ищет вхождение в area/cluster/district площадки).
const DISTRICTS: [string, string[]][] = [
  ["Патонг", ["патонг", "patong"]],
  ["Банг Тао", ["банг тао", "бангтао", "bang tao", "лагуна", "laguna"]],
  ["Камала", ["камала", "kamala"]],
  ["Карон", ["карон", "karon"]],
  ["Ката", ["ката", "kata"]],
  ["Равай", ["равай", "rawai"]],
  ["Най Харн", ["най харн", "найхарн", "nai harn"]],
  ["Чалонг", ["чалонг", "chalong"]],
  ["Сурин", ["сурин", "surin"]],
  ["Старый город", ["старый город", "таун", "old town", "город"]],
  ["Панва", ["панва", "panwa"]],
  ["Май Кхао", ["май кхао", "маи кхао", "mai khao"]],
];

const OPEN_ROUTES: [string, string[]][] = [
  ["tonight", ["сегодня-экран", "тунайт", "tonight"]],
  ["map", ["карта", "карту", "map"]],
  ["artists", ["артист", "artists"]],
  ["calendar", ["календар", "calendar"]],
  ["aimatch", ["подбор", "матч", "aimatch"]],
  ["promo", ["промо", "promo"]],
];

const SEARCHY =
  /событ|афиш|вечер|туса|движ|ที่ไหน|что|где|куда|пойти|клуб|бар|пляж|техно|хаус|музык|party|сходить/i;

/** Пасхалка BOSS: «да братан» — и никакой нейросети не нужно. */
export const EGG_RE = /^да,?\s*братан[!.)]*$/i;
export const EGG_REPLY = "Тамбовский волк тебе братан!)))";

export const planOf = (raw: string): TextPlan => {
  const q = raw.trim().toLowerCase();
  if (!q) return { kind: "unknown" };

  if (/^(help|\?|помощь|команды)$/.test(q)) return { kind: "help" };

  // Бронь идёт раньше всего остального: «забронируй стол в Патонге» — это
  // заявка, а не поиск площадок по району, и уж точно не знакомство.
  if (isCancel(raw)) return { kind: "cancel" };
  if (isBooking(raw)) return { kind: "book" };
  // «привет» и «что умеешь» — это не поиск афиши, это знакомство.
  // \b в JS считает границей только ASCII — для кириллицы конец слова
  // приходится задавать явно, иначе «привет» не матчится вовсе, а «ку»
  // проглотило бы «куда пойти».
  if (/^(привет(ик|ствую)?|здаров(а|о)?|здорово|хай|йо|ку|hi|hello|салют)(?:[\s!,.?)]|$)/.test(q))
    return { kind: "greet" };
  if (/(что|чё|че).{0,12}(умеешь|можешь)|твои возможност|расскажи.{0,10}себе|кто ты/.test(q))
    return { kind: "greet" };

  // Рабочие команды команды GTR. Разбор здесь, исполнение — на сервере,
  // где стоит проверка роли: гость может набрать что угодно, но инструмент
  // ему не ответит.
  const fc = raw.trim().match(/^прогноз\s+(.+)$/i);
  if (fc) {
    const tail = fc[1].trim();
    const dm = tail.match(/(\d{4}-\d{2}-\d{2})/);
    const venue = tail.replace(/(\d{4}-\d{2}-\d{2})/, "").replace(/\s+/g, " ").trim();
    if (venue) return { kind: "forecast", venue, date: dm ? dm[1] : bkkDate(0) };
  }
  const pl = raw.trim().match(/^(?:тяга|популярность)\s+(.+)$/i);
  if (pl && pl[1].trim()) return { kind: "pull", artist: pl[1].trim() };

  const det = q.match(/^(детали|подробнее|инфо)\s+(\d{1,2})$/);
  if (det) return { kind: "details", index: Number(det[2]) };

  if (/^маршрут/.test(q)) return { kind: "route" };

  // Музыка раньше падала в «открой …» и уводила человека в базу
  // площадок: экрана с чужими сетами в приложении нет и не будет.
  // Ловим музыкальную просьбу до навигации.
  const music = q.match(
    /(?:включи|поставь|послушать|послушаем|найди|покажи|открой|скинь)?\s*(?:мне\s+)?(?:сеты?|сет|треки?|музыку|микс(?:ы|тейпы?)?|клипы?|видео)\s*(.*)$/,
  );
  if (music && /сет|трек|музык|микс|клип|видео/.test(q)) {
    const tail = music[1] ?? "";
    const src: TextPlan extends never ? never : "youtube" | "spotify" | "soundcloud" | "any" =
      /youtube|ютуб|ютьюб/.test(q)
        ? "youtube"
        : /spotify|спотифай|спотик/.test(q)
          ? "spotify"
          : /soundcloud|саундклауд|ск\b/.test(q)
            ? "soundcloud"
            : "any";
    // Имя артиста — то, что осталось после служебных слов и площадки.
    // Чистим по токенам: \b в JS не видит кириллицу, а regexp-замена
    // оставляла огрызки вроде «lutang на е».
    const STOP =
      /^(на|в|во|из|по|мне|его|её|ее|их|плиз|please|пожалуйста|youtube|ютуб[а-яё]*|ютьюб[а-яё]*|spotify|спотиф[а-яё]*|спотик[а-яё]*|soundcloud|саундклауд[а-яё]*|сет[а-яё]*|трек[а-яё]*|музык[а-яё]*|микс[а-яё]*|клип[а-яё]*|видео)$/;
    const artist = tail
      .split(/[\s,.;!?]+/)
      .filter((w) => w && !STOP.test(w))
      .join(" ")
      .trim();
    if (artist) return { kind: "music", artist, source: src };
  }

  // Поиск по базе площадок. Раньше такие фразы уходили в поиск событий
  // и возвращали пустоту — человек делал вывод, что поиск сломан. База
  // и афиша — разные вопросы: «какие клубы есть» и «что там сегодня».
  // Границы слов задаём руками: \b в JS не видит кириллицу и «клубы»
  // мимо такого шаблона проходят молча.
  const VKIND: [string, RegExp][] = [
    ["пляжный клуб", /пляжн[а-яё]*\s*клуб|бич\s*клаб|beach\s*club/],
    ["клуб", /клуб|nightclub/],
    ["бар", /(^|[^а-яё])бар/, ],
    ["ресторан", /ресторан|поесть|поужинать|покушать|поужина/],
    ["лаундж", /лаундж|lounge|rooftop|руфтоп/],
  ];
  const askVenues =
    /(какие|какой|найди|подбери|покажи|список|есть ли|посоветуй|где)/.test(q) ||
    /^(клубы|бары|рестораны|площадки|заведения|база)/.test(q);
  if (askVenues && !/сегодня|завтра|выходн|афиш|событ|играет|лайнап/.test(q)) {
    let kind2: string | undefined;
    for (const [name, re] of VKIND)
      if (re.test(q)) {
        kind2 = name;
        break;
      }
    let d: string | undefined;
    for (const [canon, aliases] of DISTRICTS)
      if (aliases.some((a) => q.includes(a))) {
        d = canon;
        break;
      }
    const PLURAL: Record<string, string> = {
      "клуб": "клубы",
      "бар": "бары",
      "ресторан": "рестораны",
      "лаундж": "лаунджи",
      "пляжный клуб": "пляжные клубы",
    };
    if (kind2 || d)
      return {
        kind: "venues",
        district: d,
        kind2,
        label: [kind2 ? PLURAL[kind2] : "площадки", d].filter(Boolean).join(" · "),
      };
  }

  // Вопрос «как/почему/что такое» — это база знаний GTR, а не афиша.
  // Раньше такое падало в поиск событий и возвращало пустоту, а человек
  // слышал одну и ту же отговорку. Спрашиваем ask_gtr: он держит по
  // несколько формулировок на тему и не повторяет уже сказанную.
  // Хвост (?![а-яё]) обязателен: без него «как» съедает «какие клубы».
  const FAQ_RE =
    /^(каким образом|как|почему|зачем|что такое|что за|чем отлич[а-яё]*|а можно|можно ли|нужно ли|надо ли|стоит ли|во сколько|до скольки|с какого|сколько|правда ли|опасно ли|обязательно ли|безопасно ли|расскажи про|расскажи о|объясни|подскажи по)(?![а-яё])/;
  if (FAQ_RE.test(q)) return { kind: "faq", question: raw.trim() };

  const open = q.match(/^открой\s+(.+)$/);
  if (open)
    for (const [route, aliases] of OPEN_ROUTES)
      if (aliases.some((a) => open[1].includes(a))) return { kind: "open", route };

  // Даты: сегодня / завтра / выходные. По умолчанию — сегодня.
  let dateFrom = bkkDate(0);
  let dateTo = bkkDate(0);
  let label = "на сегодня";
  if (/завтра/.test(q)) {
    dateFrom = dateTo = bkkDate(1);
    label = "на завтра";
  } else if (/выходн|уикенд|weekend/.test(q)) {
    // Ближайшее окно пятница—воскресенье; если уже внутри — до воскресенья.
    const dow = bkkDow();
    const toFri = dow >= 5 || dow === 0 ? 0 : 5 - dow;
    const start = dow === 0 ? 0 : toFri;
    const toSun = dow === 0 ? 0 : 7 - dow;
    dateFrom = bkkDate(start);
    dateTo = bkkDate(toSun);
    label = "на выходные";
  }

  let district: string | undefined;
  for (const [canon, aliases] of DISTRICTS)
    if (aliases.some((a) => q.includes(a))) {
      district = canon;
      break;
    }

  if (district || /сегодня|завтра|выходн|уикенд|weekend/.test(q) || SEARCHY.test(q))
    return { kind: "search", dateFrom, dateTo, district, label: district ? `${label} · ${district}` : label };

  return { kind: "unknown" };
};

// ------------------------------------------------- реплики и форматтеры

export const HELP_LINES = [
  "команды эфира:",
  "  события [район] [сегодня|завтра|выходные]",
  "  какие клубы|бары|рестораны в <районе> — поиск по базе площадок",
  "  детали <номер из списка>",
  "  маршрут — вечер из последней выдачи",
  "  открой карта|артисты|календарь|подбор",
  "можно и по-людски: «что сегодня в патонге»",
];

/** Рабочие команды видит только команда GTR: гостю показывать то, чего
 *  ему всё равно не выполнят, — это обещание, которое продукт не держит. */
export const HELP_TEAM_LINES = [
  "рабочий контур:",
  "  прогноз <площадка> [ГГГГ-ММ-ДД] — сколько людей придёт и почему",
  "  тяга <артист> — оценка тяги 0–100 по частям",
  "спроси словами: «как считать юнит-экономику вечера», «какие каналы промо работают»",
];

const OPENERS = ["Погнали.", "Смотрю базу...", "Секунду, листаю афишу..."];
export const openerFor = (q: string): string => OPENERS[q.length % OPENERS.length];

export const EMPTY_LINE =
  "По базе пусто. Не буду продавать тебе понедельник за Ибицу — попробуй другой район или день.";

type Ev = {
  title?: unknown;
  venue?: unknown;
  start_at?: unknown;
  distance_km?: unknown;
  verification_status?: unknown;
};

export const fmtEvents = (events: Ev[], label: string): string[] => {
  const out = [`нашёл ${events.length} — ${label}:`];
  events.forEach((e, i) => {
    const dist = typeof e.distance_km === "number" ? ` · ${e.distance_km} км` : "";
    out.push(`  ${i + 1}. ${String(e.venue ?? "")} — ${String(e.title ?? "")} · ${String(e.start_at ?? "")}${dist}`);
  });
  out.push("детали <номер> — подробнее; маршрут — соберу вечер");
  return out;
};

type Ven = { name?: unknown; type?: unknown; area?: unknown; music?: unknown; menu?: unknown };

export const fmtVenues = (venues: Ven[], label: string): string[] => {
  const out = [`по базе GTR — ${label}: ${venues.length}`];
  venues.forEach((v, i) => {
    out.push(`  ${i + 1}. ${String(v.name ?? "")} — ${String(v.type ?? "")} · ${String(v.area ?? "")}`);
    if (v.music) out.push(`     звук: ${String(v.music).slice(0, 70)}`);
  });
  out.push("скажи название — расскажу подробно, забронирую стол или вызову такси");
  return out;
};

export const fmtDetails = (d: Record<string, unknown>): string[] => {
  const out = [`${String(d.venue ?? "")} · ${String(d.area ?? "")}`];
  if (d.format) out.push(`формат: ${String(d.format)}`);
  if (Array.isArray(d.genres) && d.genres.length) out.push(`звук: ${(d.genres as string[]).join(", ")}`);
  if (Array.isArray(d.slots))
    for (const s of (d.slots as Record<string, unknown>[]).slice(0, 4))
      out.push(`  ${String(s.from)}–${String(s.to)} · ${String(s.role)} · ${String(s.bpm ?? "")} bpm`);
  if (d.note) out.push(String(d.note));
  return out;
};

export const fmtRoute = (legs: Record<string, unknown>[]): string[] => {
  const out = ["маршрут вечера:"];
  for (const l of legs)
    out.push(
      `  ${String(l.arrive_hour).padStart(2, "0")}:00 → ${String(l.venue)} (${String(l.area ?? "")})${l.slot_role ? ` · ${String(l.slot_role)}` : ""}`,
    );
  out.push("Погнали, брат.");
  return out;
};

// ------------------------------------------------- визитка при открытии
//
// Первое, что человек видит на табло, — не «система готова», а живой
// заход по имени со списком того, что BRO реально умеет. Список собран
// из настоящих инструментов: обещать здесь то, чего нет в tools.ts, —
// значит соврать в первой же строке.

/** Заходы. Функция детерминирована по seed (тестируемо и повторяемо),
 *  а живость даёт вызывающая сторона: BroOverlay передаёт случайный
 *  seed, и человек не слышит одно и то же приветствие два раза подряд.
 *  Стиль — «Йо-йо» и «чё кого»: дерзкий приятель, а не автоответчик. */
const GREET_OPENERS: ((n: string) => string)[] = [
  (n) => `Йо-йо, ${n}! Чё кого сегодня мутим?`,
  (n) => `Чё кого, ${n}? Остров уже проснулся, а ты?`,
  (n) => `Йоу, ${n}, брат! Вечер обещает — я проверил.`,
  (n) => `${n}, здарова! Ты к движу или движ к тебе?`,
  (n) => `Опа, ${n} в здании. Начинаем шоу.`,
  (n) => `Йо, ${n}! Сегодня без репетиций — сразу концерт.`,
  (n) => `${n}, салют! Я уже прошерстил все афиши, пока ты шёл.`,
  (n) => `Ну здравствуй, ${n}. Остров большой, ночь короткая.`,
  (n) => `Йо-йо, ${n}! Погнали, пока лучшие столы не разобрали.`,
  (n) => `${n}, вечер в хату! Куда сегодня целимся?`,
  (n) => `Чё кого, ${n}! Заряжен? Я — да.`,
  (n) => `${n}, наконец-то. Без тебя тут было прилично — исправляем.`,
];

const GREET_CLOSERS: string[] = [
  "Так что сегодня: красиво сидим или разносим танцпол?",
  "Выбирай: культурная программа или та, о которой не расскажешь маме?",
  "Стол с видом или самый громкий угол острова?",
  "Ужин как в кино или ночь как в тумане?",
  "Начнём с устриц или сразу с баса в грудную клетку?",
  "Чилл у моря или мясорубка до рассвета?",
  "Каким делаем вечер: таким, что запомним, или таким, что не вспомним?",
  "Сначала пожрать или сразу в пляс?",
  "Ну что, лёгкий разгон или полный газ?",
  "Куда рулим: закат с коктейлем или клуб до утра?",
];

/** Умения гостя — ровно то, что закрыто инструментами. */
const GREET_GUEST: string[] = [
  "· найти, где сегодня движ — по району, дню и музыке",
  "· собрать маршрут вечера: куда сначала, куда под утро",
  "· забронить стол — зону, лежак, VIP в клубе",
  "· накидать предзаказ по меню: от устриц до вагю, с ценами",
  "· рассказать про артиста: чем берёт зал, где играл, и дать послушать",
  "· найти его музыку и клипы — Spotify, SoundCloud, YouTube",
  "· вызвать такси до места — Grab, Bolt, карта",
  "· открыть любой экран приложения, пока ты держишь коктейль",
];

/** Что добавляется команде и организаторам. */
const GREET_TEAM: string[] = [
  "· завести черновик события на площадке",
  "· найти подрядчиков и технику: звук, свет, LED",
  "· написать команде GTR или в чат сообщества",
];

const TEAM_ROLES = ["gtr", "organizer", "pr", "owner", "sales"];

export const greetLines = (name?: string, role?: string, seed = 0): string[] => {
  const n = (name ?? "").trim().split(/\s+/)[0] || "брат";
  // Разные смеси для захода и концовки — иначе пары ходят строем.
  const i = (n.length + seed) % GREET_OPENERS.length;
  const c = (n.length + seed * 7 + 3) % GREET_CLOSERS.length;
  return [
    GREET_OPENERS[i](n),
    "сегодня я умею:",
    ...GREET_GUEST,
    ...(role && TEAM_ROLES.includes(role) ? GREET_TEAM : []),
    "",
    GREET_CLOSERS[c],
    "жми рацию и говори или пиши сюда — «что сегодня в патонге», «забронируй стол», «помощь»",
  ];
};


// ---------------------------------------------- рабочие сводки команды

type Fc = {
  venue?: unknown; date?: unknown; capacity?: unknown; expected?: unknown;
  low?: unknown; high?: unknown; fill_pct?: unknown; artist?: unknown;
  factors?: { name: string; k: number; why: string }[];
  advice?: unknown[];
};

/** Прогноз явки на табло. Число без множителей — гадание, поэтому
 *  показываем всю арифметику: с ней можно спорить. */
export const fmtForecast = (d: Fc): string[] => {
  const out = [
    `${String(d.venue ?? "")} · ${String(d.date ?? "")}${d.artist ? ` · ${String(d.artist)}` : ""}`,
    `ожидаю ${String(d.expected ?? "?")} чел. (вилка ${String(d.low ?? "?")}–${String(d.high ?? "?")}) — это ${String(d.fill_pct ?? "?")}% зала на ${String(d.capacity ?? "?")}`,
  ];
  for (const f of d.factors ?? []) out.push(`  ×${f.k.toFixed(2)} ${f.name} — ${f.why}`);
  for (const a of (d.advice ?? []) as string[]) out.push(a);
  return out;
};

type Pl = { artist?: unknown; score?: unknown; band?: unknown; fans?: unknown; venues_fit?: unknown; parts?: { name: string; k: number; why: string }[] };

export const fmtPull = (d: Pl): string[] => {
  const out = [`${String(d.artist ?? "")} — тяга ${String(d.score ?? "?")}/100 · ${String(d.band ?? "")}`];
  for (const p of d.parts ?? []) out.push(`  +${p.k} ${p.name} — ${p.why}`);
  out.push("тяга — оценка по нашим данным, а не билеты");
  return out;
};
