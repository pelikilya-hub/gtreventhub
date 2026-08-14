// Движок жанрового сопоставления: общий язык между вкусом слушателя
// (Spotify-жанры), стилями артистов каталога и музыкой площадок. Жанры
// сводятся в семейства — сопоставление устойчиво к формулировкам
// («melodic techno» и «минимал-техно» попадают в одно семейство).

export type GenreVector = Map<string, number>;

// Семейство → триггер-подстроки (латиница и кириллица, нижний регистр)
const FAMILIES: [string, string[]][] = [
  ["house", ["house", "хаус", "afro house", "deep house", "tech house", "organic"]],
  ["techno", ["techno", "техно", "minimal", "минимал"]],
  ["edm", ["edm", "big room", "progressive", "electro", "festival", "mainstage", "электрон"]],
  ["trance", ["trance", "транс", "psytrance", "goa", "психоделик"]],
  ["dnb", ["drum and bass", "dnb", "d&b", "jungle", "breakbeat", "драм"]],
  ["hiphop", ["hip hop", "hip-hop", "rap", "trap", "хип-хоп", "рэп", "трэп", "urban"]],
  ["rnb", ["r&b", "rnb", "soul", "соул", "neo soul"]],
  ["pop", ["pop", "поп", "dance pop", "top 40", "хит"]],
  ["rock", ["rock", "рок", "indie", "инди", "alternative", "альтернатив", "metal", "панк", "punk"]],
  ["latin", ["latin", "reggaeton", "латин", "реггетон", "salsa", "bachata", "cumbia"]],
  ["reggae", ["reggae", "dancehall", "регги", "дансхолл", "ska"]],
  ["funk", ["funk", "disco", "фанк", "диско", "nu disco", "boogie", "groove", "грув"]],
  ["jazz", ["jazz", "джаз", "swing", "blues", "блюз", "lounge jazz"]],
  ["chill", ["chill", "downtempo", "lounge", "ambient", "лаунж", "чил", "балеарик", "balearic", "sunset", "acoustic", "акустик"]],
  ["live", ["live", "band", "живая", "лайв", "кавер", "cover", "vocal", "вокал", "саксофон", "sax"]],
];

export const normalizeGenres = (raw: string[]): GenreVector => {
  const v: GenreVector = new Map();
  for (const g of raw) {
    const s = g.toLowerCase();
    for (const [fam, keys] of FAMILIES)
      if (keys.some((k) => s.includes(k))) v.set(fam, (v.get(fam) ?? 0) + 1);
  }
  // нормировка к 0..1
  const max = Math.max(1, ...v.values());
  for (const [k, n] of v) v.set(k, n / max);
  return v;
};

// Взвешенный вектор: элементы с весами (жанры Spotify по позиции в топе)
export const weightedVector = (items: { genres: string[]; weight: number }[]): GenreVector => {
  const v: GenreVector = new Map();
  for (const it of items) {
    const s = it.genres.join(" ").toLowerCase();
    for (const [fam, keys] of FAMILIES)
      if (keys.some((k) => s.includes(k))) v.set(fam, (v.get(fam) ?? 0) + it.weight);
  }
  const max = Math.max(0.0001, ...v.values());
  for (const [k, n] of v) v.set(k, n / max);
  return v;
};

// Совпадение векторов: взвешенный Жаккар (Ружичка) — пересечение к
// объединению по семействам. Строго 0..1: 1 только при полном совпадении
// профилей, поэтому проценты в интерфейсе различимы, а не «у всех 99%».
export const scoreVectors = (
  a: GenreVector,
  b: GenreVector,
): { score: number; reasons: string[] } => {
  let inter = 0;
  let union = 0;
  const hits: [string, number][] = [];
  const fams = new Set([...a.keys(), ...b.keys()]);
  for (const fam of fams) {
    const av = a.get(fam) ?? 0;
    const bv = b.get(fam) ?? 0;
    const m = Math.min(av, bv);
    inter += m;
    union += Math.max(av, bv);
    if (m > 0) hits.push([fam, m]);
  }
  hits.sort((x, y) => y[1] - x[1]);
  // поправка на бедность доказательств: совпадение по одному семейству —
  // не «идеальные 100%», уверенность растёт с шириной пересечения
  const evidence = 0.72 + 0.28 * Math.min(1, hits.length / 3);
  return {
    score: union > 0 ? (inter / union) * evidence : 0,
    reasons: hits.slice(0, 3).map(([f]) => f),
  };
};

export const FAMILY_LABEL: Record<string, string> = {
  house: "House",
  techno: "Techno",
  edm: "EDM",
  trance: "Trance",
  dnb: "Drum & Bass",
  hiphop: "Hip-Hop",
  rnb: "R&B / Soul",
  pop: "Pop",
  rock: "Rock / Indie",
  latin: "Latin",
  reggae: "Reggae",
  funk: "Funk / Disco",
  jazz: "Jazz / Blues",
  chill: "Chill / Lounge",
  live: "Live",
};
