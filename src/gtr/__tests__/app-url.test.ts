// Сторож адреса приложения.
//
// До собственного домена адрес воркера был вписан в семь мест: письма
// площадкам, кнопки бота, редирект Spotify, периметр, отчёты. Переезд
// означал охоту по grep, и один пропущенный файл продолжал бы рассылать
// гостям технический адрес.
//
// Теперь адрес один. Тест держит это правило: новый хардкод в исходниках
// уронит сборку, а не уедет в прод внутри чьего-то письма.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_ORIGINS, APP_URL, WORKER_URL } from "../app-url";

const ROOT = join(__dirname, "..", "..", "..");

const sources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith("app-url.ts")) out.push(p);
    }
  };
  walk(join(ROOT, "src"));
  return out;
};

describe("адрес приложения", () => {
  it("это собственный домен, а не технический адрес воркера", () => {
    expect(APP_URL).toBe("https://gtrevent.com");
    expect(APP_URL).not.toContain("workers.dev");
  });

  it("список разрешённых источников включает домен, www и воркер", () => {
    expect(APP_ORIGINS).toContain(APP_URL);
    expect(APP_ORIGINS).toContain("https://www.gtrevent.com");
    expect(APP_ORIGINS).toContain(WORKER_URL);
  });

  it("адрес воркера нигде не вписан руками", () => {
    const guilty = sources().filter((f) => readFileSync(f, "utf8").includes("gtr-event.workers.dev"));
    expect(guilty.map((f) => f.slice(ROOT.length + 1)), "импортируй WORKER_URL из app-url").toEqual([]);
  });

  it("домен нигде не вписан руками — всё берёт APP_URL", () => {
    // Ищем строковый литерал с доменом; упоминания в комментариях не в счёт.
    const guilty = sources().filter((f) => /["'`]https:\/\/(www\.)?gtrevent\.com/.test(readFileSync(f, "utf8")));
    expect(guilty.map((f) => f.slice(ROOT.length + 1)), "импортируй APP_URL из app-url").toEqual([]);
  });

  it("домен привязан к воркеру как Custom Domain", () => {
    const cfg = readFileSync(join(ROOT, "wrangler.jsonc"), "utf8");
    expect(cfg).toContain('"pattern": "gtrevent.com"');
    expect(cfg).toContain('"custom_domain": true');
  });
});
