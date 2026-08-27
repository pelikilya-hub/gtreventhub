// Контуры районов на карте.
//
// Файл собирается скриптом scripts/map-districts-all.py и руками не
// правится. Тест сторожит то, обо что карта ломается молча: контур из
// двух точек Leaflet нарисует как невидимую нитку, кластер без контура
// исчезнет из фильтра районов, а зона по нашим точкам, помеченная как
// административная граница, соврёт человеку про рубеж, которого нет.
import { describe, expect, it } from "vitest";

import bkkRaw from "../data/regions/bkk.json";
import pgnRaw from "../data/regions/pgn.json";
import pnaRaw from "../data/regions/pna.json";
import ptyRaw from "../data/regions/pty.json";
import smuRaw from "../data/regions/smu.json";
import geoRaw from "../data/venue-geo.json";
import shapesRaw from "../data/district-shapes.json";
import regionsRaw from "../data/regions.json";
import venuesRaw from "../data/venues.json";

const REGION_FILES = { bkk: bkkRaw, pgn: pgnRaw, pna: pnaRaw, pty: ptyRaw, smu: smuRaw };
const GEO = geoRaw;

type Shape = {
  name: string;
  center: [number, number];
  count: number;
  tambons: string[];
  src: string;
  rings: [number, number][][];
};
const SHAPES = shapesRaw as unknown as Record<string, Record<string, Shape>>;
const REGIONS = regionsRaw as Record<string, { clusters?: string[] }>;

const all = Object.entries(SHAPES).flatMap(([region, byCluster]) =>
  Object.entries(byCluster).map(([cluster, sh]) => ({ region, cluster, sh })),
);

/** Районы, которые вообще можно нарисовать: там есть площадка с координатой. */
const clustersWithGeo: Record<string, Set<string>> = (() => {
  const geo = GEO as Record<string, unknown>;
  const out: Record<string, Set<string>> = {};
  const add = (code: string, rows: { id: string; cluster?: string }[]) => {
    out[code] = new Set(
      rows
        .filter((v) => geo[v.id])
        .map((v) => (v.cluster ?? "").trim())
        .filter((c) => c && c !== "Other"),
    );
  };
  add("phuket", (venuesRaw as { venues: { id: string; cluster?: string }[] }).venues);
  for (const [code, raw] of Object.entries(REGION_FILES))
    add(code, (raw as { venues: { id: string; cluster?: string }[] }).venues);
  return out;
})();

describe("контуры районов", () => {
  it("есть у всех регионов реестра, а не у одного Пхукета", () => {
    for (const code of Object.keys(REGIONS).filter((k) => !k.startsWith("_")))
      expect(Object.keys(SHAPES[code] ?? {}).length, `регион ${code} без контуров`).toBeGreaterThan(0);
  });

  it("нарисован каждый район, у которого есть площадки с координатами", () => {
    // Именно с координатами: контур строится по точкам, и район, где ни
    // одна площадка не геокодирована, нарисовать нечем. Пустой кластер в
    // реестре — заготовка следующей волны (в Пханг-Нга это «Phang Nga
    // Town / Bay»); на карте его и так нет, чипы районов считаются по
    // площадкам.
    for (const [code, need] of Object.entries(clustersWithGeo))
      for (const cluster of need)
        expect(SHAPES[code]?.[cluster], `${code}: нет контура для «${cluster}»`).toBeTruthy();
  });

  it("лишних контуров нет: район без площадок не рисуем", () => {
    for (const { region, cluster } of all)
      expect(
        clustersWithGeo[region]?.has(cluster),
        `${region}: контур «${cluster}» без единой площадки с координатой`,
      ).toBe(true);
  });

  it("кольцо — это многоугольник, а не нитка из двух точек", () => {
    for (const { region, cluster, sh } of all) {
      expect(sh.rings.length, `${region}/${cluster}: колец нет`).toBeGreaterThan(0);
      for (const ring of sh.rings)
        expect(ring.length, `${region}/${cluster}: кольцо из ${ring.length} точек`).toBeGreaterThan(3);
    }
  });

  it("координаты в порядке Leaflet и в пределах Таиланда", () => {
    for (const { region, cluster, sh } of all)
      for (const ring of sh.rings)
        for (const [lat, lon] of ring) {
          expect(lat, `${region}/${cluster}: широта ${lat}`).toBeGreaterThan(5);
          expect(lat, `${region}/${cluster}: широта ${lat}`).toBeLessThan(21);
          expect(lon, `${region}/${cluster}: долгота ${lon}`).toBeGreaterThan(96);
          expect(lon, `${region}/${cluster}: долгота ${lon}`).toBeLessThan(106);
        }
  });

  it("происхождение контура записано и не выдаёт зону за границу", () => {
    for (const { region, cluster, sh } of all) {
      expect(["osm", "venues"], `${region}/${cluster}: src=${sh.src}`).toContain(sh.src);
      // Административный контур обязан назвать тамбоны, из которых собран,
      // — иначе провенанс не проверить. У зоны их нет по определению.
      if (sh.src === "osm") expect(sh.tambons.length, `${region}/${cluster}`).toBeGreaterThan(0);
      else expect(sh.tambons, `${region}/${cluster}: у зоны не бывает тамбонов`).toEqual([]);
    }
  });

  it("Пхукет и Бангкок нарисованы по настоящим границам", () => {
    // Единственные два региона, где OSM знает административную сетку
    // целиком. Если контуры там вдруг станут зонами — сетку потеряли,
    // и это надо заметить, а не принять молча.
    expect(Object.values(SHAPES.phuket).every((s) => s.src === "osm")).toBe(true);
    expect(Object.values(SHAPES.bkk).some((s) => s.src === "osm")).toBe(true);
  });
});
