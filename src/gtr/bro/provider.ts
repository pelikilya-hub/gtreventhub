// Источник афиши для инструментов GTR BRO: наш KV-кэш разведки.
// Вынесен отдельно, потому что им пользуются оба входа — голосовой
// маршрутизатор инструментов и текстовый мозг.
import type { EventsProvider } from "./tools";
import { collectCleanAfisha } from "../community";
import type { KvNs } from "../kv-ns";

/** Демо-источника нет намеренно — за выдуманный вечер поедет живой
 *  человек. Пусто в KV — пусто в ответе. */
export const kvProvider = (ns: KvNs): EventsProvider => ({
  id: "gtr-afisha",
  async search({ dateFrom, dateTo }) {
    // Тот же сборщик, что кормит экран «Сегодня» и дайджест в Telegram.
    // Раньше здесь читались сырые ключи venueevents:* — без отсева мусорных
    // заголовков, без чистки названия от имени площадки, без дедупа и без
    // отсечения прошедших дат. Гость видел на экране одну программу, а BRO
    // называл другую: то же событие под сырым именем, плюс дубли. Два ответа
    // про один вечер в одном продукте недопустимы, поэтому источник один.
    const items = await collectCleanAfisha(ns);
    const byVenue = new Map<string, { id?: string; title: string; dateIso: string; poster?: string }[]>();
    for (const e of items) {
      if (e.dateIso < dateFrom || e.dateIso > dateTo) continue;
      const list = byVenue.get(e.vid) ?? [];
      // Ограничение сверху: результат уходит в модель, и раздутый ответ
      // и стоит дороже, и топит полезное в шуме.
      if (list.length >= 6) continue;
      list.push({ id: e.id, title: e.title, dateIso: e.dateIso, poster: e.poster });
      byVenue.set(e.vid, list);
    }
    return [...byVenue].map(([vid, events]) => ({ vid, events }));
  },
});
