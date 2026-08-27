// Живые цифры для витрины: сколько площадок, артистов и регионов в базе.
//
// Отдельный серверный вызов, а не импорт app-data на витрине: каталог весит
// мегабайты, и тянуть его в бандл публичной страницы ради трёх чисел —
// значит убить ту самую скорость, ради которой витрина и написана отдельно.
// Заодно цифры всегда свежие: волна наполнения добавила регион — витрина
// показала новое число, без правок в разметке.
import { createServerFn } from "@tanstack/react-start";

export type PublicStats = { venues: number; artists: number; regions: number };

export const publicStatsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicStats> => {
    const { PH, loadArtists, REGIONS } = await import("./data/app-data");
    const base = await loadArtists();
    return {
      venues: PH.venues.length,
      artists: base.artists.length,
      regions: Object.keys(REGIONS).length,
    };
  },
);
