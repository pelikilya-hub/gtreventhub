// Автонаполнение: что машина имеет право дописать в базу сама.
//
// Скрипт scripts/autofill-venues.mjs делает две вещи без человека:
// ставит категорию по описанию типа и находит координату геокодером.
// Обе — записи в базу, которую потом читает гость, поэтому цена ошибки
// разная и проверяем мы разное.
//
// Категория ошибётся — площадка попадёт не в тот фильтр. Неприятно,
// заметно, чинится одной правкой.
//
// Координата ошибётся — гость поедет не туда. Это уже не косметика, и
// поймать такую ошибку глазами почти нельзя: точка выглядит нормально,
// просто стоит не там. Поэтому ниже больше всего проверок именно на
// сито имени: оно решает, принять ответ геокодера или отбросить.
import { describe, expect, it } from "vitest";

// @ts-expect-error — скрипт на голом JS, типов у него нет и не нужно
import { nameMatches, tagFromType } from "../../../scripts/autofill-venues.mjs";

describe("категория по типу", () => {
  it("частное правило срабатывает раньше общего", () => {
    // «water park» не должен стать «park», а «beach club» — «club».
    expect(tagFromType("Water park / event venue")).toBe("Show / Park");
    expect(tagFromType("Beach club / restaurant")).toBe("Beach club");
    expect(tagFromType("Night club")).toBe("Nightclub");
  });

  it("отель с переговорными — это MICE, а не ночной клуб", () => {
    expect(tagFromType("Hotel / meeting rooms")).toBe("Resort / MICE");
  });

  it("ничего не подошло — пусто, а не выдуманная категория", () => {
    // Пустая категория — работа для человека. Выдуманная — ложь в базе.
    expect(tagFromType("")).toBe("");
    expect(tagFromType("Прачечная самообслуживания")).toBe("");
  });

  it("название идёт в дело, когда тип молчит", () => {
    expect(tagFromType("", "Rhythm Rooftop")).toBe("Rooftop");
  });
});

describe("сито имени", () => {
  it("лишние слова у найденной точки допустимы", () => {
    // Мы ищем «Lost Beach Bar & Restaurant», OSM знает «Lost Beach Bar».
    expect(nameMatches("LOST Beach Bar & Restaurant", "Lost Beach Bar")).toBe(true);
    expect(nameMatches("Tree Tops Sky Dining & Bar", "Tree Tops Dining")).toBe(true);
  });

  it("пропущенное значимое слово — это другое заведение", () => {
    // Реальный ответ Photon на «Horn Pub»: стоит ровно в нашем регионе,
    // границы проходит, и только имя выдаёт подмену.
    expect(nameMatches("Horn Pub", "Koh Samui Pub Crawl")).toBe(false);
  });

  it("одной буквы для узнавания мало", () => {
    // Первый прогон на этом и споткнулся: от «Q Bar Samui» после отсева
    // общих слов остаётся «q», и она совпала с «Q Signature».
    expect(nameMatches("Q Bar Samui", "Q Signature")).toBe(false);
  });

  it("название из одних общих слов не опознаётся вовсе", () => {
    // «Beach Bar» на побережье — это не название, а описание.
    expect(nameMatches("Beach Bar", "Beach Bar Chaweng")).toBe(false);
  });

  it("регистр и пунктуация не мешают", () => {
    expect(nameMatches("Tropical Murphy's Irish Pub", "TROPICAL MURPHYS IRISH PUB")).toBe(true);
  });

  it("остров в нашем названии не требуется от найденной точки", () => {
    // «Samui» мы дописываем для человека; в OSM его в имени может не быть.
    expect(nameMatches("Kukoo Bar Samui", "Kukoo Bar")).toBe(true);
  });
});
