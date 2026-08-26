import { describe, expect, it } from "vitest";

import { handlers, qaItems, qaMatch, qaNorm, QA_MIN_SCORE } from "../tools";

/** Слой знаний, который видит гость: база плюс всё выученное. */
const guestItems = async () => {
  const all = (await import("../../data/bro-lessons.json")) as unknown as {
    default: { lessons: { id: string }[] };
  };
  const ids = all.default.lessons.map((l) => l.id);
  return qaItems(false, async () => JSON.stringify({ ids }));
};

describe("подбор темы из базы знаний", () => {
  it("матчер и инструмент отвечают одинаково — иначе «база знает» перестаёт значить «модель увидела»", async () => {
    const items = await guestItems();
    const ctx = {
      user: { email: "v@v", name: "Гость", role: "visitor" },
      kv: {
        get: async (k: string) =>
          k === "broqa:learned"
            ? JSON.stringify({
                ids: (
                  (await import("../../data/bro-lessons.json")) as unknown as {
                    default: { lessons: { id: string }[] };
                  }
                ).default.lessons.map((l) => l.id),
              })
            : null,
        put: async () => {},
      },
    } as never;
    for (const q of [
      "сколько давать чаевых",
      "можно ли курить в клубе",
      "во сколько начинается движ",
      "нужна ли виза",
      "полная чепуха про вертолёты и подводные лодки",
    ]) {
      const viaTool = await handlers.ask_gtr({ question: q }, ctx);
      const viaMatch = qaMatch(q, items);
      expect(Boolean(viaMatch), `расхождение на «${q}»`).toBe(viaTool.ok);
    }
  });

  it("нормализация склеивает написания через дефис и знаки", () => {
    expect(qaNorm("дресс-код?")).toBe(qaNorm("Дресс код"));
    expect(qaNorm("  Сколько   ЧАЕВЫХ!! ")).toBe(qaNorm("сколько чаевых"));
  });

  it("пустой и бессмысленный вопрос темы не находят", async () => {
    const items = await guestItems();
    expect(qaMatch("", items)).toBeNull();
    expect(qaMatch("   ?!  ", items)).toBeNull();
    expect(qaMatch("ъъъ щщщ фыва", items)).toBeNull();
  });

  it("слабое совпадение не проходит порог: лучше «не знаю», чем ответ не про то", async () => {
    const items = await guestItems();
    const hit = qaMatch("что", items);
    expect(hit).toBeNull();
    expect(QA_MIN_SCORE).toBeGreaterThan(0);
  });

  it("рабочий слой гостю недоступен ни при какой формулировке", async () => {
    const guest = await qaItems(false, undefined);
    const team = await qaItems(true, undefined);
    expect(team.length).toBeGreaterThan(guest.length);
    // Тема про Андаман Сити — командная; гость не должен её видеть.
    expect(guest.some((i) => i.id === "pro-andaman-city")).toBe(false);
    expect(team.some((i) => i.id === "pro-andaman-city")).toBe(true);
  });

  it("невыученные темы бэклога в перебор не попадают", async () => {
    const withoutKv = await qaItems(false, undefined);
    const withAll = await guestItems();
    expect(withAll.length).toBeGreaterThan(withoutKv.length);
  });
});
