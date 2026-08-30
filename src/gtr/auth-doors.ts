// Двери входа: серверные функции, которыми пользуется интерфейс.
//
// Правила связывания живут в identity.ts, проверка подписей — в
// auth-telegram.ts, коды — в auth-phone.ts, обмен с Google — в
// auth-google.ts. Здесь только то, что нельзя вынести: лимиты,
// выдача сессии и разговор с интерфейсом.
//
// Общее правило на все двери: отказ должен называть причину. «Что-то
// пошло не так» на экране входа — это письмо в поддержку и потерянный
// человек, а причин тут ровно три вида: не настроено у нас, не сошлось
// у провайдера, слишком часто дёргают. Их и различаем.
import { createServerFn } from "@tanstack/react-start";

import { issueSession } from "./auth";
import { newOtp, newSalt, hashOtp, otpKey, OTP_TTL, phoneConfigured, sendOtp, verifyOtp } from "./auth-phone";
import {
  checkMiniApp,
  checkWidget,
  LOGIN_CODE_TTL,
  loginCodeKey,
  newLoginCode,
  tgLabel,
  type TgAuthUser,
} from "./auth-telegram";
import { googleConfigured } from "./auth-google";
import {
  displayLogin,
  linkIdentity,
  maskPhone,
  normPhone,
  resolveOrCreate,
  sessionOf,
  unlinkIdentity,
  type Identity,
  type StoredUserWithIdentities,
} from "./identity";
import { getKvNs, kvGetJson } from "./kv-ns";
import { tgConfigured, tgToken } from "./tg";

const NO_STORE = "Хранилище аккаунтов недоступно — мы уже чиним. Попробуйте через минуту.";

/** Какие двери реально работают. Кнопка, которая заведомо приведёт к
 *  ошибке, хуже отсутствующей: человек считает, что сломан продукт. */
export const authDoorsFn = createServerFn({ method: "GET" }).handler(async () => ({
  telegram: tgConfigured(),
  google: googleConfigured(),
  phone: phoneConfigured(),
}));

// ---------- Telegram: код-ссылка ----------

type LoginCode = { chatId?: number; user?: TgAuthUser; at: number };

/** Завести код и отдать ссылку на бота. */
export const tgLoginStartFn = createServerFn({ method: "POST" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { ok: false as const, error: NO_STORE };
  if (!tgConfigured()) return { ok: false as const, error: "Вход через Telegram не настроен" };
  const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
  if (await tooMany("tglogin", clientIp(), LIMITS.otpSend, ns))
    return { ok: false as const, error: TOO_MANY_MSG };
  const code = newLoginCode();
  await ns.put(loginCodeKey(code), JSON.stringify({ at: Date.now() } satisfies LoginCode), {
    expirationTtl: LOGIN_CODE_TTL,
  });
  const bot = (await ns.get("tg:bot")) || "Gtrcom1_bot";
  return {
    ok: true as const,
    code,
    url: `https://t.me/${bot}?start=login-${code}`,
    ttl: LOGIN_CODE_TTL,
  };
});

/** Заполнился ли код. Интерфейс спрашивает раз в пару секунд, пока
 *  человек ходит в Telegram и обратно. */
export const tgLoginPollFn = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: NO_STORE };
    const rec = await kvGetJson<LoginCode>(ns, loginCodeKey(String(data.code ?? "")));
    if (!rec) return { ok: false as const, waiting: false, error: "Код истёк — начните заново" };
    if (!rec.chatId || !rec.user) return { ok: false as const, waiting: true };
    // Код одноразовый: сжигаем до выдачи сессии, чтобы повторный опрос
    // тем же кодом не выдал вторую.
    await ns.delete(loginCodeKey(String(data.code)));
    const res = await enterByTelegram(rec.user);
    return res;
  });

/** Вход данными виджета или Mini App. */
export const tgWidgetLoginFn = createServerFn({ method: "POST" })
  .inputValidator((d: { fields?: Record<string, string>; initData?: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: NO_STORE };
    const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    if (await tooMany("tglogin", clientIp(), LIMITS.otpSend, ns))
      return { ok: false as const, error: TOO_MANY_MSG };
    const checked = data.initData
      ? await checkMiniApp(data.initData, tgToken())
      : await checkWidget(data.fields ?? {}, tgToken());
    if (!checked.ok) return { ok: false as const, error: checked.error };
    return enterByTelegram(checked.user);
  });

/** Общий хвост телеграм-входа: аккаунт, привязка чата, сессия. */
const enterByTelegram = async (u: TgAuthUser) => {
  const ns = await getKvNs();
  if (!ns) return { ok: false as const, error: NO_STORE };
  const subject = String(u.id);

  // Telegram у нас уже привязывают из кабинета: tgrev:<chatId> → email.
  // Эта привязка — доказательство не слабее нашего индекса: человек
  // прошёл её из уже открытой сессии. Признаём её и переносим в индекс,
  // иначе тот, кто привязал чат месяц назад, войдёт сегодня в пустой
  // новый аккаунт и решит, что мы потеряли его данные.
  const bound = await ns.get(`tgrev:${subject}`);
  if (bound) {
    const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${bound}`);
    if (acc) {
      await linkIdentity(ns, bound, "tg", subject, tgLabel(u));
      await issueSession(sessionOf(acc));
      return { ok: true as const, created: false, login: displayLogin(acc), name: acc.name };
    }
  }

  const { user, created } = await resolveOrCreate(ns, {
    provider: "tg",
    subject,
    label: tgLabel(u),
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username,
  });
  // Обратная привязка: уведомления бота теперь знают, кому писать.
  await ns.put(`tg:${user.email}`, subject);
  await ns.put(`tgrev:${subject}`, user.email);
  await issueSession(sessionOf(user));
  if (created) await announceNew(ns, user, "Telegram");
  return { ok: true as const, created, login: displayLogin(user), name: user.name };
};

// ---------- телефон ----------

export const phoneCodeFn = createServerFn({ method: "POST" })
  .inputValidator((d: { phone: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: NO_STORE };
    const e164 = normPhone(data.phone);
    if (!e164)
      return {
        ok: false as const,
        error: "Не разобрали номер. Тайский — как 0812345678, любой другой — с кодом страны через +.",
      };
    const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    // Два лимита сразу и оба нужны. По номеру — чтобы чужой телефон
    // нельзя было завалить сообщениями с нашего адреса. По адресу —
    // чтобы скрипт не перебирал номера подряд: каждая отправка стоит
    // денег, и счёт выставят нам.
    if (
      (await tooMany("otp-phone", e164, LIMITS.otpSend, ns)) ||
      (await tooMany("otp-ip", clientIp(), LIMITS.otpSendIp, ns))
    )
      return { ok: false as const, error: TOO_MANY_MSG };

    const code = newOtp();
    const salt = newSalt();
    const sent = await sendOtp(e164, code);
    // Пишем запись только после успешной отправки: иначе человек будет
    // вводить код, которого у него нет, а мы — считать его попытки.
    if (!sent.ok) return { ok: false as const, error: sent.error };
    await ns.put(
      otpKey(e164),
      JSON.stringify({
        hash: await hashOtp(code, salt),
        salt,
        exp: Date.now() + OTP_TTL * 1000,
        tries: 0,
        via: sent.via,
      }),
      { expirationTtl: OTP_TTL + 60 },
    );
    return { ok: true as const, phone: maskPhone(e164), via: sent.via, ttl: OTP_TTL };
  });

export const phoneVerifyFn = createServerFn({ method: "POST" })
  .inputValidator((d: { phone: string; code: string; name?: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: NO_STORE };
    const e164 = normPhone(data.phone);
    if (!e164) return { ok: false as const, error: "Не разобрали номер" };
    const { tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    if (await tooMany("otp-try", e164, LIMITS.otpTry, ns))
      return { ok: false as const, error: TOO_MANY_MSG };
    const v = await verifyOtp(ns, e164, String(data.code ?? ""));
    if (!v.ok)
      return {
        ok: false as const,
        error: v.left ? `${v.error}. Осталось попыток: ${v.left}` : v.error,
      };
    const { user, created } = await resolveOrCreate(ns, {
      provider: "phone",
      subject: e164,
      label: maskPhone(e164),
      name: data.name?.trim() || undefined,
      phone: e164,
    });
    await issueSession(sessionOf(user));
    if (created) await announceNew(ns, user, "телефон");
    return { ok: true as const, created, login: displayLogin(user), name: user.name };
  });

// ---------- профиль: как вы входите ----------

export const myIdentitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { currentUser } = await import("./auth");
  const me = await currentUser();
  const ns = await getKvNs();
  if (!me || !ns) return { items: [] as Identity[], hasPassword: false, login: "" };
  const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${me.email}`);
  if (!acc) return { items: [] as Identity[], hasPassword: false, login: me.email };
  return {
    items: acc.identities ?? [],
    // Демо-состав и старые записи входят паролем, привязок у них нет.
    hasPassword: Boolean(acc.passHash) && acc.invitedBy !== "tg" && acc.invitedBy !== "phone",
    login: displayLogin(acc),
    phone: acc.phone ? maskPhone(acc.phone) : "",
  };
});

export const unlinkIdentityFn = createServerFn({ method: "POST" })
  .inputValidator((d: { provider: Identity["provider"]; subject: string }) => d)
  .handler(async ({ data }) => {
    const { currentUser } = await import("./auth");
    const me = await currentUser();
    const ns = await getKvNs();
    if (!me || !ns) return { ok: false as const, error: NO_STORE };
    return unlinkIdentity(ns, me.email, data.provider, data.subject);
  });

// ---------- служебное ----------

/** Новый человек — строка в служебный контур. Та же метрика, что у
 *  обычной регистрации: иначе воронка перестанет сходиться, как только
 *  половина людей пойдёт через новые двери. */
const announceNew = async (
  ns: NonNullable<Awaited<ReturnType<typeof getKvNs>>>,
  user: StoredUserWithIdentities,
  door: string,
) => {
  try {
    const { bumpMetric } = await import("./community");
    await bumpMetric(ns, "reg");
    const { notifyBossTg } = await import("./kv-api");
    const { tgEsc } = await import("./tg");
    await notifyBossTg(
      ns,
      `🆕 <b>Регистрация в GTR Event</b>\n${tgEsc(user.name)} · вход через ${tgEsc(door)} · посетитель`,
    );
  } catch {
    /* уведомление не важнее входа */
  }
};
