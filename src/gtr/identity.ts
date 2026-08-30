// Личность: один человек — один аккаунт, сколько бы дверей мы ни открыли.
//
// До этого модуля вход был один: email и пароль, и аккаунт назывался
// своим email. Как только дверей становится несколько — Telegram, Google,
// телефон, — появляется вопрос, которого раньше не было: два входа одного
// человека должны привести в один кабинет, а не завести второй.
//
// Цена ошибки здесь несимметрична, и это определило все правила ниже.
// Не связали два входа — человек видит пустой кабинет и злится: неприятно,
// но чинится руками. Связали ошибочно — человек попал в чужой кабинет с
// чужими бронями и контактами. Второе непоправимо, поэтому связываем
// только по доказанному владению, а во всех сомнительных случаях заводим
// отдельный аккаунт.
//
// Что считается доказательством:
//   · этот же вход уже приводил сюда раньше (индекс ident:) — да;
//   · провайдер подтвердил email, и такой аккаунт у нас есть — да,
//     Google ручается за адрес, который сам же и проверил;
//   · провайдер отдал email, но не подтвердил его — нет. Иначе любой,
//     кто заведёт у себя почтовый ящик с чужим адресом, войдёт в чужой
//     кабинет;
//   · совпало имя, ник или что-то похожее — нет и близко.
//
// Ключ аккаунта остался прежним: user:<email>. Это не изящно — у входа
// по телефону и у половины телеграм-аккаунтов почты нет вовсе, — но
// email как первичный ключ пронизывает весь продукт: задачи, брони,
// предложения артистам, привязку Telegram. Менять его сейчас значило бы
// переписать всё разом и рискнуть бронями. Поэтому аккаунтам без почты
// выдаётся служебный адрес в зоне, которой не существует, и интерфейс
// такой адрес не показывает никогда.
import { hashPassword, type StoredUser } from "./auth";
import type { KvNs } from "./kv-ns";
import { kvGetJson } from "./kv-ns";

/** Двери, через которые входят. `password` — историческая, остальные новые. */
export type IdentityProvider = "password" | "tg" | "google" | "phone";

/** Запись о входе в карточке аккаунта: чем человек пользуется. */
export type Identity = {
  provider: IdentityProvider;
  /** Идентификатор у провайдера: chatId, google sub, номер в E.164. */
  subject: string;
  /** Что показать человеку: @ник, адрес почты, номер. */
  label: string;
  at: number;
};

/** Аккаунт с привязками. Поле необязательное: у записей, заведённых до
 *  этого модуля, его нет, и это нормально — они входят паролем. */
export type StoredUserWithIdentities = StoredUser & {
  identities?: Identity[];
  phone?: string;
  /** Адрес выдан нами, а не человеком: показывать его нельзя. */
  emailSynthetic?: boolean;
};

/** Зона, которой не существует ни в одном реестре. Служебный адрес по
 *  ошибке никуда не уйдёт: письмо в неё не доставится в принципе. */
const SYNTH_DOMAIN = "id.gtrevent.invalid";

export const syntheticEmail = (provider: IdentityProvider, subject: string) =>
  `${provider}-${subject.toLowerCase().replace(/[^a-z0-9]+/g, "")}@${SYNTH_DOMAIN}`;

export const isSyntheticEmail = (email: string) => email.endsWith(`@${SYNTH_DOMAIN}`);

/** Как называть человека на экране. Служебный адрес не показываем: он
 *  выглядит как ошибка системы и подрывает доверие ровно в тот момент,
 *  когда человек только что вошёл. */
export const displayLogin = (u: {
  email: string;
  phone?: string;
  identities?: Identity[];
}): string => {
  if (!isSyntheticEmail(u.email)) return u.email;
  const tg = u.identities?.find((i) => i.provider === "tg");
  if (tg?.label) return tg.label;
  if (u.phone) return u.phone;
  return u.identities?.[0]?.label ?? "";
};

// ---------- телефон ----------

/** Код страны по умолчанию: продукт живёт в Таиланде, и здешние номера
 *  пишут как 08x без кода. Всё остальное просим вводить с плюсом —
 *  угадывать страну по длине значит рано или поздно увести код на чужой
 *  номер. */
const DEFAULT_CC = "66";

/** Номер в E.164 или null, если понять его нельзя.
 *
 *  Null здесь — не отказ, а просьба уточнить: интерфейс попросит ввести
 *  номер с кодом страны. Это честнее, чем догадка: смс с кодом входа,
 *  ушедшая не туда, — это чужой доступ к аккаунту. */
export const normPhone = (raw: string): string | null => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Международная запись: «+66…» и «0066…» — одно и то же.
  const intl = s.startsWith("+") ? s.slice(1) : s.startsWith("00") ? s.slice(2) : "";
  if (intl) {
    const d = intl.replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }
  const d = s.replace(/\D/g, "");
  // Местная запись: 0 и девять цифр — тайский мобильный.
  if (d.length === 10 && d.startsWith("0")) return `+${DEFAULT_CC}${d.slice(1)}`;
  return null;
};

/** Номер для показа: середина скрыта. Нужен там, где человек должен
 *  узнать свой номер, но соседу через плечо его видеть незачем. */
export const maskPhone = (e164: string) =>
  e164.length > 7 ? `${e164.slice(0, 4)}···${e164.slice(-3)}` : e164;

// ---------- индекс входов ----------

const identKey = (provider: IdentityProvider, subject: string) =>
  `ident:${provider}:${subject.toLowerCase()}`;

const phoneKey = (e164: string) => `phoneidx:${e164}`;

/** Кому принадлежит этот вход. Пусто — вход ещё ни к кому не привязан. */
export const accountByIdentity = async (
  ns: KvNs,
  provider: IdentityProvider,
  subject: string,
): Promise<string | null> => ns.get(identKey(provider, subject));

/** Привязать вход к аккаунту: индекс плюс запись в карточке.
 *
 *  Индекс и карточка пишутся раздельно, и между ними теоретически может
 *  порваться. Ведущим считаем индекс — по нему идёт вход; карточка нужна
 *  экрану «как вы входите». Разойдутся — человек войдёт, но не увидит
 *  привязку в профиле. Это худшее, что тут может случиться. */
export const linkIdentity = async (
  ns: KvNs,
  email: string,
  provider: IdentityProvider,
  subject: string,
  label: string,
): Promise<void> => {
  await ns.put(identKey(provider, subject), email);
  const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${email}`);
  if (!acc) return;
  const list = (acc.identities ?? []).filter(
    (i) => !(i.provider === provider && i.subject === subject),
  );
  list.push({ provider, subject, label, at: Date.now() });
  acc.identities = list;
  await ns.put(`user:${email}`, JSON.stringify(acc));
};

/** Отвязать вход.
 *
 *  Последнюю дверь отвязать нельзя. Человек, снявший единственный способ
 *  входа, потеряет аккаунт молча и заметит это в следующий раз — когда
 *  уже не войдёт и не поймёт почему. Пароль тоже считается дверью. */
export const unlinkIdentity = async (
  ns: KvNs,
  email: string,
  provider: IdentityProvider,
  subject: string,
): Promise<{ ok: boolean; error?: string }> => {
  const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${email}`);
  if (!acc) return { ok: false, error: "Аккаунт не найден" };
  const rest = (acc.identities ?? []).filter(
    (i) => !(i.provider === provider && i.subject === subject),
  );
  if (!rest.length && !acc.passHash)
    return { ok: false, error: "Это единственный способ входа — сначала добавьте другой" };
  acc.identities = rest;
  if (provider === "phone") delete acc.phone;
  await ns.put(`user:${email}`, JSON.stringify(acc));
  await ns.delete(identKey(provider, subject));
  if (provider === "phone") await ns.delete(phoneKey(subject));
  return { ok: true };
};

// ---------- вход через провайдера ----------

export type ProviderProfile = {
  provider: IdentityProvider;
  /** Идентификатор у провайдера — то, что не меняется при смене ника. */
  subject: string;
  /** Как показать вход человеку. */
  label: string;
  name?: string;
  /** Адрес от провайдера. Пусто — провайдер его не дал. */
  email?: string;
  /** Провайдер сам проверил владение адресом. Без этого связывать нельзя. */
  emailVerified?: boolean;
  phone?: string;
  avatar?: string;
};

export type ResolveResult = {
  user: StoredUserWithIdentities;
  /** Аккаунт только что заведён — интерфейсу есть что сказать новому человеку. */
  created: boolean;
  /** Вход привязан к аккаунту, который уже был. */
  linked: boolean;
};

const initialsOf = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "ГО";

/** Найти аккаунт по входу или завести новый.
 *
 *  Порядок проверок — это порядок убывания надёжности доказательства, и
 *  менять его нельзя: каждая следующая ступень слабее предыдущей.
 *
 *  Новый аккаунт получает роль посетителя. Так же работает и обычная
 *  регистрация: посетителем становятся сразу, а роль артиста, площадки
 *  или команды — это заявка, которую подтверждает основатель. Вход через
 *  Google не должен быть лазейкой мимо этого правила. */
export const resolveOrCreate = async (
  ns: KvNs,
  p: ProviderProfile,
): Promise<ResolveResult> => {
  const { ROLE_LABELS } = await import("./kv-api");

  // 1. Этот вход уже приводил сюда. Самое надёжное, что у нас есть.
  const known = await accountByIdentity(ns, p.provider, p.subject);
  if (known) {
    const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${known}`);
    if (acc) return { user: acc, created: false, linked: false };
    // Индекс пережил аккаунт — чиним молча и идём дальше как с новым.
    await ns.delete(identKey(p.provider, p.subject));
  }

  // 2. Провайдер поручился за адрес, и такой аккаунт у нас есть.
  //    Именно поручился: непроверенный адрес сюда не попадает.
  const email = p.email?.trim().toLowerCase();
  if (email && p.emailVerified) {
    const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${email}`);
    if (acc) {
      await linkIdentity(ns, email, p.provider, p.subject, p.label);
      const fresh = await kvGetJson<StoredUserWithIdentities>(ns, `user:${email}`);
      return { user: fresh ?? acc, created: false, linked: true };
    }
  }

  // 3. Телефон уже привязан к аккаунту — вход по нему ведёт туда же.
  if (p.phone) {
    const byPhone = await ns.get(phoneKey(p.phone));
    if (byPhone) {
      const acc = await kvGetJson<StoredUserWithIdentities>(ns, `user:${byPhone}`);
      if (acc) {
        await linkIdentity(ns, byPhone, p.provider, p.subject, p.label);
        const fresh = await kvGetJson<StoredUserWithIdentities>(ns, `user:${byPhone}`);
        return { user: fresh ?? acc, created: false, linked: true };
      }
    }
  }

  // 4. Нового человека заводим. Адрес берём настоящий, только если
  //    провайдер за него ручается и он свободен; иначе служебный.
  const free = email && p.emailVerified && !(await ns.get(`user:${email}`));
  const key = free ? email! : syntheticEmail(p.provider, p.subject);
  const name = p.name?.trim() || p.label || "Гость";
  const acc: StoredUserWithIdentities = {
    email: key,
    name,
    role: "visitor",
    roleLabel: ROLE_LABELS.visitor,
    venueId: "",
    initials: initialsOf(name),
    // Пароля у такого аккаунта нет вовсе. Пустая строка сюда не годится:
    // verifyPassword сравнивает с хэшем, и пустой хэш когда-нибудь
    // совпадёт с пустым вводом. Кладём случайный — подобрать его нельзя,
    // а войти можно той дверью, которой человек и пришёл.
    passHash: await hashPassword(crypto.randomUUID()),
    created: Date.now(),
    invitedBy: p.provider,
    emailSynthetic: !free,
    ...(p.phone ? { phone: p.phone } : {}),
  };
  await ns.put(`user:${key}`, JSON.stringify(acc));
  await linkIdentity(ns, key, p.provider, p.subject, p.label);
  if (p.phone) await ns.put(phoneKey(p.phone), key);
  const fresh = await kvGetJson<StoredUserWithIdentities>(ns, `user:${key}`);
  return { user: fresh ?? acc, created: true, linked: false };
};

/** Сессионные поля из карточки: служебное в куку не кладём. */
export const sessionOf = (u: StoredUserWithIdentities) => {
  const {
    passHash: _p,
    created: _c,
    invitedBy: _i,
    identities: _ids,
    emailSynthetic: _s,
    phone: _ph,
    ...session
  } = u;
  return session;
};
