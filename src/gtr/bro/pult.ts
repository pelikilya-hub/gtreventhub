// Командный пульт Claude Code: очередь задач разработки в KV.
//
// BOSS пишет команды со стенда /bro-dev, Claude в ветке разработки
// забирает их по ключу пульта и отмечает исполнение. Очередь — рабочий
// журнал, а не чат: короткие поручения, статусы, ничего личного.
import type { KvNs } from "../kv-ns";

/** Ключ очереди в KV. */
export const PULT_KEY = "claude:pult";

/** Потолок очереди: пульт — не архив. Старые done вытесняются первыми. */
export const PULT_MAX = 50;

export type PultStatus = "new" | "taken" | "done";

export type PultCmd = {
  id: string;
  t: number; // когда поставлена, epoch ms
  by: string; // кто поставил (email)
  text: string;
  status: PultStatus;
  note?: string; // ответ Claude: что сделано или почему нет
  at?: number; // когда статус менялся
};

/** Ключ доступа Claude к очереди: производная от секрета сессий, по
 *  образцу afishaKey(). Показывается BOSS на стенде — он передаёт его
 *  Claude один раз. */
export async function pultAccessKey(): Promise<string> {
  const base =
    (typeof process !== "undefined" && process.env?.GTR_SESSION_SECRET) || "gtr-dev";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`pult:${base}`),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

/** Добавить команду. Текст режется: поручение, а не техзадание на роман. */
export function addCmd(queue: PultCmd[], by: string, text: string, now: number): PultCmd[] {
  const cmd: PultCmd = {
    id: `p${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    t: now,
    by,
    text: text.slice(0, 2000).trim(),
    status: "new",
  };
  const next = [...queue, cmd];
  // Вытесняем сперва самые старые done, затем просто самые старые.
  while (next.length > PULT_MAX) {
    const doneIdx = next.findIndex((c) => c.status === "done");
    next.splice(doneIdx === -1 ? 0 : doneIdx, 1);
  }
  return next;
}

/** Сменить статус команды (Claude: взял / сделал). */
export function ackCmd(
  queue: PultCmd[],
  id: string,
  status: PultStatus,
  note: string | undefined,
  now: number,
): PultCmd[] {
  return queue.map((c) =>
    c.id === id
      ? { ...c, status, at: now, ...(note ? { note: note.slice(0, 1000) } : {}) }
      : c,
  );
}

export async function readQueue(ns: KvNs): Promise<PultCmd[]> {
  try {
    const raw = await ns.get(PULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PultCmd[]) : [];
  } catch {
    return [];
  }
}

export async function writeQueue(ns: KvNs, queue: PultCmd[]): Promise<void> {
  await ns.put(PULT_KEY, JSON.stringify(queue));
}
