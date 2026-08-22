// Прогон брони стола глазами гостя.
//
// bookTableCore — общее ядро для формы в приложении и для голосового BRO,
// поэтому проверяется именно оно: валидация, антиспам, санитайзинг полей,
// счёт предзаказа и то, что заявка реально ложится в хранилище под ключом,
// по которому её потом найдёт менеджер.
//
// Telegram в тестах не настроен: tgApi без токена тихо не отправляет, и это
// правильное поведение — бронь не должна падать из-за недоступного бота.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bookTableCore, type BookTableInput } from "../kv-api";
import type { KvNs } from "../kv-ns";

/** Хранилище в памяти с поведением Workers KV, включая TTL. */
function memKv() {
  const store = new Map<string, { v: string; exp?: number }>();
  const ns: KvNs = {
    get: async (key) => {
      const rec = store.get(key);
      if (!rec) return null;
      if (rec.exp && rec.exp <= Date.now()) {
        store.delete(key);
        return null;
      }
      return rec.v;
    },
    put: async (key, value, opts) => {
      store.set(key, {
        v: value,
        exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
      });
    },
    delete: async (key) => void store.delete(key),
    list: async (opts) => ({
      keys: [...store.keys()]
        .filter((k) => k.startsWith(opts?.prefix ?? ""))
        .map((name) => ({ name })),
      list_complete: true,
    }),
  };
  return { ns, store };
}

const GUEST = { email: "guest@example.com" };

const input = (over: Partial<BookTableInput> = {}): BookTableInput => ({
  vid: "VEN-0002", // Café del Mar — единственная площадка с бронью
  dateIso: "2026-09-01",
  guests: 4,
  name: "Иван Гость",
  phone: "+66 812 345 678",
  zone: "Beachfront",
  tableType: "Beach Daybed",
  slot: "19:00",
  ...over,
});

const readBooking = async (store: Map<string, { v: string }>) => {
  const key = [...store.keys()].find((k) => k.startsWith("booking:"));
  return key ? JSON.parse(store.get(key)!.v) : null;
};

describe("бронь стола гостем", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("заявка проходит и ложится в хранилище", async () => {
    const { ns, store } = memKv();
    const res = await bookTableCore(ns, GUEST, input());

    expect(res.ok, "reason" in res ? String(res.reason) : "").toBe(true);
    const b = await readBooking(store);
    expect(b).toBeTruthy();
    expect(b.status).toBe("new");
    expect(b.by).toBe(GUEST.email);
    expect(b.vid).toBe("VEN-0002");
    expect(b.guests).toBe(4);
    expect(b.zone).toBe("Beachfront");
    expect(b.slot).toBe("19:00");
    expect(b.id).toMatch(/^BK-/);
  });

  it("без имени, телефона или даты — отказ с понятной причиной", async () => {
    for (const bad of [{ name: "  " }, { phone: "" }, { dateIso: "" }]) {
      const { ns, store } = memKv();
      const res = await bookTableCore(ns, GUEST, input(bad));
      expect(res.ok, `пропустило ${JSON.stringify(bad)}`).toBe(false);
      expect(await readBooking(store)).toBeNull();
    }
  });

  it("вторая заявка в ту же минуту отбивается антиспамом", async () => {
    const { ns } = memKv();
    expect((await bookTableCore(ns, GUEST, input())).ok).toBe(true);
    const second = await bookTableCore(ns, GUEST, input());
    expect(second.ok).toBe(false);
    expect("reason" in second && second.reason).toMatch(/минуту/);
  });

  it("предзаказ считается и обрезается по границам", async () => {
    const { ns, store } = memKv();
    const res = await bookTableCore(
      ns,
      GUEST,
      input({
        preorder: [
          { id: "m1", name: "Tuna Tartare", qty: 2, price: 780 },
          { id: "m2", name: "Pad Thai Seafood", qty: 1, price: 850 },
          // мусорные строки не должны доехать до менеджера
          { id: "m3", name: "Ноль штук", qty: 0, price: 500 },
        ],
      }),
    );

    expect(res.ok).toBe(true);
    const b = await readBooking(store);
    expect(b.preorder).toHaveLength(2);
    expect(b.preorderTotal).toBe(780 * 2 + 850);
  });

  it("число гостей загоняется в разумные границы", async () => {
    for (const [given, want] of [
      [0, 2], // ноль трактуется как «не указано» и получает дефолт
      [-5, 1], // отрицательное — просто зажимается по нижней границе
      [999, 100],
    ] as const) {
      const { ns, store } = memKv();
      await bookTableCore(ns, GUEST, input({ guests: given }));
      expect((await readBooking(store)).guests, `гостей: ${given}`).toBe(want);
    }
  });

  it("длинные поля режутся, а не уезжают в хранилище целиком", async () => {
    const { ns, store } = memKv();
    await bookTableCore(
      ns,
      GUEST,
      input({ name: "Я".repeat(300), note: "П".repeat(900) }),
    );
    const b = await readBooking(store);
    expect(b.name.length).toBeLessThanOrEqual(90);
    expect(b.note.length).toBeLessThanOrEqual(300);
  });
});
