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
export async function buildDigestText(ns: KvNs): Promise<string> {
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
  const lines: string[] = [];
  lines.push(`🌴 <b>GTR · Куда пойти на Пхукете</b>`);
  if (tonight.length) {
    lines.push("", `🔥 <b>Сегодня</b>`);
    for (const e of tonight)
      lines.push(`• <b>${tgEsc(e.title.toUpperCase())}</b> — ${tgEsc(e.venueName)}`);
  }
  if (upcoming.length) {
    lines.push("", `📅 <b>Ближайшие вечера</b>`);
    for (const e of upcoming)
      lines.push(`• ${RU_DATE(e.dateIso)} · <b>${tgEsc(e.title.toUpperCase())}</b> — ${tgEsc(e.venueName)}`);
  }
  if (!tonight.length && !upcoming.length) {
    lines.push("", "Программа обновляется — загляни в приложение, там вся карта острова.");
  }
  lines.push("", `🎟 Афиша, бронь столов и подбор вечеринок под твой вкус:`, APP_URL);
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
    "",
    `Погнали! 🚀`,
  ].join("\n");
}

// Пост-приглашение тестовой группы: зовём людей в продукт и в комьюнити
export function buildInviteText(cfg: CommunityCfg): string {
  const lines = [
    `🎉 <b>GTR Event — твой гид по ночному Пхукету</b>`,
    "",
    `104 клуба и бара, 312 артистов, живая афиша на каждый вечер, бронь столов в пару касаний и ИИ-подбор вечеринок под твой вкус.`,
    "",
    `▶ Открыть приложение: ${APP_URL}`,
  ];
  if (cfg.channelUrl) lines.push(`📣 Новости: ${tgEsc(cfg.channelUrl)}`);
  if (cfg.chatUrl) lines.push(`💬 Чат сообщества: ${tgEsc(cfg.chatUrl)}`);
  lines.push(`📩 Связь и сотрудничество: @bangtaostyle`);
  lines.push("", `Мы запускаем тестовую группу — заходи первым и расскажи, чего не хватает. Твои идеи попадут в продукт.`);
  return lines.join("\n");
}
