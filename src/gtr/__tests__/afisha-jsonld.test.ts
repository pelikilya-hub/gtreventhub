// JSON-LD слой разведки афиш: сайты мимо WordPress (Wix, Tilda, Squarespace)
// размечают события для Google — мы читаем ту же разметку. Тесты держат
// главное: событие без даты или в прошлом не появляется, битые блоки не
// роняют разбор, @graph и массивы типов разворачиваются.
import { describe, expect, it } from "vitest";

import { eventsFromJsonLd } from "../afisha";

const wrap = (json: string) =>
  `<html><head><script type="application/ld+json">${json}</script></head><body/></html>`;

describe("eventsFromJsonLd", () => {
  it("читает MusicEvent с датой, постером и ссылкой", () => {
    const html = wrap(
      JSON.stringify({
        "@type": "MusicEvent",
        name: "Techno Ritual",
        startDate: "2030-01-15T22:00:00+07:00",
        url: "https://club.example/e/ritual",
        image: [{ url: "https://club.example/p.jpg" }],
      }),
    );
    const ev = eventsFromJsonLd(html, "club.example");
    expect(ev).toHaveLength(1);
    expect(ev[0].dateIso).toBe("2030-01-15");
    expect(ev[0].title).toBe("Techno Ritual");
    expect(ev[0].poster).toBe("https://club.example/p.jpg");
    expect(ev[0].url).toBe("https://club.example/e/ritual");
    expect(ev[0].source).toBe("club.example");
  });

  it("разворачивает @graph и массив @type, прошлое отбрасывает", () => {
    const html = wrap(
      JSON.stringify({
        "@graph": [
          { "@type": ["Event", "Thing"], name: "Future Party", startDate: "2030-02-02" },
          { "@type": "Event", name: "Old Party", startDate: "2020-01-01" },
          { "@type": "Organization", name: "Не событие" },
        ],
      }),
    );
    const ev = eventsFromJsonLd(html, "x.example");
    expect(ev.map((e) => e.title)).toEqual(["Future Party"]);
  });

  it("битый JSON-блок не роняет разбор соседних", () => {
    const html =
      wrap("{not json") +
      wrap(JSON.stringify({ "@type": "Event", name: "Alive", startDate: "2030-03-03" }));
    expect(eventsFromJsonLd(html, "x.example").map((e) => e.title)).toEqual(["Alive"]);
  });

  it("без имени или без даты события не бывает", () => {
    const html = wrap(
      JSON.stringify([
        { "@type": "Event", startDate: "2030-04-04" },
        { "@type": "Event", name: "No date" },
      ]),
    );
    expect(eventsFromJsonLd(html, "x.example")).toHaveLength(0);
  });
});
