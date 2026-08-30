// Личность: связывание входов, номера, служебные адреса.
//
// Здесь проверяется самая дорогая ошибка продукта. Все остальные баги
// портят впечатление; эта отдаёт человеку чужой кабинет — с чужими
// бронями, контактами площадок и перепиской. Поэтому проверок на
// «связали лишнего» больше, чем на «не связали».
//
// Хранилище подменяем картой в памяти: KV в тестах не нужен, а правила
// связывания к нему и не привязаны.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KvNs } from "../kv-ns";
import {
  displayLogin,
  isSyntheticEmail,
  linkIdentity,
  maskPhone,
  normPhone,
  resolveOrCreate,
  sessionOf,
  syntheticEmail,
  unlinkIdentity,
} from "../identity";

/** KV в памяти: get/put/delete/list — ровно то, чем пользуется модуль. */
const memNs = (seed: Record<string, string> = {}): KvNs & { dump: Map<string, string> } => {
  const m = new Map(Object.entries(seed));
  return {
    dump: m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    list: async ({ prefix = "" } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
};

const account = (email: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    email,
    name: "Кто-то",
    role: "visitor",
    roleLabel: "Посетитель",
    venueId: "",
    initials: "КТ",
    passHash: "pbkdf2$1$aa$bb",
    created: 1,
    invitedBy: "signup",
    ...extra,
  });

beforeEach(() => {
  // hashPassword внутри resolveOrCreate реально считает PBKDF2 на сто
  // тысяч итераций — в тестах это секунды на ровном месте.
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});

describe("номер телефона", () => {
  it("тайский местный формат разворачивается в международный", () => {
    expect(normPhone("0812345678")).toBe("+66812345678");
    expect(normPhone("081 234 5678")).toBe("+66812345678");
    expect(normPhone("081-234-5678")).toBe("+66812345678");
  });

  it("плюс и двойной ноль — одно и то же", () => {
    expect(normPhone("+66812345678")).toBe("+66812345678");
    expect(normPhone("0066812345678")).toBe("+66812345678");
  });

  it("непонятный номер — это null, а не догадка", () => {
    // Догадка здесь означает код входа, ушедший на чужой телефон.
    // Пусть лучше интерфейс попросит ввести номер с кодом страны.
    expect(normPhone("89123456789")).toBeNull(); // 11 цифр без плюса
    expect(normPhone("12345")).toBeNull();
    expect(normPhone("")).toBeNull();
    expect(normPhone("не телефон")).toBeNull();
  });

  it("на экране номер показывается без середины", () => {
    expect(maskPhone("+66812345678")).toBe("+668···678");
  });
});

describe("служебный адрес", () => {
  it("выдаётся в несуществующей зоне", () => {
    // Письмо туда не доставится ни при какой ошибке в рассылке.
    const e = syntheticEmail("tg", "123456");
    expect(e.endsWith(".invalid")).toBe(true);
    expect(isSyntheticEmail(e)).toBe(true);
    expect(isSyntheticEmail("boss@gtr.events")).toBe(false);
  });

  it("на экране вместо него — ник или номер", () => {
    // «tg-123@id.gtrevent.invalid» человек прочтёт как поломку.
    expect(
      displayLogin({
        email: syntheticEmail("tg", "77"),
        identities: [{ provider: "tg", subject: "77", label: "@lutang", at: 1 }],
      }),
    ).toBe("@lutang");
    expect(displayLogin({ email: "boss@gtr.events" })).toBe("boss@gtr.events");
  });
});

describe("связывание входов", () => {
  it("тот же вход второй раз ведёт в тот же аккаунт", async () => {
    const ns = memNs();
    const a = await resolveOrCreate(ns, { provider: "tg", subject: "555", label: "@kto" });
    expect(a.created).toBe(true);
    const b = await resolveOrCreate(ns, { provider: "tg", subject: "555", label: "@kto" });
    expect(b.created).toBe(false);
    expect(b.user.email).toBe(a.user.email);
  });

  it("подтверждённый провайдером email связывается с готовым аккаунтом", async () => {
    // Google сам проверил адрес — это доказательство владения.
    const ns = memNs({ "user:fedor@gtr.events": account("fedor@gtr.events") });
    const r = await resolveOrCreate(ns, {
      provider: "google",
      subject: "g-1",
      label: "fedor@gtr.events",
      email: "fedor@gtr.events",
      emailVerified: true,
    });
    expect(r.created).toBe(false);
    expect(r.linked).toBe(true);
    expect(r.user.email).toBe("fedor@gtr.events");
    expect(await ns.get("ident:google:g-1")).toBe("fedor@gtr.events");
  });

  it("НЕподтверждённый email чужой аккаунт не открывает", async () => {
    // Самая дорогая ошибка во всём модуле: иначе достаточно завести
    // почтовый ящик с чужим адресом, чтобы войти в чужой кабинет.
    const ns = memNs({ "user:fedor@gtr.events": account("fedor@gtr.events") });
    const r = await resolveOrCreate(ns, {
      provider: "google",
      subject: "g-2",
      label: "fedor@gtr.events",
      email: "fedor@gtr.events",
      emailVerified: false,
    });
    expect(r.linked).toBe(false);
    expect(r.created).toBe(true);
    expect(r.user.email).not.toBe("fedor@gtr.events");
    expect(isSyntheticEmail(r.user.email)).toBe(true);
  });

  it("совпадение имени доказательством не считается", async () => {
    const ns = memNs({ "user:fedor@gtr.events": account("fedor@gtr.events", { name: "Фёдор" }) });
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "9", label: "@f", name: "Фёдор" });
    expect(r.user.email).not.toBe("fedor@gtr.events");
  });

  it("телефон, уже привязанный к аккаунту, ведёт туда же", async () => {
    const ns = memNs();
    const first = await resolveOrCreate(ns, {
      provider: "phone",
      subject: "+66812345678",
      label: "+668···678",
      phone: "+66812345678",
    });
    // Другой subject, тот же номер: так будет, если однажды сменится
    // формат идентификатора у входа.
    const again = await resolveOrCreate(ns, {
      provider: "google",
      subject: "g-3",
      label: "x",
      phone: "+66812345678",
    });
    expect(again.user.email).toBe(first.user.email);
    expect(again.linked).toBe(true);
  });

  it("новый аккаунт — всегда посетитель", async () => {
    // Иначе вход через Google стал бы лазейкой мимо одобрения ролей.
    const ns = memNs();
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "1", label: "@x" });
    expect(r.user.role).toBe("visitor");
  });

  it("у аккаунта без пароля хэш всё равно есть и он случайный", async () => {
    // Пустой хэш рано или поздно совпадёт с пустым вводом.
    const ns = memNs();
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "2", label: "@y" });
    expect(r.user.passHash).toMatch(/^pbkdf2\$/);
  });

  it("осиротевший индекс не ломает вход", async () => {
    // Индекс пережил аккаунт — такое бывает после ручной правки базы.
    // Человек должен войти, а не упереться в пустой экран.
    const ns = memNs({ "ident:tg:404": "user-which-is-gone@x.y" });
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "404", label: "@z" });
    expect(r.created).toBe(true);
  });
});

describe("отвязка входа", () => {
  it("последнюю дверь отвязать нельзя", async () => {
    // Иначе человек запирает себя снаружи и узнаёт об этом в следующий
    // раз, когда уже не сможет войти и не поймёт почему.
    const ns = memNs();
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "77", label: "@one" });
    // У соцаккаунта пароля по смыслу нет: хэш случайный и никому не известен.
    const raw = JSON.parse((await ns.get(`user:${r.user.email}`))!) as Record<string, unknown>;
    delete raw.passHash;
    await ns.put(`user:${r.user.email}`, JSON.stringify(raw));
    const res = await unlinkIdentity(ns, r.user.email, "tg", "77");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("единственный способ входа");
  });

  it("одну из двух дверей отвязать можно, и индекс уходит вместе с ней", async () => {
    const ns = memNs();
    const r = await resolveOrCreate(ns, { provider: "tg", subject: "88", label: "@two" });
    await linkIdentity(ns, r.user.email, "google", "g-9", "two@ya.ru");
    const res = await unlinkIdentity(ns, r.user.email, "google", "g-9");
    expect(res.ok).toBe(true);
    expect(await ns.get("ident:google:g-9")).toBeNull();
    expect(await ns.get("ident:tg:88")).toBe(r.user.email);
  });
});

describe("сессия", () => {
  it("служебные поля в куку не едут", async () => {
    // Кука уходит в браузер и живёт неделю: хэшу пароля, номеру телефона
    // и списку привязок там делать нечего.
    const ns = memNs();
    const r = await resolveOrCreate(ns, {
      provider: "phone",
      subject: "+66800000000",
      label: "+668···000",
      phone: "+66800000000",
    });
    const s = sessionOf(r.user) as Record<string, unknown>;
    for (const k of ["passHash", "phone", "identities", "created", "invitedBy", "emailSynthetic"])
      expect(s[k], k).toBeUndefined();
    expect(s.role).toBe("visitor");
  });
});
