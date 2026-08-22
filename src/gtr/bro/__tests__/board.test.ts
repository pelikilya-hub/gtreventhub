// Табло BRO: реплики двух сторон перемежаются.
//
// Баг, ради которого написан этот файл: кусок распознавания дописывался в
// последнюю строку списка, а не в свою. BRO отвечает, не дожидаясь конца
// фразы гостя, — его строка встаёт последней, и остаток речи гостя уезжал
// в новую строку. На табло фраза выглядела разорванной, хотя расслышана
// была верно.
import { describe, expect, it } from "vitest";

import { appendPartial, sealLine, type BoardRow } from "../board";

const say = (rows: BoardRow[], who: BoardRow["who"], ...chunks: string[]) =>
  chunks.reduce((acc, c) => appendPartial(acc, who, c), rows);

const textOf = (rows: BoardRow[], who: BoardRow["who"]) =>
  rows.filter((r) => r.who === who).map((r) => r.text);

describe("склейка строк табло", () => {
  it("куски одной реплики собираются в одну строку", () => {
    const rows = say([], "user", "где сегодня ", "играет ", "техно");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("где сегодня играет техно");
    expect(rows[0].done).toBe(false);
  });

  it("речь гостя не рвётся, когда BRO вклинивается посреди фразы", () => {
    let rows = say([], "user", "где сегодня ");
    rows = say(rows, "bro", "Сейчас гляну");        // BRO заговорил первым
    rows = say(rows, "user", "играет техно");        // гость договаривает

    expect(textOf(rows, "user"), "фраза гостя разорвана на несколько строк").toEqual([
      "где сегодня играет техно",
    ]);
    expect(textOf(rows, "bro")).toEqual(["Сейчас гляну"]);
  });

  it("финал заменяет свою строку, а не чужую последнюю", () => {
    let rows = say([], "user", "где сегодня ");
    rows = say(rows, "bro", "Сейчас гляну");
    rows = sealLine(rows, "user", "Где сегодня играет техно?");

    const user = rows.filter((r) => r.who === "user");
    expect(user).toHaveLength(1);
    expect(user[0]).toEqual({ who: "user", text: "Где сегодня играет техно?", done: true });
    // реплика BRO осталась нетронутой и всё ещё печатается
    expect(rows.find((r) => r.who === "bro")).toMatchObject({ text: "Сейчас гляну", done: false });
  });

  it("после финала следующая реплика начинает новую строку", () => {
    let rows = sealLine(say([], "user", "первый вопрос"), "user", "Первый вопрос?");
    rows = say(rows, "user", "а второй?");
    expect(textOf(rows, "user")).toEqual(["Первый вопрос?", "а второй?"]);
  });

  it("длинный разговор не растёт без предела", () => {
    let rows: BoardRow[] = [];
    for (let i = 0; i < 200; i++) rows = sealLine(rows, "bro", `реплика ${i}`);
    expect(rows.length).toBeLessThanOrEqual(120);
    expect(rows[rows.length - 1].text).toBe("реплика 199");
  });

  it("пустой кусок ничего не меняет", () => {
    const rows = say([], "user", "текст");
    expect(appendPartial(rows, "user", "")).toBe(rows);
  });
});
