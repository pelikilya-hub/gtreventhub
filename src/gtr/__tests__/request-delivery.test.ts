// Заявка не должна теряться молча.
//
// 27.08.2026 заявка не дошла ни менеджеру в Telegram, ни в приложение, и
// продукт этого не заметил. Разбор показал три места, где дорога заявки
// молчала: отправитель глушил ответ сервера через `.catch(() => {})`,
// «не ок» от сервера ничем не отличался от успеха, а сообщение, которое
// Telegram не принял, никого не будило.
//
// Тест держит эти три конца. Он читает исходники, а не гоняет сеть:
// проверять надо именно то, что дорога заявки нигде не заглушена.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const kvApi = read("kv-api.ts");
const store = read("store.tsx");

/** Тело функции от её начала до следующего экспорта верхнего уровня. */
const bodyOf = (src: string, start: string) => {
  const from = src.indexOf(start);
  expect(from, `не нашёл ${start}`).toBeGreaterThan(-1);
  const rest = src.slice(from + start.length);
  const end = rest.indexOf("\nexport ");
  return rest.slice(0, end === -1 ? undefined : end);
};

describe("доставка заявки", () => {
  const push = bodyOf(kvApi, "export const pushRequestFn");

  it("отказ сервера называет причину, а не просто «не ок»", () => {
    // Без причины у отправителя нет шанса отличить «нет хранилища» от
    // «нет доступа», и в поддержку приходит «просто не работает».
    expect(push).toContain('reason: "нет хранилища"');
    expect(push).toContain('reason: "нет доступа"');
  });

  it("считаются доставки, а не попытки отправки", () => {
    // tgApi отвечает ok:false, когда человек не нажимал /start у этого
    // бота или токен не тот. Раньше ответ не читали вовсе.
    expect(push).toMatch(/if \(r\.ok\) delivered\+\+/);
  });

  it("заявка, не дошедшая никому, поднимает тревогу и оставляет след", () => {
    expect(push).toContain("if (!delivered)");
    expect(push).toContain("reqmiss:");
    expect(push).toContain("notifyBossTg");
  });

  it("отправитель не глушит ответ и повторяет попытки", () => {
    const deliver = bodyOf(store, "const deliverRequest");
    expect(deliver).toContain("attempt < 3");
    expect(deliver).toContain("if (r?.ok) return true");
    // Старая беда ровно в этой строке: ответ уходил в пустоту.
    expect(store).not.toContain("pushRequestFn({ data: req }).catch(() => {})");
  });

  it("несостоявшаяся отправка видна на экране", () => {
    const misc = read("screens/Misc.tsx");
    expect(misc).toContain('r.sync === "failed"');
    expect(misc).toContain("НЕ ОТПРАВЛЕНА");
  });

  it("метка доставки не уезжает в хранилище", () => {
    // Она про устройство автора: у менеджера чужое «везём» на карточке
    // означало бы, что заявки нет, хотя она уже в базе.
    expect(push).toContain("const { sync: _drop, ...clean } = data");
    expect(push).toContain("JSON.stringify(clean)");
  });
});
