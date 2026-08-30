// Вход через Telegram.
//
// Это главная дверь для нашей аудитории: она уже в Telegram — там канал,
// чат, бот и половина переписки с площадками. Просить у такого человека
// придумать пароль — терять его на ровном месте.
//
// Telegram даёт два способа доказать, что человек тот, за кого себя
// выдаёт, и мы поддерживаем оба, потому что они закрывают разные случаи.
//
// Виджет входа (и Mini App) — Telegram сам подписывает данные о человеке
// ключом, производным от токена бота. Проверка целиком у нас, сеть не
// нужна, вход мгновенный. Но виджету нужен домен, прописанный в
// BotFather, и живой скрипт telegram.org на странице — то есть он
// работает не везде.
//
// Код-ссылка — работает всегда и без всяких настроек. Приложение заводит
// одноразовый код, открывает t.me/бот?start=login-код, человек жмёт
// «Запустить», бот получает его chat_id и записывает в код. Приложение
// тем временем спрашивает сервер, не заполнился ли код. Это тот же
// механизм, которым мы уже привязываем Telegram к кабинету, — здесь он
// работает дверью.
//
// Общее у обоих: доказательством считается chat_id, а не ник. Ник в
// Telegram меняется в два касания и может быть перехвачен тем, кто
// занял освободившийся, — привязывать к нему аккаунт нельзя.

/** Данные человека от Telegram. Одинаковы у виджета и у Mini App. */
export type TgAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date?: number;
};

const enc = new TextEncoder();

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

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Строка для подписи по правилам Telegram: все поля кроме hash, по
 *  алфавиту, «ключ=значение» через перевод строки. */
export const dataCheckString = (fields: Record<string, string>): string =>
  Object.keys(fields)
    .filter((k) => k !== "hash" && k !== "signature")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

/** Сравнение подписей за одинаковое время.
 *
 *  Обычное === на строках выходит из цикла на первом же несовпавшем
 *  символе, и по времени ответа подпись подбирается посимвольно. Здесь
 *  сравнение идёт до конца всегда. */
export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Свежесть подписи. Перехваченная ссылка виджета иначе работала бы
 *  вечно: подпись верна и через год. */
const FRESH_SEC = 900;

export type TgCheck =
  | { ok: true; user: TgAuthUser }
  | { ok: false; error: string };

/** Проверка данных виджета входа.
 *
 *  Ключ подписи — SHA-256 от токена бота. Значит, подделать данные может
 *  только тот, у кого есть токен, — то есть мы сами. */
export const checkWidget = async (
  fields: Record<string, string>,
  botToken: string,
  now = Date.now(),
): Promise<TgCheck> => {
  if (!botToken) return { ok: false, error: "Вход через Telegram не настроен" };
  const got = String(fields.hash ?? "");
  if (!got) return { ok: false, error: "Нет подписи Telegram" };
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const want = hex(await hmac(secret, dataCheckString(fields)));
  if (!timingSafeEqual(want, got.toLowerCase()))
    return { ok: false, error: "Подпись Telegram не сходится" };
  const authDate = Number(fields.auth_date ?? 0);
  if (!authDate || now / 1000 - authDate > FRESH_SEC)
    return { ok: false, error: "Ссылка входа устарела — нажмите кнопку ещё раз" };
  const id = Number(fields.id ?? 0);
  if (!id) return { ok: false, error: "Telegram не назвал пользователя" };
  return {
    ok: true,
    user: {
      id,
      first_name: fields.first_name,
      last_name: fields.last_name,
      username: fields.username,
      photo_url: fields.photo_url,
      auth_date: authDate,
    },
  };
};

/** Проверка initData из Mini App.
 *
 *  Ключ тот же по смыслу, но выводится иначе: HMAC от токена бота с
 *  ключом-словом «WebAppData». Порядок аргументов здесь обратный
 *  привычному — ключом выступает константа, сообщением токен, — и
 *  перепутать их значит получить проверку, которая не пропускает никого. */
export const checkMiniApp = async (
  initData: string,
  botToken: string,
  now = Date.now(),
): Promise<TgCheck> => {
  if (!botToken) return { ok: false, error: "Вход через Telegram не настроен" };
  const params = new URLSearchParams(initData);
  const fields: Record<string, string> = {};
  params.forEach((v, k) => (fields[k] = v));
  const got = String(fields.hash ?? "");
  if (!got) return { ok: false, error: "Нет подписи Telegram" };
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const want = hex(await hmac(secret, dataCheckString(fields)));
  if (!timingSafeEqual(want, got.toLowerCase()))
    return { ok: false, error: "Подпись Telegram не сходится" };
  const authDate = Number(fields.auth_date ?? 0);
  if (!authDate || now / 1000 - authDate > FRESH_SEC)
    return { ok: false, error: "Сессия Telegram устарела — откройте приложение заново" };
  let u: TgAuthUser;
  try {
    u = JSON.parse(fields.user ?? "{}") as TgAuthUser;
  } catch {
    return { ok: false, error: "Telegram прислал данные, которые мы не разобрали" };
  }
  if (!u?.id) return { ok: false, error: "Telegram не назвал пользователя" };
  return { ok: true, user: { ...u, auth_date: authDate } };
};

/** Как показать этот вход в профиле. Ник удобнее номера, но номер
 *  есть всегда, а ник — нет. */
export const tgLabel = (u: TgAuthUser): string =>
  u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(" ") || `id ${u.id}`;

// ---------- код-ссылка ----------

/** Одноразовый код входа. Живёт пять минут: этого хватает открыть
 *  Telegram и нажать «Запустить», но не хватает подобрать перебором. */
export const LOGIN_CODE_TTL = 300;

export const loginCodeKey = (code: string) => `tglogin:${code}`;

/** Код из букв и цифр без «похожих» знаков: его читают с экрана и
 *  диктуют вслух, а 0/O и 1/l в этот момент неразличимы. */
export const newLoginCode = (): string => {
  const abc = "23456789abcdefghjkmnpqrstuvwxyz";
  const r = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(r, (b) => abc[b % abc.length]).join("");
};
