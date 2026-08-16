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
