// Мост между тем, как имя произносят, и тем, как оно записано в базе.
import { describe, expect, it } from "vitest";

import venuesPub from "../../data/venues.public.json";
import { buildHeardIndex, fixHeard, skeleton } from "../hear";

const names = (venuesPub as { venues: { name: string }[] }).venues.map((v) => v.name);
const ix = buildHeardIndex(names);

describe("согласный скелет", () => {
  it("сводит русское произношение и латинское написание к одному", () => {
    const pairs: [string, string][] = [
      ["Catch", "кетч"],
      ["XANA", "ксана"],
      ["Moonshine", "муншайн"],
      ["Malika", "малика"],
      ["Illuzion", "иллюжн"],
      ["Beach", "бич"],
      ["Phuket", "пхукет"],
    ];
    for (const [lat, cyr] of pairs) {
      expect(`${lat}/${cyr}: ${skeleton(lat)} = ${skeleton(cyr)}`).toBe(
        `${lat}/${cyr}: ${skeleton(lat)} = ${skeleton(lat)}`,
      );
    }
  });

  it("разные имена не схлопываются в один скелет", () => {
    expect(skeleton("Catch")).not.toBe(skeleton("XANA"));
    expect(skeleton("Moonshine")).not.toBe(skeleton("Malika"));
  });
});

describe("починка услышанного", () => {
  it("многословное имя чинится целиком", () => {
    expect(fixHeard("поехали в кетч бич клаб", ix)).toContain("Catch Beach Club");
  });

  it("одиночное имя тоже", () => {
    expect(fixHeard("что сегодня в ксана", ix)).toContain("XANA");
  });

  it("уже правильное написание не трогает", () => {
    const s = "что сегодня в Catch Beach Club";
    expect(fixHeard(s, ix)).toBe(s);
  });

  it("обычную речь без имён оставляет как есть", () => {
    const s = "а во сколько там начинается и дорого ли";
    expect(fixHeard(s, ix)).toBe(s);
  });

  it("общие слова сами по себе именем не считает", () => {
    const s = "хочу в бар";
    expect(fixHeard(s, ix)).toBe(s);
  });

  it("неоднозначный скелет не трогает вовсе", () => {
    // Два разных места с одним скелетом: угадать нельзя, значит не трогаем.
    const two = buildHeardIndex(["Malika", "Milaka"]);
    expect(skeleton("Malika")).toBe(skeleton("Milaka"));
    expect(two.get(skeleton("Malika"))).toBeNull();
    expect(fixHeard("идём в малику", two)).toBe("идём в малику");
  });

  it("сохраняет остальную фразу и знаки", () => {
    const out = fixHeard("кетч бич клаб — во сколько?", ix);
    expect(out).toContain("— во сколько?");
  });
});
