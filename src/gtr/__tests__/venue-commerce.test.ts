// Реестр коммерции площадок.
//
// Раньше бронь была прибита к одному venueId, а данные Catch лежали в
// репозитории неподключёнными. Теперь площадка добавляется одной записью —
// и этот файл следит, чтобы вместе с ней не приехали битые данные:
// чужой venueId, стол без слотов, зона-сирота или цена-строка.
import { describe, expect, it } from "vitest";

import { PH } from "../data/app-data";
import { COMMERCE, hasReserve, menuOf, menuVenues, reserveOf, reserveVenues, zonesOfSpace } from "../venue-commerce";

const VIDS = new Set(PH.venues.map((v) => v.id));

describe("реестр коммерции", () => {
  it("каждая запись указывает на существующую площадку", () => {
    for (const vid of Object.keys(COMMERCE)) expect(VIDS.has(vid), `нет площадки ${vid}`).toBe(true);
  });

  it("ключ реестра совпадает с venueId внутри файлов", () => {
    for (const [vid, c] of Object.entries(COMMERCE)) {
      if (c.reserve) expect(c.reserve.meta.venueId, `рассадка ${vid}`).toBe(vid);
      if (c.menu) expect(c.menu.meta.venueId, `меню ${vid}`).toBe(vid);
    }
  });

  it("бронь открыта там и только там, где есть рассадка", () => {
    for (const vid of VIDS) expect(hasReserve(vid)).toBe(Boolean(COMMERCE[vid]?.reserve));
    expect(reserveVenues().length).toBeGreaterThanOrEqual(2);
  });

  it("у каждого стола есть зона из своей же рассадки", () => {
    for (const { venueName, reserve } of reserveVenues()) {
      const zones = new Set(reserve.zones.map((z) => z.id));
      for (const tb of reserve.tables)
        expect(zones.has(tb.zone), `${venueName}: стол ${tb.id} ссылается на зону ${tb.zone}`).toBe(true);
    }
  });

  it("стол пригоден к брони: слоты, вместимость, депозит числом", () => {
    for (const { venueName, reserve } of reserveVenues())
      for (const tb of reserve.tables) {
        const who = `${venueName} · ${tb.id}`;
        expect(tb.slots.length, `${who}: нет слотов времени`).toBeGreaterThan(0);
        expect(tb.pax, `${who}: вместимость`).toBeGreaterThan(0);
        expect(typeof tb.deposit, `${who}: депозит должен быть числом`).toBe("number");
        if (tb.credit !== undefined) expect(tb.credit).toBeLessThanOrEqual(tb.deposit);
      }
  });

  it("в каждом меню есть позиции, и у них числовая цена", () => {
    for (const { venueName, menu } of menuVenues()) {
      const items = menu.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
      expect(items.length, `${venueName}: пустое меню`).toBeGreaterThan(0);
      for (const it of items)
        expect(typeof it.price, `${venueName} · ${it.name}: цена не число`).toBe("number");
    }
  });

  it("оговорка про налоги идёт вместе с меню", () => {
    // Назвать сумму без оговорки про сервис и НДС — обещать счёт, которого
    // не будет: у Catch сбор включён, у SHAMAN сверху 17%.
    for (const m of menuVenues()) expect(m.note.length, `${m.venueName}: нет примечания к ценам`).toBeGreaterThan(0);
  });

  it("площадка без коммерции отдаёт пустоту, а не падает", () => {
    expect(hasReserve("VEN-9999")).toBe(false);
    expect(reserveOf("VEN-9999")).toBeNull();
    expect(menuOf("VEN-9999")).toBeNull();
    expect(zonesOfSpace("VEN-9999", "any")).toEqual([]);
  });

  it("Catch подключён: и рассадка, и меню", () => {
    // Данные Catch однажды уже пролежали в репозитории мёртвым грузом —
    // проверка именно про это.
    const catchVid = "VEN-0001";
    expect(hasReserve(catchVid)).toBe(true);
    expect(reserveOf(catchVid)!.tables.length).toBeGreaterThan(0);
    expect(menuOf(catchVid)!.sections.length).toBeGreaterThan(0);
  });
});
