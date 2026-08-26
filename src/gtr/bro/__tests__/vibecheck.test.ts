// Вайб-чек: чистая функция классификации по темпу+спектру — единственная
// часть фичи, которую можно проверить без реального микрофона в браузере.
// Стиль теперь называется тем же словарём dir/ru, что и остальная база
// жанров (genre-bpm.json — диапазоны по общепринятым темповым
// конвенциям, не выгрузка с внешнего сервиса).
import { describe, expect, it } from "vitest";

import { classifyVibe } from "../vibecheck";

describe("classifyVibe", () => {
  it("не нащупали ритм — честно говорит об этом, а не подставляет BPM", () => {
    expect(classifyVibe(null, 0.2).key).toBe("unclear");
  });

  it("нет ритма, но много баса — фоновый бас, а не выдуманный темп", () => {
    expect(classifyVibe(null, 0.6).key).toBe("ambient-bass");
  });

  it("медленный темп — чилл", () => {
    expect(classifyVibe(80, 0.3).key).toBe("chill");
  });

  it("диско ниже хауса", () => {
    expect(classifyVibe(110, 0.3).ru).toBe("диско");
  });

  it("хаус с тяжёлым басом получает пометку «бас-хаус»", () => {
    const r = classifyVibe(123, 0.5);
    expect(r.key).toBe("house");
    expect(r.ru).toContain("бас-хаус");
  });

  it("зона пересечения техно/транс: тяжёлый бас — техно, лёгкий — транс", () => {
    expect(classifyVibe(138, 0.55).key).toBe("techno");
    expect(classifyVibe(138, 0.3).key).toBe("trance");
  });

  it("явное техно вне зоны пересечения остаётся техно", () => {
    expect(classifyVibe(129, 0.3).key).toBe("techno");
  });

  it("зона пересечения hard dance/dnb: ровный бит — hard dance, рваный — dnb", () => {
    expect(classifyVibe(170, 0.4, 0.9).key).toBe("hard-dance");
    expect(classifyVibe(170, 0.4, 0.3).key).toBe("drum-bass");
  });

  it("явный hard dance вне зоны пересечения не зависит от ровности", () => {
    expect(classifyVibe(185, 0.4, 0.1).key).toBe("hard-dance");
  });
});
