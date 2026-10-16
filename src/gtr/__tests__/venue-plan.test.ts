import { describe, expect, it } from "vitest";

import { SPACES } from "../data/app-data";
import { roomPlan, spaceDims, venuePlan } from "../venue-plan";

describe("схема площадки по размерам залов", () => {
  it("размеры читаются из заметок базы", () => {
    expect(spaceDims("Dimensions/configuration: 29.4 x 19.5 x 4.7 m; classroom 240")).toEqual([29.4, 19.5]);
    expect(spaceDims("Dimensions/configuration: 120.7 x 46 m; classroom")).toEqual([120.7, 46]);
    expect(spaceDims("Pool deck; capacity not public")).toBeNull();
  });

  it("Marriott Merlin: секции A + B + C складываются в Grand Ballroom из базы", () => {
    const grand = SPACES("VEN-0069").find((s) => s.name === "Merlin Grand Ballroom")!;
    const [gw, gh] = spaceDims(grand.notes as string)!;
    const a = spaceDims(SPACES("VEN-0069").find((s) => s.name === "Merlin Ballroom A")!.notes as string)!;
    const c = spaceDims(SPACES("VEN-0069").find((s) => s.name === "Merlin Ballroom C")!.notes as string)!;
    expect(a[0] + c[0]).toBeCloseTo(gw, 1); // 13.6 + 15.8 = 29.4
    expect(c[1]).toBeCloseTo(gh, 1); // C во всю глубину Grand
    expect(a[1] * 2).toBeCloseTo(gh, 0); // две секции по 9.8 ≈ 19.5
  });

  it("каждый зал Marriott, кроме уличных, получает место на схеме", () => {
    const plan = venuePlan("VEN-0069")!;
    expect(plan.image.src.startsWith("data:image/svg+xml")).toBe(true);
    for (const s of SPACES("VEN-0069")) {
      const p = plan.anchor(String(s.name));
      if (s.inOut === "Outdoor") continue;
      expect(p, String(s.name)).not.toBeNull();
      expect(p!.x).toBeGreaterThan(0);
      expect(p!.x).toBeLessThan(1000);
    }
  });

  it("схема зала есть у любого зала с размерами, у площадки без раскладки — нет", () => {
    const lawn = roomPlan("VEN-0069", "Beach Lawn");
    expect(lawn).not.toBeNull();
    // четыре блока — четыре разных места внутри зала
    const pts = [0, 1, 2, 3].map((i) => lawn!.slot!(i, 4));
    expect(new Set(pts.map((p) => `${p.x}:${p.y}`)).size).toBe(4);
    expect(venuePlan("VEN-0061")).toBeNull();
    expect(roomPlan("VEN-0069", "Outdoor Pool Deck")).toBeNull();
  });
});
