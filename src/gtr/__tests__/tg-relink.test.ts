// Сторож кнопок бота.
//
// 27.08.2026 кнопка «Обновить ссылки в Telegram» подменила меню бота
// Web-App-кнопкой на приложение — и кнопки в боте перестали работать
// совсем. Причина в нашем же периметре: он отдаёт
// `content-security-policy: frame-ancestors 'self'`, а Telegram на десктопе
// и в вебе открывает Web App во фрейме. Браузер такой фрейм не рисует.
// Заодно эта кнопка вытеснила список команд — исчезло и «/».
//
// Пока периметр запрещает чужие фреймы, Web App в боте существовать не
// может. Тест держит оба конца этого правила: и запрет, и сам периметр.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("кнопки телеграм-бота", () => {
  const api = read("src/gtr/kv-api.ts");
  const perimeter = read("src/server/perimeter.ts");

  it("периметр по-прежнему запрещает встраивание в чужой фрейм", () => {
    // Если это когда-нибудь снимут осознанно — тест ниже надо пересмотреть,
    // а не удалить: Web App станет возможен, но по-прежнему не должен
    // занимать место списка команд.
    expect(perimeter).toContain("frame-ancestors 'self'");
  });

  it("меню бота — список команд, а не Web App", () => {
    expect(api).toContain('menu_button: { type: "commands" }');
    expect(api).not.toContain('type: "web_app"');
  });

  it("в списке команд есть всё, что бот реально понимает", () => {
    // Команды, до которых человек добирается только через «/»: если их нет
    // в списке, половина бота становится невидимой.
    for (const cmd of ["tonight", "afisha", "menu", "ref", "top", "cabinet", "offers", "gigs", "status", "help"])
      expect(api, `нет команды /${cmd}`).toContain(`command: "${cmd}"`);
  });
});
