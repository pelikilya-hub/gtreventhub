import { describe, expect, it } from "vitest";

import {
  attach,
  parseMegatix,
  parseTicketmelon,
  sitemapEntries,
  ticketRegion,
  tmEventFromHtml,
  tmToFetch,
  TM_PAGES_PER_RUN,
} from "../afisha-tickets";

const TODAY = "2026-11-08";
const venues = [
  { id: "VEN-0013", name: "Illuzion Phuket" },
  { id: "VEN-0002", name: "Café del Mar" },
  { id: "VEN-BKK1", name: "Illuzion Bar", region: "bkk" },
];

// Записи — в том виде, в каком их отдаёт /api/v2/events/search 08.11.2026
const mx = (id: number, name: string, venue: string, start: string, extra: object = {}) => ({
  id,
  name,
  slug: `ev-${id}`,
  promoter_name: "",
  venue_name: venue,
  is_published: true,
  visibility: "Public",
  cover: `https://media.megatix.com.au/e/${id}/a.jpg`,
  banner: "/images/cover.png",
  display_price: "฿300.00 - ฿25,000.00",
  start_datetime: start,
  ...extra,
});

describe("ticketRegion", () => {
  it("английский адрес, тайский адрес и точка на карте", () => {
    expect(ticketRegion("BOA Nightclub Phuket")).toBe("phuket");
    expect(ticketRegion("Cloud 11 - Bangkok")).toBe("bkk");
    expect(ticketRegion("Oxa Koh Phangan")).toBe("pgn");
    expect(ticketRegion("Yeden Gardens", "777J+2JW หมู่ 5 ตำบล โคกกลอย อำเภอตะกั่วทุ่ง พังงา 82140, Thailand")).toBe("pna");
    expect(ticketRegion("Some Hall", "ถนนรัชดาภิเษก กรุงเทพมหานคร 10400")).toBe("bkk");
    expect(ticketRegion("No Name", "", 9.51, 100.05)).toBe("smu");
  });

  it("город не узнан — null, а не Пхукет по умолчанию", () => {
    expect(ticketRegion("Koh Tao")).toBeNull();
    expect(ticketRegion("Revolution Hostel Pai")).toBeNull();
  });
});

describe("attach", () => {
  const base = [
    { id: "PGN-37", name: "Sabai Corner Koh Phangan", region: "pgn" },
    { id: "SMU-2", name: "CLUB SEEN Koh Samui", region: "smu" },
    { id: "SMU-14", name: "WOOBAR (W Koh Samui)", region: "smu" },
    { id: "V-108", name: "Luxury 3BR Villa Wallaya with Private Pool" },
    { id: "V-2", name: "Café del Mar" },
  ];
  it("одно имя входит в другое — та же площадка", () => {
    expect(attach("Cafe Del Mar Phuket", "phuket", base)).toBe("V-2");
    expect(attach("Woobar", "smu", base)).toBe("SMU-14");
    expect(attach("CLUB SEEN Koh Samui", "smu", base)).toBe("SMU-2");
  });
  it("общих слов мало: остров и «luxury pool villa» площадку не делают", () => {
    expect(attach("Oxa Koh Phangan", "pgn", base)).toBeUndefined();
    expect(attach("Amari Koh Samui", "smu", base)).toBeUndefined();
    expect(attach("Cabanas Koh Samui Beach Club", "smu", base)).toBeUndefined();
    expect(attach("Sri Panwa Phuket Luxury Pool Villa Hotel", "phuket", base)).toBeUndefined();
  });
});

describe("parseMegatix", () => {
  it("вечер с ценой, началом и площадкой из базы", () => {
    const [e] = parseMegatix([mx(1, "MK @ ILLUZION PHUKET - FRI 13 NOV", "Illuzion Phuket", "2026-11-13 22:00:00")], TODAY, venues);
    expect(e).toMatchObject({
      id: "mx-1",
      dateIso: "2026-11-13",
      time: "22:00",
      price: "฿300 - ฿25,000",
      poster: "https://media.megatix.com.au/e/1/a.jpg",
      url: "https://megatix.in.th/events/ev-1",
      region: "phuket",
      vid: "VEN-0013",
      source: "megatix.in.th",
    });
  });

  it("площадку сводит только внутри региона", () => {
    const [e] = parseMegatix([mx(2, "Night", "Illuzion Bar", "2026-11-14 21:00:00", { promoter_name: "Bangkok Nights" })], TODAY, venues);
    expect(e.region).toBe("bkk");
    expect(e.vid).toBe("VEN-BKK1");
  });

  it("город площадки важнее города в названии вечера", () => {
    const [e] = parseMegatix([mx(14, "Kolour Phuket Tour Finale", "Cloud 11 - Bangkok", "2026-11-21 21:00:00")], TODAY);
    expect(e.region).toBe("bkk");
  });

  it("отбрасывает прошедшее, скрытое, не-вечера и витрины заведений", () => {
    const out = parseMegatix(
      [
        mx(3, "Old Party Phuket", "Patong", "2025-02-01 22:00:00"),
        mx(4, "Hidden Phuket", "Patong", "2026-11-20 22:00:00", { visibility: "Private" }),
        mx(5, "Phuket Airport Transfer", "Patong", "2026-11-20 10:00:00"),
        mx(6, "Afroroom PHUKET - VIP Tables", "AFROROOM PHUKET", "2026-11-20 22:00:00"),
        mx(7, "SunRay Social & Swim Club - DayPass", "SunRay Samui", "2026-11-20 10:00:00"),
        mx(8, "Alexa Beach Club Phuket", "Alexa Beach Club Phuket", "2026-11-20 10:00:00"),
        mx(9, "Leo Beach Music Festival", "Koh Tao", "2026-11-20 16:00:00"),
        mx(10, "Late Phuket NYE", "Patong", "2027-06-01 22:00:00"),
      ],
      TODAY,
      venues,
      "2027-03-08",
    );
    expect(out).toEqual([]);
  });

  it("концертный тур — вечер, а не экскурсия", () => {
    const out = parseMegatix([mx(11, "My Chemical Romance - South East Asia Tour", "IMPACT Challenger Hall Bangkok", "2026-11-17 19:00:00")], TODAY);
    expect(out).toHaveLength(1);
  });

  it("полночь не выдаёт за время, заглушку постера не берёт, дубли сводит", () => {
    const out = parseMegatix(
      [
        mx(12, "Full Moon Festival Phuket", "Paradise Beach Patong", "2026-11-21 00:00:00", { cover: "https://megatix.in.th/images/cover.png" }),
        mx(13, "Full Moon Festival Phuket", "Paradise Beach Patong", "2026-11-21 00:00:00"),
      ],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].time).toBeUndefined();
    expect(out[0].poster).toBeUndefined();
  });
});

// Страница события Ticketmelon: Zamna, 08.11.2026 (сокращено)
const TM = {
  event_id: "f09923bda76c11f1911101117567899b",
  name: "Zamna Phuket 2027",
  show_starttime: 1801213200000, // 2027-01-29 16:00 по Бангкоку
  show_endtime: 1801328340000,
  timezone: { country: "Asia/Bangkok", offset: 420 },
  img_poster: "https://tm-prod-event-files-v3.s3.ap-southeast-1.amazonaws.com/f0/poster/34.jpeg",
  img_banner: "https://tm-prod-event-files-v3.s3.ap-southeast-1.amazonaws.com/f0/banner/34.jpeg",
  status: "publish",
  is_hide_web: false,
  venue: {
    name: "Yeden Gardens",
    formatted_address: "777J+2JW หมู่ 5 ตำบล โคกกลอย อำเภอตะกั่วทุ่ง พังงา 82140, Thailand",
    latitude: 8.2626124,
    longitude: 98.28158859999999,
  },
};
const html = (event: object) =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { event } } })}</script></body></html>`;

describe("Ticketmelon", () => {
  const url = "https://www.ticketmelon.com/zamna/phuket";

  it("событие из __NEXT_DATA__: дата по местному времени, адрес и точка", () => {
    const e = parseTicketmelon(tmEventFromHtml(html(TM)), url, TODAY);
    expect(e).toMatchObject({
      id: "tm-f09923bda76c11f1911101117567899b",
      title: "Zamna Phuket 2027",
      dateIso: "2027-01-29",
      time: "16:00",
      region: "pna",
      url,
      venue: "Yeden Gardens",
      venueGeo: [8.2626124, 98.28158859999999],
      source: "ticketmelon.com",
    });
    expect(e?.poster).toContain("/poster/");
  });

  it("черновик, скрытое и прошедшее — не вечер", () => {
    expect(parseTicketmelon({ ...TM, status: "draft" }, url, TODAY)).toBeNull();
    expect(parseTicketmelon({ ...TM, is_hide_web: true }, url, TODAY)).toBeNull();
    expect(parseTicketmelon(TM, url, "2027-02-01")).toBeNull();
    expect(tmEventFromHtml("<html>нет данных</html>")).toBeNull();
  });

  it("карта сайта: ссылки и lastmod", () => {
    const xml = `<urlset><url><loc>https://www.ticketmelon.com/a/b</loc><lastmod>2026-11-02</lastmod></url>
      <url> <loc> https://www.ticketmelon.com/c/d </loc></url></urlset>`;
    expect(sitemapEntries(xml)).toEqual([
      { loc: "https://www.ticketmelon.com/a/b", m: "2026-11-02" },
      { loc: "https://www.ticketmelon.com/c/d", m: "" },
    ]);
  });

  it("за прогон читает новые раньше изменившихся, курорты раньше прочих", () => {
    const entries = [
      { loc: "https://www.ticketmelon.com/club/bkk-night", m: "2026-11-05" },
      { loc: "https://www.ticketmelon.com/zamna/phuket", m: "2026-11-01" },
      { loc: "https://www.ticketmelon.com/known/same", m: "2026-11-01" },
      { loc: "https://www.ticketmelon.com/known/changed", m: "2026-11-07" },
    ];
    const cache = {
      "https://www.ticketmelon.com/known/same": { m: "2026-11-01" },
      "https://www.ticketmelon.com/known/changed": { m: "2026-10-01" },
    };
    expect(tmToFetch(entries, cache)).toEqual([
      "https://www.ticketmelon.com/zamna/phuket",
      "https://www.ticketmelon.com/club/bkk-night",
      "https://www.ticketmelon.com/known/changed",
    ]);
    const many = Array.from({ length: 100 }, (_, i) => ({ loc: `https://www.ticketmelon.com/x/${i}`, m: "" }));
    expect(tmToFetch(many, {})).toHaveLength(TM_PAGES_PER_RUN);
  });
});
