// Увольнение: человек уходит целиком, а не наполовину.
//
// «Удалить работника» раньше означало стереть одну карточку
// user:<email>. Всё остальное оставалось жить, и последствия были хуже,
// чем кажется.
//
// Главное: привязка Telegram двусторонняя — tg:<email> и tgrev:<chatId>.
// Бот опознаёт человека по второй и карточку не требовал: не нашёл —
// возвращал объект с одним email. А роль в таком объекте пустая, и
// проверка «служебный ли это человек», устроенная как «любой, кто не
// артист», отвечала «да». Уволенный продолжал смотреть заявки и события
// командными командами бота.
//
// Это не теория, а то, что проверяется ниже построчно: такие вещи
// обнаруживаются не в интерфейсе, а в момент, когда кто-то решает
// проверить, остался ли доступ.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { purgeAccount } from "../identity";
import type { KvNs } from "../kv-ns";

const memNs = (seed: Record<string, string> = {}): KvNs & { keys: () => string[] } => {
  const m = new Map(Object.entries(seed));
  return {
    keys: () => [...m.keys()],
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix = "" } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
};

/** Уволенный сотрудник со всем, что успело на нём завестись. */
const firedEmployee = () =>
  memNs({
    "user:fired@gtr.events": JSON.stringify({
      email: "fired@gtr.events",
      name: "Бывший Сотрудников",
      role: "sales",
      roleLabel: "Event-продажи",
      venueId: "VEN-0033",
      initials: "БС",
      passHash: "pbkdf2$1$aa$bb",
      created: 1,
      invitedBy: "admin@gtr.events",
      phone: "+66812345678",
      identities: [
        { provider: "tg", subject: "555001", label: "@fired", at: 1 },
        { provider: "google", subject: "g-777", label: "fired@gmail.com", at: 1 },
        { provider: "phone", subject: "+66812345678", label: "+668···678", at: 1 },
      ],
    }),
    "tg:fired@gtr.events": "555001",
    "tgrev:555001": "fired@gtr.events",
    "ident:tg:555001": "fired@gtr.events",
    "ident:google:g-777": "fired@gtr.events",
    "ident:phone:+66812345678": "fired@gtr.events",
    "phoneidx:+66812345678": "fired@gtr.events",
    "push:fired@gtr.events": '{"endpoint":"https://push.example/x"}',
    "pushfeed:fired@gtr.events": "[]",
    "mprofile:fired@gtr.events": '{"genres":["house"]}',
    "invitemsg:fired@gtr.events": "добро пожаловать",
    // чужие записи — их трогать нельзя
    "user:boss@gtr.events": '{"email":"boss@gtr.events"}',
    "tgrev:999": "boss@gtr.events",
    "ident:tg:999": "boss@gtr.events",
  });

describe("увольнение снимает всё, что держит человека", () => {
  it("карточка аккаунта уходит", async () => {
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    expect(await ns.get("user:fired@gtr.events")).toBeNull();
  });

  it("привязка Telegram снимается в обе стороны", async () => {
    // Прямая — чтобы ему перестали писать. Обратная — чтобы бот
    // перестал его узнавать. Без второй он остаётся в боте как свой.
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    expect(await ns.get("tg:fired@gtr.events")).toBeNull();
    expect(await ns.get("tgrev:555001")).toBeNull();
  });

  it("все двери входа закрываются", async () => {
    // Telegram, Google и телефон — каждый вход это отдельный индекс.
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    for (const k of ["ident:tg:555001", "ident:google:g-777", "ident:phone:+66812345678"])
      expect(await ns.get(k), k).toBeNull();
    expect(await ns.get("phoneidx:+66812345678")).toBeNull();
  });

  it("уведомления перестают приходить", async () => {
    // Человек уволился, а push команды продолжал падать ему на телефон.
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    expect(await ns.get("push:fired@gtr.events")).toBeNull();
    expect(await ns.get("pushfeed:fired@gtr.events")).toBeNull();
  });

  it("личные хвосты не остаются", async () => {
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    for (const k of ["mprofile:fired@gtr.events", "invitemsg:fired@gtr.events"])
      expect(await ns.get(k), k).toBeNull();
  });

  it("чужие записи не трогает", async () => {
    // Удаление по подстроке email — классический способ снести соседа.
    const ns = firedEmployee();
    await purgeAccount(ns, "fired@gtr.events");
    expect(await ns.get("user:boss@gtr.events")).not.toBeNull();
    expect(await ns.get("tgrev:999")).toBe("boss@gtr.events");
    expect(await ns.get("ident:tg:999")).toBe("boss@gtr.events");
  });

  it("регистр адреса не мешает", async () => {
    const ns = firedEmployee();
    await purgeAccount(ns, "  FIRED@GTR.Events  ");
    expect(await ns.get("user:fired@gtr.events")).toBeNull();
    expect(await ns.get("tgrev:555001")).toBeNull();
  });

  it("отчитывается, что именно сняла", async () => {
    // Удаление человека — операция, которую надо уметь предъявить.
    const ns = firedEmployee();
    const { removed } = await purgeAccount(ns, "fired@gtr.events");
    expect(removed).toContain("user:fired@gtr.events");
    expect(removed).toContain("tgrev:555001");
    expect(removed.length).toBeGreaterThan(8);
  });

  it("аккаунт без привязок удаляется без падения", async () => {
    const ns = memNs({ "user:plain@gtr.events": '{"email":"plain@gtr.events"}' });
    await expect(purgeAccount(ns, "plain@gtr.events")).resolves.toBeTruthy();
    expect(await ns.get("user:plain@gtr.events")).toBeNull();
  });
});

describe("бот не пускает уволенного", () => {
  const tg = readFileSync(join(__dirname, "..", "..", "routes", "api.tg.ts"), "utf8");

  it("нет карточки — нет человека", () => {
    // Прямая улика прошлой дыры: фолбэк «?? { email }» отдавал объект без
    // роли, и проверка на служебность его пропускала.
    expect(tg).not.toContain("?? { email }");
    expect(tg).toContain("if (acc) return acc;");
  });

  it("осиротевшая привязка снимается на месте", () => {
    // Иначе она находится при каждом сообщении и живёт вечно.
    const i = tg.indexOf("async function userOfChat");
    const body = tg.slice(i, i + 700);
    expect(body).toContain("await ns.delete(`tgrev:${chatId}`)");
  });

  it("служебные роли перечислены поимённо, а не «все кроме артиста»", () => {
    // «Все, кроме артиста» означало, что каждая новая роль автоматически
    // становится служебной: посетитель и площадка так и получили доступ
    // к командным командам бота.
    expect(tg).toContain("STAFF_ROLES");
    expect(tg).not.toContain('u.role !== "artist"');
    for (const r of ["gtr", "pr", "owner", "sales", "organizer"])
      expect(tg, r).toContain(`"${r}"`);
  });

  it("посетителя и площадки в служебных нет", () => {
    const i = tg.indexOf("const STAFF_ROLES");
    const line = tg.slice(i, tg.indexOf("\n", i));
    expect(line).not.toContain("visitor");
    expect(line).not.toContain("venue");
    expect(line).not.toContain("artist");
  });
});

describe("удаление из кабинета", () => {
  const api = readFileSync(join(__dirname, "..", "kv-api.ts"), "utf8");
  const fn = api.slice(api.indexOf("export const deleteUserFn"), api.indexOf("export const listManagersFn"));

  it("доступно только GTR-админу", () => {
    expect(fn).toContain('me?.role !== "gtr"');
  });

  it("админ не может удалить себя", () => {
    // Оставшись с живой кукой, он потерял бы доступ молча — в момент,
    // когда вернуть его уже нечем.
    expect(fn).toContain("Нельзя удалить собственный аккаунт");
  });

  it("зовёт полное удаление, а не стирает одну карточку", () => {
    expect(fn).toContain("purgeAccount");
    expect(fn).not.toMatch(/ns\.delete\(`user:\$\{[^}]+\}`\)/);
  });

  it("отказ называет причину", () => {
    // Молчаливый { ok: false } на экране выглядит как «кнопка не
    // нажимается», и человек жмёт её ещё десять раз.
    expect(fn).toContain('error: "Хранилище недоступно"');
    expect(fn).toContain('error: "Нет прав"');
  });
});

// Причину с сервера надо ещё и показать. Ровно здесь она терялась:
// кнопка звала удаление и обновляла список, а ответ выбрасывала.
describe("кнопка «Удалить» в панели команды", () => {
  const src = readFileSync(join(__dirname, "..", "screens", "Misc.tsx"), "utf8");
  const fn = src.slice(src.indexOf("const removeUser"), src.indexOf("const artHits"));

  it("удаление не проходит без подтверждения", () => {
    // Необратимое действие рядом с кнопкой «Новый пароль»: промах пальцем
    // по телефону не должен стирать человека из команды.
    expect(fn).toMatch(/if \(!confirm\(/);
    expect(fn).toMatch(/\)\) return;/);
  });

  it("показывает и успех, и отказ", () => {
    expect(fn).toContain("setMsg");
    expect(fn).toContain("r.ok");
    expect(fn).toContain("r.error");
    expect(fn).toContain("Сервер недоступен");
  });

  it("не выбрасывает ответ сервера", () => {
    // Прежний вид — deleteUserFn(...).then(refresh) — молчал обо всём:
    // и об отказе, и об упавшем хранилище.
    expect(src).not.toMatch(/deleteUserFn\([^)]*\)\s*\.then\(refresh\)/);
    expect(fn).toContain("await deleteUserFn");
  });

  it("обновляет список после удаления", () => {
    expect(fn).toContain("refresh()");
  });

  it("кнопка заперта на время запроса", () => {
    // Двойной тап по медленной сети отправлял удаление дважды.
    const btn = src.slice(src.indexOf("onClick={() => removeUser(u)}") - 400, src.indexOf("onClick={() => removeUser(u)}"));
    expect(btn).toContain("disabled={busy}");
  });
});
