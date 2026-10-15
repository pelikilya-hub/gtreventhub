import { describe, expect, it } from "vitest";

import type { GraphNode } from "../data/app-data";
import { autoLayout } from "../screens/PlanCanvas";

const node = (id: string, kind: GraphNode["kind"], extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind,
  x: 0,
  y: 0,
  title: id,
  sub: "",
  badge: "",
  fields: [],
  ...extra,
});

describe("план: авто-раскладка значков", () => {
  it("площадка первой, затем залы, по колонкам", () => {
    const pos = autoLayout(
      [node("p", "promo"), node("r1", "room"), node("v", "venue"), node("r2", "room")],
      3,
    );
    expect(pos.get("v")).toEqual({ x: 80, y: 70 });
    expect(pos.get("r1")?.y).toBe(70);
    expect(pos.get("r2")?.y).toBe(70);
    // четвёртый уходит на второй ряд при трёх колонках
    expect(pos.get("p")).toEqual({ x: 80, y: 210 });
  });

  it("узлы, уже поставленные на план, не трогает", () => {
    const pos = autoLayout([node("v", "venue", { px: 500, py: 300 }), node("r", "room")], 5);
    expect(pos.has("v")).toBe(false);
    expect(pos.get("r")).toEqual({ x: 80, y: 70 });
  });
});
