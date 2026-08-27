import { describe, expect, it } from "vitest";
import {
  eventsToday,
  signupsToday,
  createdToday,
  phuketDayStart,
  type DigestAfishaEvent,
  type DigestUser,
} from "../daily-digest";

const ev = (vid: string, dateIso: string, artistIds: string[] = []): DigestAfishaEvent => ({ vid, dateIso, artistIds });

describe("daily-digest", () => {
  it("считает события дня, площадки и топ по числу событий", () => {
    const events = [
      ev("VEN-1", "2026-08-27", ["A"]),
      ev("VEN-1", "2026-08-27"),
      ev("VEN-2", "2026-08-27"),
      ev("VEN-3", "2026-08-28"),
    ];
    const r = eventsToday(events, "2026-08-27");
    expect(r.total).toBe(3);
    expect(r.venues).toBe(2);
    expect(r.withArtist).toBe(1);
    expect(r.byVenue[0]).toEqual({ vid: "VEN-1", count: 2 });
  });

  it("топ заведений детерминирован при равном числе событий", () => {
    const r = eventsToday([ev("VEN-B", "2026-08-27"), ev("VEN-A", "2026-08-27")], "2026-08-27");
    expect(r.byVenue.map((x) => x.vid)).toEqual(["VEN-A", "VEN-B"]);
  });

  it("регистрации за сегодня разбиваются по ролям", () => {
    const day = 1_700_000_000_000;
    const users: DigestUser[] = [
      { role: "owner", created: day + 1000 },
      { role: "organizer", created: day + 2000 },
      { role: "artist", created: day + 3000 },
      { role: "gtr", created: day + 4000 },
      { role: "visitor", created: day - 5000 }, // вчера — не в счёт
    ];
    expect(signupsToday(users, day)).toEqual({ venues: 1, organizers: 1, artists: 1, team: 1, total: 4 });
  });

  it("createdToday игнорирует сидовые записи без реального времени", () => {
    const day = 1_700_000_000_000;
    expect(createdToday([{ ts: day + 1 }, { ts: 5 }, { ts: day - 1 }], day)).toBe(1);
  });

  it("phuketDayStart — полночь по UTC+7, кратна суткам в локальном поясе", () => {
    // 2026-08-27T02:00:00Z = 09:00 по Пхукету → начало суток 2026-08-26T17:00:00Z
    const noonPhuket = Date.parse("2026-08-27T02:00:00Z");
    const start = phuketDayStart(noonPhuket);
    expect(new Date(start).toISOString()).toBe("2026-08-26T17:00:00.000Z");
  });
});
