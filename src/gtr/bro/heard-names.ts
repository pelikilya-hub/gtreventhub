// Готовый индекс имён для починки услышанного: площадки и артисты из
// публичных витрин. Собирается один раз при первом обращении — обе базы
// уже лежат в бандле, сеть не нужна.
import artistsPub from "../data/artists.public.json";
import venuesPub from "../data/venues.public.json";
import { buildHeardIndex, fixHeard, type HeardIndex } from "./hear";

let ix: HeardIndex | null = null;

const index = (): HeardIndex => {
  if (!ix) {
    const venues = (venuesPub as { venues: { name: string }[] }).venues.map((v) => v.name);
    const artists = (artistsPub as { artists: { name: string }[] }).artists.map((a) => a.name);
    ix = buildHeardIndex([...venues, ...artists]);
  }
  return ix;
};

/** Починить финальную реплику гостя: «кетч бич клаб» → Catch Beach Club.
 *  Работает по однозначным совпадениям; сомнительное не трогает. */
export const fixHeardNames = (text: string): string => fixHeard(text, index());
