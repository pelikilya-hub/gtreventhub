// Цены вилл: ежедневная сверка с trip.com.
//
// Источник цены вынесен в адаптер намеренно. Публичные страницы trip.com
// для этого непригодны — проверено: цен в HTML нет вообще (приходят
// подписанным XHR, прямой вызов их API отдаёт 400), а SEO-поле «средняя
// от» возвращает одно и то же число для 1, 3 и 7 ночей и без дат вовсе.
// Достоверный источник — партнёрский API trip.com (connect.trip.com).
// Пока ключа нет, работает ручной источник: цену подтверждает человек,
// а система следит за свежестью и напоминает.
import villasRaw from "./data/villas.json";
import { getKvNs, kvGetJson, type KvNs } from "./kv-ns";

export const VILLA_MARKUP = 1.15; // прайс GTR = trip.com +15%

// сколько дней цена считается актуальной; дальше — просрочена
export const PRICE_TTL_DAYS = 1;

export type VillaPrice = {
  vid: string;
  currency: string; // THB
  basePerNight: number; // ставка trip.com за ночь
  gtrPerNight: number; // наша = база × markup
  markup: number;
  checkedAt: string; // ISO-дата сверки
  source: "manual" | "trip-affiliate";
  by?: string; // кто сверил (для ручного источника)
  available?: boolean | null; // занятость: знает только партнёрский API
  note?: string;
};

export const priceKey = (vid: string) => `villaprice:${vid}`;

export const gtrFrom = (basePerNight: number, markup = VILLA_MARKUP) =>
  Math.round(basePerNight * markup);

export const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);

export const isStale = (p: VillaPrice | null | undefined) =>
  !p || daysSince(p.checkedAt) > PRICE_TTL_DAYS;

export async function readPrices(ns: KvNs, vids: string[]) {
  const out: Record<string, VillaPrice> = {};
  await Promise.all(
    vids.map(async (vid) => {
      const p = await kvGetJson<VillaPrice>(ns, priceKey(vid));
      if (p) out[vid] = p;
    }),
  );
  return out;
}

// ---------- адаптер источника ----------
// Когда партнёрский ключ появится, здесь добавляется реализация
// fetchFromAffiliate(vid, dates) и подставляется вместо ручного пути —
// остальной код (KV, экран, крон, наценка) не меняется.

export const affiliateConfigured = () =>
  Boolean(typeof process !== "undefined" && process.env?.TRIP_AFFILIATE_KEY);

/** Живая цена и занятость от партнёрского API. Без ключа честно возвращает
 *  null, а не выдуманное число. */
export async function fetchLivePrice(_vid: string): Promise<VillaPrice | null> {
  if (!affiliateConfigured()) return null;
  // TODO: подключить connect.trip.com, когда партнёрский аккаунт одобрят.
  // Контракт возврата уже зафиксирован типом VillaPrice, поэтому замена
  // источника не потребует правок в экране и кроне.
  return null;
}

/** Список вилл, у которых цену пора сверить. */
export async function staleVillas(vids: string[]) {
  const ns = await getKvNs();
  if (!ns) return { ns: null as KvNs | null, stale: vids, prices: {} as Record<string, VillaPrice> };
  const prices = await readPrices(ns, vids);
  return { ns, prices, stale: vids.filter((v) => isStale(prices[v])) };
}

// Список вилл берём из общей статики — отдельного реестра не заводим,
// чтобы вилла не могла «потеряться» между экраном и кроном.
type VillaStatic = { id: string; name: string; tripId: number };
export const villaList = (): VillaStatic[] =>
  (villasRaw as { villas: VillaStatic[] }).villas;
export const villaIds = () => villaList().map((v) => v.id);

const dayShift = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Глубокая ссылка на завтра–послезавтра: одно нажатие — и человек видит
 *  ровно ту ставку, которую надо вбить. */
export const checkLink = (tripId: number) =>
  `https://www.trip.com/hotels/detail/?hotelId=${tripId}` +
  `&checkIn=${dayShift(1)}&checkOut=${dayShift(2)}&curr=THB&locale=ru-RU`;

/** Ежедневная сверка. Есть партнёрский ключ — тянем живую ставку сами;
 *  нет — возвращаем список на ручную сверку, ничего не выдумывая. */
export async function runDailyCheck() {
  const { ns, prices, stale } = await staleVillas(villaIds());
  const auto: string[] = [];
  const manual: VillaStatic[] = [];
  for (const vid of stale) {
    const live = ns ? await fetchLivePrice(vid) : null;
    if (live && ns) {
      await ns.put(priceKey(vid), JSON.stringify(live));
      auto.push(vid);
    } else {
      const v = villaList().find((x) => x.id === vid);
      if (v) manual.push(v);
    }
  }
  return { ns, prices, stale, auto, manual };
}
