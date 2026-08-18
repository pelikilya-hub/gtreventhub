// Обучение BRO: перенос следующих тем из бэклога в живую базу знаний.
//
// Используется кроном (11:00 Пхукета, /api/bro-learn) и кнопкой «выучить
// сейчас» на стенде /bro-dev. Обучение намеренно не генеративное: темы
// написаны заранее и проверены — база знаний обязана быть точной.
import lessonsRaw from "../data/bro-lessons.json";
import type { KvNs } from "../kv-ns";
import { kvGetJson } from "../kv-ns";

/** Ключ живой базы знаний: какие темы BRO уже выучил. */
export const LEARNED_KEY = "broqa:learned";

export type Lesson = { id: string; tag: string; title: string; keys: string[]; answers: string[] };
type Learned = { ids: string[]; at?: string };

export const allLessons = (): Lesson[] => (lessonsRaw as { lessons: Lesson[] }).lessons;

export type LearnResult = {
  ok: true;
  learned: string[]; // id выученных этим прогоном
  titles: string[];
  total: number; // всего в живой базе
  left: number; // осталось в бэклоге
};

/** Снимок прогресса без изменения состояния. */
export async function learnProgress(ns: KvNs) {
  const all = allLessons();
  const prev = (await kvGetJson<Learned>(ns, LEARNED_KEY)) ?? { ids: [] };
  const known = new Set(prev.ids);
  const learned = all.filter((l) => known.has(l.id));
  const backlog = all.filter((l) => !known.has(l.id));
  return { learned, backlog, at: prev.at };
}

/** Выучить следующие n тем. Сообщает BOSS в Telegram: обучение без
 *  отчёта неотличимо от его отсутствия. */
export async function learnNext(ns: KvNs, n: number): Promise<LearnResult> {
  const all = allLessons();
  const prev = (await kvGetJson<Learned>(ns, LEARNED_KEY)) ?? { ids: [] };
  const known = new Set(prev.ids);
  const next = all.filter((l) => !known.has(l.id)).slice(0, n);
  if (!next.length)
    return { ok: true, learned: [], titles: [], total: prev.ids.length, left: 0 };

  const ids = [...prev.ids, ...next.map((l) => l.id)];
  const at = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  await ns.put(LEARNED_KEY, JSON.stringify({ ids, at } satisfies Learned));

  const { notifyBossTg } = await import("../kv-api");
  const left = all.length - ids.length;
  await notifyBossTg(
    ns,
    [
      "🎓 <b>BRO выучил новое</b>",
      ...next.map((l) => `• ${l.title} <i>(${l.tag})</i>`),
      "",
      `Всего тем в живой базе: ${ids.length}. В бэклоге осталось: ${left}.`,
    ].join("\n"),
  ).catch(() => {});

  return {
    ok: true,
    learned: next.map((l) => l.id),
    titles: next.map((l) => l.title),
    total: ids.length,
    left,
  };
}
