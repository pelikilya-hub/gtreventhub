// Двери входа: подписи, коды, обмен с Google.
//
// Всё, что здесь проверяется, — это места, где ошибка означает не
// «неудобно», а «вошёл кто угодно». Подпись Telegram, срок её годности,
// aud у токена Google, перебор кода по смс. Такие вещи глазами не
// проверишь: неверная проверка выглядит ровно так же, как верная, пока
// её не попробует обойти живой человек.
import { describe, expect, it, vi } from "vitest";

import {
  hashOtp,
  newOtp,
  newSalt,
  otpKey,
  OTP_TRIES,
  verifyOtp,
  type OtpRecord,
} from "../auth-phone";
import { parseIdToken } from "../auth-google";
import {
  checkMiniApp,
  checkWidget,
  dataCheckString,
  newLoginCode,
  timingSafeEqual,
  tgLabel,
} from "../auth-telegram";
import type { KvNs } from "../kv-ns";

const BOT = "123456:AAHtestTOKENnotreal";
const enc = new TextEncoder();

const hexOf = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

const hmac = async (key: ArrayBuffer | Uint8Array, msg: string) => {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
};

/** Подписываем данные так же, как это делает Telegram, — иначе тест
 *  проверял бы нашу же ошибку против неё самой. */
const signWidget = async (fields: Record<string, string>) => {
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(BOT));
  return hexOf(await hmac(secret, dataCheckString(fields)));
};

const memNs = (seed: Record<string, string> = {}): KvNs => {
  const m = new Map(Object.entries(seed));
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix = "" } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
};

describe("подпись Telegram", () => {
  const now = 1_800_000_000_000;
  const base = { id: "555", first_name: "Фёдор", username: "fedor", auth_date: String(now / 1000) };

  it("настоящая подпись проходит", async () => {
    const fields = { ...base, hash: await signWidget(base) };
    const r = await checkWidget(fields, BOT, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(555);
  });

  it("подделка не проходит", async () => {
    const r = await checkWidget({ ...base, hash: "00".repeat(32) }, BOT, now);
    expect(r.ok).toBe(false);
  });

  it("подменённое поле ломает подпись", async () => {
    // Подписали одно, прислали другое: классическая попытка войти под
    // чужим id, оставив чужую же подпись.
    const fields = { ...base, hash: await signWidget(base) };
    const r = await checkWidget({ ...fields, id: "556" }, BOT, now);
    expect(r.ok).toBe(false);
  });

  it("старая подпись не работает вечно", async () => {
    // Подпись остаётся верной всегда; без проверки срока перехваченная
    // ссылка входа пускала бы в кабинет и через год.
    const fields = { ...base, hash: await signWidget(base) };
    const r = await checkWidget(fields, BOT, now + 3600_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("устарела");
  });

  it("без токена бота дверь честно говорит, что не настроена", async () => {
    const r = await checkWidget({ ...base, hash: "x" }, "", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("не настроен");
  });

  it("у Mini App ключ выводится иначе, чем у виджета", async () => {
    // Порядок аргументов здесь обратный привычному: ключом идёт слово
    // WebAppData, сообщением — токен. Перепутать их значит получить
    // проверку, которая не пропускает никого.
    const user = JSON.stringify({ id: 777, username: "mini" });
    const fields = { auth_date: String(now / 1000), user };
    const secret = await hmac(enc.encode("WebAppData"), BOT);
    const hash = hexOf(await hmac(secret, dataCheckString(fields)));
    const initData = new URLSearchParams({ ...fields, hash }).toString();
    const r = await checkMiniApp(initData, BOT, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(777);
    // Ключ виджета для Mini App не годится — и наоборот.
    const wrong = hexOf(
      await hmac(await crypto.subtle.digest("SHA-256", enc.encode(BOT)), dataCheckString(fields)),
    );
    const bad = new URLSearchParams({ ...fields, hash: wrong }).toString();
    expect((await checkMiniApp(bad, BOT, now)).ok).toBe(false);
  });

  it("сама подпись в строку проверки не входит", () => {
    const s = dataCheckString({ b: "2", a: "1", hash: "zzz" });
    expect(s).toBe("a=1\nb=2");
  });

  it("сравнение подписей идёт до конца при любом входе", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("вход подписывается chat_id, а подписью показывается ник", () => {
    // Ник меняется в два касания и может достаться другому человеку —
    // привязывать к нему аккаунт нельзя, показывать можно.
    expect(tgLabel({ id: 1, username: "lutang" })).toBe("@lutang");
    expect(tgLabel({ id: 1, first_name: "Фёдор" })).toBe("Фёдор");
    expect(tgLabel({ id: 42 })).toBe("id 42");
  });

  it("в коде входа нет знаков, которые путают при чтении", () => {
    // Код читают с экрана и диктуют вслух: 0/O и 1/l там неразличимы.
    for (let i = 0; i < 20; i++) expect(newLoginCode()).not.toMatch(/[01lo]/i);
    expect(newLoginCode()).not.toBe(newLoginCode());
  });
});

describe("код на телефон", () => {
  const seed = async (tries = 0, code = "123456", exp = Date.now() + 60_000) => {
    const salt = newSalt();
    const rec: OtpRecord = { hash: await hashOtp(code, salt), salt, exp, tries, via: "SMS" };
    return memNs({ [otpKey("+66800000000")]: JSON.stringify(rec) });
  };

  it("верный код проходит и сгорает", async () => {
    // Одноразовость важнее удобства: иначе перехваченный код работает
    // до конца своего срока.
    const ns = await seed();
    expect((await verifyOtp(ns, "+66800000000", "123456")).ok).toBe(true);
    expect((await verifyOtp(ns, "+66800000000", "123456")).ok).toBe(false);
  });

  it("неверный код тратит попытку и говорит, сколько осталось", async () => {
    const ns = await seed();
    const r = await verifyOtp(ns, "+66800000000", "000000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.left).toBe(OTP_TRIES - 1);
  });

  it("перебор сжигает код целиком", async () => {
    // Без этого перебор просто продолжился бы: код-то остался прежним.
    const ns = await seed(OTP_TRIES - 1);
    const r = await verifyOtp(ns, "+66800000000", "999999");
    expect(r.ok).toBe(false);
    expect(await ns.get(otpKey("+66800000000"))).toBeNull();
  });

  it("истёкший код не принимается", async () => {
    const ns = await seed(0, "123456", Date.now() - 1000);
    const r = await verifyOtp(ns, "+66800000000", "123456");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("истёк");
  });

  it("код, который не запрашивали, — не ошибка ввода", async () => {
    const r = await verifyOtp(memNs(), "+66800000000", "123456");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("не запрашивался");
  });

  it("в хранилище лежит хэш, а не сам код", async () => {
    // Биндинг KV видит весь воркер, а дампы бывают. Код в открытом
    // виде — это чужой вход на ближайшие пять минут.
    const salt = newSalt();
    const h = await hashOtp("123456", salt);
    expect(h).not.toContain("123456");
    expect(h).toHaveLength(64);
    // Соль на каждый код своя: иначе по хранилищу видно, у кого код тот же.
    expect(await hashOtp("123456", newSalt())).not.toBe(h);
  });

  it("код — шесть цифр без ведущего нуля", async () => {
    for (let i = 0; i < 50; i++) expect(newOtp()).toMatch(/^[1-9]\d{5}$/);
  });
});

describe("токен Google", () => {
  const AUD = "our-client-id.apps.googleusercontent.com";
  const now = 1_800_000_000_000;
  // Токен кодирует UTF-8, а не ASCII: имя «Кто-то» в btoa напрямую не
  // лезет. Кодируем как настоящий Google — иначе тест проверял бы
  // разбор данных, которых в жизни не бывает.
  const b64 = (o: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const token = (claims: Record<string, unknown>) => `x.${b64(claims)}.y`;
  const good = {
    aud: AUD,
    iss: "https://accounts.google.com",
    sub: "1122",
    exp: now / 1000 + 600,
    email: "kto@gmail.com",
    email_verified: true,
    name: "Кто-то",
  };

  it("нормальный токен разбирается", () => {
    const r = parseIdToken(token(good), AUD, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.sub).toBe("1122");
      expect(r.profile.emailVerified).toBe(true);
    }
  });

  it("токен, выписанный другому приложению, отвергается", () => {
    // Без этой проверки любой со своим проектом в Google вошёл бы к нам
    // под чужим sub — своим же токеном от своего приложения.
    const r = parseIdToken(token({ ...good, aud: "someone-else" }), AUD, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("не нам");
  });

  it("просроченный токен отвергается", () => {
    const r = parseIdToken(token({ ...good, exp: now / 1000 - 10 }), AUD, now);
    expect(r.ok).toBe(false);
  });

  it("чужой издатель отвергается", () => {
    const r = parseIdToken(token({ ...good, iss: "https://evil.example" }), AUD, now);
    expect(r.ok).toBe(false);
  });

  it("email_verified строкой считается подтверждением, всё прочее — нет", () => {
    // Google отдаёт это поле то булевым, то строкой. Ошибиться тут
    // значит связать аккаунт по непроверенному адресу.
    const asString = parseIdToken(token({ ...good, email_verified: "true" }), AUD, now);
    expect(asString.ok && asString.profile.emailVerified).toBe(true);
    const missing = parseIdToken(token({ ...good, email_verified: undefined }), AUD, now);
    expect(missing.ok && missing.profile.emailVerified).toBe(false);
    const falsey = parseIdToken(token({ ...good, email_verified: "false" }), AUD, now);
    expect(falsey.ok && falsey.profile.emailVerified).toBe(false);
  });

  it("имя не латиницей доезжает целым", () => {
    // atob отдаёт байты, а не текст: без декодера «Фёдор» приезжает
    // как «Ð¤Ñ‘Ð´Ð¾Ñ€», и человек видит кракозябры вместо своего имени.
    const r = parseIdToken(token({ ...good, name: "Фёдор Пеликиля" }), AUD, now);
    expect(r.ok && r.profile.name).toBe("Фёдор Пеликиля");
  });

  it("мусор вместо токена не роняет вход", () => {
    for (const bad of ["", "не.токен", "a.b", "a.!!!.c"])
      expect(parseIdToken(bad, AUD, now).ok, bad).toBe(false);
  });
});

describe("дверь без ключей", () => {
  it("не настроенный телефон честно говорит об этом, а не делает вид", async () => {
    // Соблазн «сделать вид, что код ушёл» тут особенно велик: экран
    // выглядит рабочим. И особенно вреден: человек ждёт смс, которой
    // никто не отправлял, и решает, что сломан телефон.
    vi.stubEnv("TG_GATEWAY_TOKEN", "");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    const { phoneConfigured, sendOtp } = await import("../auth-phone");
    expect(phoneConfigured()).toBe(false);
    const r = await sendOtp("+66800000000", "123456");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("не подключён");
    vi.unstubAllEnvs();
  });
});
