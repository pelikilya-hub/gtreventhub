import { describe, expect, it } from "vitest";

import { parseRaListings, regionFromRa } from "../afisha-ra-area";

// Площадки — в том виде, в каком их отдаёт eventListings RA 16.10.2026
const UNCLAVE = { name: "Unclave (Koh Phangan)", address: "Moo 2, 51/26, Ban Tai, Koh Phangan, Surat Thani 84280, Thailand", area: { name: "All" }, location: { latitude: 9.71, longitude: 100.03 } };
const ARMANIA = { name: "Armania Phuket", address: "11 Bangla Road, Patong Beach, Kathu, Phuket 83150, Thailand", area: { name: "All" }, location: { latitude: 7.89, longitude: 98.3 } };
const RED_CNX = { name: "ReD CNX", address: "12 Huay Kaew Rd, Chang Phueak, Amphoe Mueang Chiang Mai, Chiang Mai, Thailand 50300", area: { name: "All" }, location: { latitude: 19, longitude: 99 } };
const ELSEWHERE = { name: "Elsewhere", address: "3 Naradhiwas Rajanagarindra Rd, Si Lom, Bang Rak, Bangkok 10500", area: { name: "Bangkok" }, location: { latitude: 14, longitude: 101 } };
const TBA_BKK = { name: "TBA - Baccarat", address: null as unknown as string, area: { name: "Bangkok" }, location: { latitude: 0, longitude: 0 } };
const NOWHERE = { name: "Deep Green", address: "", area: { name: "All" }, location: { latitude: 0, longitude: 0 } };

const ev = (id: string, date: string, venue: object, extra: object = {}) => ({
  event: { id, title: `Night ${id}`, date: `${date}T00:00:00.000`, startTime: `${date}T22:00:00.000`, contentUrl: `/events/${id}`, venue, images: [{ filename: `https://images.ra.co/${id}.jpg` }], artists: [], ...extra },
});

describe("regionFromRa", () => {
  it("город по адресу: острова раньше Сураттхани, Бангкок по району", () => {
    expect(regionFromRa(UNCLAVE)).toBe("pgn");
    expect(regionFromRa(ARMANIA)).toBe("phuket");
    expect(regionFromRa(RED_CNX)).toBe("cnx");
    expect(regionFromRa(ELSEWHERE)).toBe("bkk");
    expect(regionFromRa({ name: "Ark Bar", address: "Chaweng Beach, Koh Samui" })).toBe("smu");
    expect(regionFromRa({ name: "Lio", address: "Walking Street, Pattaya City" })).toBe("pty");
  });

  it("Пханг-Нга не путается с Панганом", () => {
    expect(regionFromRa({ name: "X", address: "Khao Lak, Takua Pa, Phang Nga 82220" })).toBe("pna");
  });

  it("без адреса — по зоне RA, а округлённые координаты не в счёт", () => {
    expect(regionFromRa(TBA_BKK)).toBe("bkk");
    expect(regionFromRa(NOWHERE)).toBeNull();
    expect(regionFromRa({ name: "Y", location: { latitude: 14, longitude: 101 } })).toBeNull();
    expect(regionFromRa({ name: "Z", location: { latitude: 9.51, longitude: 100.05 } })).toBe("smu");
  });
});

describe("parseRaListings", () => {
  const venues = [
    { id: "VEN-0016", name: "Armania Phuket" },
    { id: "VEN-PGN-0001", name: "Unclave", region: "pgn" },
    { id: "VEN-BKK-0007", name: "Elsewhere Phuket Lounge", region: "phuket" },
  ];

  it("отсекает прошедшее, неизвестный город и дубли; время 00:00 не выдумывает", () => {
    const out = parseRaListings(
      [
        ev("1", "2026-10-15", ARMANIA),
        ev("2", "2026-10-25", ARMANIA),
        ev("2", "2026-10-25", ARMANIA),
        ev("3", "2026-10-31", UNCLAVE, { startTime: "2026-10-31T00:00:00.000" }),
        ev("4", "2026-11-10", NOWHERE),
        ev("5", "2026-11-10", ELSEWHERE),
      ],
      "2026-10-16",
      venues,
    );
    expect(out.map((e) => e.id)).toEqual(["ra-2", "ra-3", "ra-5"]);
    expect(out[0]).toMatchObject({ region: "phuket", vid: "VEN-0016", time: "22:00", url: "https://ra.co/events/2", poster: "https://images.ra.co/2.jpg" });
    expect(out[1]).toMatchObject({ region: "pgn", vid: "VEN-PGN-0001", venue: "Unclave", time: undefined });
  });

  it("с базой сводит только внутри региона", () => {
    const [e] = parseRaListings([ev("5", "2026-11-10", ELSEWHERE)], "2026-10-16", venues);
    expect(e.region).toBe("bkk");
    expect(e.vid).toBeUndefined();
  });

  it("лайнап дописывается к названию, если его там нет", () => {
    const [e] = parseRaListings(
      [ev("6", "2026-11-01", ELSEWHERE, { title: "Elsewhere Fridays", artists: [{ name: "JAKRIN" }, { name: "LaLa" }] })],
      "2026-10-16",
    );
    expect(e.title).toBe("Elsewhere Fridays · JAKRIN, LaLa");
  });
});

describe("чистка RA", () => {
  it("невидимые символы направления текста убираются, Бангсаен — не Паттайя", () => {
    const [e] = parseRaListings([ev("7", "2026-11-04", ELSEWHERE, { title: "VINYL SESSIONS (Strictly Vi‬‬nyl)" })], "2026-10-16");
    expect(e.title).toBe("VINYL SESSIONS (Strictly Vinyl)");
    expect(regionFromRa({ name: "Woowon, Bangsaen, Chonburi", address: "Bangsaen, Chon Buri" })).toBeNull();
  });
});
