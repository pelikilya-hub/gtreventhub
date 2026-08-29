// Карта: поиск, расстояния, порядок вечера.
//
// Карта умела показывать, где заведения стоят, и на этом кончалась. Найти
// конкретное можно было только глазами, «что рядом» — на глаз по
// масштабной линейке, а порядок остановок вечера был порядком, в котором
// их добавляли, и не правился вовсе.
//
// Логика вынесена в map-find.ts именно ради этого теста: Leaflet проверить
// нельзя, а ранжирование, километры и обход — можно.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { driveUrl, findVenues, kmLabel, nearestOrder, norm, straightKm, walkable } from "../map-find";

const V = (id: string, name: string, area = "Патонг", cluster = "Патонг", type = "Bar") => ({
  id,
  name,
  area,
  cluster,
  type,
});

const BASE = [
  V("A", "Illuzion Phuket", "Патонг"),
  V("B", "Café del Mar", "Ката"),
  V("C", "Bar Rouge", "Патонг"),
  V("D", "Fidelio Lounge", "Камала"),
  V("E", "Sky Bar Kata", "Ката"),
];

describe("поиск площадки", () => {
  it("диакритика и регистр не мешают", () => {
    // «Café del Mar» на вывеске, «Cafe Del Mar» в переписке, «CAFE DEL
    // MAR» в счёте — для поиска это одно название.
    expect(norm("Café del Mar")).toBe("cafe del mar");
    expect(findVenues("cafe del mar", BASE)[0].id).toBe("B");
    expect(findVenues("CAFÉ", BASE)[0].id).toBe("B");
  });

  it("точное имя стоит выше вхождения в середину", () => {
    // Иначе запрос «bar» вываливает сорок баров прежде «Bar Rouge».
    expect(findVenues("bar", BASE)[0].id).toBe("C");
  });

  it("начало слова находит, середина чужого слова — нет", () => {
    const hits = findVenues("del", BASE).map((v) => v.id);
    expect(hits[0]).toBe("B"); // Café **del** Mar
    expect(hits.indexOf("D")).toBeGreaterThan(0); // Fi**del**io — ниже
  });

  it("район и тип тоже ищутся, но после названий", () => {
    const hits = findVenues("ката", BASE).map((v) => v.id);
    expect(hits).toContain("B");
    expect(hits).toContain("E");
    // «Sky Bar Kata» — совпадение в названии, оно и первое.
    expect(hits[0]).toBe("E");
  });

  it("русский запрос находит латинское название", () => {
    // Половина аудитории набирает кириллицей, а вывески на острове
    // латинские. Без транслитерации «ката» находило заведения в районе
    // Ката, но не «Sky Bar Kata» — ровно то, которое искали. Теперь
    // совпадение идёт по названию (начало слова), а не по району, и
    // поэтому стоит первым — это и проверено выше.
    expect(norm("ката")).toBe("kata");
    expect(norm("Патонг")).toBe("patong");
    expect(norm("Пхукет")).toBe("phuket");
  });

  it("английская фонетика транслитерации не по зубам — и это не баг", () => {
    // «скай» превращается в skai, а на вывеске Sky: ни одна схема
    // транслитерации эту пару не сводит. Граница возможностей записана
    // тестом, чтобы её не пытались чинить в самом поиске — лечится это
    // только словарём синонимов, а он себя пока не окупает.
    expect(norm("скай")).toBe("skai");
    expect(findVenues("скай", BASE)).toEqual([]);
  });

  it("одна буква не ищет", () => {
    // Иначе первое же нажатие вываливает половину базы.
    expect(findVenues("b", BASE)).toEqual([]);
    expect(findVenues("", BASE)).toEqual([]);
  });

  it("спецзнаки в запросе не роняют регулярку", () => {
    // Строку набирает человек, и «(» там появляется случайно.
    expect(() => findVenues("bar (", BASE)).not.toThrow();
    expect(() => findVenues("a+b*c", BASE)).not.toThrow();
  });
});

describe("расстояние", () => {
  it("под километр меряется метрами", () => {
    // «650 м» гость переводит в «десять минут пешком», «0.7 км» — нет.
    expect(kmLabel(0.64)).toBe("650 м");
    expect(kmLabel(3.42)).toBe("3.4 км");
    expect(kmLabel(17.6)).toBe("18 км");
  });

  it("единицы приходят из словаря, а не зашиты по-русски", () => {
    // «4.7 км» в английской версии — ровно та мелочь, по которой видно,
    // что перевод делали не до конца.
    expect(kmLabel(0.64, { m: "m", km: "km" })).toBe("650 m");
    expect(kmLabel(3.42, { m: "ม.", km: "กม." })).toBe("3.4 กม.");
    const screen = readFileSync(join(__dirname, "..", "screens", "MapScreen.tsx"), "utf8");
    expect(screen).toContain('({ m: t("м"), km: t("км") })');
    expect(screen).not.toMatch(/kmLabel\([a-z]+\)/);
  });

  it("пешком — только по-настоящему близко", () => {
    // Жара и отсутствие тротуаров: обещать прогулку там, где нужен байк,
    // — плохая услуга.
    expect(walkable(0.9)).toBe(true);
    expect(walkable(2.5)).toBe(false);
  });

  it("километры считаются похожими на правду", () => {
    // Патонг → Ката по прямой: около восьми километров.
    const km = straightKm([7.8958, 98.2966], [7.8215, 98.2985]);
    expect(km).toBeGreaterThan(7);
    expect(km).toBeLessThan(9);
  });
});

describe("порядок вечера", () => {
  const P: Record<string, [number, number]> = {
    patong: [7.8958, 98.2966],
    kamala: [7.9556, 98.2828],
    kata: [7.8215, 98.2985],
    rawai: [7.7757, 98.3253],
  };

  it("обход идёт от старта по ближайшему соседу", () => {
    // Гость добавлял площадки как вспоминал; география в этом порядке не
    // участвовала. Пересборка экономит настоящие километры такси.
    const order = nearestOrder(P.kamala, ["rawai", "patong", "kata"], (k) => P[k]);
    expect(order).toEqual(["patong", "kata", "rawai"]);
  });

  it("без своей точки первая остановка остаётся первой", () => {
    // Не знаем, откуда человек стартует — значит, его собственный выбор
    // начала уважаем, а дальше ведём по ближайшим.
    const order = nearestOrder(null, ["rawai", "kamala", "kata"], (k) => P[k]);
    expect(order[0]).toBe("rawai");
    expect(order).toEqual(["rawai", "kata", "kamala"]);
  });

  it("площадка без координат не теряется, а уходит в хвост", () => {
    const order = nearestOrder(P.patong, ["kata", "ghost", "kamala"], (k) => P[k] ?? null);
    expect(order).toHaveLength(3);
    expect(order[order.length - 1]).toBe("ghost");
  });

  it("пустой вечер не ломает пересборку", () => {
    expect(nearestOrder(P.patong, [], () => null)).toEqual([]);
  });
});

describe("ссылка «доехать»", () => {
  it("ведёт в маршрут внешней карты, а не в поиск по названию", () => {
    // Поиск по имени на Пхукете находит три «Sky Bar»; координата — одна.
    const url = driveUrl(7.8958, 98.2966);
    expect(url).toContain("destination=7.8958,98.2966");
    expect(url).toContain("dir/?api=1");
  });
});

describe("экран карты", () => {
  const src = readFileSync(join(__dirname, "..", "screens", "MapScreen.tsx"), "utf8");

  it("слой «сегодня играют» приходит с сервера, а не выдумывается", () => {
    expect(src).toContain("mapAfishaFn");
    expect(src).toContain("todaySet");
  });

  it("переключатель «сегодня» не показывается, когда играть некому", () => {
    // Кнопка, которая гарантированно даёт пустой экран, — ловушка.
    expect(src).toContain("tonightN ? (");
    expect(src).toContain("if (tonightOnly && !tonightN) setTonightOnly(false)");
  });

  it("фильтры считаются один раз для точек, счётчика и списка", () => {
    // Раньше «сколько показано» и «что нарисовано» считались отдельно и
    // разошлись бы при первом же новом фильтре.
    expect(src).toContain("const visible = useMemo");
    expect(src).toContain("{visible.length} / {onMap.length}");
  });

  it("выбор региона и категории переживает перезагрузку, район — нет", () => {
    // Застрявший фильтр района читается как поломка карты.
    expect(src).toContain("gtr-map-view");
    expect(src).toContain("savePref({ ...loadPref(), region: code })");
    expect(src).not.toMatch(/savePref\([^)]*district/);
  });

  it("маршрут всегда сохраняется вместе с состоянием", () => {
    // Раньше saveRoute звали руками рядом с setRoute, и «убрать точку» в
    // одном месте сохраняло, а в другом — нет.
    expect(src).toContain("const setSavedRoute");
    expect(src).toContain("saveRoute(out)");
    // Единственный прямой вызов — внутри setSavedRoute.
    expect(src.match(/saveRoute\(/g)).toHaveLength(1);
  });
});
