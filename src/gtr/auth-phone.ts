// Вход по телефону: код из шести цифр.
//
// Телефон — единственная дверь, которая работает для человека без
// Telegram, без Google и без желания придумывать пароль. Для гостя,
// который стоит у входа в клуб и хочет забронировать стол, это разница
// между «сделал» и «закрыл вкладку».
//
// Отправлять код мы сами не умеем и не должны: это работа оператора.
// Поддерживаем два канала, и выбирается тот, чей ключ задан.
//
//   Telegram Gateway — код приходит сообщением в Telegram на номер.
//     Дешевле смс в разы и точно доедет: наша аудитория в Telegram уже
//     сидит. Не доедет только к тому, у кого Telegram нет.
//   Twilio — обычная смс, доходит куда угодно, стоит дороже.
//
// Ни один не настроен — говорим прямо: вход по телефону не работает.
// Соблазн «сделать вид, что код ушёл» здесь особенно велик — экран
// выглядит рабочим, ошибки нет, — и особенно вреден: человек будет
// ждать смс, которой никто не отправлял, и решит, что сломан телефон.
//
// Сам код мы не храним. В хранилище лежит его хэш с солью — тот же
// приём, что и с паролями. KV читает не только наш код: биндинг видит
// весь воркер, а дампы бывают. Код в открытом виде — это чужой вход в
// аккаунт на ближайшие пять минут.
import type { KvNs } from "./kv-ns";
import { kvGetJson } from "./kv-ns";

/** Пять минут: успеть переключиться в сообщения и вернуться. */
export const OTP_TTL = 300;
/** Пять попыток на код. Шестизначный код перебирается за миллион
 *  попыток, пять из них ничего не дают, а живому человеку хватает. */
export const OTP_TRIES = 5;

export type OtpRecord = {
  hash: string;
  salt: string;
  exp: number;
  tries: number;
  /** Куда ушёл код — только чтобы показать это человеку на экране. */
  via: string;
};

export const otpKey = (e164: string) => `phoneotp:${e164}`;

/** Шесть цифр. Первая не ноль — не ради стойкости, а чтобы код не терял
 *  цифру при копировании в поля, которые обрезают ведущие нули. */
export const newOtp = (): string => {
  const r = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(100000 + (r % 900000));
};

const enc = new TextEncoder();

const hexOf = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** Хэш кода. Соль на каждый код своя: без неё одинаковые коды у разных
 *  людей дают одинаковый хэш, и по хранилищу видно, у кого код тот же. */
export const hashOtp = async (code: string, salt: string): Promise<string> =>
  hexOf(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${code}`)));

export const newSalt = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

// ---------- отправка ----------

export type SendResult =
  | { ok: true; via: string }
  | { ok: false; error: string };

const gatewayToken = () =>
  (typeof process !== "undefined" && process.env?.TG_GATEWAY_TOKEN) || "";
const twilioSid = () =>
  (typeof process !== "undefined" && process.env?.TWILIO_ACCOUNT_SID) || "";
const twilioAuth = () =>
  (typeof process !== "undefined" && process.env?.TWILIO_AUTH_TOKEN) || "";
const twilioFrom = () =>
  (typeof process !== "undefined" && process.env?.TWILIO_FROM) || "";

/** Настроен ли вход по телефону вообще. Экран входа спрашивает это,
 *  чтобы не показывать кнопку, которая заведомо не сработает. */
export const phoneConfigured = (): boolean =>
  Boolean(gatewayToken() || (twilioSid() && twilioAuth() && twilioFrom()));

/** Отправить код. Канал выбирается по тому, чей ключ задан. */
export const sendOtp = async (e164: string, code: string): Promise<SendResult> => {
  if (gatewayToken()) {
    try {
      const r = await fetch("https://gatewayapi.telegram.org/sendVerificationMessage", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${gatewayToken()}`,
        },
        body: JSON.stringify({ phone_number: e164, code, ttl: OTP_TTL }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) return { ok: true, via: "Telegram" };
      // Провал одного канала — не повод молчать: скажем, что случилось,
      // и попробуем второй, если он есть.
      if (!twilioSid()) return { ok: false, error: `Telegram Gateway: ${j.error ?? "отказ"}` };
    } catch (e) {
      if (!twilioSid())
        return { ok: false, error: `Telegram Gateway недоступен: ${(e as Error).message}` };
    }
  }
  if (twilioSid() && twilioAuth() && twilioFrom()) {
    try {
      const body = new URLSearchParams({
        To: e164,
        From: twilioFrom(),
        Body: `GTR Event: код входа ${code}. Никому его не сообщайте.`,
      });
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid()}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${twilioSid()}:${twilioAuth()}`)}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (r.ok) return { ok: true, via: "SMS" };
      const t = await r.text().catch(() => "");
      return { ok: false, error: `SMS не отправлена (${r.status}) ${t.slice(0, 120)}` };
    } catch (e) {
      return { ok: false, error: `SMS-шлюз недоступен: ${(e as Error).message}` };
    }
  }
  return {
    ok: false,
    error: "Вход по телефону пока не подключён. Войдите через Telegram или почтой.",
  };
};

// ---------- проверка ----------

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string; left?: number };

/** Сверить код. Запись расходуется при любом исходе, кроме промаха с
 *  оставшимися попытками: иначе один код жил бы дольше своего срока. */
export const verifyOtp = async (
  ns: KvNs,
  e164: string,
  code: string,
): Promise<VerifyResult> => {
  const key = otpKey(e164);
  const rec = await kvGetJson<OtpRecord>(ns, key);
  if (!rec) return { ok: false, error: "Код не запрашивался или истёк — запросите новый" };
  if (rec.exp < Date.now()) {
    await ns.delete(key);
    return { ok: false, error: "Код истёк — запросите новый" };
  }
  const got = await hashOtp(String(code ?? "").trim(), rec.salt);
  if (got !== rec.hash) {
    const tries = rec.tries + 1;
    if (tries >= OTP_TRIES) {
      // Сжигаем код целиком: иначе перебор продолжится следующей
      // попыткой запроса, а код останется прежним.
      await ns.delete(key);
      return { ok: false, error: "Слишком много неверных попыток — запросите новый код", left: 0 };
    }
    await ns.put(key, JSON.stringify({ ...rec, tries }), {
      expirationTtl: Math.max(60, Math.ceil((rec.exp - Date.now()) / 1000)),
    });
    return { ok: false, error: "Код не совпал", left: OTP_TRIES - tries };
  }
  await ns.delete(key);
  return { ok: true };
};
