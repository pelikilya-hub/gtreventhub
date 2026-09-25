// Экран не утаскивает страницу вбок.
//
// Замер на телефоне 390px нашёл то, что не даёт ни одной ошибки в
// консоли и потому жило месяцами: паспорт площадки уезжал вправо на
// 109px, финансы и GTR-админ на 140, залы на 82, заявки на 21. Гость
// видит, что страницу можно оттащить пальцем вбок, а вёрстка «съехала».
//
// Причин было несколько и все разные: декоративный луч с inset:-60%,
// длинный адрес сайта в чипе, смещения на анимации. Ловить их поштучно
// бессмысленно — завтра добавят новый чип с длинной ссылкой. Поэтому
// подрезка стоит в одном месте, на обёртке экрана, и этот файл сторожит
// именно её: и что она есть, и что она правильного вида.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "gtr.css"), "utf8");

/** Тело правила по селектору: от «селектор {» до ближайшей «}». */
const rule = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
};

describe("обёртка экрана подрезает вынос", () => {
  const screenin = rule(".gtr-screenin");

  it("правило существует", () => {
    expect(screenin).not.toBe("");
  });

  it("подрезка стоит", () => {
    expect(screenin).toContain("overflow-x: clip");
  });

  it("именно clip, а не hidden", () => {
    // hidden делает элемент контейнером прокрутки и ломает
    // position:sticky внутри — на нём держатся шапки таблиц и панель
    // дня в календаре. clip только отрезает, ничего не скроллит.
    expect(screenin).not.toContain("overflow-x: hidden");
    expect(screenin).not.toMatch(/overflow:\s*hidden/);
  });
});

describe("полноширинные блоки не пострадали", () => {
  it("карта и трекер по-прежнему выходят на всю ширину", () => {
    // Приём тот же: 100vw плюс отрицательные поля. Если подрезка
    // когда-нибудь переедет выше по дереву, сломается именно это —
    // карта перестанет доходить до краёв экрана.
    //
    // Правил у каждого класса два: обычное и мобильное. Во всю ширину
    // блок выходит только на телефоне, поэтому ищем по всем вхождениям,
    // а не по первому — первое как раз и есть десктопное.
    for (const cls of ["gtr-map-canvas", "gtr-track-canvas"]) {
      const bodies: string[] = [];
      for (let i = css.indexOf(`.${cls} {`); i > -1; i = css.indexOf(`.${cls} {`, i + 1))
        bodies.push(css.slice(i, css.indexOf("}", i)));
      expect(bodies.length, `нет правил .${cls}`).toBeGreaterThan(0);
      const fullBleed = bodies.find((b) => b.includes("width: 100vw"));
      expect(fullBleed, `${cls}: нет полноширинного правила`).toBeTruthy();
      expect(fullBleed, cls).toContain("margin-inline: calc(50% - 50vw)");
    }
  });
});

describe("длинная ссылка в чипе", () => {
  const chip = rule(".gtr-chip");

  it("чип не шире своего места", () => {
    // «ILLUZIONPHUKET.COM/VIP-TABLE-BOOKING/» в одну строку — 289px при
    // экране 390. Без потолка он утаскивал страницу целиком.
    expect(chip).toContain("max-width: 100%");
  });

  it("обрыв показан многоточием, а не тишиной", () => {
    // После подрезки текст просто обрывался без следа, и человек не
    // понимал, что адрес длиннее показанного.
    expect(chip).toContain("text-overflow: ellipsis");
    expect(chip).toContain("overflow: hidden");
  });

  it("чип по-прежнему не переносится", () => {
    // «ГОТОВО», разорванное пополам, читается как поломка.
    expect(chip).toContain("white-space: nowrap");
  });
});

describe("подписи не притворяются состоянием", () => {
  it("занятость месяца не называется загрузкой", () => {
    // «ЗАГРУЗКА МЕСЯЦА» читается как «идёт загрузка»: на этом споткнулся
    // обходчик экранов и решил, что календарь завис. Речь о занятости —
    // сколько событий в каждый день.
    const cal = readFileSync(join(__dirname, "..", "screens", "Calendar.tsx"), "utf8");
    expect(cal).toContain("ЗАНЯТОСТЬ ПО ДНЯМ");
    expect(cal).not.toContain("ЗАГРУЗКА МЕСЯЦА");
    const dict = readFileSync(join(__dirname, "..", "i18n-dict.ts"), "utf8");
    expect(dict).not.toContain("MONTH LOAD");
  });
});
