// Серверный слой GTR Event поверх Workers KV: аккаунты менеджеров и общая
// база событий/заявок. Пока биндинга нет (vite-dev), функции возвращают
// null/недоступно — клиент продолжает работать на localStorage.
import { createServerFn } from "@tanstack/react-start";
import { currentUser, type SessionUser, type StoredUser } from "./auth";
import type { EventDraft, OrgRequest, RoleId } from "./data/app-data";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "./kv-ns";

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const ROLE_LABELS: Record<RoleId, string> = {
  pr: "PR-директор",
  owner: "Владелец",
  sales: "Event-продажи",
  gtr: "GTR-админ",
};

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "ГТ";

// Видит ли пользователь событие: владелец, его площадка (для событий без
// владельца — старых и засеянных) или GTR-админ
const canSeeDraft = (u: SessionUser, d: EventDraft) =>
  u.role === "gtr" || (d.owner ? d.owner === u.email : d.venueId === u.venueId);

const canSeeRequest = (u: SessionUser, r: OrgRequest) =>
  u.role === "gtr" || r.venueId === u.venueId || r.assignee === u.email;

// ---------- пользователи ----------

export type PublicUser = Omit<StoredUser, "passHash">;

export const inviteUserFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { name: string; email: string; role: RoleId; venueId: string; password: string }) => d,
  )
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (me?.role !== "gtr") return { ok: false as const, error: "Только GTR-админ" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, error: "Хранилище недоступно (локальный режим)" };

    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { ok: false as const, error: "Некорректный email" };
    if (data.password.length < 6)
      return { ok: false as const, error: "Пароль от 6 символов" };
    if (await ns.get(`user:${email}`))
      return { ok: false as const, error: "Такой пользователь уже есть" };

    const stored: StoredUser = {
      email,
      name: data.name.trim() || email,
      role: data.role,
      roleLabel: ROLE_LABELS[data.role],
      venueId: data.venueId || "",
      initials: initialsOf(data.name),
      passHash: await sha256(data.password),
      created: Date.now(),
      invitedBy: me.email,
    };
    await ns.put(`user:${email}`, JSON.stringify(stored));
    const { passHash: _p, ...pub } = stored;
    return { ok: true as const, user: pub as PublicUser };
  });

export const listUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  if (me?.role !== "gtr") return { ok: false as const, users: [] as PublicUser[] };
  const ns = await getKvNs();
  if (!ns) return { ok: false as const, users: [] as PublicUser[] };
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  return {
    ok: true as const,
    users: users
      .map(({ passHash: _p, ...u }) => u as PublicUser)
      .sort((a, b) => b.created - a.created),
  };
});

export const deleteUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const me = await currentUser();
    if (me?.role !== "gtr") return { ok: false as const };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    await ns.delete(`user:${data.email.trim().toLowerCase()}`);
    return { ok: true as const };
  });

// Менеджеры для назначения заявок: доступно всем ролям площадок
export const listManagersFn = createServerFn({ method: "GET" }).handler(async () => {
  const me = await currentUser();
  if (!me) return { managers: [] as { email: string; name: string }[] };
  const ns = await getKvNs();
  if (!ns) return { managers: [] };
  const keys = await kvListAll(ns, "user:");
  const users = (
    await Promise.all(keys.map((k) => kvGetJson<StoredUser>(ns, k)))
  ).filter((u): u is StoredUser => Boolean(u));
  return {
    managers: users
      .filter((u) => u.role === "sales" || u.role === "gtr")
      .map((u) => ({ email: u.email, name: u.name })),
  };
});

// ---------- события и заявки ----------

const getDraft = (ns: KvNs, id: string) => kvGetJson<EventDraft>(ns, `draft:${id}`);

export const pullSharedFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!u || !ns) return null;

  const [draftKeys, reqKeys] = await Promise.all([
    kvListAll(ns, "draft:"),
    kvListAll(ns, "req:"),
  ]);
  const [drafts, requests] = await Promise.all([
    Promise.all(draftKeys.map((k) => kvGetJson<EventDraft>(ns, k))),
    Promise.all(reqKeys.map((k) => kvGetJson<OrgRequest>(ns, k))),
  ]);
  return {
    drafts: drafts.filter((d): d is EventDraft => Boolean(d)).filter((d) => canSeeDraft(u, d)),
    requests: requests
      .filter((r): r is OrgRequest => Boolean(r))
      .filter((r) => canSeeRequest(u, r)),
  };
});

export const pushDraftFn = createServerFn({ method: "POST" })
  .inputValidator((d: EventDraft) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    // писать можно только своё (или админом); чужой существующий драфт не трогаем
    const existing = await getDraft(ns, data.id);
    const target = existing ?? data;
    if (!canSeeDraft(u, target)) return { ok: false as const };
    await ns.put(`draft:${data.id}`, JSON.stringify(data));
    return { ok: true as const };
  });

export const deleteDraftKvFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const };
    const existing = await getDraft(ns, data.id);
    if (existing && !canSeeDraft(u, existing)) return { ok: false as const };
    await ns.delete(`draft:${data.id}`);
    return { ok: true as const };
  });

// Заявку создаёт организатор без сессии; правки — только авторизованные
export const pushRequestFn = createServerFn({ method: "POST" })
  .inputValidator((d: OrgRequest) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const };
    const existing = await kvGetJson<OrgRequest>(ns, `req:${data.id}`);
    if (existing) {
      const u = await currentUser();
      if (!u || !canSeeRequest(u, existing)) return { ok: false as const };
    }
    await ns.put(`req:${data.id}`, JSON.stringify(data));
    return { ok: true as const };
  });
