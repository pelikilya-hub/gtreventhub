// Разговор живёт три минуты. Тесты держат обе границы: вернулся раньше —
// продолжаем, позже — начинаем заново, а сломанный localStorage не должен
// ронять оверлей вовсе.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_TTL_MS, chatStale, touchChat } from "../chat-life";

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
} as unknown as Storage;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", fakeStorage);
  vi.useRealTimers();
});

describe("время жизни разговора", () => {
  it("первый вход всегда начинает заново", () => {
    expect(chatStale()).toBe(true);
  });

  it("возврат в пределах трёх минут продолжает разговор", () => {
    touchChat();
    expect(chatStale()).toBe(false);
  });

  it("после трёх минут разговор считается новым", () => {
    store.set("gtr.bro.lastAt", String(Date.now() - CHAT_TTL_MS - 1000));
    expect(chatStale()).toBe(true);
  });

  it("ровно на границе разговор ещё жив", () => {
    store.set("gtr.bro.lastAt", String(Date.now() - CHAT_TTL_MS + 2000));
    expect(chatStale()).toBe(false);
  });

  it("запрещённое хранилище не ломает оверлей", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage);
    expect(() => touchChat()).not.toThrow();
    expect(chatStale()).toBe(false);
  });
});
