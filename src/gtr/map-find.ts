// Поиск и расстояния на карте.
//
// Логика вынесена из экрана намеренно: её можно проверить тестом, а
// экран Leaflet — нет. Здесь нет ни React, ни браузерных API.
//
// Зачем поиск на карте вообще. В базе больше сотни площадок, и до сих пор
// единственным способом найти конкретную было вспомнить её район, нажать
// нужный чип и глазами перебрать точки. Человек, который пришёл со
// словами «где Illuzion», проделывал это каждый раз заново.

// Кириллица в латиницу. Нужна не для красоты: названия площадок на
// Пхукете латинские («Sky Bar Kata»), а районы у нас подписаны по-русски
// («Ката»), и половина аудитории набирает запрос русскими буквами. Без
// этой таблицы «ката» находило заведение в районе Ката, но не заведение
// со словом Kata в названии — то есть ровно то, которое искали.
const RU_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Приведение к сравнимому виду: регистр, диакритика, алфавит, знаки.
 *
 *  Названия на Пхукете пишут как придётся: «Café del Mar», «Cafe Del
 *  Mar», «CAFÉ DEL MAR». Для поиска это одно и то же слово — и то же
 *  слово, набранное кириллицей. */
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0430-\u044f\u0451]/g, (c) => RU_LAT[c] ?? c)
    // Тайские знаки оставляем как есть: транслитерации для них нет, а
    // выкидывать их — значит превращать тайский запрос в пустую строку.
    .replace(/[^a-z0-9\u0e00-\u0e7f\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Findable = {
  id: string;
  name: string;
  area: string;
  cluster: string;
  type: string;
};

/** Совпадения по названию, району и типу — по убыванию уместности.
 *
 *  Порядок ступеней важнее их точных весов: имя целиком бьёт начало
 *  слова, начало слова бьёт середину, и только потом идут район и тип.
 *  Иначе запрос «bar» вываливает сорок баров прежде «Bar Rouge». */
export const findVenues = <V extends Findable>(
  query: string,
  venues: readonly V[],
  limit = 8,
): V[] => {
  const q = norm(query);
  if (q.length < 2) return [];
  const scored: { v: V; score: number }[] = [];
  for (const v of venues) {
    const name = norm(v.name);
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    // Начало любого слова: «del» находит «Café del Mar», но не «Fidelio».
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) score = 60;
    else if (name.includes(q)) score = 40;
    else if (norm(v.area).includes(q) || norm(v.cluster).includes(q)) score = 20;
    else if (norm(v.type).includes(q)) score = 10;
    if (score) scored.push({ v, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
    .slice(0, limit)
    .map((x) => x.v);
};

/** Человеческое расстояние. До километра — метрами: «650 м» гость
 *  переводит в «десять минут пешком», а «0.7 км» — нет.
 *
 *  Единицы приходят снаружи, потому что интерфейс трёхъязычный: экран
 *  подставляет переведённые «m/km» и «ม./กม.». По умолчанию русские —
 *  чтобы модуль оставался чистым и проверялся тестом без i18next. */
export const kmLabel = (
  km: number,
  units: { m: string; km: string } = { m: "м", km: "км" },
): string =>
  km < 1
    ? `${Math.round(km / 0.05) * 50} ${units.m}`
    : `${km < 10 ? km.toFixed(1) : Math.round(km)} ${units.km}`;

/** Дойдёт ли пешком. Порог низкий сознательно: жара, тротуаров нет,
 *  и обещать прогулку там, где нужен байк, — плохая услуга. */
export const walkable = (km: number): boolean => km <= 1.2;

/** Порядок обхода: жадный ближайший сосед от старта.
 *
 *  Оптимального маршрута коммивояжёра здесь не нужно — вечер это три-пять
 *  точек, а жадный обход на таком размере почти всегда даёт тот же ответ
 *  и считается мгновенно. Важнее другое: порядок, в котором площадки
 *  добавляли, географическим не был вовсе, и «оптимизировать» экономит
 *  реальные километры на такси. */
export const nearestOrder = <T>(
  start: [number, number] | null,
  items: readonly T[],
  at: (item: T) => [number, number] | null,
): T[] => {
  const left = items.filter((i) => at(i));
  const out: T[] = [];
  let cur = start;
  while (left.length) {
    let best = 0;
    if (cur) {
      let bestKm = Infinity;
      for (let i = 0; i < left.length; i++) {
        const p = at(left[i])!;
        const km = straight(cur, p);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      }
    }
    const [picked] = left.splice(best, 1);
    out.push(picked);
    cur = at(picked);
  }
  // Точки без координат порядок не задают, но и терять их нельзя:
  // площадка остаётся в списке вечера, просто в хвосте.
  return [...out, ...items.filter((i) => !at(i))];
};

/** Расстояние по прямой, км. Для острова плоской проекции хватает. */
const straight = (a: [number, number], b: [number, number]): number => {
  const dLat = (b[0] - a[0]) * 110.574;
  const dLon = (b[1] - a[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};
export { straight as straightKm };

/** Ссылка «доехать» во внешнюю карту.
 *
 *  Универсальная форма Google Maps: её понимает и приложение на телефоне,
 *  и браузер на десктопе. Своего навигатора у нас нет и не будет — гостю
 *  нужен тот, где уже сохранён его дом и оплачено такси. */
export const driveUrl = (lat: number, lon: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
