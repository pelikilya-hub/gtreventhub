// Публичные двери: то, что видит человек по ссылке из рекламы или из
// нашей же рассылки, ещё не будучи нашим пользователем.
//
// Обход анонимно показал две стены — обе в контуре подключения площадок,
// то есть ровно там, куда пойдут рекламные деньги.
//
// Магик-ссылка площадки с протухшим токеном сообщала «запросите новую у
// контакта GTR» — и всё. Контакта на странице не было: ссылку мы шлём
// в рассылке, человек с той стороны не знает нас по имени, и написать
// ему некуда. Приглашение по коду при недоступной базе показывало
// внутреннюю строку «Хранилище недоступно» — инженерную фразу человеку,
// который пришёл заводить аккаунт.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("магик-ссылка площадки", () => {
  const src = read("routes/gtr/v.tsx");

  it("протухший токен даёт контакт, а не только сожаление", () => {
    expect(src).toContain("OWNER_TG");
    expect(src).toContain("t.badWrite");
    expect(src).toContain("t.badApp");
  });

  it("выход подписан на всех трёх языках формы", () => {
    // Форму открывают тайские и англоязычные управляющие — язык здесь
    // не украшение, а условие того, что письмо вообще прочтут.
    for (const key of ["badWrite", "badApp"])
      expect(src.match(new RegExp(`${key}:`, "g"))?.length, `${key} не на трёх языках`).toBe(3);
  });
});

describe("приглашение по ссылке", () => {
  const src = read("routes/gtr/join.tsx");

  it("внутренняя причина не показывается человеку как есть", () => {
    // «Хранилище недоступно» — это для нас, а не для того, кто пришёл
    // заводить аккаунт по нашему же приглашению.
    expect(src).toContain("/^Хранилище/.test(info.error");
    expect(src).not.toMatch(/>\{info\.error\}</);
  });

  it("есть кому написать, когда ссылка не сработала", () => {
    expect(src).toContain("OWNER_TG");
    expect(src).toContain('t("Написать команде GTR")');
  });
});

describe("периметр входа", () => {
  const src = read("routes/gtr/$screen.tsx");

  it("закрытый экран без сессии уводит на вход", () => {
    expect(src).toContain("if (!user) throw redirect({ to: \"/gtr/login\" })");
  });

  it("несуществующий экран не роняет приложение, а ведёт на дашборд", () => {
    expect(src).toContain("SCREENS.includes(params.screen as ScreenId)");
    expect(src).toContain('screen: "dash"');
  });
});
