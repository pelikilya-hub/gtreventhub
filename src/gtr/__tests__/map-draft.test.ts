// Карта со стороны: черновик площадки из приёмника встаёт на нашу карту,
// а не уводит в чужую.
//
// Раньше «На карте» в черновиках открывало Google Maps: другой дизайн,
// другие знаки, круглые кнопки — и ни одного соседа из нашей базы рядом.
// Теперь точка приходит адресной строкой, и карта сама ставит её среди
// своих. Здесь проверяется то, что можно проверить без Leaflet: разбор
// точки, выбор региона и знак для черновика.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { nearestRegion, parsePin } from "../map-find";
import { catOf, draftCat } from "../map-style";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("parsePin", () => {
  it("читает «lat,lon» с пробелами", () => {
    expect(parsePin("7.8912, 98.2965")).toEqual([7.8912, 98.2965]);
  });
  it("мусор и координаты вне диапазона не пропускает", () => {
    for (const bad of [undefined, "", "x,y", "7.9", "91,98", "7,181", "NaN,1"]) expect(parsePin(bad)).toBeNull();
  });
});

describe("nearestRegion", () => {
  const regions = { phuket: { center: [7.95, 98.34] as [number, number] }, bkk: { center: [13.75, 100.5] as [number, number] } };
  it("Банг-Тао — Пхукет, Сукхумвит — Бангкок", () => {
    expect(nearestRegion([7.99, 98.29], regions)).toBe("phuket");
    expect(nearestRegion([13.74, 100.56], regions)).toBe("bkk");
  });
  it("без регионов — null", () => {
    expect(nearestRegion([7.9, 98.3], {})).toBeNull();
  });
});

describe("draftCat", () => {
  it("тип из Nominatim сводится к знаку карты", () => {
    expect(draftCat("nightclub")).toBe(catOf("Nightclub"));
    expect(draftCat("pub")).toBe(catOf("Bar / Lounge"));
    expect(draftCat("hotel")).toBe(catOf("Resort / MICE"));
    expect(draftCat("beach_resort")).toBe(catOf("Beach club"));
  });
  it("неизвестное и пустое — «Прочее»", () => {
    expect(draftCat("bakery")).toBe(catOf("Other"));
    expect(draftCat(undefined)).toBe(catOf("Other"));
  });
});

describe("черновики ведут на нашу карту", () => {
  const drafts = read("screens/Drafts.tsx");
  it("Google Maps из черновиков ушёл", () => {
    expect(drafts).not.toMatch(/google\.com\/maps/);
  });
  it("с координатой — точка на карте, без — имя в поиске", () => {
    expect(drafts).toMatch(/screen: "map"/);
    expect(drafts).toMatch(/pin: `\$\{v\.lat\},\$\{v\.lon\}`/);
    expect(drafts).toMatch(/find: v\.name/);
  });
  it("роут пропускает точку и поиск на карту", () => {
    const route = read("../routes/gtr/$screen.tsx");
    for (const k of ["pin", "label", "kind", "find"]) expect(route).toMatch(new RegExp(`${k}: typeof s\\.${k} === "string"`));
  });
});
