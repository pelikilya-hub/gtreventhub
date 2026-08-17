// Парсер афиш разбирает чужие посты в наши факты. Тесты держат главное:
// без даты события не появляется, прошедшая дата без года уезжает в
// следующий год, а служебные слова не становятся именами артистов.
import { describe, expect, it } from "vitest";

import { parseArtists, parseDate, parsePost, parsePrice, parseTime, parseVenue } from "../afisha-parse";

// 15 августа 2026, Пхукет
const NOW = Date.parse("2026-08-15T05:00:00Z");

describe("дата", () => {
  it("читает русские и английские написания", () => {
    expect(parseDate("22 августа большая ночь", NOW)).toBe("2026-08-22");
    expect(parseDate("Party on Aug 22", NOW)).toBe("2026-08-22");
    expect(parseDate("22 aug", NOW)).toBe("2026-08-22");
    expect(parseDate("22.08 в клубе", NOW)).toBe("2026-08-22");
    expect(parseDate("2026-08-22", NOW)).toBe("2026-08-22");
  });

  it("сегодня и завтра считаются по времени острова", () => {
    expect(parseDate("сегодня в патонге", NOW)).toBe("2026-08-15");
    expect(parseDate("завтра", NOW)).toBe("2026-08-16");
  });

  it("прошедшая дата без года — это следующий год", () => {
    expect(parseDate("3 марта", NOW)).toBe("2027-03-03");
  });

  it("без даты события не бывает", () => {
    expect(parseDate("Лучшие клубы острова, подписывайся", NOW)).toBeNull();
    expect(parsePost("Реклама: @PhuketParty_AdminBot", NOW)).toBeNull();
  });

  it("время не путается с датой", () => {
    expect(parseDate("старт в 22:00", NOW)).toBeNull();
    expect(parseTime("старт в 22:00")).toBe("22:00");
  });
});

describe("площадка", () => {
  it("берётся из строки-указателя", () => {
    expect(parseVenue("🔥 Notorious Friday\n📍 Illuzion Phuket\n🎧 DJ Meet")).toBe("Illuzion Phuket");
    expect(parseVenue("Место: Café del Mar")).toBe("Café del Mar");
    expect(parseVenue("@ Catch Beach Club")).toBe("Catch Beach Club");
  });

  it("в табличном формате площадка — первая ячейка", () => {
    expect(parseVenue("Illuzion | Notorious Friday | 22:00")).toBe("Illuzion");
  });

  it("служебная строка площадкой не становится", () => {
    expect(parseVenue("Вход | 500 ฿")).toBe("");
  });
});

describe("лайнап", () => {
  it("собирает имена из строки артистов", () => {
    expect(parseArtists("🎧 DJ Meet, LUTANG & Alex Vee")).toEqual(["DJ Meet", "LUTANG", "Alex Vee"]);
    expect(parseArtists("Line up: A-Mase / Nagornaya")).toEqual(["A-Mase", "Nagornaya"]);
  });

  it("читает тайминг-сетку", () => {
    expect(parseArtists("22:00 — LUTANG\n01:00 — DJ Meet")).toEqual(["LUTANG", "DJ Meet"]);
  });

  it("служебные слова не попадают в лайнап", () => {
    expect(parseArtists("🎧 dj, live, вход")).toEqual([]);
  });
});

describe("цена", () => {
  it("читает баты и свободный вход", () => {
    expect(parsePrice("вход 500฿")).toBe("500 ฿");
    expect(parsePrice("entry 1000 THB")).toBe("1000 ฿");
    expect(parsePrice("Вход свободный до 23:00")).toBe("вход свободный");
    expect(parsePrice("просто текст")).toBeUndefined();
  });
});

describe("пост целиком", () => {
  it("разбирается в факты", () => {
    const p = parsePost(
      ["🔥 NOTORIOUS FRIDAY", "📍 Illuzion Phuket", "22 августа, старт 23:00", "🎧 DJ Meet, LUTANG", "Вход 500฿"].join("\n"),
      NOW,
    );
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.dateIso).toBe("2026-08-22");
    expect(p.venueQuery).toBe("Illuzion Phuket");
    expect(p.artistNames).toEqual(["DJ Meet", "LUTANG"]);
    expect(p.timeText).toBe("23:00");
    expect(p.priceText).toBe("500 ฿");
    expect(p.title.length).toBeGreaterThan(3);
  });
});
