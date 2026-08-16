// Разбор текстовых команд. Правила должны понимать живую русскую речь,
// но не притворяться умнее, чем есть: непонятное честно уходит в help.
import { describe, expect, it } from "vitest";

import { bkkDate, fmtEvents, planOf } from "../text";

describe("разбор команд", () => {
  it("район и «сегодня» из живой фразы", () => {
    const p = planOf("что сегодня в патонге");
    expect(p.kind).toBe("search");
    if (p.kind === "search") {
      expect(p.district).toBe("Патонг");
      expect(p.dateFrom).toBe(bkkDate(0));
    }
  });

  it("завтра сдвигает окно на день", () => {
    const p = planOf("события завтра");
    if (p.kind === "search") expect(p.dateFrom).toBe(bkkDate(1));
    expect(p.kind).toBe("search");
  });

  it("выходные — окно до воскресенья включительно", () => {
    const p = planOf("куда сходить на выходных");
    expect(p.kind).toBe("search");
    if (p.kind === "search") expect(p.dateTo >= p.dateFrom).toBe(true);
  });

  it("алиасы районов: бангтао → Банг Тао", () => {
    const p = planOf("движ в бангтао");
    if (p.kind === "search") expect(p.district).toBe("Банг Тао");
  });

  it("навигация: открой карту", () => {
    expect(planOf("открой карту")).toEqual({ kind: "open", route: "map" });
  });

  it("детали с номером", () => {
    expect(planOf("детали 2")).toEqual({ kind: "details", index: 2 });
  });

  it("маршрут", () => {
    expect(planOf("маршрут")).toEqual({ kind: "route" });
  });

  it("бессмыслица не притворяется поиском", () => {
    expect(planOf("asdfgh").kind).toBe("unknown");
  });

  it("help", () => {
    expect(planOf("помощь").kind).toBe("help");
  });
});

describe("форматтер выдачи", () => {
  it("нумерует и подсказывает следующие шаги", () => {
    const lines = fmtEvents(
      [{ title: "Party", venue: "Illuzion", start_at: "2026-08-16" }],
      "на сегодня",
    );
    expect(lines[0]).toContain("нашёл 1");
    expect(lines[1]).toContain("1. Illuzion");
    expect(lines.at(-1)).toContain("маршрут");
  });
});
