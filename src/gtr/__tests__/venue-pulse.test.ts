// Пульс площадки и анонимная оценка.
//
// Проверяется не «работает ли функция», а обещания, которые мы дали
// пользователю: по данным нельзя восстановить, кто где был. Это ровно те
// свойства, которые ломаются молча — сотрудник добавит поле «кто оценил»
// ради удобства поддержки, и приватности не станет.
import { describe, expect, it } from "vitest";

import { checkInCore, pulseCore, rateVisitCore } from "../venue-pulse";
import type { KvNs } from "../kv-ns";

function memKv() {
  const store = new Map<string, string>();
  const ns: KvNs = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async (o) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  return { ns, store };
}

const VID = "VEN-0002";
const T0 = Date.UTC(2026, 7, 27, 14, 0, 0);
/** Чек-ин «час назад»: за окном задержки, внутри трёхчасового окна. */
const ago = (min: number) => T0 - min * 60_000;

const crowd = async (ns: KvNs, n: number, at: number, from = 0) => {
  for (let i = from; i < from + n; i++) await checkInCore(ns, { email: `g${i}@x.io` }, VID, at);
};

describe("пульс площадки", () => {
  it("ниже порога не показывает ничего — и никогда «пусто»", async () => {
    const { ns } = memKv();
    await crowd(ns, 7, ago(60));
    const pulse = await pulseCore(ns, T0);
    // Именно отсутствие ключа: «пусто» ударило бы по бизнесу площадки.
    expect(pulse[VID]).toBeUndefined();
    expect(Object.values(pulse)).not.toContain("empty");
  });

  it("на пороге показывает ступень, а не число людей", async () => {
    const { ns } = memKv();
    await crowd(ns, 8, ago(60));
    const pulse = await pulseCore(ns, T0);
    expect(pulse[VID]).toBe("busy");
    // Наружу уходят только ступени: цифра — это и есть счётчик людей.
    // Проверяем значения, а не весь ответ: цифры есть в самом id площадки.
    for (const v of Object.values(pulse)) {
      expect(typeof v).toBe("string");
      expect(v).toMatch(/^(busy|hot|packed)$/);
    }
  });

  it("ступени растут с числом гостей", async () => {
    for (const [n, want] of [
      [8, "busy"],
      [15, "hot"],
      [30, "packed"],
    ] as const) {
      const { ns } = memKv();
      await crowd(ns, n, ago(60));
      expect((await pulseCore(ns, T0))[VID], `${n} гостей`).toBe(want);
    }
  });

  it("один гость не может накрутить пульс повторными нажатиями", async () => {
    const { ns } = memKv();
    for (let i = 0; i < 40; i++) await checkInCore(ns, { email: "one@x.io" }, VID, ago(60) + i * 1000);
    expect((await pulseCore(ns, T0))[VID]).toBeUndefined();
  });

  it("последние минуты в счёт не идут — иначе пульс следит за человеком", async () => {
    const { ns } = memKv();
    // Достаточная толпа, но вся пришла только что.
    await crowd(ns, 20, ago(5));
    expect((await pulseCore(ns, T0))[VID]).toBeUndefined();
    // Те же люди час спустя уже видны.
    expect((await pulseCore(ns, T0 + 60 * 60_000))[VID]).toBe("hot");
  });

  it("вчерашний вечер не считается сегодняшним", async () => {
    const { ns } = memKv();
    await crowd(ns, 20, ago(60 * 20));
    expect((await pulseCore(ns, T0))[VID]).toBeUndefined();
  });

  it("в хранилище пульса нет ни почты, ни чего-либо похожего на неё", async () => {
    const { ns, store } = memKv();
    await crowd(ns, 10, ago(60));
    const dump = [...store.values()].join(" ");
    expect(dump).not.toContain("@x.io");
    expect(dump).not.toMatch(/@/);
  });

  it("отпечаток гостя меняется день ко дню — историю перемещений не собрать", async () => {
    const { ns, store } = memKv();
    await checkInCore(ns, { email: "one@x.io" }, VID, T0);
    const day1 = store.get("pulse:all")!;
    store.clear();
    await checkInCore(ns, { email: "one@x.io" }, VID, T0 + 86_400_000);
    const day2 = store.get("pulse:all")!;
    const h = (s: string) => /"h":"([0-9a-f]{8})"/.exec(s)![1];
    expect(h(day1)).not.toBe(h(day2));
  });
});

describe("анонимная оценка визита", () => {
  const tokenOf = async (ns: KvNs, email: string) => {
    const r = await checkInCore(ns, { email }, VID, T0);
    if (!r.ok) throw new Error(r.reason);
    return r.token;
  };

  it("в записи оценки нет автора", async () => {
    const { ns, store } = memKv();
    const token = await tokenOf(ns, "guest@x.io");
    const r = await rateVisitCore(ns, token, 5, "Отличный вечер", ["музыка"], T0);
    expect(r.ok).toBe(true);

    const key = [...store.keys()].find((k) => k.startsWith("rating:"))!;
    const saved = JSON.parse(store.get(key)!);
    // Ни почты, ни отпечатка, ни самого токена — восстановить некого.
    expect(JSON.stringify(saved)).not.toContain("@");
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(Object.keys(saved).sort()).toEqual(["dateIso", "id", "score", "tags", "text", "vid"]);
  });

  it("один визит оценивается один раз", async () => {
    const { ns } = memKv();
    const token = await tokenOf(ns, "guest@x.io");
    expect((await rateVisitCore(ns, token, 5, undefined, undefined, T0)).ok).toBe(true);
    const second = await rateVisitCore(ns, token, 1, undefined, undefined, T0);
    expect(second.ok).toBe(false);
    expect("reason" in second && second.reason).toMatch(/уже оценён/);
  });

  it("без чек-ина оценить нельзя", async () => {
    const { ns } = memKv();
    for (const bad of ["", "мусор", "VEN-0002", "VEN-0002.2026-08-27.zzzzzzzz"]) {
      const r = await rateVisitCore(ns, bad, 5, undefined, undefined, T0);
      expect(r.ok, `прошло: ${bad}`).toBe(false);
    }
  });

  it("оценка вне диапазона 1–5 не принимается", async () => {
    const { ns } = memKv();
    for (const s of [0, 6, -3, 99]) {
      const token = await tokenOf(ns, `g${s}@x.io`);
      expect((await rateVisitCore(ns, token, s, undefined, undefined, T0)).ok, `оценка ${s}`).toBe(false);
    }
  });

  it("отметка «уже оценено» не выдаёт, кто это был", async () => {
    const { ns, store } = memKv();
    const token = await tokenOf(ns, "guest@x.io");
    await rateVisitCore(ns, token, 4, undefined, undefined, T0);
    const usedKey = [...store.keys()].find((k) => k.startsWith("rated:"))!;
    // В ключе живёт отпечаток дня, но не почта: связать его с человеком
    // можно только зная и почту, и соль дня — то есть перебрав всю базу.
    expect(usedKey).not.toContain("@");
    expect(store.get(usedKey)).toBe("1");
  });

  it("длинный отзыв обрезается, а не уезжает в хранилище целиком", async () => {
    const { ns, store } = memKv();
    const token = await tokenOf(ns, "guest@x.io");
    await rateVisitCore(ns, token, 3, "П".repeat(2000), undefined, T0);
    const key = [...store.keys()].find((k) => k.startsWith("rating:"))!;
    expect(JSON.parse(store.get(key)!).text.length).toBeLessThanOrEqual(500);
  });
});
