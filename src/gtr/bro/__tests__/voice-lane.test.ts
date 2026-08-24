import { describe, expect, it } from "vitest";
import { LaneGuard, NO_FALLBACK } from "../voice-lane";
import { ttsChunks } from "../local-voice";

describe("LaneGuard", () => {
  it("не поднялось соединение — падаем на стабильную сразу", () => {
    const g = new LaneGuard();
    expect(g.failed("network", false, 1000)).toBe(true);
  });

  it("одиночный обрыв живого эфира прощается", () => {
    const g = new LaneGuard();
    expect(g.failed("ws-close", true, 1000)).toBe(false);
  });

  it("второй обрыв за 30 секунд — пересадка", () => {
    const g = new LaneGuard();
    g.failed("ws-close", true, 1000);
    expect(g.failed("api", true, 20_000)).toBe(true);
  });

  it("обрывы реже окна не копятся", () => {
    const g = new LaneGuard();
    g.failed("ws-close", true, 1000);
    expect(g.failed("ws-close", true, 40_000)).toBe(false);
    // ...и третий через ещё 40 секунд — тоже одиночный.
    expect(g.failed("ws-close", true, 80_000)).toBe(false);
  });

  it("ошибки, которые пересадка не лечит, в счёт не идут", () => {
    const g = new LaneGuard();
    for (const kind of NO_FALLBACK) {
      expect(g.failed(kind, false, 1000)).toBe(false);
      expect(g.failed(kind, true, 1000)).toBe(false);
    }
    // ...и следом обычный одиночный обрыв всё ещё прощается: запрещённые
    // ошибки не должны были накрутить счётчик.
    expect(g.failed("ws-close", true, 2000)).toBe(false);
  });

  it("reset забывает историю обрывов", () => {
    const g = new LaneGuard();
    g.failed("ws-close", true, 1000);
    g.reset();
    expect(g.failed("ws-close", true, 2000)).toBe(false);
  });
});

describe("ttsChunks", () => {
  it("короткий ответ — один кусок", () => {
    expect(ttsChunks("Погнали в Illuzion.")).toEqual(["Погнали в Illuzion."]);
  });

  it("длинный ответ режется по предложениям, не по буквам", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Предложение номер ${i} про вечер на Пхукете.`).join(" ");
    const chunks = ttsChunks(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c).toMatch(/\.$/);
    expect(chunks.join(" ")).toBe(long);
  });

  it("пустота и пробелы — пустой список", () => {
    expect(ttsChunks("   ")).toEqual([]);
  });
});
