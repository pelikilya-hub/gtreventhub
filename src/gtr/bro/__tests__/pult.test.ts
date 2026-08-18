// Пульт Claude: очередь команд ведёт себя предсказуемо.
import { describe, expect, it } from "vitest";

import { addCmd, ackCmd, pultAccessKey, PULT_MAX, type PultCmd } from "../pult";

const NOW = 1_787_000_000_000;

describe("пульт Claude", () => {
  it("команда встаёт в очередь со статусом new и автором", () => {
    const q = addCmd([], "boss@gtr", "поправь шапку", NOW);
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe("new");
    expect(q[0].by).toBe("boss@gtr");
    expect(q[0].text).toBe("поправь шапку");
    expect(q[0].id).toMatch(/^p/);
  });

  it("текст режется до 2000 знаков — поручение, а не роман", () => {
    const q = addCmd([], "boss@gtr", "х".repeat(5000), NOW);
    expect(q[0].text.length).toBe(2000);
  });

  it("ack меняет статус и несёт ответ Claude", () => {
    let q = addCmd([], "boss@gtr", "задача", NOW);
    q = ackCmd(q, q[0].id, "done", "сделано, коммит abc", NOW + 1000);
    expect(q[0].status).toBe("done");
    expect(q[0].note).toBe("сделано, коммит abc");
    expect(q[0].at).toBe(NOW + 1000);
  });

  it("ack с чужим id ничего не трогает", () => {
    const q = addCmd([], "boss@gtr", "задача", NOW);
    expect(ackCmd(q, "нет-такого", "done", undefined, NOW)).toEqual(q);
  });

  it("переполнение вытесняет сперва выполненные, потом самые старые", () => {
    let q: PultCmd[] = [];
    for (let i = 0; i < PULT_MAX; i++) q = addCmd(q, "boss@gtr", `задача ${i}`, NOW + i);
    // одна выполнена в середине — уйдёт первой
    q = ackCmd(q, q[10].id, "done", undefined, NOW);
    q = addCmd(q, "boss@gtr", "новая", NOW + 999);
    expect(q).toHaveLength(PULT_MAX);
    expect(q.find((c) => c.text === "задача 10")).toBeUndefined();
    expect(q.find((c) => c.text === "новая")).toBeDefined();
    // все done кончились — теперь уходит самая старая
    q = addCmd(q, "boss@gtr", "ещё", NOW + 1000);
    expect(q).toHaveLength(PULT_MAX);
    expect(q.find((c) => c.text === "задача 0")).toBeUndefined();
  });

  it("ключ пульта — 48 hex-знаков и стабилен", async () => {
    const a = await pultAccessKey();
    const b = await pultAccessKey();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).toBe(b);
  });
});
