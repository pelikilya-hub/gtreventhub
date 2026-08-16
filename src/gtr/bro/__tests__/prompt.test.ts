// Промпт — это код: он определяет, что скажет продукт живому человеку.
// Проверяем то, что нельзя проверить глазами при каждой правке: границы
// безопасности на месте, режимы отличаются друг от друга, а контекст
// подаётся структурой и не тянет за собой чужой текст.
import { describe, expect, it } from "vitest";

import { buildContextBlock, buildPrompt, PROMPT_VERSION, VOICE_LAB_LINES } from "../prompt.ru";

const base = {
  userId: "u@example.com",
  language: "ru" as const,
  personaMode: "bro" as const,
  timezone: "Asia/Bangkok",
  currentTime: "2026-08-16T20:00:00.000Z",
};

describe("системный промпт", () => {
  it("версионирован", () => {
    expect(PROMPT_VERSION).toMatch(/^gtr-bro\.ru@\d+\.\d+\.\d+$/);
  });

  it("во всех режимах несёт границы безопасности и подтверждений", () => {
    for (const personaMode of ["concierge", "bro", "unhinged"] as const) {
      const p = buildPrompt({ ...base, personaMode });
      expect(p).toContain("нелегальные вещества");
      expect(p).toContain("confirmation UI");
      expect(p).toContain("Голосовое «да» не заменяет confirmation UI");
      expect(p).toContain("экстренную помощь");
    }
  });

  it("consierge не получает разрешения на мат, unhinged получает", () => {
    expect(buildPrompt({ ...base, personaMode: "concierge" })).toContain("Мата нет вообще");
    const u = buildPrompt({ ...base, personaMode: "unhinged" });
    expect(u).toContain("Режим включил сам пользователь");
    expect(u).toContain("без послаблений");
  });

  it("фраза unhinged не разрешается в режиме bro", () => {
    expect(buildPrompt({ ...base, personaMode: "bro" })).toContain(
      "«Чё-кого, сучары?» запрещено",
    );
  });

  it("контекст отдаётся строками, а пустые поля не попадают вовсе", () => {
    const block = buildContextBlock({ ...base, displayName: "BOSS", partySize: 4 });
    expect(block).toContain("- Имя: BOSS");
    expect(block).toContain("- Человек в компании: 4");
    expect(block).not.toContain("Бюджет");
    expect(block).not.toContain("undefined");
  });

  it("Voice Lab: один набор реплик для всех голосов", () => {
    expect(VOICE_LAB_LINES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(VOICE_LAB_LINES.map((l) => l.id)).size).toBe(VOICE_LAB_LINES.length);
  });
});
