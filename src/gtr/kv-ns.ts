// Доступ к Workers KV из серверных функций.
// Биндинг GTR_KV добавляется в конфиг воркера на деплое
// (scripts/patch-wrangler.mjs). В vite-dev биндинга нет — функции честно
// возвращают null, и приложение работает в локальном демо-режиме.

// Минимальный интерфейс KV, чтобы не тащить @cloudflare/workers-types
export type KvNs = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (opts?: {
    prefix?: string;
    cursor?: string;
  }) => Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};

export const getKvNs = async (): Promise<KvNs | null> => {
  try {
    // cloudflare:workers существует только в рантайме воркера — резолвим
    // строкой, чтобы vite и tsc не пытались найти модуль на диске
    const name = "cloudflare:workers";
    const m = (await import(/* @vite-ignore */ name)) as { env?: Record<string, unknown> };
    return (m.env?.GTR_KV as KvNs | undefined) ?? devKv();
  } catch {
    return devKv();
  }
};

// Хранилище в памяти — только для локальной разработки и только по явному
// флагу GTR_DEV_KV=1: так можно пройти продажу билета или бронь целиком на
// своей машине. В боевой сборке import.meta.env.DEV ложно, и ветка
// вырезается целиком.
let devStore: Map<string, string> | null = null;
function devKv(): KvNs | null {
  if (!import.meta.env.DEV || typeof process === "undefined" || !process.env.GTR_DEV_KV) return null;
  const m = (devStore ??= new Map());
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix = "" } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
}

export const kvGetJson = async <T>(ns: KvNs, key: string): Promise<T | null> => {
  const raw = await ns.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// Все ключи по префиксу (KV отдаёт страницами по 1000)
export const kvListAll = async (ns: KvNs, prefix: string): Promise<string[]> => {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await ns.list({ prefix, cursor });
    names.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
};
