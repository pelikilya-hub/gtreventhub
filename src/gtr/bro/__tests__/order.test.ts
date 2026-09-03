// Бронь — это разговор, а не одна фраза. Здесь проверяется, что продукт
// помнит сказанное и не спрашивает дважды.
import { describe, expect, it } from "vitest";

import {
  absorb,
  empty,
  isBooking,
  isCancel,
  isCold,
  missing,
  readDate,
  readGuests,
  readPhone,
  readSlot,
  ready,
  recap,
  type Order,
} from "../order";

const TODAY = "2026-08-30"; // воскресенье
const NOW = Date.parse(`${TODAY}T12:00:00Z`);

const say = (o: Order, text: string, at = NOW) => absorb(o, text, TODAY, at);

describe("просьба забронировать узнаётся", () => {
  it("в разных словах", () => {
    for (const q of [
      "закажи стол",
      "забронируй столик",
      "займи лежак",
      "забей нам стол",
      "хочу забронировать VIP",
      "столик",
    ])
      expect(isBooking(q), q).toBe(true);
  });

  it("а поиск афиши — не бронь", () => {
    for (const q of ["что сегодня в патонге", "какие клубы есть", "включи сет"])
      expect(isBooking(q), q).toBe(false);
  });

  it("вопрос про бронь — тоже не бронь", () => {
    // «Как забронировать стол» — вопрос про порядок. Открыть на нём
    // заявку значит не услышать человека.
    for (const q of ["как забронировать стол", "можно ли забронировать столик", "сколько стоит стол"])
      expect(isBooking(q), q).toBe(false);
  });
});

describe("разбор реплик", () => {
  it("дни недели считаются от сегодня", () => {
    expect(readDate("давай в субботу", TODAY)).toBe("2026-09-05");
    expect(readDate("завтра", TODAY)).toBe("2026-08-31");
    expect(readDate("сегодня вечером", TODAY)).toBe("2026-08-30");
    expect(readDate("на 2026-09-12", TODAY)).toBe("2026-09-12");
  });

  it("гости словами и цифрами", () => {
    expect(readGuests("нас четверо")).toBe(4);
    expect(readGuests("на 6 человек")).toBe(6);
    expect(readGuests("вдвоём")).toBe(2);
  });

  it("время не превращается в гостей", () => {
    // «в 10» — это час, а не десять человек. Ошибка тихая и дорогая:
    // стол накрыли бы не на тех.
    expect(readGuests("подъедем в 10")).toBeUndefined();
    expect(readSlot("подъедем в 10")).toBe("10:00");
    expect(readSlot("в 21:30")).toBe("21:30");
    expect(readSlot("в 9 вечера")).toBe("21:00");
  });

  it("телефон отличается от номера стола", () => {
    expect(readPhone("+66 93 580 44 86")).toBe("+66935804486");
    expect(readPhone("стол 12")).toBeUndefined();
  });
});

describe("последовательность брони", () => {
  it("не переспрашивает то, что уже сказали", () => {
    // Ровно жалоба BOSS: просишь стол — а тебя спрашивают, чем займёмся.
    let o = say(empty(NOW), "забронируй стол в субботу на четверых");
    expect(o.dateIso).toBe("2026-09-05");
    expect(o.guests).toBe(4);
    expect(o.table).toBe("стол");
    // Осталось спросить только площадку и телефон — и ничего больше.
    expect(missing(o)).toEqual(["venue", "phone"]);

    o = { ...say(o, "Café del Mar"), awaiting: undefined };
    expect(o.venue).toBeUndefined(); // имя берём только когда сами спросили
  });

  it("короткий ответ читается вместе с вопросом", () => {
    let o: Order = { ...empty(NOW), awaiting: "venue" };
    o = say(o, "Café del Mar");
    expect(o.venue).toBe("Café del Mar");

    o = { ...o, awaiting: "guests" };
    o = say(o, "4");
    expect(o.guests).toBe(4);

    o = { ...o, awaiting: "dateIso" };
    o = say(o, "в пятницу");
    expect(o.dateIso).toBe("2026-09-04");
  });

  it("собранная бронь готова к отправке", () => {
    let o = say(empty(NOW), "забронируй стол на завтра, нас двое, +66 93 580 44 86");
    expect(ready(o)).toBe(false);
    o = say({ ...o, awaiting: "venue" }, "Illuzion");
    expect(ready(o)).toBe(true);
    expect(recap(o)).toContain("Illuzion");
    expect(recap(o)).toContain("2 гостя");
  });

  it("новая реплика уточняет, а не стирает", () => {
    let o = say(empty(NOW), "стол на четверых завтра");
    o = say(o, "нет, лучше в субботу");
    expect(o.dateIso).toBe("2026-09-05");
    expect(o.guests).toBe(4); // про гостей не переспрашиваем
  });
});

describe("нить не вечная", () => {
  it("через полчаса молчания разговор остыл", () => {
    const o = say(empty(NOW), "забронируй стол");
    expect(isCold(o, NOW + 20 * 60_000)).toBe(false);
    expect(isCold(o, NOW + 31 * 60_000)).toBe(true);
    expect(isCold(null, NOW)).toBe(true);
  });

  it("отмену слышим прямо", () => {
    for (const q of ["отмена", "не надо", "передумал", "сброс"])
      expect(isCancel(q), q).toBe(true);
    expect(isCancel("не сегодня, а завтра")).toBe(false);
  });
});
