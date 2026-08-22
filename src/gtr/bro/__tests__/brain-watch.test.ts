import { describe, expect, it } from "vitest";

import { ago, alarmText, FAILS_TO_ALARM, stepWatch, type BrainWatch } from "../brain-watch";

const MIN = 60_000;

/** Прогнать череду проб, вернув состояние и все поднятые тревоги. */
const run = (probes: boolean[], t0 = 1_000_000) => {
  let w: BrainWatch | null = null;
  const alarms: string[] = [];
  probes.forEach((ok, i) => {
    const step = stepWatch(w, ok, t0 + i * 15 * MIN);
    w = step.next;
    if (step.alarm) alarms.push(step.alarm);
  });
  return { w: w as unknown as BrainWatch, alarms };
};

describe("сторож мозга", () => {
  it("одна неудачная проба — ещё не падение", () => {
    const { w, alarms } = run([true, false]);
    expect(alarms).toEqual([]);
    expect(w.down).toBe(false);
    expect(w.fails).toBe(1);
  });

  it("две подряд — тревога", () => {
    const { alarms } = run([true, false, false]);
    expect(alarms).toEqual(["down"]);
    expect(FAILS_TO_ALARM).toBe(2);
  });

  it("пока лежит — молчит, повторных тревог нет", () => {
    const { w, alarms } = run([true, false, false, false, false, false]);
    expect(alarms).toEqual(["down"]);
    expect(w.down).toBe(true);
    expect(w.fails).toBe(5);
  });

  it("поднялся — ровно одна тревога о возврате", () => {
    const { w, alarms } = run([true, false, false, false, true, true]);
    expect(alarms).toEqual(["down", "up"]);
    expect(w.down).toBe(false);
    expect(w.fails).toBe(0);
  });

  it("моргнуло и восстановилось — гость ничего не заметил, сторож молчит", () => {
    const { alarms } = run([true, false, true, false, true]);
    expect(alarms).toEqual([]);
  });

  it("первая же проба удачная — тревоги о возврате нет", () => {
    const { alarms } = run([true]);
    expect(alarms).toEqual([]);
  });

  it("холодный старт с лежащим мозгом: тревога всё равно поднимается", () => {
    const { w, alarms } = run([false, false]);
    expect(alarms).toEqual(["down"]);
    expect(w.lastOk).toBe(0);
  });

  it("since отмечает начало падения, а не последнюю пробу", () => {
    const t0 = 1_000_000;
    let w: BrainWatch | null = null;
    [true, false, false, false].forEach((ok, i) => {
      w = stepWatch(w, ok, t0 + i * 15 * MIN).next;
    });
    // Тревога поднялась на третьей пробе (индекс 2), там же и метка.
    expect((w as unknown as BrainWatch).since).toBe(t0 + 2 * 15 * MIN);
  });

  it("текст тревоги называет длительность, а не голый факт", () => {
    const now = 1_000_000;
    const down = alarmText("down", { down: true, fails: 2, since: now, lastOk: now - 40 * MIN }, now);
    expect(down).toContain("40 мин");
    const up = alarmText("up", { down: false, fails: 0, since: now - 3 * 60 * MIN, lastOk: now }, now);
    expect(up).toContain("3 ч");
  });

  it("без единого удачного ответа текст не врёт про «последний раз»", () => {
    const t = alarmText("down", { down: true, fails: 2, since: 5, lastOk: 0 }, 5);
    expect(t).toContain("ещё не было");
  });

  it("длительность округляется по порядку величины", () => {
    expect(ago(30_000)).toBe("1 мин");
    expect(ago(45 * MIN)).toBe("45 мин");
    expect(ago(5 * 60 * MIN)).toBe("5 ч");
    expect(ago(5 * 24 * 60 * MIN)).toBe("5 сут");
  });
});
