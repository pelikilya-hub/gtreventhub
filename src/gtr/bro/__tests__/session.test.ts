// Клиентская петля. Проверяем защёлку подтверждений: набор write-действий
// пуст, и если кто-то его наполнит, он обязан положить туда человеческое
// описание — иначе пользователю нечего будет подтверждать.
import { describe, expect, it } from "vitest";

import { NEEDS_CONFIRM } from "../session";

describe("граница подтверждений", () => {
  it("в MVP нет write-инструментов", () => {
    expect(Object.keys(NEEDS_CONFIRM)).toHaveLength(0);
  });

  it("каждая запись несёт текст для человека", () => {
    for (const [tool, summary] of Object.entries(NEEDS_CONFIRM)) {
      expect(summary.length).toBeGreaterThan(10);
      expect(tool).toMatch(/^[a-z_]+$/);
    }
  });
});
