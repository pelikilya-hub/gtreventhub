// Конвейер наполнения: очередь, лесенка, цена шага.
//
// Замер по базе (scripts/venue-readiness.mjs) дал цифру, с которой
// пришлось начать: из 354 площадок 56 гость не увидит вовсе — нет
// координаты или категории, — а ещё 143 стоят на карте точкой без фото
// и в списке их пролистывают не глядя. Половина базы не показывается,
// и реклама на неё оплачивала бы пустые карточки.
//
// «Наполнять по 20 в день» работает только с правильной очередью.
// Алфавитная очередь тратит день на площадки с шестью дырами, пока
// двадцать соседних ждут одного поля. Отсюда цена шага и сортировка.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FILL_FIELDS,
  FILL_LEVELS,
  fillLevel,
  fillQueue,
  fillSummary,
  stepCost,
  stepGaps,
  venueGaps,
  type FillRow,
} from "../venue-fill";

const full = {
  tag: "Nightclub",
  concept: "Клуб на 600 человек с террасой над морем и резидентами из Бангкока каждую пятницу.",
  phone: "+66 76 000 000",
  capacity: "600 гостей",
  music: "house, techno",
};
const fullExtra = { hasGeo: true, hero: "/x.jpg", gallery: 4 };

describe("пробелы площадки", () => {
  it("заполненная площадка не имеет пробелов", () => {
    expect(venueGaps(full, fullExtra)).toEqual([]);
    expect(fillLevel([])).toBe("в продаже");
  });

  it("категория «Other» — это не категория", () => {
    // На карте такая точка серая и не попадает ни в один фильтр.
    expect(venueGaps({ ...full, tag: "Other" }, fullExtra)).toContain("type");
  });

  it("описание из прочерка не считается описанием", () => {
    // «—» в поле — это следы импорта, а не текст, по которому выбирают.
    for (const c of ["—", "-", "  ", "клуб"])
      expect(venueGaps({ ...full, concept: c }, fullExtra), c).toContain("concept");
  });

  it("вместимость без цифры не вместимость", () => {
    expect(venueGaps({ ...full, capacity: "уточняется" }, fullExtra)).toContain("capacity");
  });

  it("подтверждённое площадкой засчитывается наравне со статикой", () => {
    // Иначе очередь звала бы добивать то, что заведение уже прислало
    // через магик-ссылку, — и команда делала бы работу дважды.
    const bare = { tag: "Bar / Lounge", concept: full.concept, music: full.music };
    expect(venueGaps(bare, { ...fullExtra })).toEqual(["contact", "capacity"]);
    expect(
      venueGaps(bare, { ...fullExtra, confirmedContact: true, confirmedCapacity: "180" }),
    ).toEqual([]);
  });

  it("фото от площадки складывается с нашей галереей", () => {
    const g = venueGaps(full, { hasGeo: true, hero: "/x.jpg", gallery: 2 });
    expect(g).toContain("gallery");
    expect(venueGaps(full, { hasGeo: true, hero: "/x.jpg", gallery: 3 })).toEqual([]);
  });
});

describe("лесенка уровней", () => {
  it("совпадает с тем, где площадку видно", () => {
    expect(fillLevel(["geo"])).toBe("невидима");
    expect(fillLevel(["type"])).toBe("невидима");
    expect(fillLevel(["photo"])).toBe("на карте");
    expect(fillLevel(["concept"])).toBe("в списке");
    expect(fillLevel(["contact"])).toBe("в витрине");
    expect(fillLevel(["capacity"])).toBe("в витрине");
    expect(fillLevel(["music", "gallery"])).toBe("в продаже");
  });

  it("нижняя ступень главнее верхней", () => {
    // Без координаты не спасёт ни фото, ни описание: площадки нет.
    expect(fillLevel(["geo", "photo", "concept", "contact"])).toBe("невидима");
  });
});

describe("сегодняшний шаг", () => {
  it("называет только то, что поднимает на ступень", () => {
    // У площадки без координаты и без галереи пробелов два, а шаг один.
    // Показывать оба одинаково — значит каждый раз заставлять менеджера
    // соображать, что из списка сегодняшнее.
    expect(stepGaps(["geo", "gallery"])).toEqual(["geo"]);
    expect(stepGaps(["photo", "contact", "capacity"])).toEqual(["photo"]);
    expect(stepGaps(["contact", "capacity", "music"])).toEqual(["contact", "capacity"]);
    expect(stepGaps(["music", "gallery"])).toEqual(["music", "gallery"]);
    expect(stepGaps([])).toEqual([]);
  });

  it("цена шага — это ровно длина шага", () => {
    // Одно определение вместо двух: раньше они жили порознь и могли
    // разойтись при первой же правке лесенки.
    for (const g of [["geo"], ["geo", "type"], ["photo", "concept"], ["contact"], []])
      expect(stepCost(g as never)).toBe(stepGaps(g as never).length);
  });
});

describe("цена шага", () => {
  it("считает только то, что нужно до следующей ступени", () => {
    // У площадки без фото и без контакта шаг стоит одно поле: фото.
    // Контакт — забота следующей ступени, и в цену сегодняшнего шага
    // он входить не должен, иначе очередь врёт про объём работы.
    expect(stepCost(["photo", "contact", "capacity", "music", "gallery"])).toBe(1);
    expect(stepCost(["geo", "type"])).toBe(2);
    expect(stepCost(["contact", "capacity"])).toBe(2);
  });
});

describe("очередь", () => {
  const row = (name: string, gaps: string[]): FillRow => ({
    id: name,
    name,
    region: "phuket",
    area: "",
    gaps: gaps as FillRow["gaps"],
    level: fillLevel(gaps as FillRow["gaps"]),
    cost: stepCost(gaps as FillRow["gaps"]),
  });

  it("дешёвые шаги идут первыми, а не алфавит", () => {
    // Прямая улика прошлого подхода: «Ananta» перед «Zebra» независимо
    // от того, сколько у каждой дыр.
    const q = fillQueue([
      row("Ananta", ["geo", "type"]),
      row("Zebra", ["photo"]),
      row("Mango", ["concept"]),
    ]);
    expect(q.map((r) => r.name)).toEqual(["Zebra", "Mango", "Ananta"]);
  });

  it("доведённые до продажи из очереди уходят", () => {
    // Держать их в списке дел — значит прятать за ними работу.
    const q = fillQueue([row("Done", []), row("Todo", ["photo"])]);
    expect(q.map((r) => r.name)).toEqual(["Todo"]);
  });

  it("сводка считает все уровни, включая нулевые", () => {
    const s = fillSummary([row("A", ["geo"]), row("B", [])]);
    expect(s["невидима"]).toBe(1);
    expect(s["в продаже"]).toBe(1);
    expect(Object.keys(s).sort()).toEqual([...FILL_LEVELS].sort());
  });
});

describe("очередь на сервере", () => {
  const kvApi = readFileSync(join(__dirname, "..", "kv-api.ts"), "utf8");
  const fn = kvApi.slice(kvApi.indexOf("export const venueQueueFn"));
  // Сборка строк переехала в venue-rows.ts: те же цифры нужны и экрану,
  // и утренней сводке крона, а два расчёта рано или поздно разойдутся.
  const rows = readFileSync(join(__dirname, "..", "venue-rows.ts"), "utf8");

  it("это внутренняя кухня: гостю, артисту и площадке закрыто", () => {
    expect(fn).toContain('["gtr", "pr", "owner", "sales"].includes(me.role)');
  });

  it("экран и крон считают одной сборкой, а не каждый своей", () => {
    expect(fn).toContain("buildFillRows");
  });

  it("учитывает то, что прислали сами площадки", () => {
    expect(rows).toContain('kvListAll(ns, "vconfirm:")');
    expect(rows).toContain('kvListAll(ns, "vphoto:")');
  });

  it("без хранилища считает по статике, а не падает", () => {
    // Локальный режим и минута недоступности KV не должны выключать
    // экран целиком — очередь просто станет пессимистичнее.
    expect(rows).toContain("if (ns) {");
    expect(rows).not.toMatch(/if \(!ns\) return \[\];[\s\S]{0,80}PH\.venues/);
  });
});

describe("подписи полей", () => {
  it("у каждого поля есть человеческое имя и объяснение зачем", () => {
    // Список читает менеджер, а не разработчик: «geo» ему ничего не
    // говорит, «без неё нет ни на карте, ни в „рядом со мной“» — говорит.
    for (const f of FILL_FIELDS) {
      expect(f.label.length, f.key).toBeGreaterThan(3);
      expect(f.why.length, f.key).toBeGreaterThan(15);
    }
  });
});
