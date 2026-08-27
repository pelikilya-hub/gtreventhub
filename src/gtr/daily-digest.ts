// Сводка дня для команды и организатора: что реально произошло на платформе
// за сегодня. Только измеримые сигналы — афиша, регистрации, черновики,
// заявки. Чистые функции, тестируются без сети.

export type DigestAfishaEvent = { vid: string; dateIso: string; artistIds: string[] };
export type DigestUser = { role: string; created: number };
export type WithTs = { ts?: number; updated?: number; created?: number };

/** Афиша на дату: сколько событий, в скольких заведениях и топ заведений
 *  по числу событий. Отвечает на «в каких заведениях есть мероприятия». */
export function eventsToday(
  events: DigestAfishaEvent[],
  todayIso: string,
): { total: number; venues: number; withArtist: number; byVenue: { vid: string; count: number }[] } {
  const today = events.filter((e) => e.dateIso === todayIso);
  const counts = new Map<string, number>();
  for (const e of today) counts.set(e.vid, (counts.get(e.vid) ?? 0) + 1);
  const byVenue = [...counts.entries()]
    .map(([vid, count]) => ({ vid, count }))
    .sort((a, b) => b.count - a.count || (a.vid < b.vid ? -1 : 1));
  return {
    total: today.length,
    venues: counts.size,
    withArtist: today.filter((e) => e.artistIds.length).length,
    byVenue,
  };
}

/** Регистрации за сегодня по типам: площадки (owner), организаторы, артисты,
 *  команда. dayStartMs — начало суток в нужном часовом поясе. */
export function signupsToday(
  users: DigestUser[],
  dayStartMs: number,
): { venues: number; organizers: number; artists: number; team: number; total: number } {
  const fresh = users.filter((u) => (u.created ?? 0) >= dayStartMs);
  const isTeam = (r: string) => r === "gtr" || r === "sales" || r === "pr";
  return {
    venues: fresh.filter((u) => u.role === "owner").length,
    organizers: fresh.filter((u) => u.role === "organizer").length,
    artists: fresh.filter((u) => u.role === "artist").length,
    team: fresh.filter((u) => isTeam(u.role)).length,
    total: fresh.length,
  };
}

/** Сколько записей создано/обновлено сегодня. Сидовые записи без реального
 *  времени (ts ≈ 0) не в счёт — как и в живой ленте боса. */
export function createdToday(items: WithTs[], dayStartMs: number): number {
  return items.filter((i) => {
    const ts = i.ts ?? i.updated ?? i.created ?? 0;
    return ts > 1e12 && ts >= dayStartMs;
  }).length;
}

/** Начало сегодняшних суток по Пхукету (UTC+7) в миллисекундах UTC.
 *  Тот же пояс, что и «Сегодня» в афише — сутки не должны разъезжаться. */
export function phuketDayStart(nowMs: number): number {
  const TZ = 7 * 3600_000;
  const local = nowMs + TZ;
  const dayLocal = Math.floor(local / 86_400_000) * 86_400_000;
  return dayLocal - TZ;
}
