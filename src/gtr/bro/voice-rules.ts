// Ответ голосом по правилам — без единой нейросети.
//
// Стабильная полоса (local-voice.ts) думает нашим текстовым каскадом.
// Каскад двойной — Gemini и свой Qwen, — но ночь, когда молчат оба,
// уже случалась: мозг на своей машине пролежал сутки. Тогда полоса,
// названная стабильной, отвечала «мозг не отвечает», хотя вся афиша и
// вся база площадок лежат в нашем KV и достаются инструментами без
// всякой модели. Этот модуль и есть последний рубеж: разбор вопроса —
// правила из text.ts, факты — только из инструментов.
//
// Фразы здесь свои, а не из fmtEvents/fmtVenues: те писались для табло
// и говорят «детали ‹номер›», «маршрут» — экранные подсказки, которые
// вслух звучат мусором, да и нумерованный список ухом не берётся.
// Голосу нужны одна-две фразы и два-три названия.

import type { BroCard } from "./session";
import { planOf } from "./text";
import { safetyOf } from "./safety";

export type ToolCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ ok?: boolean; data?: Record<string, unknown>; error?: string }>;

export type RulesReply = { say: string; cards: BroCard[] };

/** Боевой вызов инструмента. Вынесен от rulesReply, чтобы правила
 *  проверялись тестами без сети. */
export const callBroTool: ToolCall = async (name, args) => {
  try {
    const r = await fetch("/api/gtr-bro-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name, args, callId: "voice-rules" }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await r.json()) as { result?: { ok?: boolean; data?: Record<string, unknown>; error?: string } };
    return data.result ?? { ok: false, error: `HTTP ${r.status}` };
  } catch {
    return { ok: false, error: "network" };
  }
};

type Ev = Record<string, unknown>;

/** Событие одной фразой: «Illuzion — Techno Night, в 23:00». */
export const evPhrase = (e: Ev): string => {
  const venue = String(e.venue ?? "").trim();
  const title = String(e.title ?? "").trim();
  const at = String(e.start_at ?? "").trim();
  // Из «2026-08-26T23:00» ухо берёт только время.
  const time = /(\d{1,2}:\d{2})/.exec(at)?.[1] ?? "";
  const head = venue && title ? `${venue} — ${title}` : venue || title;
  return time ? `${head}, в ${time}` : head;
};

/** Перечисление на слух: «A, B и C». Больше трёх ухо не удержит. */
export const listPhrase = (parts: string[], and: string): string => {
  const p = parts.filter(Boolean).slice(0, 3);
  if (p.length <= 1) return p[0] ?? "";
  return `${p.slice(0, -1).join(", ")} ${and} ${p[p.length - 1]}`;
};

const RU = {
  found: (n: number) => (n === 1 ? "Нашёл одно:" : `Нашёл ${n}:`),
  and: "и",
  empty: "На эту дату по базе пусто. Спроси другой день или район.",
  near: "Ближайшее по базе:",
  venues: "По базе:",
  noVenues: "Таких площадок в базе нет.",
  greet: "На связи. Спроси, что сегодня, или назови район.",
  nothing: "Такого не знаю. Спроси про вечер, площадку или район.",
};

const EN = {
  found: (n: number) => (n === 1 ? "Found one:" : `Found ${n}:`),
  and: "and",
  empty: "Nothing in the base for that date. Try another day or area.",
  near: "Closest I have:",
  venues: "From the base:",
  noVenues: "No venues like that in the base.",
  greet: "I'm here. Ask what's on tonight, or name an area.",
  nothing: "I don't know that one. Ask about a night, a venue or an area.",
};

/** Ответ по правилам. null — правила не потянули, пусть решает вызвавший.
 *  lang — язык обвязки; факты (названия, время) языка не имеют, а ответ
 *  базы знаний уходит как есть: он уже написан человеческим языком, и
 *  озвучка сама подберёт голос по его буквам. */
export const rulesReply = async (
  raw: string,
  callTool: ToolCall,
  lang = "en",
): Promise<RulesReply | null> => {
  const q = raw.trim();
  if (!q) return null;
  const T = lang.startsWith("ru") ? RU : EN;

  // Безопасность отвечает первой и одинаково в любую ночь — по-русски,
  // как в тексте: это выверенные формулировки, переписывать их на лету
  // ради языка разговора нельзя.
  const risk = safetyOf(q);
  if (risk) return { say: risk.hint ? `${risk.reply} ${risk.hint}` : risk.reply, cards: [] };

  const plan = planOf(q);

  if (plan.kind === "greet") return { say: T.greet, cards: [] };

  if (plan.kind === "faq") {
    const r = await callTool("ask_gtr", { question: plan.question });
    const answer = String(r.data?.answer ?? "").trim();
    return answer ? { say: answer, cards: [] } : null;
  }

  if (plan.kind === "search") {
    const r = await callTool("search_events", {
      dateFrom: plan.dateFrom,
      dateTo: plan.dateTo,
      district: plan.district,
      limit: 5,
    });
    if (!r.ok) return null;
    const events = (r.data?.events as Ev[] | undefined) ?? [];
    if (events.length) {
      const said = listPhrase(events.map(evPhrase), T.and);
      return {
        say: `${T.found(events.length)} ${said}.`,
        cards: events.slice(0, 3).map((data) => ({ kind: "event" as const, data })),
      };
    }
    // Пустой день — не тупик: сразу отдаём ближайшее живое, иначе
    // человек решит, что поиск сломан.
    const near = (r.data?.nearest as Ev[] | undefined) ?? [];
    if (near.length)
      return {
        say: `${T.empty} ${T.near} ${listPhrase(near.map(evPhrase), T.and)}.`,
        cards: near.slice(0, 3).map((data) => ({ kind: "event" as const, data })),
      };
    return { say: T.empty, cards: [] };
  }

  if (plan.kind === "venues") {
    const r = await callTool("search_venues", {
      district: plan.district,
      kind: plan.kind2,
      limit: 5,
    });
    if (!r.ok) return null;
    const venues = (r.data?.venues as Ev[] | undefined) ?? [];
    if (!venues.length) return { say: T.noVenues, cards: [] };
    const names = venues.map((v) => String(v.name ?? "").trim());
    return {
      say: `${T.venues} ${listPhrase(names, T.and)}.`,
      cards: venues.slice(0, 3).map((data) => ({ kind: "venue" as const, data })),
    };
  }

  // Остальное — экранное: «детали третий», маршрут из последней выдачи,
  // навигация по приложению. Ухом это не работает и подменять его
  // выдуманной фразой нельзя.
  if (plan.kind === "unknown" || plan.kind === "help") return { say: T.nothing, cards: [] };
  return null;
};
