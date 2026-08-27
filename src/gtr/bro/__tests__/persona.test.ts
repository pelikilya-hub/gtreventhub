// Настройки разговора обязаны действовать в обеих полосах.
//
// Утром обнаружилось, что язык был захардкожен в трёх местах. Вечером —
// что тем же способом захардкожена персона: голос слушался «без мата», а
// печатный ответ приходил прежним тоном, потому что текстовая ручка
// ставила personaMode: "bro" намертво и от клиента его не читала.
//
// Настройка, которую слышит одна половина продукта и не слышит вторая,
// хуже отсутствующей: человек считает, что его просьбу проигнорировали.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildTextPrompt, pickMode, type BroContext } from "../prompt.ru";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = read("../../../routes/api.gtr-bro-text.ts");
const gem = read("../../../routes/api.gtr-bro-gem.ts");
const overlay = read("../BroOverlay.tsx");

const ctx = (mode: BroContext["personaMode"]): BroContext => ({
  userId: "u@example.com",
  language: "ru",
  personaMode: mode,
  timezone: "Asia/Bangkok",
  currentTime: "2026-08-27T12:00:00.000Z",
});

describe("персона", () => {
  it("разбирается одинаково и по умолчанию это бро", () => {
    expect(pickMode("concierge")).toBe("concierge");
    expect(pickMode("unhinged")).toBe("unhinged");
    expect(pickMode("bro")).toBe("bro");
    // Мусор и пустота не должны молча включать развязный тон.
    expect(pickMode(undefined)).toBe("bro");
    expect(pickMode("КОНСЬЕРЖ")).toBe("bro");
    expect(pickMode({ mode: "unhinged" })).toBe("bro");
  });

  it("режим правда меняет промпт, а не только флаг", () => {
    const a = buildTextPrompt(ctx("bro"));
    const b = buildTextPrompt(ctx("concierge"));
    expect(a).not.toBe(b);
    expect(b).toContain("concierge");
  });

  it("ни одна полоса не зашивает персону намертво", () => {
    for (const [name, src] of [
      ["текст", text],
      ["голос", gem],
    ] as const) {
      expect(`${name}: ${/personaMode:\s*"(bro|concierge|unhinged)"/.test(src)}`).toBe(
        `${name}: false`,
      );
      expect(src).toContain("pickMode(body.personaMode)");
    }
  });

  it("разбор персоны один на обе полосы", () => {
    // Своя копия в каждой ручке — это два разных значения по умолчанию
    // через полгода.
    for (const src of [text, gem]) expect(src).not.toContain("const pickMode");
    expect(text).toContain('from "../gtr/bro/prompt.ru"');
  });

  it("оверлей шлёт в текст и язык, и персону", () => {
    // Именно тело запроса к текстовой ручке, а не первый попавшийся
    // JSON.stringify в файле.
    const call = /gtr-bro-text[\s\S]{0,600}/.exec(overlay)?.[0] ?? "";
    expect(call).toContain("lang: langRef.current");
    expect(call).toContain("personaMode: modeRef.current");
  });
});
