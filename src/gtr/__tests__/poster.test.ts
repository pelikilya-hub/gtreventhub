// Модуль постеров: у каждого события есть афиша.
//
// Три вещи ломали ленту, и каждая проверяется здесь отдельно:
//   1) относительный путь картинки резолвился от НАШЕГО домена;
//   2) ключ /api/poster не пускал id с кириллицей и тайским;
//   3) события без постера показывались дыркой.
import { describe, expect, it } from "vitest";

import { eventsFromJsonLd } from "../afisha";
import {
  absImg,
  parsePosterKey,
  posterKey,
  posterKvKey,
  posterSlug,
  posterSvg,
  posterUrl,
  wrapTitle,
} from "../poster";

describe("адрес картинки", () => {
  it("относительный путь резолвится от страницы площадки, а не от нас", () => {
    expect(absImg("/wp-content/uploads/party.jpg", "https://club.example/events/friday")).toBe(
      "https://club.example/wp-content/uploads/party.jpg",
    );
  });

  it("протокол-относительный адрес получает схему страницы", () => {
    expect(absImg("//cdn.example/p.jpg", "https://club.example/e")).toBe("https://cdn.example/p.jpg");
  });

  it("соседний файл считается от каталога страницы", () => {
    expect(absImg("poster.jpg", "https://club.example/events/friday")).toBe(
      "https://club.example/events/poster.jpg",
    );
  });

  it("абсолютный адрес не трогаем", () => {
    expect(absImg("https://cdn.example/p.jpg", "https://club.example")).toBe("https://cdn.example/p.jpg");
  });

  it("data: и мусор отбрасываем — их нельзя скачать вторым запросом", () => {
    expect(absImg("data:image/png;base64,AAA", "https://club.example")).toBe("");
    expect(absImg("", "https://club.example")).toBe("");
    expect(absImg("javascript:alert(1)", "https://club.example")).toBe("");
  });
});

describe("ключ постера", () => {
  it("латинский слуг проходит как есть — старый кэш остаётся рабочим", () => {
    expect(posterSlug("hebdonis-13-aug")).toBe("hebdonis-13-aug");
    expect(posterKvKey("VEN-0002", "hebdonis-13-aug")).toBe("poster:VEN-0002:hebdonis-13-aug");
  });

  it("кириллица и тайский превращаются в безопасный ключ", () => {
    for (const id of ["ld-2026-08-30-ночь-музыки", "ld-2026-09-01-คืนนี้", "tribe-12%d0%bf"]) {
      const slug = posterSlug(id);
      expect(slug, id).toMatch(/^[A-Za-z0-9._-]{1,80}$/);
      expect(parsePosterKey(`VEN-0002:${slug}`)).toEqual({ vid: "VEN-0002", slug });
    }
  });

  it("разные id дают разные ключи, один и тот же — всегда один", () => {
    const a = posterSlug("ld-2026-08-30-ночь");
    const b = posterSlug("ld-2026-08-30-день");
    expect(a).not.toBe(b);
    expect(posterSlug("ld-2026-08-30-ночь")).toBe(a);
  });

  it("битый ключ ручка отвергает", () => {
    expect(parsePosterKey("")).toBeNull();
    expect(parsePosterKey("VEN-0002")).toBeNull();
    expect(parsePosterKey(":slug")).toBeNull();
    expect(parsePosterKey("VEN-0002:сло/эш")).toBeNull();
  });

  it("адрес картинки — один на всё приложение", () => {
    expect(posterUrl("VEN-0002", "ld-2026-08-30-ночь")).toBe(
      `/api/poster?k=${encodeURIComponent(posterKey("VEN-0002", "ld-2026-08-30-ночь"))}`,
    );
  });
});

describe("нарисованная афиша", () => {
  const art = posterSvg({
    title: "Sunset & Bass",
    dateIso: "2026-08-30",
    venueName: "Café del Mar",
    accent: "#F08C51",
  });

  it("это картинка с названием, числом и месяцем", () => {
    expect(art.startsWith("<svg")).toBe(true);
    expect(art).toContain("SUNSET");
    expect(art).toContain(">30<");
    expect(art).toContain(">AUG<");
  });

  it("текст экранирован — афиша не ломается о кавычки и амперсанд", () => {
    const evil = posterSvg({
      title: 'Bass & <script>"x"</script>',
      dateIso: "2026-08-30",
      venueName: "Club",
    });
    expect(evil).not.toContain("<script>");
    expect(evil).toContain("&amp;");
  });

  it("цвет берётся у категории площадки, мусорный — игнорируется", () => {
    expect(art).toContain("#F08C51");
    expect(posterSvg({ title: "X", dateIso: "2026-01-02", venueName: "Y", accent: "red" })).toContain(
      "#E5231B",
    );
  });

  it("длинное название режется, а не вылезает за холст", () => {
    const lines = wrapTitle("ОДНО ДВА ТРИ ЧЕТЫРЕ ПЯТЬ ШЕСТЬ СЕМЬ ВОСЕМЬ ДЕВЯТЬ ДЕСЯТЬ", 12, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(lines[lines.length - 1].endsWith("…")).toBe(true);
  });
});

describe("разметка schema.org", () => {
  it("относительная картинка события доезжает абсолютным адресом", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "MusicEvent",
      name: "Night",
      startDate: "2099-12-31",
      url: "/events/night",
      image: "/img/night.jpg",
    })}</script>`;
    const [ev] = eventsFromJsonLd(html, "club.example", "https://club.example/events");
    expect(ev.poster).toBe("https://club.example/img/night.jpg");
    expect(ev.url).toBe("https://club.example/events/night");
  });
});
