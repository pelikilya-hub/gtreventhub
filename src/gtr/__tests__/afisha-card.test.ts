// Афиша: пропорции, факты, переходы.
//
// Три жалобы разом — «вставляются криво», «информации и фото не хватает»,
// «нет кликабельности и календаря» — оказались одной причиной: данные у
// нас были, а до карточки не доезжали.
//
// Кривизна. Афиши приходят какими есть: Instagram даёт квадрат, обложка
// Facebook — 16:9, сторис — 9:16. Мы рисовали их все в рамке 4:5 через
// object-fit: cover, то есть обрезали до заполнения — и срезали ровно то,
// ради чего афишу смотрят: у горизонтальной уходили левый и правый края
// с именами и временем, у сторис — верх и низ с датой и ценой.
//
// Факты. parseTime и parsePrice работали с самого начала, JSON-LD отдаёт
// startDate со временем, Facebook — start_time. Но VenueAfishaEvent этих
// полей не имел: время срезалось slice(0, 10) и выбрасывалось.
//
// Переходы. Клик по карточке вёл на паспорт площадки — уводил с события,
// ради которого гость и открыл ленту. Дней было много, а выбрать день
// было нечем: лента шла свитком сверху вниз.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { eventsFromJsonLd } from "../afisha";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Страница с разметкой schema.org — то, что отдаёт сайт площадки. */
const ld = (node: Record<string, unknown>) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "MusicEvent",
    name: "Sunset Session",
    ...node,
  })}</script></head><body></body></html>`;

const future = () => {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
};

describe("время и цена из разметки", () => {
  it("время в startDate больше не срезается вместе с зоной", () => {
    // Прямая улика: раньше здесь стоял slice(0, 10) и всё.
    const [e] = eventsFromJsonLd(ld({ startDate: `${future()}T22:00+07:00` }), "x.com");
    expect(e.dateIso).toBe(future());
    expect(e.time).toBe("22:00");
  });

  it("дата без времени не превращается в полночь", () => {
    // «В 00:00» гость прочтёт как факт, а это не факт, а наша выдумка.
    const [e] = eventsFromJsonLd(ld({ startDate: future() }), "x.com");
    expect(e.time).toBeUndefined();
  });

  it("мусор вместо времени отбрасывается", () => {
    const [e] = eventsFromJsonLd(ld({ startDate: `${future()}Tвечером` }), "x.com");
    expect(e.time).toBeUndefined();
  });

  it("цена берётся из offers, а ноль означает свободный вход", () => {
    // Ноль — это не «нет данных»: разница для гостя принципиальная.
    const paid = eventsFromJsonLd(
      ld({ startDate: future(), offers: { price: "500", priceCurrency: "THB" } }),
      "x.com",
    );
    expect(paid[0].price).toBe("500 ฿");
    const free = eventsFromJsonLd(ld({ startDate: future(), offers: { price: 0 } }), "x.com");
    expect(free[0].price).toBe("вход свободный");
  });

  it("нет offers — нет цены, а не «0 ฿»", () => {
    const [e] = eventsFromJsonLd(ld({ startDate: future() }), "x.com");
    expect(e.price).toBeUndefined();
  });

  it("чужая валюта не выдаётся за баты", () => {
    const [e] = eventsFromJsonLd(
      ld({ startDate: future(), offers: { price: 20, priceCurrency: "usd" } }),
      "x.com",
    );
    expect(e.price).toBe("20 USD");
  });
});

describe("постер не обрезается", () => {
  const img = read("poster-img.tsx");

  it("афиша вписывается целиком, а не заполняет рамку", () => {
    expect(img).toContain('objectFit: "contain"');
  });

  it("поля закрывает размытая копия, а не чёрная пустота", () => {
    expect(img).toContain("blur(");
    expect(img).toContain('objectFit: "cover"'); // это подложка
    expect(img).toContain("aria-hidden");
  });

  it("ни один экран афиши не режет постер по-старому", () => {
    // Прямая улика прошлой поломки: cover прямо на постере события.
    for (const f of ["screens/Platform.tsx", "screens/Tonight.tsx", "screens/Base.tsx"]) {
      const src = read(f);
      const i = src.indexOf("posterUrl(");
      expect(i, `${f}: posterUrl не найден`).toBeGreaterThan(-1);
      expect(src.slice(i - 400, i + 400), `${f}: постер всё ещё обрезается`).not.toContain(
        'objectFit: "cover"',
      );
    }
  });
});

describe("лента событий", () => {
  const src = read("screens/Platform.tsx");
  const feed = src.slice(src.indexOf("export function FeedScreen"), src.indexOf("export function AiMatchScreen"));

  it("есть полоса дней, и она считает события", () => {
    // Свиток из всех дат подряд заставлял листать чужие дни.
    expect(feed).toContain("const days = useMemo");
    expect(feed).toContain("m.set(e.dateIso, (m.get(e.dateIso) ?? 0) + 1)");
  });

  it("пустые дни в полосу не попадают", () => {
    // Тридцать нулей прячут те четыре дня, где программа реально стоит.
    expect(feed).toContain("[...m.entries()].sort");
    expect(feed).not.toMatch(/for \(let i = 0; i < 30/);
  });

  it("открывается на сегодня или на ближайшем дне с программой", () => {
    expect(feed).toContain("bkkToday()");
    expect(feed).toContain("days.find(([d]) => d >= today)?.[0] ?? days[0][0]");
  });

  it("у карточки два названных выхода вместо одного немого", () => {
    // Раньше вся карточка вела на паспорт площадки — то есть уводила с
    // события, ради которого гость открыл ленту.
    expect(feed).toContain('t("Заведение")');
    expect(feed).toContain("href={e.url}");
    expect(feed).not.toMatch(/<Card[\s\S]{0,120}hover[\s\S]{0,120}onClick=\{\(\) =>\s*navigate/);
  });

  it("время и цена показываются на карточке", () => {
    expect(feed).toContain("{e.time ? (");
    expect(feed).toContain("{e.price ? (");
  });
});

describe("цена как строка", () => {
  it("«вход свободный» переведён, хотя приходит из парсера", () => {
    // Литерала в t() нет — строку рождает parsePrice/ldPrice, и сторож
    // переводов её не видит. Держим руками, иначе гость-иностранец
    // прочтёт единственный русский текст на английской карточке.
    const dict = read("i18n-dict.ts");
    expect(dict).toContain('"вход свободный": "free entry"');
    expect(dict).toContain('"вход свободный": "เข้าฟรี"');
  });
});

describe("модель события", () => {
  const afisha = read("afisha.ts");

  it("время и цена — часть события, а не догадка экрана", () => {
    expect(afisha).toContain("time?: string;");
    expect(afisha).toContain("price?: string;");
  });

  it("Facebook отдаёт время, и оно тоже больше не теряется", () => {
    expect(afisha).toContain('time: String(e.start_time ?? "").slice(11, 16) || undefined');
  });
});
