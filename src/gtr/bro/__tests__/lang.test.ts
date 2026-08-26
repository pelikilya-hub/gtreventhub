import { describe, expect, it } from "vitest";
import { isBroLang, langDirective, speechLocale } from "../lang";

describe("isBroLang", () => {
  it("пропускает только известные языки", () => {
    expect(isBroLang("ru")).toBe(true);
    expect(isBroLang("en")).toBe(true);
    for (const v of ["th", "EN", "", null, undefined, 1, {}]) expect(isBroLang(v)).toBe(false);
  });
});

describe("speechLocale", () => {
  it("даёт полную локаль — коротким кодом слух не настроить", () => {
    expect(speechLocale("en")).toBe("en-US");
    expect(speechLocale("ru")).toBe("ru-RU");
  });
});

describe("langDirective", () => {
  it("английская директива требует английский и бережёт названия", () => {
    const d = langDirective("en");
    expect(d).toContain("ONLY in English");
    expect(d).toContain("never translate");
  });

  it("русская директива требует русский и бережёт названия", () => {
    const d = langDirective("ru");
    expect(d).toContain("ТОЛЬКО по-русски");
    expect(d).toContain("не переводи");
  });

  it("уходит отдельным разделом — иначе тонет в теле промпта", () => {
    for (const l of ["ru", "en"] as const) expect(langDirective(l).startsWith("\n\n---\n\n#")).toBe(true);
  });
});
