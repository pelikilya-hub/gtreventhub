/** Русское склонение при числе.
 *
 *  Жило в двух копиях — в community.ts для телеграма и в Constructor.tsx
 *  для брифа, — и когда третьему месту (письма площадкам) понадобилось
 *  то же самое, копий стало бы три. Правило одно, и место ему одно.
 *
 *  Подвох, на котором ломаются самодельные версии: 11–14 всегда «много»,
 *  сколько бы ни было в единицах. «11 площадок», а не «11 площадка».
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
