// Разбор ответа модели для вайб-чека: модель слушает 5 секунд звука и
// называет жанр — но только из нашего словаря genres.json. Свободный
// текст модели здесь не гуляет: неизвестный id отбрасывается, bpm вне
// человеческого диапазона — тоже. Чистая функция, чтобы тестировалась
// без сети и без микрофона.
import genresRaw from "../data/genres.json";

type GenreDict = {
  genres: Record<string, { id: string; en: string; ru: string; dir: string; group: string; alias: string[] }>;
};
const DICT = (genresRaw as unknown as GenreDict).genres;

export type VibeGuess = {
  genreId: string;
  ru: string;
  en: string;
  group: string;
  bpm: number | null;
};

/** Ищет жанр по точному id, затем по алиасам — модель иногда отвечает
 *  «tech house» вместо «tech-house», это не повод терять ответ. */
export const resolveGenre = (raw: string): GenreDict["genres"][string] | null => {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if (DICT[q]) return DICT[q];
  for (const g of Object.values(DICT)) if (g.alias.includes(q)) return g;
  return null;
};

/** Вытаскивает из текста модели первый JSON-объект и валидирует его
 *  против словаря жанров. Ошибка любого рода — null, без исключений:
 *  на клиенте останется честная локальная прикидка по темпу. */
export const parseVibeReply = (text: string): VibeGuess | null => {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  let obj: { genre?: unknown; bpm?: unknown };
  try {
    obj = JSON.parse(m[0]) as typeof obj;
  } catch {
    return null;
  }
  const genre = resolveGenre(String(obj.genre ?? ""));
  if (!genre) return null;
  const bpmNum = Math.round(Number(obj.bpm));
  const bpm = Number.isFinite(bpmNum) && bpmNum >= 50 && bpmNum <= 220 ? bpmNum : null;
  return { genreId: genre.id, ru: genre.ru, en: genre.en, group: genre.group, bpm };
};

/** Список допустимых id для промпта — модель выбирает из него, а не
 *  сочиняет свой ярлык. */
export const genreIdList = (): string[] => Object.keys(DICT);
