import { describe, expect, it } from "vitest";
import { loudness, pickHeadliner, islandDigest, type DigestEvent } from "../guest-digest";

const ev = (p: Partial<DigestEvent> & { id: string }): DigestEvent => ({
  vid: "VEN-0001",
  title: "Party",
  dateIso: "2026-08-27",
  artistIds: [],
  ...p,
});

describe("guest-digest", () => {
  it("наш артист перевешивает постер", () => {
    const withArtist = ev({ id: "a", artistIds: ["ART-1"] });
    const withPoster = ev({ id: "b", poster: "p.jpg" });
    expect(loudness(withArtist)).toBeGreaterThan(loudness(withPoster));
  });

  it("постер перевешивает голое событие", () => {
    expect(loudness(ev({ id: "a", poster: "p.jpg" }))).toBeGreaterThan(loudness(ev({ id: "b" })));
  });

  it("хедлайнер — самое шумное событие сегодня", () => {
    const events = [
      ev({ id: "quiet", title: "x" }),
      ev({ id: "loud", artistIds: ["ART-1", "ART-2"], poster: "p.jpg", title: "Big Night" }),
      ev({ id: "yesterday", dateIso: "2026-08-26", artistIds: ["ART-9"], poster: "q.jpg" }),
    ];
    expect(pickHeadliner(events, "2026-08-27")?.id).toBe("loud");
  });

  it("без событий сегодня — null (откат к видео)", () => {
    expect(pickHeadliner([ev({ id: "old", dateIso: "2026-08-01" })], "2026-08-27")).toBeNull();
  });

  it("ранжирование детерминированно при равных очках", () => {
    const a = ev({ id: "aaa", title: "Same" });
    const b = ev({ id: "bbb", title: "Same" });
    expect(pickHeadliner([b, a], "2026-08-27")?.id).toBe("aaa");
    expect(pickHeadliner([a, b], "2026-08-27")?.id).toBe("aaa");
  });

  it("сводка считает события, площадки и наших артистов только за сегодня", () => {
    const events = [
      ev({ id: "1", vid: "VEN-0001", artistIds: ["ART-1"] }),
      ev({ id: "2", vid: "VEN-0001" }),
      ev({ id: "3", vid: "VEN-0002", artistIds: ["ART-2"] }),
      ev({ id: "old", vid: "VEN-0003", dateIso: "2026-08-01" }),
    ];
    expect(islandDigest(events, "2026-08-27")).toEqual({ events: 3, venues: 2, withArtist: 2 });
  });
});
