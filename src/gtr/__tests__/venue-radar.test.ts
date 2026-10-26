import { describe, expect, it } from "vitest";

import type { VenueDraft } from "../intake";
import { mergeRadarDraft, planRadar, radarName, RADAR_WRITES_PER_RUN, type RadarSighting } from "../venue-radar";

const TODAY = "2026-10-26";
const NOW = Date.UTC(2026, 9, 26, 5);

const seen = (name: string, dateIso: string, extra: Partial<RadarSighting> = {}): RadarSighting => ({
  name,
  region: "bkk",
  source: "ra.co",
  event: { id: `ra-${name}-${dateIso}`, dateIso, title: `Night at ${name}`, url: `https://ra.co/events/${dateIso}` },
  ...extra,
});

describe("radarName", () => {
  it("скрытые и сборные места площадками не считаются", () => {
    for (const n of ["TBA", "TBA - Baccarat", "Secret Location", "Various Venues", "Online", "12", " "])
      expect(radarName(n)).toBe("");
  });

  it("настоящее имя проходит, лишние пробелы срезаны", () => {
    expect(radarName("  Culture   Cafe ")).toBe("Culture Cafe");
    expect(radarName("12 x 12")).toBe("12 x 12");
  });
});

describe("mergeRadarDraft", () => {
  it("новая площадка: черновик с вечерами, местом и источником", () => {
    const d = mergeRadarDraft(
      null,
      "culture-cafe",
      [
        seen("Culture Cafe", "2026-10-28", { address: "Sukhumvit 11, Bangkok", lat: 13.74, lon: 100.55 }),
        seen("Culture Cafe", "2026-10-27"),
      ],
      TODAY,
      NOW,
    );
    expect(d).toMatchObject({
      slug: "culture-cafe",
      name: "Culture Cafe",
      status: "new",
      region: "bkk",
      seenIn: ["ra.co"],
      address: "Sukhumvit 11, Bangkok",
      lat: 13.74,
      lon: 100.55,
      firstSeenAt: NOW,
    });
    expect(d!.events!.map((e) => e.dateIso)).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("повтор того же — писать нечего: бюджет записей KV не тратится", () => {
    const list = [seen("Dual", "2026-10-30")];
    const first = mergeRadarDraft(null, "dual", list, TODAY, NOW)!;
    expect(mergeRadarDraft(first, "dual", list, TODAY, NOW + 7200e3)).toBeNull();
  });

  it("новый вечер или новый источник — запись, первое появление не сдвигается", () => {
    const first = mergeRadarDraft(null, "dual", [seen("Dual", "2026-10-30")], TODAY, NOW)!;
    const more = mergeRadarDraft(first, "dual", [seen("Dual", "2026-11-02")], TODAY, NOW + 1)!;
    expect(more.events!.map((e) => e.dateIso)).toEqual(["2026-10-30", "2026-11-02"]);
    expect(more.firstSeenAt).toBe(NOW);
    const city = mergeRadarDraft(more, "dual", [seen("Dual", "2026-11-02", { source: "www.phuket.net" })], TODAY, NOW + 2)!;
    expect(city.seenIn).toEqual(["ra.co", "www.phuket.net"]);
  });

  it("прошедшие вечера выпадают", () => {
    const old = mergeRadarDraft(null, "dual", [seen("Dual", "2026-10-26")], TODAY, NOW)!;
    const next = mergeRadarDraft(old, "dual", [seen("Dual", "2026-11-05")], "2026-10-27", NOW + 1)!;
    expect(next.events!.map((e) => e.dateIso)).toEqual(["2026-11-05"]);
  });

  it("отклонённую площадку радар не воскрешает", () => {
    const skipped = { ...mergeRadarDraft(null, "mall", [seen("Central World", "2026-10-30")], TODAY, NOW)!, status: "skip" as const };
    expect(mergeRadarDraft(skipped, "mall", [seen("Central World", "2026-11-30")], TODAY, NOW)).toBeNull();
  });

  it("черновик из приёмника постов сохраняет своё имя и обогащение", () => {
    const intake: VenueDraft = { slug: "horn", name: "HORN", seenAt: 1, seenIn: ["tg"], status: "new", kind: "bar", lat: 13.7, lon: 100.5 };
    const d = mergeRadarDraft(intake, "horn", [seen("Horn", "2026-10-29", { lat: 1, lon: 2 })], TODAY, NOW)!;
    expect(d).toMatchObject({ name: "HORN", kind: "bar", lat: 13.7, lon: 100.5, firstSeenAt: 1, seenIn: ["tg", "ra.co"] });
  });
});

describe("planRadar", () => {
  it("сводит находки по имени и ставит вперёд площадки с программой", () => {
    const { writes, fresh } = planRadar(
      [seen("Horn", "2026-10-29"), seen("Culture Cafe", "2026-10-27"), seen("culture cafe", "2026-10-28"), seen("TBA", "2026-10-28")],
      new Map(),
      TODAY,
      NOW,
    );
    expect(writes.map((d) => d.slug)).toEqual(["culture-cafe", "horn"]);
    expect(writes[0].events).toHaveLength(2);
    expect(fresh).toHaveLength(2);
  });

  it("за прогон пишет не больше лимита, известные в «новые» не попадают", () => {
    const many = Array.from({ length: RADAR_WRITES_PER_RUN + 10 }, (_, i) => seen(`Club Number ${i}`, "2026-10-30"));
    const prev = new Map([["club-number-0", { slug: "club-number-0", name: "Club Number 0", seenAt: 1, seenIn: ["tg"], status: "new" } as VenueDraft]]);
    const { writes, fresh } = planRadar(many, prev, TODAY, NOW);
    expect(writes).toHaveLength(RADAR_WRITES_PER_RUN);
    expect(fresh.some((d) => d.slug === "club-number-0")).toBe(false);
  });
});
