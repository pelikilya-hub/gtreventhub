// Разбор текстовых команд. Правила должны понимать живую русскую речь,
// но не притворяться умнее, чем есть: непонятное честно уходит в help.
import { describe, expect, it } from "vitest";

import { looksInvented } from "../guard";
import { bkkDate, fmtEvents, greetLines, planOf } from "../text";

describe("разбор команд", () => {
  it("район и «сегодня» из живой фразы", () => {
    const p = planOf("что сегодня в патонге");
    expect(p.kind).toBe("search");
    if (p.kind === "search") {
      expect(p.district).toBe("Патонг");
      expect(p.dateFrom).toBe(bkkDate(0));
    }
  });

  it("завтра сдвигает окно на день", () => {
    const p = planOf("события завтра");
    if (p.kind === "search") expect(p.dateFrom).toBe(bkkDate(1));
    expect(p.kind).toBe("search");
  });

  it("выходные — окно до воскресенья включительно", () => {
    const p = planOf("куда сходить на выходных");
    expect(p.kind).toBe("search");
    if (p.kind === "search") expect(p.dateTo >= p.dateFrom).toBe(true);
  });

  it("алиасы районов: бангтао → Банг Тао", () => {
    const p = planOf("движ в бангтао");
    if (p.kind === "search") expect(p.district).toBe("Банг Тао");
  });

  it("навигация: открой карту", () => {
    expect(planOf("открой карту")).toEqual({ kind: "open", route: "map" });
  });

  it("детали с номером", () => {
    expect(planOf("детали 2")).toEqual({ kind: "details", index: 2 });
  });

  it("маршрут", () => {
    expect(planOf("маршрут")).toEqual({ kind: "route" });
  });

  it("бессмыслица не притворяется поиском", () => {
    expect(planOf("asdfgh").kind).toBe("unknown");
  });

  it("help", () => {
    expect(planOf("помощь").kind).toBe("help");
  });
});

describe("форматтер выдачи", () => {
  it("нумерует и подсказывает следующие шаги", () => {
    const lines = fmtEvents(
      [{ title: "Party", venue: "Illuzion", start_at: "2026-08-16" }],
      "на сегодня",
    );
    expect(lines[0]).toContain("нашёл 1");
    expect(lines[1]).toContain("1. Illuzion");
    expect(lines.at(-1)).toContain("маршрут");
  });
});

describe("пасхалка", () => {
  it("«да братан» во всех обличьях", async () => {
    const { EGG_RE } = await import("../text");
    for (const q of ["да братан", "Да, братан!", "да, братан)))", "ДА БРАТАН"])
      expect(EGG_RE.test(q)).toBe(true);
    expect(EGG_RE.test("да")).toBe(false);
    expect(EGG_RE.test("братан, что сегодня")).toBe(false);
  });
});

describe("визитка BRO", () => {
  it("зовёт по имени и перечисляет только реальные умения", () => {
    const g = greetLines("Илья Пелихосов", "visitor", 0);
    expect(g[0]).toContain("Илья");
    // фамилия в обращении — это уже не приятель, а повестка
    expect(g[0]).not.toContain("Пелихосов");
    const body = g.join(" ");
    expect(body).toContain("Café del Mar");
    expect(body).toContain("маршрут");
    // гостю не обещаем инструменты команды
    expect(body).not.toContain("подрядчик");
  });

  it("команде добавляет её инструменты", () => {
    const g = greetLines("Фёдор", "gtr", 0).join(" ");
    expect(g).toContain("подрядчик");
    expect(g).toContain("черновик события");
  });

  it("без имени не выдумывает его", () => {
    expect(greetLines(undefined, "visitor", 0)[0]).toContain("брат");
  });

  it("«привет» и «что ты умеешь» — это знакомство, а не поиск афиши", () => {
    expect(planOf("привет").kind).toBe("greet");
    expect(planOf("что ты умеешь?").kind).toBe("greet");
    expect(planOf("кто ты").kind).toBe("greet");
    // а вот это по-прежнему поиск
    expect(planOf("что сегодня в патонге").kind).toBe("search");
  });
});

describe("карантин выдумки", () => {
  it("список мест без единого вызова инструмента не доходит до человека", () => {
    const invented =
      "Брат, сегодня в Патонге жара:\n- Café de la Luna — бар с кавой\n- Coco's — клуб с диджеями";
    expect(looksInvented(invented, 0)).toBe(true);
    // тот же текст, но факты пришли из инструмента — пропускаем
    expect(looksInvented(invented, 1)).toBe(false);
  });

  it("уточняющий вопрос и честный отказ проходят свободно", () => {
    expect(looksInvented("Брат, давай поищем. Ты сейчас где?", 0)).toBe(false);
    expect(looksInvented("По базе на сегодня пусто — не буду выдумывать.", 0)).toBe(false);
  });
});

describe("музыкальные команды не уводят в навигацию", () => {
  it("«открой сеты X на ютубе» — это музыка, а не экран приложения", () => {
    const p = planOf("открой сеты LUTANG на ютубе");
    expect(p.kind).toBe("music");
    if (p.kind === "music") {
      expect(p.artist).toBe("lutang");
      expect(p.source).toBe("youtube");
    }
  });

  it("площадка распознаётся по-русски и по-английски", () => {
    const a = planOf("послушать треки лутанг в спотифай");
    const b = planOf("включи микс dj meet на саундклауде");
    expect(a.kind === "music" && a.source).toBe("spotify");
    expect(b.kind === "music" && b.source).toBe("soundcloud");
    expect(b.kind === "music" && b.artist).toBe("dj meet");
  });

  it("навигация по экранам приложения не сломалась", () => {
    expect(planOf("открой карту").kind).toBe("open");
    expect(planOf("открой артисты").kind).toBe("open");
  });
});

describe("поиск по базе площадок в текстовом режиме", () => {
  it("«какие клубы в патонге» ищет базу, а не афишу", () => {
    const p = planOf("какие клубы в патонге");
    expect(p.kind).toBe("venues");
    if (p.kind === "venues") {
      expect(p.district).toBe("Патонг");
      expect(p.kind2).toBe("клуб");
    }
  });

  it("типы мест распознаются, включая пляжные клубы и еду", () => {
    const a = planOf("найди пляжный клуб в банг тао");
    const b = planOf("где поесть в камале");
    expect(a.kind === "venues" && a.kind2).toBe("пляжный клуб");
    expect(b.kind === "venues" && b.kind2).toBe("ресторан");
  });

  it("вопрос про афишу остаётся поиском событий", () => {
    expect(planOf("что сегодня в патонге").kind).toBe("search");
    expect(planOf("куда пойти сегодня").kind).toBe("search");
    expect(planOf("какие клубы играют сегодня").kind).toBe("search");
  });
});
