// Источник афиши для инструментов GTR BRO: наш KV-кэш разведки.
// Вынесен отдельно, потому что им пользуются оба входа — голосовой
// маршрутизатор инструментов и текстовый мозг.
import type { EventsProvider } from "./tools";
import { kvGetJson, kvListAll, type KvNs } from "../kv-ns";

/** Демо-источника нет намеренно — за выдуманный вечер поедет живой
 *  человек. Пусто в KV — пусто в ответе. */
export const kvProvider = (ns: KvNs): EventsProvider => ({
  id: "gtr-afisha",
  async search({ dateFrom, dateTo }) {
    const keys = await kvListAll(ns, "venueevents:");
    const out: { vid: string; events: { id?: string; title: string; dateIso: string; poster?: string }[] }[] = [];
    // Ограничение сверху: результат уходит в модель, и раздутый ответ
    // и стоит дороже, и топит полезное в шуме.
    // Вся база (110 площадок) должна помещаться: срез на 60 отрезал бы
    // хвост алфавита, и BRO «не знал» бы про часть заведений. В ответ
    // всё равно попадают только площадки с событиями в окне дат.
    for (const key of keys.slice(0, 160)) {
      const rec = await kvGetJson<{ events?: { id?: string; title: string; dateIso: string; poster?: string }[] }>(
        ns,
        key,
      );
      const events = (rec?.events ?? []).filter((e) => e.dateIso >= dateFrom && e.dateIso <= dateTo);
      if (events.length) out.push({ vid: key.slice("venueevents:".length), events: events.slice(0, 6) });
    }
    return out;
  },
});
