// Маршрут вечера: список площадок и настоящая дорога между ними.
//
// Список жил внутри экрана «Сегодня» и был виден только ему. Карта рисовала
// остров, трекер — свою линию, и три экрана не знали друг о друге: гость
// собирал вечер в одном месте, а на карте его маршрута не было. Теперь
// хранилище одно, и любой экран читает тот же вечер.
//
// Линия между точками — дорога, а не прямая. Прямая по Пхукету врёт вдвое:
// между Патонгом и Камалой хребет, дорога идёт серпантином, и «2 км» на
// экране превращались в двадцать минут такси. Гость планирует вечер по
// этому числу — значит, оно должно быть настоящим.
export const ROUTE_KEY = "gtr-evening-route";

export const loadRoute = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const saveRoute = (ids: string[]): void => {
  try {
    localStorage.setItem(ROUTE_KEY, JSON.stringify(ids));
  } catch {
    /* приватный режим Safari — маршрут просто не переживёт перезагрузку */
  }
};

/** Точка в порядке Leaflet: [широта, долгота]. */
export type LatLon = [number, number];

export type RoadRoute = {
  /** Готовая линия для полилинии. Пусто — рисовать нечего. */
  line: LatLon[];
  meters: number;
  /** Секунды в пути на машине; 0 — если считали по прямой. */
  seconds: number;
  /** true — дорога от маршрутизатора, false — запасная прямая. */
  real: boolean;
};

const EMPTY: RoadRoute = { line: [], meters: 0, seconds: 0, real: false };

/** Расстояние по прямой, км. Для Пхукета плоской проекции хватает. */
export const straightKm = (a: LatLon, b: LatLon): number => {
  const dLat = (b[0] - a[0]) * 110.574;
  const dLon = (b[1] - a[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

const straightRoute = (points: LatLon[]): RoadRoute => {
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += straightKm(points[i - 1], points[i]) * 1000;
  return { line: points, meters: Math.round(meters), seconds: 0, real: false };
};

// Маршрут между теми же точками не меняется — второй раз спрашивать сеть
// незачем. Ключ по координатам, а не по id площадок: старт может быть
// живой позицией гостя, у которой id нет.
const cache = new Map<string, RoadRoute>();
const keyOf = (points: LatLon[]) =>
  points.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(";");

/** Публичный демо-сервер OSRM: без ключа, но и без гарантий. Держим его за
 *  одной константой — когда упрёмся в лимиты, менять придётся одну строку. */
const OSRM = "https://router.project-osrm.org/route/v1/driving/";

/** Больше точек демо-сервер не считает надёжно, да и вечер на 25 баров
 *  никто не планирует. */
const MAX_POINTS = 25;

/**
 * Дорога через все точки по порядку. Никогда не бросает: если сеть легла
 * или маршрутизатор отказал — возвращает прямые между теми же точками с
 * пометкой real:false. Карта обязана нарисоваться в любом случае.
 */
export async function roadRoute(points: LatLon[], timeoutMs = 7000): Promise<RoadRoute> {
  if (points.length < 2) return points.length ? { ...EMPTY, line: points } : EMPTY;
  const pts = points.slice(0, MAX_POINTS);
  const key = keyOf(pts);
  const hit = cache.get(key);
  if (hit) return hit;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // OSRM ждёт долготу первой — порядок обратный нашему и Leaflet.
    const path = pts.map(([la, lo]) => `${lo},${la}`).join(";");
    const res = await fetch(`${OSRM}${path}?overview=full&geometries=geojson`, {
      signal: ctl.signal,
    });
    if (!res.ok) return straightRoute(pts);
    const json = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const r = json.code === "Ok" ? json.routes?.[0] : undefined;
    if (!r?.geometry?.coordinates?.length) return straightRoute(pts);
    const out: RoadRoute = {
      line: r.geometry.coordinates.map(([lo, la]) => [la, lo] as LatLon),
      meters: Math.round(r.distance),
      seconds: Math.round(r.duration),
      real: true,
    };
    cache.set(key, out);
    return out;
  } catch {
    // Отмена по таймауту и отказ сети приходят сюда одинаково — и в обоих
    // случаях гостю нужна линия, а не пустая карта.
    return straightRoute(pts);
  } finally {
    clearTimeout(timer);
  }
}

/** «12 км · 18 мин» — то, что подписывают под маршрутом. Время показываем
 *  только настоящее: у прямой его нет, и выдумывать минуты нельзя. */
export const routeLabel = (r: RoadRoute): string => {
  const km = r.meters / 1000;
  const dist = km >= 10 ? `${Math.round(km)} км` : `${km.toFixed(1)} км`;
  if (!r.real || !r.seconds) return dist;
  const min = Math.round(r.seconds / 60);
  return `${dist} · ${min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`}`;
};
