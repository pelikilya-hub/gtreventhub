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
          { id: "platter-mezze", name: "Mezze", qty: 2, price: 1450 },
          { id: "platter-royal-thai", name: "Royal Thai Selection", qty: 1, price: 2250 },
          // мусорные строки не должны доехать до менеджера
          { id: "platter-japanese", name: "Ноль штук", qty: 0, price: 4500 },
        ],
      }),
    );

    expect(res.ok).toBe(true);
    const b = await readBooking(store);
    expect(b.preorder).toHaveLength(2);
    expect(b.preorderTotal).toBe(1450 * 2 + 2250);
  });

  // Регрессия: форма брони — один живой компонент на все площадки, и при
  // смене заведения её корзина уезжала в заявку соседнего ресторана.
  // Клиент починен сбросом состояния, но граница обязана держать это сама:
  // заявка уходит живому менеджеру, и заказ блюд, которых у него нет, —
  // не «косметика», а сорванный вечер гостя.
  it("блюда чужой площадки в предзаказ не проходят", async () => {
    const { ns, store } = memKv();
    const res = await bookTableCore(
      ns,
      GUEST,
      input({
        preorder: [
          { id: "platter-mezze", name: "Mezze", qty: 1, price: 1450 },
          // позиция из меню Catch Beach Club — в Café del Mar её нет
          { id: "eggs-benedict", name: "Eggs Benedict", qty: 2, price: 520 },
          // и просто выдуманный id
          { id: "нет-такого-блюда", name: "Фантом", qty: 1, price: 100 },
        ],
      }),
    );

    expect(res.ok).toBe(true);
    const b = await readBooking(store);
    expect(b.preorder).toHaveLength(1);
    expect(b.preorder[0].id).toBe("platter-mezze");
    expect(b.preorderTotal).toBe(1450);
  });

  it("цену предзаказа диктует меню, а не заявка", async () => {
    const { ns, store } = memKv();
    await bookTableCore(
      ns,
      GUEST,
      // клиент прислал единицу вместо реальных 1450 — берём цену из меню
      input({ preorder: [{ id: "platter-mezze", name: "Mezze", qty: 1, price: 1 }] }),
    );
    const b = await readBooking(store);
    expect(b.preorder[0].price).toBe(1450);
    expect(b.preorderTotal).toBe(1450);
  });

  it("у площадки без меню предзаказ отбрасывается целиком", async () => {
    const { ns, store } = memKv();
    // VEN-0061 — Place Coworking: бронь переговорной есть, кухни нет
    await bookTableCore(
      ns,
      GUEST,
      input({
        vid: "VEN-0061",
        preorder: [{ id: "platter-mezze", name: "Mezze", qty: 1, price: 1450 }],
      }),
    );
    const b = await readBooking(store);
    expect(b.preorder ?? []).toHaveLength(0);
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
