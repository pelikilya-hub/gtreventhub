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

const USERS: DemoUser[] = [
  {
    email: "pr@gtr.events",
    name: "Ника Соболева",
    role: "pr",
    roleLabel: "PR-директор",
    venueId: "VEN-0013",
    initials: "ПД",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "owner@gtr.events",
    name: "Артём Ким",
    role: "owner",
    roleLabel: "Владелец",
    venueId: "VEN-0061",
    initials: "ВЛ",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "sales@gtr.events",
    name: "Мария Чан",
    role: "sales",
    roleLabel: "Event-продажи",
    venueId: "VEN-0033",
    initials: "ПР",
    passHash: DEMO_PASS_HASH,
  },
  {
    email: "admin@gtr.events",
    name: "GTR HQ",
    role: "gtr",
    roleLabel: "GTR-админ",
    venueId: "",
    initials: "АД",
    passHash: DEMO_PASS_HASH,
  },
];

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

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();

    // 1) Приглашённые менеджеры: личные аккаунты в KV со своими паролями
    const ns = await getKvNs();
    if (ns) {
      const stored = await kvGetJson<StoredUser>(ns, `user:${email}`);
      if (stored) {
        if (stored.passHash !== (await sha256(data.password))) {
          return { ok: false as const, error: "Неверный email или пароль" };
        }
        const { passHash: _p, created: _c, invitedBy: _i, ...sessionUser } = stored;
        await issueSession(sessionUser);
        return { ok: true as const, user: sessionUser };
      }
    }

    // 2) Демо-состав: общий пароль стенда (или демо-пароль без гейта)
    const user = USERS.find((u) => u.email === email);
    if (!user || (await expectedHash()) !== (await sha256(data.password))) {
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
export const accessModeFn = createServerFn({ method: "GET" }).handler(
  async () => ({
    demo: isDemoAccess(),
  }),
);

// Матрица прав (экран «Доступы и роли» + фактические проверки в интерфейсе)
export const PERMISSIONS: {
  key: string;
  label: string;
  roles: Record<RoleId, boolean>;
}[] = [
  {
    key: "dash",
    label: "Дашборд площадки",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true },
  },
  {
    key: "calendar.edit",
    label: "Календарь: изменять программу",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: false },
  },
  {
    key: "constructor.edit",
    label: "Конструктор: собирать событие",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true },
  },
  {
    key: "inquiries.reply",
    label: "Отвечать на заявки организаторов",
    roles: { pr: true, owner: true, sales: true, gtr: false, artist: false, organizer: false },
  },
  {
    key: "finance.view",
    label: "Финансы: видеть условия и ставки",
    roles: { pr: false, owner: true, sales: true, gtr: true, artist: false, organizer: false },
  },
  {
    key: "venue.edit",
    label: "Паспорт площадки: редактирование",
    roles: { pr: true, owner: true, sales: false, gtr: true, artist: false, organizer: false },
  },
  {
    key: "network.view",
    label: "База · Пхукет (сеть)",
    roles: { pr: true, owner: true, sales: true, gtr: true, artist: false, organizer: true },
  },
  {
    key: "network.manage",
    label: "Управление реестром сети",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false },
  },
  {
    key: "venue.delete",
    label: "Удаление площадки",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false },
  },
  {
    key: "roles.manage",
    label: "Назначение ролей и приглашения",
    roles: { pr: false, owner: false, sales: false, gtr: true, artist: false, organizer: false },
  },
];

export const can = (role: RoleId, key: string) =>
  PERMISSIONS.find((p) => p.key === key)?.roles[role] ?? false;
