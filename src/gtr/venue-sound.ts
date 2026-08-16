// Звуковой паспорт площадки в работе: что играет в этот час и кому.
//
// Подбор артиста до сих пор сравнивал один жанровый вектор площадки с
// вектором артиста — как будто вечер однороден. Он не однороден: у
// пляжного клуба закат и полночь — разные вечера с разной публикой и
// разным темпом, а у отельного банкета и андеграундного клуба списки
// запретов не пересекаются вовсе.
//
// Паспорта собирает scripts/venue-sound.py: формат, слоты по часам,
// коридор BPM, энергия, палитра жанров и вето. Здесь — только чтение и
// счёт совпадения.
import SOUND_RAW from "./data/venue-sound.json";
import { genreKin } from "./genres";

export type SoundSlot = {
  from: number;
  to: number;
  role: string;
  bpm: [number, number];
  energy: number;
  genres: Record<string, number>;
};

export type VenueSound = {
  arch: string;
  label: string;
  audience: string;
  note: string;
  veto: string[];
  slots: SoundSlot[];
};

const SOUND = SOUND_RAW as unknown as Record<string, VenueSound>;

export const soundOf = (vid: string): VenueSound | null => SOUND[vid] ?? null;

/** Слот, в который попадает час. Вечер переходит за полночь, поэтому
 *  отрезок 23→2 нельзя сравнивать как обычный диапазон. */
export const slotAt = (vid: string, hour: number): SoundSlot | null => {
  const s = SOUND[vid];
  if (!s) return null;
  const h = ((hour % 24) + 24) % 24;
  for (const sl of s.slots) {
    const inside = sl.from <= sl.to ? h >= sl.from && h < sl.to : h >= sl.from || h < sl.to;
    if (inside) return sl;
  }
  return null;
};

/** Главный слот площадки — самый энергичный. По нему её и запоминают,
 *  и именно он подразумевается, когда час не назван. */
export const primeSlot = (vid: string): SoundSlot | null => {
  const s = SOUND[vid];
  if (!s?.slots.length) return null;
  return s.slots.reduce((a, b) => (b.energy > a.energy ? b : a));
};

export type Fit = {
  score: number;
  slot: SoundSlot | null;
  vetoed: string[];
  matched: { id: string; w: number }[];
};

/** Насколько артист подходит площадке в этот час.
 *
 *  Вето — не штраф, а отказ: жанр из списка запретов обнуляет счёт
 *  целиком. Ошибка «поставили хардстайл на семейный пляж» стоит
 *  площадке вечера, и никакое совпадение по остальным жанрам её не
 *  окупает.
 *
 *  Всё остальное — совпадение набора артиста с палитрой слота, где
 *  родство считается по дереву жанров: соседний жанр приносит долю
 *  веса, а не ноль. */
export const fitArtist = (vid: string, styleIds: string[], hour?: number): Fit => {
  const s = SOUND[vid];
  const slot = hour === undefined ? primeSlot(vid) : slotAt(vid, hour);
  if (!s || !slot || !styleIds.length) return { score: 0, slot, vetoed: [], matched: [] };

  const veto = new Set(s.veto);
  const vetoed = styleIds.filter((g) => veto.has(g));
  if (vetoed.length) return { score: 0, slot, vetoed, matched: [] };

  const palette = Object.entries(slot.genres);
  const matched: { id: string; w: number }[] = [];
  let sum = 0;
  for (const g of styleIds) {
    let best = 0;
    for (const [pid, w] of palette) {
      const v = genreKin(g, pid) * w;
      if (v > best) best = v;
    }
    if (best > 0) matched.push({ id: g, w: Number(best.toFixed(3)) });
    sum += best;
  }
  // Делим на число жанров артиста, а не на размер палитры: артист с
  // одним точным попаданием не должен проигрывать артисту с пятью
  // приблизительными.
  const score = sum / styleIds.length;
  matched.sort((a, b) => b.w - a.w);
  return { score: Math.min(1, score), slot, vetoed: [], matched: matched.slice(0, 4) };
};

/** Короткое человеческое объяснение решения — для карточки подбора. */
export const fitReason = (vid: string, fit: Fit, lang = "ru"): string => {
  const s = SOUND[vid];
  if (!s) return "";
  if (fit.vetoed.length)
    return lang === "ru"
      ? `не для этой площадки: ${fit.vetoed.length} запрещённый стиль`
      : `not for this venue: ${fit.vetoed.length} vetoed style`;
  if (!fit.slot) return "";
  const bpm = `${fit.slot.bpm[0]}–${fit.slot.bpm[1]} BPM`;
  return lang === "ru" ? `${s.label} · ${fit.slot.role} · ${bpm}` : `${s.arch} · ${fit.slot.role} · ${bpm}`;
};
