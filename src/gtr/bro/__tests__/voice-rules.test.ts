import { describe, expect, it, vi } from "vitest";
import { evPhrase, listPhrase, rulesReply, type ToolCall } from "../voice-rules";

const noTools: ToolCall = async () => ({ ok: false, error: "unreachable" });

describe("evPhrase", () => {
  it("из даты берёт только время — дату ухом не ловят", () => {
    expect(evPhrase({ venue: "Illuzion", title: "Techno Night", start_at: "2026-08-26T23:00" })).toBe(
      "Illuzion — Techno Night, в 23:00",
    );
  });

  it("без времени — просто площадка и событие", () => {
    expect(evPhrase({ venue: "Illuzion", title: "Techno Night" })).toBe("Illuzion — Techno Night");
  });

  it("пустые поля не рождают тире в пустоту", () => {
    expect(evPhrase({ venue: "Illuzion" })).toBe("Illuzion");
  });
});

describe("listPhrase", () => {
  it("перечисление на слух, а не через запятую до конца", () => {
    expect(listPhrase(["A", "B", "C"], "и")).toBe("A, B и C");
  });

  it("одно название — без союза", () => {
    expect(listPhrase(["A"], "и")).toBe("A");
  });

  it("больше трёх ухо не удержит — режем", () => {
    expect(listPhrase(["A", "B", "C", "D"], "and")).toBe("A, B and C");
  });
});

describe("rulesReply", () => {
  it("безопасность отвечает без единого инструмента", async () => {
    const tools = vi.fn(noTools);
    const r = await rulesReply("я за рулём выпил, доеду?", tools);
    expect(r?.say).toBeTruthy();
    expect(tools).not.toHaveBeenCalled();
  });

  it("афиша: события уходят фразой и карточками", async () => {
    const tools: ToolCall = async (name) => {
      expect(name).toBe("search_events");
      return {
        ok: true,
        data: {
          events: [
            { venue: "Illuzion", title: "Techno", start_at: "2026-08-26T23:00" },
            { venue: "Catch", title: "Beach", start_at: "2026-08-26T18:00" },
          ],
        },
      };
    };
    const r = await rulesReply("что сегодня", tools, "ru");
    expect(r?.say).toBe("Нашёл 2: Illuzion — Techno, в 23:00 и Catch — Beach, в 18:00.");
    expect(r?.cards).toHaveLength(2);
    expect(r?.cards[0].kind).toBe("event");
  });

  it("пустой день не тупик — отдаём ближайшее живое", async () => {
    const tools: ToolCall = async () => ({
      ok: true,
      data: { events: [], nearest: [{ venue: "Illuzion", title: "Techno", start_at: "2026-08-28T23:00" }] },
    });
    const r = await rulesReply("что сегодня", tools, "ru");
    expect(r?.say).toContain("Ближайшее по базе");
    expect(r?.say).toContain("Illuzion");
    expect(r?.cards).toHaveLength(1);
  });

  it("совсем пусто — честная фраза без выдуманного вечера", async () => {
    const tools: ToolCall = async () => ({ ok: true, data: { events: [], nearest: [] } });
    const r = await rulesReply("что сегодня", tools, "ru");
    expect(r?.say).toBe("На эту дату по базе пусто. Спроси другой день или район.");
    expect(r?.cards).toEqual([]);
  });

  it("площадки: названия фразой", async () => {
    const tools: ToolCall = async (name) => {
      expect(name).toBe("search_venues");
      return { ok: true, data: { venues: [{ name: "Illuzion" }, { name: "Catch Beach Club" }] } };
    };
    const r = await rulesReply("какие клубы в патонге", tools, "en");
    expect(r?.say).toBe("From the base: Illuzion and Catch Beach Club.");
    expect(r?.cards[0].kind).toBe("venue");
  });

  it("база знаний отдаёт свой ответ дословно, без обвязки", async () => {
    const tools: ToolCall = async () => ({ ok: true, data: { answer: "Техно — это 4/4 и 130 bpm." } });
    const r = await rulesReply("что такое техно", tools, "en");
    expect(r?.say).toBe("Техно — это 4/4 и 130 bpm.");
  });

  it("инструмент упал — правила молчат, а не врут", async () => {
    const r = await rulesReply("что сегодня", noTools, "ru");
    expect(r).toBeNull();
  });

  it("пустой ввод не идёт ни в правила, ни в инструменты", async () => {
    const tools = vi.fn(noTools);
    expect(await rulesReply("   ", tools)).toBeNull();
    expect(tools).not.toHaveBeenCalled();
  });

  it("непонятое — короткая подсказка на языке разговора", async () => {
    const en = await rulesReply("asdfgh qwerty", noTools, "en");
    expect(en?.say).toBe("I don't know that one. Ask about a night, a venue or an area.");
    const ru = await rulesReply("asdfgh qwerty", noTools, "ru");
    expect(ru?.say).toBe("Такого не знаю. Спроси про вечер, площадку или район.");
  });
});
