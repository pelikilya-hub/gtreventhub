import { describe, expect, it } from "vitest";

import { SPACES } from "../data/app-data";
import { buildPresetDraft, EVENT_PRESETS } from "../data/presets";
import { applyRooms } from "../screens/Events";

// Мастер события: залы, выбранные на шаге «Залы и зоны», обязаны попасть в
// граф. Раньше сценарий оставлял один свой зал, а выбор пользователя
// срезал и его — событие уходило в конструктор без единого зала.
describe("мастер: выбранные залы попадают в событие", () => {
  const vid = "VEN-0069"; // Marriott Merlin Beach: 12 залов, больше лимита сборщика
  const preset = EVENT_PRESETS.find((p) => p.id.startsWith("gala")) ?? EVENT_PRESETS[0];

  it("сценарий + три выбранных зала, в том числе за пределами первых шести", () => {
    const names = SPACES(vid).map((s) => String(s.name));
    const pick = [names[0], names[5], names[10]];
    const g = applyRooms(buildPresetDraft(vid, preset, "").graph, pick, [], vid);
    const rooms = g.nodes.filter((n) => n.kind === "room").map((n) => n.title);
    expect(rooms.sort()).toEqual([...pick].sort());
    // каждый зал связан с площадкой
    const venue = g.nodes.find((n) => n.kind === "venue")!;
    for (const r of g.nodes.filter((n) => n.kind === "room"))
      expect(g.links.some((l) => l.from === venue.id && l.to === r.id)).toBe(true);
    // id не повторяются
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
  });

  it("блоки сценария крепятся к первому выбранному залу", () => {
    const names = SPACES(vid).map((s) => String(s.name));
    const g = applyRooms(buildPresetDraft(vid, preset, "").graph, [names[5], names[0]], [], vid);
    const main = g.nodes.find((n) => n.kind === "room" && n.title === names[5])!;
    const placed = g.nodes.filter((n) => ["artist", "sound", "light", "decor", "content", "gear", "interactive"].includes(n.kind));
    for (const n of placed) {
      const owner = g.links.find((l) => l.to === n.id && g.nodes.find((x) => x.id === l.from)?.kind === "room");
      expect(owner?.from).toBe(main.id);
    }
  });
});
