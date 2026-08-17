// Прогноз явки и тяга артиста — арифметика, а не догадки модели.
//
// Организатор спрашивает «сколько придёт» и получает от обычного чат-бота
// красивое число из воздуха. Здесь считается по факторам, каждый из
// которых виден в ответе: вместимость площадки, день недели, сезон
// Пхукета, тяга артиста, цена входа, промо и сколько дней до даты.
// Модель не придумывает коэффициенты — она их только пересказывает.
//
// Все коэффициенты — рабочие гипотезы GTR по нашей же практике на
// острове. Это не физика: их место в одном файле именно затем, чтобы
// после первых событий их можно было пересчитать по факту.

export type Factor = { name: string; k: number; why: string };

/** «≈120», «300–400», «до 5 000» → число. Вместимость в базе живёт
 *  строкой: источники пишут её как придётся, а нам нужен потолок зала. */
export const capacityOf = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const nums = String(raw)
    .replace(/[\s ,']/g, "")
    .match(/\d{2,6}/g);
  if (!nums?.length) return null;
  // Диапазон «300-400» — берём верх: это потолок зала, а не план продаж.
  const vals = nums.map(Number).filter((n) => n >= 20 && n <= 20000);
  return vals.length ? Math.max(...vals) : null;
};

/** Какую долю зала в обычную ночь собирает формат. Клуб живёт плотной
 *  посадкой, ресторан — столами: одинаковая вместимость значит разное. */
export const baseFill = (type: string, tag: string): { k: number; why: string } => {
  const s = `${type} ${tag}`.toLowerCase();
  if (/night ?club|club/.test(s) && !/beach/.test(s)) return { k: 0.55, why: "клуб — плотная посадка" };
  if (/beach/.test(s)) return { k: 0.45, why: "пляжный клуб — поток вместо посадки" };
  if (/rooftop|lounge/.test(s)) return { k: 0.4, why: "лаундж — камерный формат" };
  if (/bar|pub/.test(s)) return { k: 0.5, why: "бар — оборот гостей за вечер" };
  if (/restaurant|dining/.test(s)) return { k: 0.35, why: "ресторан — только столы" };
  return { k: 0.45, why: "формат без явной категории" };
};

const DOW: [number, string][] = [
  [0.85, "воскресенье — ранний вечер"],
  [0.55, "понедельник — мёртвый день"],
  [0.6, "вторник — тихо"],
  [0.75, "среда — середина недели"],
  [0.9, "четверг — разгон"],
  [1.15, "пятница"],
  [1.25, "суббота — пик недели"],
];

/** День недели по дате в формате ГГГГ-ММ-ДД (без часовых поясов: дата
 *  события — календарная, а не момент времени). */
export const dowFactor = (date: string): Factor => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [k, why] = DOW[d] ?? DOW[3];
  return { name: "день недели", k, why };
};

/** Сезон Пхукета: высокий — ноябрь–март, дождливый — май–октябрь.
 *  Июль–август чуть выше низкого: европейские каникулы. */
export const seasonFactor = (date: string): Factor => {
  const m = Number(date.slice(5, 7));
  if (m >= 11 || m <= 3) return { name: "сезон", k: 1.2, why: "высокий сезон на острове" };
  if (m === 4 || m === 10) return { name: "сезон", k: 1.0, why: "межсезонье" };
  if (m === 7 || m === 8) return { name: "сезон", k: 0.9, why: "дожди, но европейские каникулы" };
  return { name: "сезон", k: 0.75, why: "низкий сезон, дожди" };
};

/** Цена входа. Ноль — не «бесплатно всем», а другой профиль гостя:
 *  людей больше, выручка с бара. */
export const priceFactor = (price?: number): Factor => {
  if (price === undefined || price === null || Number.isNaN(price))
    return { name: "цена входа", k: 1.0, why: "цена не задана — считаю как обычный вход" };
  if (price <= 0) return { name: "цена входа", k: 1.15, why: "вход свободный" };
  if (price <= 500) return { name: "цена входа", k: 1.05, why: "низкий порог" };
  if (price <= 1000) return { name: "цена входа", k: 1.0, why: "рыночная цена вечера" };
  if (price <= 2000) return { name: "цена входа", k: 0.9, why: "выше рынка — часть отсеется" };
  return { name: "цена входа", k: 0.78, why: "премиальный вход, узкая аудитория" };
};

/** Промо. «Никакого» — это не ноль гостей: у площадки есть свой поток. */
export const promoFactor = (promo?: string): Factor => {
  const p = String(promo ?? "mid").toLowerCase();
  if (/нет|none|no/.test(p)) return { name: "промо", k: 0.8, why: "без промо — только поток площадки" };
  if (/слаб|low|мало/.test(p)) return { name: "промо", k: 0.9, why: "слабое промо" };
  if (/сильн|high|макс/.test(p))
    return { name: "промо", k: 1.15, why: "сильное промо: неделя прогрева, площадка в деле" };
  return { name: "промо", k: 1.0, why: "обычное промо" };
};

/** Сколько дней осталось. Афиша, вывешенная за сутки, собирает своих же
 *  завсегдатаев — и только их. */
export const leadFactor = (date: string, today: string): Factor => {
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (Number.isNaN(days)) return { name: "срок анонса", k: 1.0, why: "срок неизвестен" };
  if (days < 0) return { name: "срок анонса", k: 1.0, why: "дата уже прошла — считаю без поправки" };
  if (days <= 2) return { name: "срок анонса", k: 0.85, why: `до даты ${days} дн. — анонс поздний` };
  if (days <= 6) return { name: "срок анонса", k: 0.95, why: `до даты ${days} дн.` };
  if (days <= 30) return { name: "срок анонса", k: 1.0, why: `до даты ${days} дн. — нормальный горизонт` };
  return { name: "срок анонса", k: 0.95, why: "слишком рано: анонс успеет остыть" };
};

/** Тяга артиста в множитель. score 0..100 → 0.85..1.35: даже пустое имя
 *  не обнуляет вечер, а звезда не делает зал резиновым. */
export const pullFactor = (score?: number): Factor => {
  if (score === undefined) return { name: "артист", k: 1.0, why: "артист не задан" };
  const k = Math.round((0.85 + (Math.max(0, Math.min(100, score)) / 100) * 0.5) * 100) / 100;
  return { name: "артист", k, why: `тяга ${Math.round(score)} из 100` };
};

export type ForecastIn = {
  capacity: number;
  type: string;
  tag: string;
  date: string;
  today: string;
  price?: number;
  promo?: string;
  pull?: number;
};

export type ForecastOut = {
  capacity: number;
  expected: number;
  low: number;
  high: number;
  fill_pct: number;
  factors: Factor[];
  advice: string[];
};

export const forecast = (i: ForecastIn): ForecastOut => {
  const base = baseFill(i.type, i.tag);
  const factors: Factor[] = [
    { name: "формат площадки", k: base.k, why: base.why },
    dowFactor(i.date),
    seasonFactor(i.date),
    pullFactor(i.pull),
    priceFactor(i.price),
    promoFactor(i.promo),
    leadFactor(i.date, i.today),
  ];
  const mult = factors.reduce((acc, f) => acc * f.k, 1);
  // Зал не резиновый: за потолок вместимости прогноз не выходит, сколько
  // бы факторов ни сложилось удачно.
  const raw = i.capacity * mult;
  const expected = Math.round(Math.min(raw, i.capacity * 1.02));
  const advice: string[] = [];
  const weak = [...factors].sort((a, b) => a.k - b.k)[0];
  if (weak && weak.k < 1)
    advice.push(`Слабое место — ${weak.name}: ${weak.why}. Здесь и есть запас.`);
  if (expected > i.capacity * 0.9)
    advice.push("Считай зал полным: имеет смысл поднять цену или закрыть депозитами столы.");
  if (expected < i.capacity * 0.25)
    advice.push("Меньше четверти зала — либо меняем день, либо усиливаем артиста и промо.");
  return {
    capacity: i.capacity,
    expected,
    // Разброс честный: это прогноз по семи факторам, а не касса.
    low: Math.round(expected * 0.75),
    high: Math.round(Math.min(expected * 1.25, i.capacity * 1.02)),
    fill_pct: Math.round((expected / i.capacity) * 100),
    factors,
    advice,
  };
};

export type PullIn = {
  fans?: number | null;
  tier?: string;
  prio?: string;
  verified?: boolean;
  directLinks: number;
  venuesFit: number;
};

export type PullOut = { score: number; band: string; parts: Factor[] };

/** Тяга артиста в баллах. Слушатели на стримингах — не гости на входе,
 *  поэтому цифровой след даёт только половину веса, остальное — место
 *  артиста на самом острове. */
export const pullScore = (i: PullIn): PullOut => {
  const parts: Factor[] = [];
  // Фанаты — по логарифму: разница между 100 и 1 000 важнее, чем между
  // 100 000 и 101 000.
  const fans = Math.max(0, i.fans ?? 0);
  const fanPts = fans > 0 ? Math.min(40, (Math.log10(fans + 1) / 6) * 40 * 1.6) : 0;
  parts.push({
    name: "цифровой след",
    k: Math.round(fanPts),
    why: fans > 0 ? `${fans.toLocaleString("ru-RU")} слушателей на Deezer` : "стриминговых данных нет",
  });
  const tier = String(i.tier ?? "").toUpperCase();
  const tierPts = tier.includes("A") ? 25 : tier.includes("B") ? 15 : tier.includes("C") ? 8 : 5;
  parts.push({ name: "уровень в базе", k: tierPts, why: `тир ${tier || "не указан"}` });
  const prioPts = String(i.prio ?? "").toUpperCase() === "A" ? 15 : 6;
  parts.push({ name: "приоритет сцены", k: prioPts, why: `приоритет ${i.prio ?? "-"}` });
  const verPts = i.verified ? 8 : 0;
  parts.push({ name: "верификация", k: verPts, why: i.verified ? "профиль подтверждён" : "не подтверждён" });
  const linkPts = Math.min(6, i.directLinks * 2);
  parts.push({ name: "прямые записи", k: linkPts, why: `${i.directLinks} прямых ссылок на музыку` });
  const fitPts = Math.min(6, i.venuesFit);
  parts.push({ name: "площадки под звук", k: fitPts, why: `${i.venuesFit} площадок Пхукета по стилю` });
  const score = Math.round(Math.min(100, fanPts + tierPts + prioPts + verPts + linkPts + fitPts));
  const band =
    score >= 70 ? "хедлайнер" : score >= 45 ? "сильный резидент" : score >= 25 ? "локальная сцена" : "разогрев";
  return { score, band, parts };
};
