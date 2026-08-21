// Вайб-чек: чистая функция бакетов темпа+баса — единственная часть
// фичи, которую можно проверить без реального микрофона в браузере.
import { describe, expect, it } from "vitest";

import { classifyVibe } from "../vibecheck";

describe("classifyVibe", () => {
  it("не нащупали ритм — честно говорит об этом, а не подставляет BPM", () => {
    const r = classifyVibe(null, 0.2);
    expect(r.key).toBe("unclear");
  });

  it("нет ритма, но много баса — фоновый бас, а не выдуманный темп", () => {
    const r = classifyVibe(null, 0.6);
    expect(r.key).toBe("ambient-bass");
  });

  it("медленный темп — чилл", () => {
    expect(classifyVibe(80, 0.3).key).toBe("chill");
  });

  it("120 bpm с тяжёлым басом — бас-хаус, без баса — хаус", () => {
    expect(classifyVibe(120, 0.5).key).toBe("bass-house");
    expect(classifyVibe(120, 0.3).key).toBe("house");
  });

  it("135 bpm с тяжёлым басом — техно, без — прогрессив", () => {
    expect(classifyVibe(135, 0.5).key).toBe("techno");
    expect(classifyVibe(135, 0.3).key).toBe("progressive");
  });

  it("150 bpm — транс, 165 — хардстайл", () => {
    expect(classifyVibe(150, 0.3).key).toBe("trance");
    expect(classifyVibe(165, 0.3).key).toBe("hardstyle");
  });
});
