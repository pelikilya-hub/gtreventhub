// Авторизация GTR Event: httpOnly-cookie сессия, подписанная HMAC-SHA256 (Web Crypto,
// работает и в Node, и в Cloudflare Workers). Пользователи — демо-состав MVP.
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import {
  getCookie,
  setCookie,
  deleteCookie,
} from "@tanstack/react-start/server";
import type { RoleId } from "./data/app-data";
import { getKvNs, kvGetJson } from "./kv-ns";

export type SessionUser = {
  email: string;
  name: string;
  role: RoleId;
  roleLabel: string;
  venueId: string; // пусто для GTR-админа (кросс-сетевой доступ)
  artistId?: string; // роль artist: карточка каталога (MC-…)
  teamOf?: string; // email тимлида-организатора, чью команду пополнил
  boss?: boolean; // BOSS: дашборд контроля поверх прав GTR-админа
  pro?: boolean; // участник Комьюнити PRO: открывает раздел Private (виллы)
  initials: string;
};

type DemoUser = SessionUser & { passHash: string };

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Пароли реальных аккаунтов: PBKDF2 с индивидуальной солью, а не голый
// sha256 (тот легко перебирается по радужным таблицам, если KV когда-либо
// утечёт). Формат: pbkdf2$итерации$соль$хэш. Старые записи, созданные до
// этого перехода, всё ещё голый sha256-хэш — verifyPassword понимает оба
// формата и молча перехэшируется в новый при следующем успешном входе.
const PBKDF2_ITER = 100_000;

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string) =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));

const pbkdf2 = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
};

export const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${hash}`;
};

export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<boolean> => {
  if (stored.startsWith("pbkdf2$")) {
    const [, iterStr, saltHex, hashHex] = stored.split("$");
    const iterations = Number(iterStr) || PBKDF2_ITER;
    return (await pbkdf2(password, fromHex(saltHex), iterations)) === hashHex;
  }
  return stored === (await sha256(password)); // легаси-формат
};

// Пароль демо-доступа: gtr2026 (подсказан на экране входа).
// На публичном стенде демо-пароль означает открытый доступ: он написан
// в самом интерфейсе. Поэтому если задан GTR_ACCESS_PASSWORD, вход идёт
// только по нему, а подсказки и кнопки быстрого входа гаснут.
const DEMO_PASS_HASH =
  "d1afdc8a7155abb9c52f8ef746699c5e0648b5c8c1b30e2ac7360ae4c913dcda";

const accessPassword = () =>
  (typeof process !== "undefined" && process.env?.GTR_ACCESS_PASSWORD) || "";

export const isDemoAccess = () => !accessPassword();

// Ожидаемый хэш: из переменной окружения либо демо-пароль для локальной работы
const expectedHash = async () => {
  const pw = accessPassword();
  return pw ? await sha256(pw) : DEMO_PASS_HASH;
};


const COOKIE = "gtr_session";
const WEEK = 60 * 60 * 24 * 7;

const secret = () =>
  (typeof process !== "undefined" && process.env?.GTR_SESSION_SECRET) ||
  "gtr-event-mvp-dev-secret-rotate-in-prod";

const b64url = (s: string) =>
  btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64url = (s: string) =>
  decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

const hmacKey = async () =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const sign = async (payload: string) => {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(payload),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const makeToken = async (user: SessionUser) => {
  const payload = b64url(
    JSON.stringify({ ...user, exp: Date.now() + WEEK * 1000 }),
  );
  return `${payload}.${await sign(payload)}`;
};

const readToken = async (
  token: string | undefined,
): Promise<SessionUser | null> => {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await sign(payload)) !== sig) return null;
  try {
    const data = JSON.parse(unb64url(payload)) as SessionUser & { exp: number };
    if (data.exp < Date.now()) return null;
    const { exp: _exp, ...user } = data;
    return user;
  } catch {
    return null;
  }
};

// Приглашённый пользователь в KV: сессионные поля + личный пароль
export type StoredUser = SessionUser & {
  passHash: string;
  created: number;
  invitedBy: string;
};

// Только сервер: в клиентском бандле вызов бросит ошибку
export const issueSession = createServerOnlyFn(async (sessionUser: SessionUser) => {
  setCookie(COOKIE, await makeToken(sessionUser), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: WEEK,
    secure: process.env.NODE_ENV === "production",
  });
});

// Счётчик исходов входа: без почт и паролей, только «что произошло».
// Нужен, чтобы отличать «человек ошибается паролем» от «запрос вообще
// не долетает» — снаружи эти случаи выглядят одинаково: «не заходит».
const countLogin = async (outcome: string) => {
  try {
    const ns = await getKvNs();
    if (!ns) return;
    const key = `loginstat:${new Date().toISOString().slice(0, 10)}`;
    const cur = ((await kvGetJson<Record<string, number>>(ns, key)) ?? {}) as Record<string, number>;
    cur[outcome] = (cur[outcome] ?? 0) + 1;
    await ns.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch {
    /* счётчик не важнее входа */
  }
};

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();

    // Перебор пароля — самая дешёвая атака на продукт с регистрацией.
    // Считаем попытки и по адресу, и по аккаунту: первый лимит ловит
    // перебор одного пароля по многим почтам, второй — многих паролей
    // по одной почте.
    const { clientIp, tooMany, LIMITS, TOO_MANY_MSG } = await import("./abuse");
    const ip = clientIp();
    if (
      (await tooMany("login", ip, LIMITS.login)) ||
      (await tooMany("login-acc", email, LIMITS.login)) ||
      (await tooMany("login-day", ip, LIMITS.loginDay))
    ) {
      await countLogin("rate");
      return { ok: false as const, error: TOO_MANY_MSG };
    }

    // 1) Приглашённые менеджеры: личные аккаунты в KV со своими паролями
    const ns = await getKvNs();
    if (ns) {
      const stored = await kvGetJson<StoredUser>(ns, `user:${email}`);
      if (stored) {
        if (!(await verifyPassword(data.password, stored.passHash))) {
          await countLogin("badpass");
          return { ok: false as const, error: "Неверный email или пароль" };
        }
        // легаси-хэш без соли — тихо перехэшируем на PBKDF2, раз пароль уже подтверждён
        if (!stored.passHash.startsWith("pbkdf2$")) {
          stored.passHash = await hashPassword(data.password);
          await ns.put(`user:${email}`, JSON.stringify(stored));
        }
        const { passHash: _p, created: _c, invitedBy: _i, ...sessionUser } = stored;
        await issueSession(sessionUser);
        // Роль в исходе (без почты): «вошёл ли BOSS» и «вошла ли команда»
        // различимы, и при этом счётчик по-прежнему не хранит личность.
        await countLogin(stored.boss ? "ok-boss" : `ok-${stored.role}`);
        return { ok: true as const, user: sessionUser };
      }
      // заявка на роль ещё не одобрена — честно говорим статус
      if (await ns.get(`pending:${email}`)) {
        return {
          ok: false as const,
          error: "Заявка на рассмотрении у основателя GTR. После одобрения вход откроется с вашим паролем.",
        };
      }
    }

    // 2) Демо-состав: общий пароль стенда (или демо-пароль без гейта)
    // Список демо-аккаунтов подгружается на сервере в момент проверки:
    // в браузер он не попадает вовсе.
    const { demoUsers } = await import("./auth-users");
    const user = demoUsers(DEMO_PASS_HASH).find((u) => u.email === email);
    if (!user || (await expectedHash()) !== (await sha256(data.password))) {
      // Сюда попадает и опечатка в почте: личной записи в KV нет, демо
      // не совпало. Без счётчика этот случай неотличим от «запрос не
      // долетел» — а лечатся они по-разному.
      await countLogin(user ? "badpass-demo" : "nouser");
      return { ok: false as const, error: "Неверный email или пароль" };
    }
    const { passHash: _ph, ...sessionUser } = user;
    await issueSession(sessionUser);
    return { ok: true as const, user: sessionUser };
  });

// Текущий пользователь запроса — для проверок прав в других серверных
// функциях. Только сервер: в клиентском бандле вызов бросит ошибку.
export const currentUser = createServerOnlyFn(
  async (): Promise<SessionUser | null> => readToken(getCookie(COOKIE)),
);

// Для файловых роутов (вебхуки, push-лента), где нет контекста server-fn:
// достаём и проверяем сессию прямо из заголовка Cookie
export const userFromCookieHeader = createServerOnlyFn(
  async (cookieHeader: string | null): Promise<SessionUser | null> => {
    const m = (cookieHeader ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? readToken(decodeURIComponent(m[1])) : null;
  },
);

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(COOKIE, { path: "/" });
  return { ok: true };
});

export const sessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await readToken(getCookie(COOKIE));
  return { user };
});

// Экран входа спрашивает, показывать ли демо-подсказки: на стенде с заданным
// паролем они выдали бы доступ любому, кто открыл ссылку
export const accessModeFn = createServerFn({ method: "GET" }).handler(async () => {
  // Подсказки со списком демо-аккаунтов приезжают только когда демо-режим
  // реально включён. Раньше они лежали в бандле экрана входа всегда — и
  // любой посетитель получал перечень действующих адресов даром.
  const demo = isDemoAccess();
  if (!demo) return { demo, hints: [] as { email: string; label: string; ini: string; venue: string }[] };
  const { demoUsers } = await import("./auth-users");
  return {
    demo,
    hints: demoUsers("")
      .filter((u) => u.role !== "gtr" || u.email === "admin@gtr.events")
      .map((u) => ({ email: u.email, label: u.roleLabel, ini: u.initials, venue: u.venueId })),
  };
});

// Матрица прав (экран «Доступы и роли» + фактические проверки в интерфейсе)
export const PERMISSIONS: {
  key: string;
  label: string;
  roles: Record<RoleId, boolean>;
}[] = [
  {
    key: "dash",
    label: "Дашборд площадки",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true , visitor: false },
  },
  {
    key: "calendar.edit",
    label: "Календарь: изменять программу",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: false , visitor: false },
  },
  {
    key: "constructor.edit",
    label: "Конструктор: собирать событие",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true , visitor: false },
  },
  {
    key: "inquiries.reply",
    label: "Отвечать на заявки организаторов",
    roles: { pr: true, owner: true, sales: true, gtr: false, artist: false, organizer: false , visitor: false },
  },
  {
    key: "finance.view",
    label: "Финансы: видеть условия и ставки",
    roles: { pr: false, owner: true, sales: true, gtr: true, artist: false, organizer: false , visitor: false },
  },
  {
    key: "venue.edit",
    label: "Паспорт площадки: редактирование",
    roles: { pr: true, owner: true, sales: false, gtr: true, artist: false, organizer: false , visitor: false },
  },
  {
    key: "network.view",
    label: "База · Пхукет (сеть)",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true , visitor: false },
  },
  {
    key: "network.manage",
    label: "Управление реестром сети",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false , visitor: false },
  },
  {
    key: "venue.delete",
    label: "Удаление площадки",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false , visitor: false },
  },
  {
    key: "roles.manage",
    label: "Назначение ролей и приглашения",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false , visitor: false },
  },
];

export const can = (role: RoleId, key: string) =>
  PERMISSIONS.find((p) => p.key === key)?.roles[role] ?? false;
