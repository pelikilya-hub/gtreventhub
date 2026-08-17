// Прогноз — арифметика, и она обязана быть предсказуемой. Здесь
// проверяется не «красивое число», а поведение модели на границах.
import { describe, expect, it } from "vitest";

import { capacityOf, forecast, pullScore, seasonFactor } from "../forecast";

describe("вместимость из строки базы", () => {
  it("читает разные написания и берёт верх диапазона", () => {
    expect(capacityOf("≈120")).toBe(120);
    expect(capacityOf("300–400")).toBe(400);
    expect(capacityOf("до 5 000 гостей")).toBe(5000);
    expect(capacityOf("")).toBeNull();
    expect(capacityOf("нет данных")).toBeNull();
  });
});

describe("сезон Пхукета", () => {
  it("высокий сезон выше низкого", () => {
    expect(seasonFactor("2026-01-15").k).toBeGreaterThan(seasonFactor("2026-06-15").k);
  });
});

describe("прогноз явки", () => {
  const base = { capacity: 500, type: "Nightclub", tag: "Club", date: "2026-12-05", today: "2026-11-20" };

  it("вилка обрамляет ожидание и не выходит за зал", () => {
    const f = forecast({ ...base, promo: "сильное", price: 0, pull: 100 });
    expect(f.low).toBeLessThanOrEqual(f.expected);
    expect(f.high).toBeGreaterThanOrEqual(f.expected);
    expect(f.high).toBeLessThanOrEqual(Math.round(500 * 1.02));
  });

  it("каждый множитель объяснён", () => {
    const f = forecast(base);
    expect(f.factors.length).toBe(7);
    for (const x of f.factors) expect(x.why.length).toBeGreaterThan(3);
  });

  it("подсказывает слабое место, а не только число", () => {
    const f = forecast({ ...base, date: "2026-06-08", promo: "нет" });
    expect(f.advice.join(" ")).toMatch(/\S/);
  });
});

describe("тяга артиста", () => {
  it("растёт с аудиторией и не превышает ста", () => {
    const low = pullScore({ fans: 0, tier: "C", prio: "B", verified: false, directLinks: 0, venuesFit: 0 });
    const high = pullScore({ fans: 900000, tier: "A", prio: "A", verified: true, directLinks: 3, venuesFit: 20 });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.score).toBeLessThanOrEqual(100);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });

  it("band называет уровень словами", () => {
    expect(pullScore({ fans: 900000, tier: "A", prio: "A", verified: true, directLinks: 3, venuesFit: 20 }).band).toBe(
      "хедлайнер",
    );
  });
});
