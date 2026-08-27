// Дайджест гостя: из живой афиши выбираем «самое шумное событие сегодня»
// для геро-промо и считаем сводку по острову. Чистые функции — вся логика
// ранжирования тестируется без сети и без React.

export type DigestEvent = {
  id: string;
  vid: string;
  title: string;
  dateIso: string; // YYYY-MM-DD
  poster?: string;
  artistIds: string[];
};

/** Насколько «громкое» событие: наш артист в лайнапе весит больше всего,
 *  затем наличие постера (есть чем показать промо), затем длина названия
 *  как грубый прокси проработанности карточки. Детерминированно —
 *  порядок при равных очках стабилен, без Math.random. */
export function loudness(e: DigestEvent): number {
  let s = 0;
  if (e.artistIds.length) s += 100 + Math.min(e.artistIds.length, 5) * 5;
  if (e.poster) s += 40;
  s += Math.min(e.title.trim().length, 40);
  return s;
}

/** Самое шумное событие на дату todayIso. null, если на сегодня афиши нет —
 *  тогда геро откатывается к дежурному видео. Постер не обязателен: без
 *  картинки событие всё равно может стать заголовком вечера. */
export function pickHeadliner(events: DigestEvent[], todayIso: string): DigestEvent | null {
  const today = events.filter((e) => e.dateIso === todayIso);
  if (!today.length) return null;
  return today
    .slice()
    .sort((a, b) => loudness(b) - loudness(a) || (a.id < b.id ? -1 : 1))[0];
}

/** Сводка по острову на дату: сколько событий и в скольких заведениях.
 *  Это «новости индустрии» уровня гостя — из реальных данных, без выдумок. */
export function islandDigest(
  events: DigestEvent[],
  todayIso: string,
): { events: number; venues: number; withArtist: number } {
  const today = events.filter((e) => e.dateIso === todayIso);
  const venues = new Set(today.map((e) => e.vid));
  return {
    events: today.length,
    venues: venues.size,
    withArtist: today.filter((e) => e.artistIds.length).length,
  };
}
