// Телеграм-маркетинг: афиши, кликабельные события, опросы.
//
// Канал, который только объявляет, читают вполглаза. Здесь зафиксировано
// то, что превращает объявление в приглашение — и то, обо что оно ломается
// молча: Telegram не умеет SVG в фото, режет варианты опроса длиннее сотни
// знаков и не принимает альбом из одного элемента.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_URL } from "../app-url";
import {
  bkkWeekday,
  buildDigest,
  buildDigestText,
  buildMovedText,
  buildThemePoll,
  buildTonightPoll,
  fitPoll,
  plural,
} from "../community";
import { posterPhoto } from "../poster";
import type { KvNs } from "../kv-ns";

function memKv(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>(
    Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  const ns: KvNs = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async (o) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  return ns;
}

/** Пхукетская дата: афиша и дайджест живут по ней, а не по гринвичской. */
const bkkIso = (shift = 0) =>
  new Date(Date.now() + 7 * 3600e3 + shift * 86400e3).toISOString().slice(0, 10);

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Ночь ${id}`,
  dateIso: bkkIso(),
  url: "https://club.example/e",
  artistIds: [],
  source: "site",
  ...over,
});

// Две реальные площадки с фото в /venues — postersPhoto опирается на них.
const tonightKv = () =>
  memKv({
    "venueevents:VEN-0001": { events: [ev("a", { poster: "/api/poster?k=VEN-0001%3Aa" })], syncedAt: 0, source: "site" },
    "venueevents:VEN-0002": { events: [ev("b")], syncedAt: 0, source: "site" },
    "venueevents:VEN-0003": { events: [ev("c")], syncedAt: 0, source: "site" },
  });

describe("картинка для Telegram", () => {
  it("кэшированный постер годится — за ним настоящий файл", () => {
    expect(posterPhoto(APP_URL, "VEN-0001", { id: "a", poster: "/api/poster?k=x" })).toContain(
      "/api/poster?k=",
    );
  });

  it("фото площадки годится: ручка отдаст его редиректом", () => {
    const url = posterPhoto(APP_URL, "VEN-0001", { id: "a" }, "/venues/VEN-0001-hero.jpg");
    expect(url.startsWith(`${APP_URL}/api/poster`)).toBe(true);
  });

  it("внешняя ссылка без кэша и без фото площадки не годится", () => {
    // Она может не скачаться в момент отправки — ручка нарисует SVG, а
    // Telegram не умеет SVG и роняет весь альбом.
    expect(posterPhoto(APP_URL, "VEN-0001", { id: "a", poster: "https://cdn.example/p.jpg" })).toBe("");
    expect(posterPhoto(APP_URL, "VEN-0001", { id: "a" })).toBe("");
  });
});

describe("дайджест", () => {
  it("каждое событие — ссылка в приложение на программу площадки", async () => {
    const text = await buildDigestText(tonightKv());
    expect(text).toContain(`href="${APP_URL}/gtr/tonight?vid=VEN-0001"`);
    expect(text).toContain("<b>");
  });

  it("сегодняшний вечер попадает в «Сегодня», а не в «ближайшие»", async () => {
    // Раньше «сегодня» считалось по UTC, и после полуночи по-местному
    // программа дня уезжала в раздел ближайших вечеров.
    const text = await buildDigestText(tonightKv());
    const head = text.slice(0, text.indexOf("📅") === -1 ? undefined : text.indexOf("📅"));
    expect(head).toContain("VEN-0001");
  });

  it("к вечеру собираются афиши — по одной с площадки", async () => {
    const { photos } = await buildDigest(tonightKv());
    expect(photos.length).toBeGreaterThanOrEqual(2);
    expect(new Set(photos).size).toBe(photos.length);
    expect(photos.length).toBeLessThanOrEqual(8);
    for (const p of photos) expect(p.startsWith(`${APP_URL}/api/poster`)).toBe(true);
  });

  it("пустая афиша не роняет дайджест и не даёт битого альбома", async () => {
    const { text, photos } = await buildDigest(memKv());
    expect(text).toContain("GTR");
    expect(photos).toEqual([]);
  });
});

describe("опросы", () => {
  it("варианты подрезаны под пределы Telegram", () => {
    const p = fitPoll({
      question: "q".repeat(400),
      options: [...Array(14)].map((_, i) => `${"o".repeat(140)}${i}`),
    });
    expect(p.question.length).toBeLessThanOrEqual(300);
    expect(p.options.length).toBeLessThanOrEqual(10);
    for (const o of p.options) expect(o.length).toBeLessThanOrEqual(100);
  });

  it("дубли вариантов схлопываются — Telegram их не принимает", () => {
    expect(fitPoll({ question: "q", options: ["Да", "Да", "Нет", " "] }).options).toEqual(["Да", "Нет"]);
  });

  it("все темы ротации валидны и не повторяются подряд", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 7; d++) {
      const p = buildThemePoll(d);
      expect(p.options.length).toBeGreaterThanOrEqual(2);
      expect(p.options.length).toBeLessThanOrEqual(10);
      expect(p.question.length).toBeLessThanOrEqual(300);
      for (const o of p.options) expect(o.length).toBeLessThanOrEqual(100);
      seen.add(p.question);
    }
    expect(seen.size).toBe(7);
  });

  it("опрос про сегодня собирается из живой афиши", async () => {
    const p = await buildTonightPoll(tonightKv());
    expect(p).not.toBeNull();
    // Площадки плюс честный вариант «остаюсь дома»: без него голосуют
    // только те, кто уже собрался, и картина спроса выходит нарисованной.
    expect(p!.options.length).toBeGreaterThanOrEqual(3);
    expect(p!.options.at(-1)).toContain("Сижу дома");
  });

  it("без программы опроса про сегодня нет — вопрос был бы пустым", async () => {
    expect(await buildTonightPoll(memKv())).toBeNull();
  });

  it("день недели считается по острову, а не по Гринвичу", () => {
    // 00:30 понедельника на Пхукете — это ещё воскресенье по UTC.
    expect(bkkWeekday(Date.UTC(2026, 7, 30, 17, 30))).toBe(1);
    expect(new Date(Date.UTC(2026, 7, 30, 17, 30)).getUTCDay()).toBe(0);
  });
});

describe("склонение при числе", () => {
  it("русские формы выбираются правилом, а не подбираются под текущее число", () => {
    const f = (n: number) => `${n} ${plural(n, "площадка", "площадки", "площадок")}`;
    expect(f(1)).toBe("1 площадка");
    expect(f(2)).toBe("2 площадки");
    expect(f(5)).toBe("5 площадок");
    // подвох: 11–14 всегда «много», сколько бы ни было в единицах
    expect(f(11)).toBe("11 площадок");
    expect(f(12)).toBe("12 площадок");
    expect(f(21)).toBe("21 площадка");
    expect(f(22)).toBe("22 площадки");
    expect(f(111)).toBe("111 площадок");
    expect(f(354)).toBe("354 площадки");
    expect(f(0)).toBe("0 площадок");
  });

  it("объявление о переезде склоняет обе цифры", () => {
    const t = buildMovedText(354, 312);
    expect(t).toContain("354 площадки");
    expect(t).toContain("312 артистов");
    expect(t).not.toContain("354 площадок");
  });
});

describe("фирменный слой", () => {
  it("каждый вопрос опроса начинается со знака из фирменного пака", () => {
    // brandEmojify в tgApi подменяет обычный знак на наш только по точному
    // совпадению — поэтому вопрос обязан начинаться именно с того эмодзи,
    // который есть в карте BRAND_EMOJI.
    const tg = readFileSync(join(__dirname, "..", "tg.ts"), "utf8");
    const brand = new Set([...tg.matchAll(/"(\p{Extended_Pictographic}[️]?)":\s*"\d+"/gu)].map((m) => m[1]));
    expect(brand.size).toBeGreaterThan(30);
    for (let d = 0; d < 7; d++) {
      const q = buildThemePoll(d).question;
      const first = [...q][0];
      expect(brand.has(first), `вопрос «${q.slice(0, 40)}…» начинается с «${first}», которого нет в паке`).toBe(true);
    }
  });

  it("опрос уходит с question_parse_mode — иначе знак останется обычным", () => {
    for (const f of ["../../routes/api.community-digest.ts", "../kv-api.ts"])
      expect(readFileSync(join(__dirname, f), "utf8"), f).toContain('question_parse_mode: "HTML"');
  });

  it("помощник телеграма знает, где у опроса текст и где режим разметки", () => {
    const tg = readFileSync(join(__dirname, "..", "tg.ts"), "utf8");
    expect(tg).toContain('sendPoll: "question"');
    expect(tg).toContain('sendPoll: "question_parse_mode"');
  });
});
