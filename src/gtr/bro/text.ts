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

export type TextPlan =
  | { kind: "help" }
  | { kind: "greet" }
  | { kind: "search"; dateFrom: string; dateTo: string; district?: string; label: string }
  | { kind: "details"; index: number }
  | { kind: "route" }
  | { kind: "open"; route: string }
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
  // «привет» и «что умеешь» — это не поиск афиши, это знакомство.
  // \b в JS считает границей только ASCII — для кириллицы конец слова
  // приходится задавать явно, иначе «привет» не матчится вовсе, а «ку»
  // проглотило бы «куда пойти».
  if (/^(привет(ик|ствую)?|здаров(а|о)?|здорово|хай|йо|ку|hi|hello|салют)(?:[\s!,.?)]|$)/.test(q))
    return { kind: "greet" };
  if (/(что|чё|че).{0,12}(умеешь|можешь)|твои возможност|расскажи.{0,10}себе|кто ты/.test(q))
    return { kind: "greet" };

  const det = q.match(/^(детали|подробнее|инфо)\s+(\d{1,2})$/);
  if (det) return { kind: "details", index: Number(det[2]) };

  if (/^маршрут/.test(q)) return { kind: "route" };

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
  "  детали <номер из списка>",
  "  маршрут — вечер из последней выдачи",
  "  открой карта|артисты|календарь|подбор",
  "можно и по-людски: «что сегодня в патонге»",
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

/** Заходы. Выбор детерминированный (по имени и дню), чтобы одному
 *  человеку в один вечер не сыпалось всё подряд, а тестировать было
 *  можно повторяемо. */
const GREET_OPENERS: ((n: string) => string)[] = [
  (n) => `Ну что, ${n}, сам напросился. Поехали.`,
  (n) => `О, ${n} нарисовался. Значит, вечер уже не пустой.`,
  (n) => `${n}, ты вовремя. Я как раз доедал чужую афишу.`,
  (n) => `Здарова, ${n}. Пока ты думал — я уже всё посмотрел.`,
  (n) => `${n}, слушай сюда. Один раз рассказываю, что я умею.`,
];

const GREET_CLOSERS: string[] = [
  "Ну что, вкусно пожрать или нажраться до беспамятства?",
  "Тебе сегодня красиво сидеть или разносить танцпол?",
  "Выбирай: культурная программа или та, о которой не рассказывают маме?",
  "Так что берём — стол с видом или самый громкий угол острова?",
];

/** Умения гостя — ровно то, что закрыто инструментами. */
const GREET_GUEST: string[] = [
  "· найти, где сегодня движ — по району, дню и музыке",
  "· собрать маршрут вечера: куда сначала, куда под утро",
  "· забронить стол в Café del Mar — зону, лежак, VIP в клубе",
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
  const i = (n.length + seed) % GREET_OPENERS.length;
  const c = (n.length + seed) % GREET_CLOSERS.length;
  return [
    GREET_OPENERS[i](n),
    "сегодня я умею:",
    ...GREET_GUEST,
    ...(role && TEAM_ROLES.includes(role) ? GREET_TEAM : []),
    "",
    GREET_CLOSERS[c],
    "жми рацию и говори или пиши сюда — «что сегодня в патонге», «столы в кафе дель мар», «помощь»",
  ];
};
