// Комьюнити GTR в Telegram: канал (новости) + группа (общение).
// BOSS привязывает их в дашборде: бот проверяет, что добавлен админом,
// и запоминает chat_id. Дальше работают дайджест вечера (кроном и кнопкой),
// пост-приглашение тестовой группы и команда /tonight в чате.
import { cleanEventTitle, isJunkEventTitle } from "./afisha-clean";
import type { VenueAfisha } from "./afisha";
import { kvGetJson, kvListAll, type KvNs } from "./kv-ns";
import { tgApi, tgEsc } from "./tg";

import { APP_URL } from "./app-url";
export { APP_URL };
// Контакт основателя для связи и сотрудничества — показывается в постах
export const OWNER_TG = "https://t.me/bangtaostyle";

export type CommunityCfg = {
  channelUrl?: string;
  chatUrl?: string;
  channelId?: number;
  chatId?: number;
  channelTitle?: string;
  chatTitle?: string;
  channelAdmin?: boolean;
  chatAdmin?: boolean;
  updated?: number;
};

export const COMMUNITY_KEY = "setting:community";

// Из t.me-ссылки или @имени достаём username для getChat
export function tgUsernameOf(url: string): string | null {
  const m = String(url)
    .trim()
    .match(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/);
  return m ? m[1] : null;
}

// Проверка привязки: чат существует и бот в нём админ (иначе постить нельзя)
export async function resolveTgChat(url: string): Promise<
  | { ok: true; id: number; title: string; admin: boolean }
  | { ok: false; reason: string }
> {
  const uname = tgUsernameOf(url);
  if (!uname) return { ok: false, reason: "Ссылка должна быть вида t.me/имя (публичный канал/группа)" };
  const chat = await tgApi<{ id: number; title?: string; username?: string }>("getChat", {
    chat_id: `@${uname}`,
  });
  if (!chat.ok || !chat.result) {
    return { ok: false, reason: `Чат @${uname} не найден: ${chat.description || "нет доступа"}. Бот уже добавлен?` };
  }
  const me = await tgApi<{ id: number }>("getMe", {});
  const member = me.ok && me.result
    ? await tgApi<{ status: string }>("getChatMember", { chat_id: chat.result.id, user_id: me.result.id })
    : { ok: false as const, result: undefined, description: "getMe failed" };
  const admin = Boolean(
    member.ok && member.result && ["administrator", "creator"].includes(member.result.status),
  );
  return { ok: true, id: chat.result.id, title: chat.result.title || `@${uname}`, admin };
}

// Чистая афиша целиком — общая для ленты, дайджеста и /tonight
export async function collectCleanAfisha(ns: KvNs) {
  const { V } = await import("./data/app-data");
  const { bkkToday } = await import("./afisha-parse");
  const keys = await kvListAll(ns, "venueevents:");
  // День острова, а не UTC. Воркер живёт по Гринвичу, Пхукет — на семь часов
  // впереди: до 07:00 по местному UTC-дата ещё вчерашняя, и сегодняшняя
  // программа отсекалась как прошедшая ровно в часы, когда её и смотрят.
  const today = bkkToday();
  const items: (VenueAfisha["events"][number] & { vid: string; venueName: string })[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const rec = await kvGetJson<VenueAfisha>(ns, k);
    const vid = k.slice("venueevents:".length);
    const venueName = V(vid)?.name || "";
    for (const e of rec?.events ?? []) {
      if (e.dateIso < today) continue;
      if (isJunkEventTitle(e.title)) continue;
      const title = cleanEventTitle(e.title, venueName);
      if (isJunkEventTitle(title)) continue;
      const key = `${title.toLowerCase()}|${e.dateIso}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...e, title, vid, venueName });
    }
  }
  items.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return items;
}

const RU_DATE = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Русское склонение при числе: «1 площадка, 2 площадки, 354 площадки».
 *
 *  Мелочь, но она читается как небрежность: описание канала с «354
 *  площадок» видит каждый, кто открывает GTR Live впервые. Числа в наших
 *  текстах живые — сегодня 354, завтра 380, — поэтому форма выбирается
 *  правилом, а не подбирается руками под текущее значение. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// Дайджест вечера: сегодняшняя программа, при тишине — ближайшие дни
// Языки бота: Telegram присылает language_code пользователя — бот отвечает
// на его языке. Канал один на всех, поэтому дайджест туда идёт "dual"
// (RU·EN-метки, контент — названия и площадки — языконезависим).
export type TgLang = "ru" | "en" | "th" | "dual";

// Язык конкретного человека — всегда один. "dual" бывает только у настройки
// канала (пост сразу на двух языках), поэтому сюда он не попадает никогда:
// сужаем тип, иначе каждая словарная таблица требует несуществующей ветки.
export const tgLangOf = (code?: string): Exclude<TgLang, "dual"> => {
  const c = (code || "").toLowerCase();
  if (c.startsWith("ru") || c.startsWith("uk") || c.startsWith("be") || c.startsWith("kk")) return "ru";
  if (c.startsWith("th")) return "th";
  return "en";
};

const DIGEST_L: Record<Exclude<TgLang, "dual">, { head: string; tonight: string; upcoming: string; empty: string; cta: string }> = {
  ru: {
    head: "GTR · Куда пойти на Пхукете",
    tonight: "Сегодня",
    upcoming: "Ближайшие вечера",
    empty: "Программа обновляется — загляни в приложение, там вся карта острова.",
    cta: "афиша, бронь столов и подбор вечеринок под твой вкус",
  },
  en: {
    head: "GTR · Where to go in Phuket",
    tonight: "Tonight",
    upcoming: "Upcoming nights",
    empty: "The lineup is updating — check the app for the full island map.",
    cta: "events, table booking and AI party match",
  },
  th: {
    head: "GTR · เที่ยวไหนดีที่ภูเก็ต",
    tonight: "คืนนี้",
    upcoming: "คืนถัดไป",
    empty: "โปรแกรมกำลังอัปเดต — เปิดแอปดูแผนที่ทั้งเกาะได้เลย",
    cta: "อีเวนต์ จองโต๊ะ และ AI จับคู่ปาร์ตี้",
  },
};

/** Дайджест целиком: текст плюс афиши к нему.
 *
 *  Раньше «Куда сегодня пойти» уходило голой простынёй текста — в ленте
 *  канала это выглядит как объявление, мимо которого листают. Теперь у
 *  вечера есть лицо: альбом афиш, а каждое событие в тексте — ссылка,
 *  которая открывает программу этой площадки прямо в приложении.
 *
 *  Картинки собираются строго растровые (см. posterPhoto): Telegram не
 *  умеет SVG, а один негодный элемент роняет альбом целиком. */
export type Digest = { text: string; photos: string[] };

export async function buildDigest(ns: KvNs, lang: TgLang = "dual"): Promise<Digest> {
  const text = await buildDigestText(ns, lang);
  const { bkkToday } = await import("./afisha-parse");
  const { richOf } = await import("./data/app-data");
  const { posterPhoto } = await import("./poster");
  const items = await collectCleanAfisha(ns);
  const today = bkkToday();
  const photos: string[] = [];
  const seenVenue = new Set<string>();
  for (const e of items) {
    if (e.dateIso !== today) continue;
    // По одной афише с площадки: десять карточек одного клуба — это не
    // альбом вечера, а его реклама.
    if (seenVenue.has(e.vid)) continue;
    const p = posterPhoto(APP_URL, e.vid, e, richOf(e.vid).hero);
    if (!p) continue;
    seenVenue.add(e.vid);
    photos.push(p);
    if (photos.length >= 8) break; // предел альбома Telegram — 10, берём с запасом
  }
  return { text, photos };
}

export async function buildDigestText(ns: KvNs, lang: TgLang = "dual"): Promise<string> {
  const items = await collectCleanAfisha(ns);
  // День острова, а не UTC. Отбор в collectCleanAfisha уже идёт по
  // пхукетской дате, и разъезд этих двух «сегодня» ронял программу дня в
  // раздел «ближайшие вечера» каждую ночь после полуночи по местному —
  // ровно в те часы, когда команду /tonight и зовут.
  const { bkkToday } = await import("./afisha-parse");
  const today = bkkToday();
  const tonight = items.filter((e) => e.dateIso === today).slice(0, 8);
  // не даём одной площадке забить весь дайджест — максимум 2 строки на неё
  const perVenue = new Map<string, number>();
  const upcoming: typeof items = [];
  for (const e of items) {
    if (e.dateIso <= today) continue;
    if ((perVenue.get(e.vid) ?? 0) >= 2) continue;
    perVenue.set(e.vid, (perVenue.get(e.vid) ?? 0) + 1);
    upcoming.push(e);
    if (upcoming.length >= 8 - Math.min(tonight.length, 8)) break;
  }
  // dual: русская метка · английская — контент один и тот же
  const pick = (k: keyof (typeof DIGEST_L)["ru"]) =>
    lang === "dual" ? `${DIGEST_L.ru[k]} · ${DIGEST_L.en[k]}` : DIGEST_L[lang][k];
  // Каждое событие — ссылка в приложение на программу этой площадки.
  // Раньше дайджест был простынёй текста: человек читал «сегодня в Illuzion»
  // и шёл искать это вручную. Теперь тап по названию открывает вечер.
  const evUrl = (vid: string) => `${APP_URL}/gtr/tonight?vid=${encodeURIComponent(vid)}`;
  const evLink = (e: { vid: string; title: string }) =>
    `<a href="${evUrl(e.vid)}"><b>${tgEsc(e.title.toUpperCase())}</b></a>`;

  const lines: string[] = [];
  lines.push(`🌴 <b>${lang === "dual" ? `${DIGEST_L.ru.head} · Phuket night guide` : DIGEST_L[lang].head}</b>`);
  if (tonight.length) {
    lines.push("", `🔥 <b>${pick("tonight")}</b>`);
    for (const e of tonight) lines.push(`• ${evLink(e)} — ${tgEsc(e.venueName)}`);
  }
  if (upcoming.length) {
    lines.push("", `📅 <b>${pick("upcoming")}</b>`);
    for (const e of upcoming)
      lines.push(`• ${RU_DATE(e.dateIso)} · ${evLink(e)} — ${tgEsc(e.venueName)}`);
  }
  if (!tonight.length && !upcoming.length) {
    lines.push("", pick("empty"));
  }
  // ссылка — только под кнопкой у отправителя, в тексте её нет вообще
  lines.push("", `🎫 ${pick("cta")}`);
  return lines.join("\n");
}

// ---------- опросы: вовлечение вместо вещания ----------
//
// Канал, который только объявляет, читают вполглаза. Опрос — единственный
// формат, где участие стоит один тап и виден результат: человек голосует,
// видит, что думают остальные, и возвращается посмотреть итог. Плюс это
// честная разведка спроса — что за аудитория и куда она собирается.
//
// Два вида. Первый — про сегодняшний вечер: варианты собираются из живой
// афиши, поэтому опрос заодно работает витриной программы. Второй —
// тематический, на случай тихого дня; темы крутятся по номеру дня, чтобы
// один и тот же вопрос не приходил дважды за неделю.

export type TgPoll = {
  /** Вопрос начинается с эмодзи из фирменного пака: tgApi подменит его на
   *  наш знак, если отправить с question_parse_mode: "HTML". Знак в опросе
   *  разглядывают дольше, чем где-либо ещё в ленте. */
  question: string;
  options: string[];
  /** несколько ответов: уместно там, где выбор не взаимоисключающий */
  multiple?: boolean;
};

// Пределы Telegram: вопрос 300 знаков, вариант 100, вариантов 2–10.
const POLL_Q_MAX = 300;
const POLL_OPT_MAX = 100;
const POLL_OPTS_MAX = 10;

/** Подрезать опрос под пределы Telegram. Ответ длиннее сотни знаков API не
 *  принимает вовсе — молча отправить «почти опрос» нельзя. */
export const fitPoll = (p: TgPoll): TgPoll => ({
  question: p.question.slice(0, POLL_Q_MAX),
  options: [...new Set(p.options.map((o) => o.trim().slice(0, POLL_OPT_MAX)).filter(Boolean))].slice(
    0,
    POLL_OPTS_MAX,
  ),
  multiple: p.multiple,
});

const THEME_POLLS: TgPoll[] = [
  {
    question: "🕐 Во сколько выходишь? · What time do you head out?",
    options: ["До 22:00 · Before 10pm", "22:00–00:00 · 10pm–midnight", "После полуночи · After midnight", "Я уже там · Already out"],
  },
  {
    question: "🎚 Что решает при выборе места? · What makes the place?",
    options: ["Музыка · Music", "Люди · The crowd", "Вид и локация · The view", "Цена входа · The price"],
    multiple: true,
  },
  {
    question: "🌴 Пляжный клуб или ночной? · Beach club or nightclub?",
    options: ["Пляжный днём · Beach by day", "Ночной до утра · Club till morning", "И то и то · Both", "Бар потише · A quiet bar"],
  },
  {
    question: "🎧 Какой звук твой? · What's your sound?",
    options: ["Хаус · House", "Техно · Techno", "Хип-хоп · Hip-hop", "Латина · Latin", "Лайв-музыка · Live music"],
    multiple: true,
  },
  {
    question: "🚪 Что мешает выбраться вечером? · What stops you going out?",
    options: ["Не знаю куда · Don't know where", "Далеко ехать · Too far", "Дорого · Too pricey", "Ничего, я иду · Nothing, I'm out"],
  },
  {
    question: "🍸 Стол бронируешь заранее? · Do you book a table ahead?",
    options: ["Да, всегда · Always", "Иногда · Sometimes", "Иду без стола · Never bother", "Ни разу не пробовал(а) · Never tried"],
  },
  {
    question: "🤝 С кем идёшь чаще? · Who do you go out with?",
    options: ["Один(а) · Solo", "Вдвоём · As a pair", "Компанией · With friends", "Как получится · Depends"],
  },
];

/** Тематический опрос по номеру дня: темы крутятся, не повторяясь неделями. */
export const buildThemePoll = (dayNo: number): TgPoll =>
  fitPoll(THEME_POLLS[Math.abs(Math.trunc(dayNo)) % THEME_POLLS.length]);

/** Опрос про сегодняшний вечер: варианты — площадки из живой афиши.
 *  null, если программы на сегодня нет или её слишком мало для выбора. */
export async function buildTonightPoll(ns: KvNs): Promise<TgPoll | null> {
  const { bkkToday } = await import("./afisha-parse");
  const today = bkkToday();
  const names: string[] = [];
  for (const e of await collectCleanAfisha(ns)) {
    if (e.dateIso !== today) continue;
    const name = e.venueName || e.title;
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= POLL_OPTS_MAX - 1) break;
  }
  if (names.length < 2) return null;
  return fitPoll({
    question: "🪩 Куда сегодня? · Where are you going tonight?",
    // «Сижу дома» — не шутка, а рабочий вариант: без него голосуют только
    // те, кто уже собрался, и картина спроса выходит нарисованной.
    options: [...names, "Сижу дома · Staying in"],
  });
}

/** Опрос дня: сначала пробуем живой вечер, иначе — тема из ротации. */
export async function buildPoll(ns: KvNs, dayNo: number): Promise<TgPoll> {
  return (await buildTonightPoll(ns)) ?? buildThemePoll(dayNo);
}

/** Номер дня по пхукетскому времени — сеятель ротации тем и признак того,
 *  какой сегодня день недели на острове, а не в Гринвиче. */
export const bkkDayNo = (now = Date.now()) => Math.floor((now + 7 * 3600e3) / 86400e3);
export const bkkWeekday = (now = Date.now()) => new Date(now + 7 * 3600e3).getUTCDay();

// ---------- служебный контур: изоляция от публичного ----------
// Всё техническое (уведомления команде, метрики) не имеет права попадать
// в публичный канал/чат комьюнити — даже если id перепутан в переменных.

export const OPS_KEY = "setting:ops";
export type OpsCfg = { chatId: number; title?: string; bound?: number };

// Пропускает id только если это НЕ публичный чат комьюнити; иначе ""
export async function guardInternalChatId(
  ns: KvNs,
  chatId: string | number | undefined | null,
): Promise<string> {
  if (!chatId) return "";
  const cfg = await kvGetJson<CommunityCfg>(ns, COMMUNITY_KEY);
  const s = String(chatId);
  if (cfg && (s === String(cfg.channelId ?? "∅") || s === String(cfg.chatId ?? "∅"))) return "";
  return s;
}

// Счётчики дня: вступления/выходы канала и чата, регистрации
export type DayMetrics = { chJoin: number; chLeave: number; gJoin: number; gLeave: number; reg: number };
const EMPTY_DAY: DayMetrics = { chJoin: 0, chLeave: 0, gJoin: 0, gLeave: 0, reg: 0 };

export async function bumpMetric(ns: KvNs, field: keyof DayMetrics): Promise<void> {
  const key = `mstat:${new Date().toISOString().slice(0, 10)}`;
  const cur = (await kvGetJson<DayMetrics>(ns, key)) ?? { ...EMPTY_DAY };
  cur[field] = (cur[field] ?? 0) + 1;
  await ns.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 45 });
}

// Ежедневная сводка метрик для служебного контура
export async function buildOpsSummary(ns: KvNs): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const m = (await kvGetJson<DayMetrics>(ns, `mstat:${today}`)) ?? { ...EMPTY_DAY };
  const cfg = await kvGetJson<CommunityCfg>(ns, COMMUNITY_KEY);
  const count = async (id?: number) => {
    if (!id) return "—";
    const r = await tgApi<number>("getChatMemberCount", { chat_id: id });
    return r.ok ? String(r.result) : "—";
  };
  const chN = await count(cfg?.channelId);
  const gN = await count(cfg?.chatId);
  // топ инвайтеров
  const { kvListAll } = await import("./kv-ns");
  const keys = await kvListAll(ns, "refscore:");
  const rows: { n: number; name: string }[] = [];
  for (const k of keys) {
    const v = await kvGetJson<{ n: number; name: string }>(ns, k);
    if (v?.n) rows.push(v);
  }
  rows.sort((a, b) => b.n - a.n);
  const lines = [
    `📊 <b>GTR OPS · сводка за ${today}</b>`,
    "",
    `🔊 Канал: <b>${chN}</b> подписчиков · за день +${m.chJoin} / −${m.chLeave}`,
    `💬 Чат: <b>${gN}</b> участников · за день +${m.gJoin} / −${m.gLeave}`,
    `🆕 Регистраций в приложении: <b>${m.reg}</b>`,
  ];
  if (rows.length) {
    lines.push("", `🏆 Топ инвайтеров: ${rows.slice(0, 3).map((r) => `${tgEsc(r.name)} (${r.n})`).join(" · ")}`);
  }
  return lines.join("\n");
}

// Конкурсный пост: правила + deep-link на бота, который выдаёт личную ссылку
export function buildContestText(): string {
  return [
    `🏆 <b>КОНКУРС: приведи друзей — забери вечер</b>`,
    "",
    `Всё просто:`,
    `1️⃣ Жми кнопку под постом — бот выдаст твою личную ссылку на канал`,
    `2️⃣ Зови по ней друзей`,
    `3️⃣ Каждый вступивший — балл тебе. Таблица лидеров: /top у бота`,
    "",
    `🎁 Топ-3 инвайтера получают призы от GTR — стол на вечеринке и гостевой список.`,
    `⏳ Конкурс идёт до 1 сентября, награждение — в прямом эфире!`,
    "",
    `Погнали! 🚀`,
  ].join("\n");
}

// ---------- переезд на постоянный адрес ----------
// Продукт жил на техническом адресе воркера: такую ссылку не запомнить, не
// продиктовать и стыдно отправить площадке. Теперь дом постоянный —
// gtrevent.com, — и об этом надо сказать вслух один раз и громко: пост
// закрепляется в канале и остаётся первым, что видит новый подписчик.
//
// Канал двуязычный, поэтому и пост двуязычный: русские строки, следом
// английские. Ссылки в теле не пишем — они уходят в кнопки, так их видно
// на любом клиенте и они не превращаются в серую простыню.
export function buildMovedText(venues: number, artists: number): string {
  return [
    `🚀 <b>GTR EVENT ПЕРЕЕХАЛ НА ПОСТОЯННЫЙ АДРЕС</b>`,
    `<b>gtrevent.com</b>`,
    "",
    `Больше никаких технических ссылок. Один адрес — навсегда, его легко продиктовать другу и не стыдно отправить площадке.`,
    "",
    `🌴 <b>${venues} ${plural(venues, "площадка", "площадки", "площадок")} Таиланда</b> — Пхукет, Самуи, Панган, Паттайя, Бангкок, Пханг-Нга`,
    `🎧 <b>${artists} ${plural(artists, "артист", "артиста", "артистов")}</b> с музыкой и послужным списком`,
    `📅 <b>Живая афиша на каждый вечер</b> — кто играет, где и во сколько`,
    `🍸 <b>Бронь стола</b> в пару касаний, ответ за 15 минут`,
    `🪩 <b>ИИ-подбор вечеринок</b> под твой музыкальный вкус`,
    "",
    `🚀 <b>Поставь на телефон как приложение</b>`,
    `iPhone: открой gtrevent.com в Safari → «Поделиться» → «На экран «Домой»`,
    `Android: открой в Chrome → меню ⋮ → «Установить приложение»`,
    `Иконка встанет на главный экран, открывается на весь экран, без адресной строки.`,
    "",
    `👤 <b>Заведи аккаунт</b> — афиша подстроится под твой вкус, откроются бронь, маршрут вечера и баллы за активность.`,
    "",
    `— — —`,
    "",
    `🚀 <b>GTR EVENT HAS MOVED TO ITS PERMANENT HOME</b>`,
    `<b>gtrevent.com</b>`,
    "",
    `${venues} venues across Thailand, ${artists} artists, a live lineup for every night, table booking in two taps and an AI party match for your taste.`,
    "",
    `🚀 Install it: iPhone — Safari → Share → Add to Home Screen. Android — Chrome → ⋮ → Install app.`,
    `👤 Create an account and the lineup starts matching your music.`,
  ].join("\n");
}

// Пост-приглашение тестовой группы: зовём людей в продукт и в комьюнити.
// linksAsText=true — для ручного копипаста (WhatsApp и т.п., где кнопок
// не бывает); false — когда пост шлёт сам бот, там ссылки только в кнопках.
export function buildInviteText(cfg: CommunityCfg, linksAsText = true): string {
  const lines = [
    `🍾 <b>GTR Event — твой гид по ночному Пхукету</b>`,
    "",
    `110 клубов и баров, 312 артистов, живая афиша на каждый вечер, бронь столов в пару касаний и ИИ-подбор вечеринок под твой вкус.`,
  ];
  if (linksAsText) {
    lines.push("", `▶ Открыть приложение: ${APP_URL}`);
    if (cfg.channelUrl) lines.push(`🔊 Новости: ${tgEsc(cfg.channelUrl)}`);
    if (cfg.chatUrl) lines.push(`💬 Чат сообщества: ${tgEsc(cfg.chatUrl)}`);
  }
  lines.push(`📩 Связь и сотрудничество: @bangtaostyle`);
  lines.push("", `Мы запускаем тестовую группу — заходи первым и расскажи, чего не хватает. Твои идеи попадут в продукт.`);
  return lines.join("\n");
}
