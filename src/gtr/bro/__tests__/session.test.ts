// Клиентская петля. Проверяем защёлку подтверждений: набор write-действий
// пуст, и если кто-то его наполнит, он обязан положить туда человеческое
// описание — иначе пользователю нечего будет подтверждать.
import { describe, expect, it } from "vitest";

import { NEEDS_CONFIRM } from "../session";

describe("граница подтверждений", () => {
  it("все пишущие инструменты под замком", () => {
    expect(Object.keys(NEEDS_CONFIRM).sort()).toEqual([
      "book_table",
      "create_event_draft",
      "send_telegram",
    ]);
  });

  it("каждая запись несёт текст для человека", () => {
    for (const [tool, summary] of Object.entries(NEEDS_CONFIRM)) {
      expect(summary.length).toBeGreaterThan(10);
      expect(tool).toMatch(/^[a-z_]+$/);
    }
  });
});

// Голос читает результат инструмента как текст: чем он толще, тем длиннее
// пауза перед первым словом ответа. Обрезка — часть контракта.
import { toolOutputForVoice } from "../session";

describe("компактный вывод инструментов для голоса", () => {
  it("search_events: постеры и служебные поля не уходят в голос", () => {
    const result = {
      ok: true,
      data: {
        events: [
          {
            event_id: "v1:e1",
            title: "Techno Night",
            venue: "Club X",
            venue_id: "v1",
            start_at: "2026-08-20",
            genre: ["техно"],
            distance_km: 1.2,
            price_from: null,
            currency: "THB",
            availability_status: "unknown",
            verification_status: "likely",
            poster: "https://cdn.example/very-long-poster-url.jpg",
            source: "kv",
          },
        ],
        total: 1,
        source: "kv",
      },
    };
    const out = toolOutputForVoice("search_events", result);
    expect(out).toContain("Techno Night");
    expect(out).toContain("v1:e1");
    expect(out).not.toContain("poster");
    expect(out).not.toContain("availability_status");
    expect(out).not.toContain("venue_id");
  });

  it("nearest и note пустого дня доезжают до модели", () => {
    const result = {
      ok: true,
      data: {
        events: [],
        total: 0,
        nearest: [{ title: "Beach Day", venue: "Cafe", start_at: "2026-08-22" }],
        note: "На запрошенные даты пусто.",
      },
    };
    const out = toolOutputForVoice("search_events", result);
    expect(out).toContain("Beach Day");
    expect(out).toContain("пусто");
  });

  it("любой другой результат режется до 2500 знаков", () => {
    const result = { ok: true, data: { blob: "х".repeat(9000) } };
    expect(toolOutputForVoice("get_venue_profile", result).length).toBe(2500);
  });

  it("ошибки инструментов проходят как есть", () => {
    const result = { ok: false, error: "timeout", retryable: true };
    expect(JSON.parse(toolOutputForVoice("search_events", result))).toEqual(result);
  });
});
