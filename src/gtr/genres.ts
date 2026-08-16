// Справочник жанров: дерево вместо плоских строк.
//
// Раньше стиль артиста был просто текстом, и сравнить два стиля можно
// было только на точное совпадение. Из-за этого дип-хаус и соулфул-хаус
// для подбора были такими же чужими, как дип-хаус и хардкор, а «клубная
// электроника» не совпадала ни с чем вообще. Теперь у каждого жанра есть
// место в дереве «направление → группа → жанр», и близость считается по
// этому дереву.
//
// Само дерево собирается скриптом (scripts/genres-build.py) и лежит в
// genres.json: 262 жанра, 19 направлений. Здесь — только чтение.
import RAW from "./data/genres.json";

export type Genre = {
  id: string;
  en: string;
  ru: string;
  dir: string;
  group: string;
  /** группы, в которых жанр числится дополнительно (Afro House — и в
      «современном House», и в африканской сцене) */
  also: string[];
  alias: string[];
};

const DATA = RAW as unknown as { order: string[]; genres: Record<string, Genre> };
export const GENRES = DATA.genres;
export const GENRE_ORDER = DATA.order;

// Плоский указатель «живое написание → жанр». Строится один раз.
const BY_ALIAS = new Map<string, string>();
for (const id of GENRE_ORDER) {
  for (const a of GENRES[id].alias) if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, id);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

// Слова, которыми площадки и артисты описывают формат, а не жанр:
// «открытый формат», «свадебный сет», «винил-сет». Жанрами они не
// являются и в дерево не ложатся — их сохраняем как есть.
const NOT_GENRE = new Set([
  "открытый формат", "свадебный сет", "радио сет", "винил сет", "кавер программа",
  "live программа", "live вокал", "стендап комедия", "инструментал",
]);

/** Привести живое написание к жанру дерева. null — если это не жанр. */
export const resolveGenre = (raw: string): string | null => {
  const n = norm(raw);
  if (!n || NOT_GENRE.has(n)) return null;
  const direct = BY_ALIAS.get(n) ?? BY_ALIAS.get(n.replace(/ /g, "")) ?? BY_ALIAS.get(n.replace(/ /g, "-"));
  if (direct) return direct;
  // «дип хаус вечеринка» → дип-хаус: ищем самый длинный жанр, целиком
  // содержащийся в строке. Длинный важнее короткого, иначе «дип-хаус»
  // схлопнется в «хаус».
  let best: string | null = null;
  let bestLen = 0;
  for (const [alias, id] of BY_ALIAS) {
    if (alias.length > bestLen && alias.length >= 4 && n.includes(alias)) {
      best = id;
      bestLen = alias.length;
    }
  }
  return best;
};

export const genreName = (id: string, lang = "ru"): string => {
  const g = GENRES[id];
  if (!g) return id;
  return lang === "ru" ? g.ru : g.en;
};

/** Родство двух жанров: 1 — один и тот же, 0 — из разных миров.
 *
 *  Числа подобраны так, чтобы соседи по группе стояли заметно ближе
 *  соседей по направлению: дип-хаус и соулфул-хаус — почти одно и то же
 *  для гостя, а дип-хаус и биг-рум — уже разные вечера, хотя оба House. */
export const genreKin = (a: string, b: string): number => {
  if (a === b) return 1;
  const x = GENRES[a];
  const y = GENRES[b];
  if (!x || !y) return 0;
  const groupsX = new Set([x.group, ...x.also]);
  const groupsY = new Set([y.group, ...y.also]);
  for (const g of groupsX) if (groupsY.has(g)) return 0.72;
  if (x.dir === y.dir) return 0.45;
  return 0;
};

/** Близость двух наборов жанров: среднее лучших совпадений.
 *
 *  Берём для каждого жанра из первого набора лучшее родство во втором и
 *  усредняем. Так набор из одного точного попадания не проигрывает
 *  набору из пяти приблизительных — а именно это и происходило, когда
 *  считали долю пересечения. */
export const genreMatch = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return 0;
  let sum = 0;
  for (const x of a) {
    let best = 0;
    for (const y of b) {
      const k = genreKin(x, y);
      if (k > best) best = k;
    }
    sum += best;
  }
  return sum / a.length;
};

/** Направления с их жанрами — для экранов выбора вкуса. */
export const GENRE_TREE: { dir: string; groups: { group: string; ids: string[] }[] }[] = (() => {
  const out: { dir: string; groups: { group: string; ids: string[] }[] }[] = [];
  for (const id of GENRE_ORDER) {
    const g = GENRES[id];
    let d = out.find((x) => x.dir === g.dir);
    if (!d) out.push((d = { dir: g.dir, groups: [] }));
    let gr = d.groups.find((x) => x.group === g.group);
    if (!gr) d.groups.push((gr = { group: g.group, ids: [] }));
    gr.ids.push(id);
  }
  return out;
})();
