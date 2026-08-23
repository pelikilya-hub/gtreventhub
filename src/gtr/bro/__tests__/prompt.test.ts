// Промпт — это код: он определяет, что скажет продукт живому человеку.
// Проверяем то, что нельзя проверить глазами при каждой правке: границы
// безопасности на месте, режимы отличаются друг от друга, а контекст
// подаётся структурой и не тянет за собой чужой текст.
import { describe, expect, it } from "vitest";

import {
  buildContextBlock,
  buildPrompt,
  buildTextPrompt,
  PROMPT_VERSION,
  VOICE_LAB_LINES,
} from "../prompt.ru";

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

describe("краткость и отсутствие саморекламы", () => {
  const ctx = {
    userId: "u",
    displayName: "Илья",
    language: "ru" as const,
    personaMode: "bro" as const,
    timezone: "Asia/Bangkok",
    currentTime: "2026-08-23T12:00:00Z",
    role: "visitor",
  };

  it("промпт прямо запрещает рассказывать о своих возможностях", () => {
    for (const text of [buildPrompt(ctx), buildTextPrompt(ctx)]) {
      const t = text.toLowerCase();
      expect(t).toContain("не рассказывай, что ты умеешь");
      // Хвост «также умею…» в конце ответов — та же реклама, только сбоку.
      expect(t).toContain("также умею");
    }
  });

  it("правило длины названо главным, а не пожеланием", () => {
    for (const text of [buildPrompt(ctx), buildTextPrompt(ctx)]) {
      const t = text.toLowerCase();
      expect(t).toContain("одна-две фразы");
      expect(t).toMatch(/сильнее характера/);
    }
  });

  it("в первой реплике нет перечисления умений", () => {
    const t = buildPrompt(ctx);
    // Прежняя формулировка звала выдать «визитку» со списком умений —
    // именно она и порождала воду в первом сообщении.
    expect(t).not.toContain("скажи, что умеешь");
    expect(t).not.toContain("Держи визитку короткой");
  });

  it("режимы отличаются манерой разговора, а не только матом", () => {
    const modes = ["concierge", "bro", "unhinged"] as const;
    const manners = modes.map((m) => {
      const p = buildPrompt({ ...ctx, personaMode: m });
      const i = p.indexOf("- Манера:");
      expect(i, `нет манеры у режима ${m}`).toBeGreaterThan(0);
      return p.slice(i, i + 120);
    });
    expect(new Set(manners).size).toBe(3);
  });

  it("у ролей разные цели, а не только разные инструменты", () => {
    const t = buildPrompt(ctx);
    for (const goal of ["чтобы вечер удался", "площадки и работа", "загрузка своего места"])
      expect(t).toContain(goal);
    // Без роли — гость: ошибиться в эту сторону безопасно.
    expect(t).toContain("считай гостем");
  });

  it("роль гостя не открывает рабочий контур", () => {
    const guest = buildTextPrompt(ctx);
    expect(guest).toContain("таких инструментов у него нет");
  });
});
