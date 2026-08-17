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
