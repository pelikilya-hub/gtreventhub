// Комьюнити GTR в Telegram: канал (новости) + группа (общение).
// BOSS привязывает их в дашборде: бот проверяет, что добавлен админом,
// и запоминает chat_id. Дальше работают дайджест вечера (кроном и кнопкой),
// пост-приглашение тестовой группы и команда /tonight в чате.
import { cleanEventTitle, isJunkEventTitle } from "./afisha-clean";
import type { VenueAfisha } from "./afisha";
import { kvGetJson, kvListAll, type KvNs } from "./kv-ns";
import { tgApi, tgEsc } from "./tg";

export const APP_URL = "https://gtr-event-hub.gtr-event.workers.dev";
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
  const keys = await kvListAll(ns, "venueevents:");
  const today = new Date().toISOString().slice(0, 10);
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

// Дайджест вечера: сегодняшняя программа, при тишине — ближайшие дни
// Языки бота: Telegram присылает language_code пользователя — бот отвечает
// на его языке. Канал один на всех, поэтому дайджест туда идёт "dual"
// (RU·EN-метки, контент — названия и площадки — языконезависим).
export type TgLang = "ru" | "en" | "th" | "dual";

export const tgLangOf = (code?: string): TgLang => {
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

export async function buildDigestText(ns: KvNs, lang: TgLang = "dual"): Promise<string> {
  const items = await collectCleanAfisha(ns);
  const today = new Date().toISOString().slice(0, 10);
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
  const lines: string[] = [];
  lines.push(`🌴 <b>${lang === "dual" ? `${DIGEST_L.ru.head} · Phuket night guide` : DIGEST_L[lang].head}</b>`);
  if (tonight.length) {
    lines.push("", `🔥 <b>${pick("tonight")}</b>`);
    for (const e of tonight)
      lines.push(`• <b>${tgEsc(e.title.toUpperCase())}</b> — ${tgEsc(e.venueName)}`);
  }
  if (upcoming.length) {
    lines.push("", `📅 <b>${pick("upcoming")}</b>`);
    for (const e of upcoming)
      lines.push(`• ${RU_DATE(e.dateIso)} · <b>${tgEsc(e.title.toUpperCase())}</b> — ${tgEsc(e.venueName)}`);
  }
  if (!tonight.length && !upcoming.length) {
    lines.push("", pick("empty"));
  }
  // ссылка — только под кнопкой у отправителя, в тексте её нет вообще
  lines.push("", `🎟 ${pick("cta")}`);
  return lines.join("\n");
}

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
    `📣 Канал: <b>${chN}</b> подписчиков · за день +${m.chJoin} / −${m.chLeave}`,
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

// Пост-приглашение тестовой группы: зовём людей в продукт и в комьюнити.
// linksAsText=true — для ручного копипаста (WhatsApp и т.п., где кнопок
// не бывает); false — когда пост шлёт сам бот, там ссылки только в кнопках.
export function buildInviteText(cfg: CommunityCfg, linksAsText = true): string {
  const lines = [
    `🎉 <b>GTR Event — твой гид по ночному Пхукету</b>`,
    "",
    `104 клуба и бара, 312 артистов, живая афиша на каждый вечер, бронь столов в пару касаний и ИИ-подбор вечеринок под твой вкус.`,
  ];
  if (linksAsText) {
    lines.push("", `▶ Открыть приложение: ${APP_URL}`);
    if (cfg.channelUrl) lines.push(`📣 Новости: ${tgEsc(cfg.channelUrl)}`);
    if (cfg.chatUrl) lines.push(`💬 Чат сообщества: ${tgEsc(cfg.chatUrl)}`);
  }
  lines.push(`📩 Связь и сотрудничество: @bangtaostyle`);
  lines.push("", `Мы запускаем тестовую группу — заходи первым и расскажи, чего не хватает. Твои идеи попадут в продукт.`);
  return lines.join("\n");
}
