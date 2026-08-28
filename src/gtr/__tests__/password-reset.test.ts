// Возврат доступа: пароль восстановить нельзя, можно только выдать новый.
//
// 28.08.2026 член команды не смог войти по своим логину и паролю, и
// оказалось, что продукту нечем ответить: пароля нет нигде (только
// PBKDF2-хэш с личной солью — из него исходник не достать), кнопки
// «задать новый» не было, а счётчик исходов входа писался в KV и не
// показывался никому. Снаружи «пароль не тот», «почта не та» и «упёрся
// в защиту от перебора» выглядели одинаково — «не заходит».
//
// Тест держит три вещи: пароль по-прежнему невосстановим, сброс есть и
// закрыт правами, а исходы входов видны.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../auth";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const kvApi = read("kv-api.ts");
const abuse = read("abuse.ts");
const misc = read("screens/Misc.tsx");

/** Тело функции от её начала до следующего экспорта верхнего уровня. */
const bodyOf = (src: string, start: string) => {
  const from = src.indexOf(start);
  expect(from, `не нашёл ${start}`).toBeGreaterThan(-1);
  const rest = src.slice(from + start.length);
  const end = rest.indexOf("\nexport ");
  return rest.slice(0, end === -1 ? undefined : end);
};

describe("хранение пароля", () => {
  it("один и тот же пароль даёт разные хэши", async () => {
    // Своя соль на каждую запись: одинаковые пароли двух людей не должны
    // выглядеть одинаково в базе.
    const a = await hashPassword("одинаковый-пароль");
    const b = await hashPassword("одинаковый-пароль");
    expect(a).not.toBe(b);
    expect(a.startsWith("pbkdf2$")).toBe(true);
  });

  it("хэш не содержит самого пароля — «напомнить» невозможно", async () => {
    const stored = await hashPassword("kata-beach-2026");
    expect(stored).not.toContain("kata");
    expect(await verifyPassword("kata-beach-2026", stored)).toBe(true);
    expect(await verifyPassword("kata-beach-2025", stored)).toBe(false);
  });

  it("легаси-формат без соли всё ещё пускает владельца", async () => {
    // Записи, заведённые до перехода на PBKDF2: голый sha256. Сломать им
    // вход переходом нельзя — перехэш идёт после успешной проверки.
    const legacy = "d1afdc8a7155abb9c52f8ef746699c5e0648b5c8c1b30e2ac7360ae4c913dcda";
    expect(await verifyPassword("gtr2026", legacy)).toBe(true);
  });
});

describe("сброс пароля", () => {
  const fn = bodyOf(kvApi, "export const setUserPasswordFn");

  it("только GTR-админ", () => {
    expect(fn).toContain('me?.role !== "gtr"');
  });

  it("несуществующий аккаунт не «чинится» новым паролем", () => {
    // Если записи нет, дело не в пароле: нужно приглашение. Молча создать
    // аккаунт здесь — значит развести две двери заведения доступа.
    expect(fn).toContain("if (!stored)");
    expect(fn).toContain("нужно приглашение");
  });

  it("пишется хэш, а не пароль", () => {
    expect(fn).toContain("stored.passHash = await hashPassword(data.password)");
    expect(fn).not.toMatch(/passHash\s*=\s*data\.password/);
  });

  it("снимает защиту от перебора, в которую человек уже упёрся", () => {
    // Иначе новый пароль первые пять минут отвечает «слишком много
    // попыток» — и выглядит это как «пароль опять не тот».
    expect(fn).toContain('clearLimit("login-acc", email, LIMITS.login, ns)');
    expect(abuse).toContain("export const clearLimit");
    // Окно фиксированное: попытки лежат в текущем слоте и предыдущем.
    expect(abuse).toContain("slot - 1");
  });
});

describe("диагностика входов", () => {
  it("исходы за неделю отдаются только GTR-админу", () => {
    const fn = bodyOf(kvApi, "export const loginStatsFn");
    expect(fn).toContain('me?.role !== "gtr"');
    expect(fn).toContain("loginstat:");
  });

  it("счётчик по-прежнему не хранит ни почты, ни пароля", () => {
    const auth = read("auth.ts");
    const counter = auth.slice(auth.indexOf("const countLogin"), auth.indexOf("const loginCore"));
    expect(counter).not.toContain("email");
    expect(counter).not.toContain("password");
  });

  it("экран различает пять исходов, а не показывает одно «не заходит»", () => {
    for (const k of ["ok-", "badpass", "nouser", "rate", "nostore"])
      expect(misc.includes(`startsWith("${k}")`), `нет разбора исхода ${k}`).toBe(true);
  });

  it("пропавшее хранилище не выдаётся за неверный пароль", () => {
    // Прод однажды уехал без биндинга GTR_KV. Шаг с личными аккаунтами
    // тогда просто пропускается, и каждый живой человек слышит «неверный
    // пароль» — перебирает буквы, пока чинить надо деплой.
    const auth = read("auth.ts");
    expect(auth).toContain("const noStore = !user && !ns");
    expect(auth).toContain("дело не в вашем пароле");
    // Перечисления аккаунтов это не даёт: условие про базу целиком.
    expect(auth).not.toMatch(/noStore\s*=\s*!stored/);
  });
});

describe("выдача пароля админом", () => {
  it("пароль генерится криптостойко и без похожих знаков", () => {
    // Его диктуют голосом и переписывают от руки: 0/O и 1/l/I стоят
    // потерянного вечера. Math.random для пароля — не источник.
    const gen = misc.slice(misc.indexOf("const newPassword"), misc.indexOf("function LoginStats"));
    expect(gen).toContain("crypto.getRandomValues");
    expect(gen).not.toContain("Math.random");
    expect(gen).not.toMatch(/const abc = "[^"]*[01ilO][^"]*"/);
  });

  it("новый пароль показывается админу один раз — передать человеку", () => {
    expect(misc).toContain("Новый пароль для ${u.email}");
  });
});
