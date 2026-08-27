// Пульс площадки и анонимная оценка вечера.
//
// Задача — показать гостю, где сегодня живо, и собрать честную обратную
// связь. Обе части сделаны так, чтобы по данным нельзя было восстановить,
// кто где был: это не обещание в политике, а свойство того, что мы пишем
// в хранилище.
//
// Что здесь НЕ делается и почему:
//
// 1. Пассивная геолокация не собирается. Пульс считается по чек-инам —
//    осознанному нажатию кнопки. Нажатие и есть согласие; фоновая слежка
//    им не является ни юридически (PDPA требует согласия на конкретную
//    цель), ни по-человечески.
//
// 2. Точное число присутствующих не показывается никогда. При пороге в
//    пять человек место деанонимизируется: видно, кто пришёл и кто ушёл.
//    Наружу уходит только ступень — «оживлённо / жарко / битком».
//
// 3. Ниже порога не показывается ничего — и никогда «пусто». Надпись
//    «здесь пусто» бьёт по бизнесу площадки, которая нам же платит.
//
// 4. Последние минуты в счёт не идут. Без задержки пульс превращается в
//    трекер конкретного человека: пришёл — цифра дёрнулась.
import { createServerFn } from "@tanstack/react-start";

import { currentUser } from "./auth";
import { getKvNs, kvGetJson, type KvNs } from "./kv-ns";

/** Окно, за которое считаем вечер живым. */
const WINDOW_MS = 3 * 60 * 60 * 1000;
/** Свежие минуты не публикуем — см. пункт 4 выше. */
const LAG_MS = 15 * 60 * 1000;
/** Меньше — не показываем ничего. Порог поднимать вместе с ростом базы:
 *  восемь человек анонимны в клубе на тысячу и не анонимны в баре на
 *  двадцать мест. */
const MIN_PULSE = 8;
/** Один гость — один голос в окне: иначе площадка накрутит себе пульс. */
const PULSE_KEY = "pulse:all";

export type PulseLevel = "busy" | "hot" | "packed";

/** Ступень вместо числа. Границы намеренно широкие: точность здесь не
 *  нужна, а по узким ступеням можно считать людей. */
const levelOf = (n: number): PulseLevel | null =>
  n >= 30 ? "packed" : n >= 15 ? "hot" : n >= MIN_PULSE ? "busy" : null;

type Entry = { t: number; h: string };
type PulseStore = Record<string, Entry[]>;

/** Короткий несоставной отпечаток гостя: нужен только чтобы отличить
 *  «пришли восемь человек» от «один нажал восемь раз». Восьми шестнадцати-
 *  ричных знаков хватает для этого и мало для восстановления адреса: по
 *  усечённому хешу нельзя перебрать почту, а соль своя на каждый вечер. */
async function memberHash(email: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${email}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const prune = (list: Entry[], now: number): Entry[] => list.filter((e) => now - e.t < WINDOW_MS);

/** Чек-ин: «я здесь». Пишет отпечаток в пульс и возвращает токен, по
 *  которому потом можно один раз оценить этот визит. */
export async function checkInCore(
  ns: KvNs,
  u: { email: string },
  vid: string,
  now = Date.now(),
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (!/^VEN-\d{4}$/.test(vid)) return { ok: false, reason: "не та площадка" };
  // Соль дня: отпечатки вчерашнего вечера не сопоставимы с сегодняшними,
  // и накопить историю перемещений по ним нельзя.
  const day = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
  const h = await memberHash(u.email, day);

  const store = ((await kvGetJson(ns, PULSE_KEY)) as PulseStore | null) ?? {};
  const list = prune(store[vid] ?? [], now);
  // Повторное нажатие в том же окне не удваивает пульс, но обновляет время.
  const seen = list.findIndex((e) => e.h === h);
  if (seen >= 0) list[seen] = { t: now, h };
  else list.push({ t: now, h });
  store[vid] = list;
  // Чужие площадки тоже подчищаем: файл один, и мусор в нём растёт молча.
  for (const k of Object.keys(store)) {
    store[k] = prune(store[k], now);
    if (!store[k].length) delete store[k];
  }
  await ns.put(PULSE_KEY, JSON.stringify(store));

  // Токен визита — то, что даёт право оценить, и единственная нить между
  // гостем и оценкой. Она рвётся при записи отзыва: в самой оценке его нет.
  const token = `${vid}.${day}.${h}`;
  return { ok: true, token };
}

/** Пульс всех площадок разом: карте нужен один запрос, а не сто десять. */
export async function pulseCore(ns: KvNs, now = Date.now()): Promise<Record<string, PulseLevel>> {
  const store = ((await kvGetJson(ns, PULSE_KEY)) as PulseStore | null) ?? {};
  const out: Record<string, PulseLevel> = {};
  for (const [vid, list] of Object.entries(store)) {
    // Свежие 15 минут отбрасываем вместе со старыми — см. пункт 4.
    const n = list.filter((e) => now - e.t < WINDOW_MS && now - e.t >= LAG_MS).length;
    const lvl = levelOf(n);
    if (lvl) out[vid] = lvl;
  }
  return out;
}

export type VisitRating = {
  id: string;
  vid: string;
  dateIso: string;
  score: number;
  text?: string;
  /** Что именно спросили — чтобы потом читать ответы правильно. */
  tags?: string[];
};

/** Анонимная оценка визита.
 *
 *  В записи нет и не появится автора: ни почты, ни отпечатка, ни токена.
 *  Токен проверяется и гасится отдельным ключом — мы знаем, что «этот визит
 *  уже оценён», но не знаем, чей он. Восстановить связь нельзя даже нам,
 *  и это осознанный размен: цена — невозможность разобрать поимённо, кто
 *  оставил грубый отзыв. */
export async function rateVisitCore(
  ns: KvNs,
  token: string,
  score: number,
  text?: string,
  tags?: string[],
  now = Date.now(),
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const m = /^(VEN-\d{4})\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{8})$/.exec(token);
  if (!m) return { ok: false, reason: "нужен токен визита — сначала чек-ин" };
  const [, vid, day] = m;
  const s = Math.round(score);
  if (!(s >= 1 && s <= 5)) return { ok: false, reason: "оценка от 1 до 5" };

  const usedKey = `rated:${token}`;
  if (await ns.get(usedKey)) return { ok: false, reason: "этот вечер уже оценён" };
  // Гасим токен ДО записи отзыва: если запись сорвётся, гость потеряет
  // возможность оценить — это неприятно. Если наоборот, он сможет
  // проголосовать дважды — это ломает данные площадки. Выбираем первое.
  await ns.put(usedKey, "1", { expirationTtl: 60 * 60 * 24 * 60 });

  const id = `RT-${now.toString(36)}-${Math.floor(now % 997).toString(36)}`;
  const rating: VisitRating = {
    id,
    vid,
    dateIso: day,
    score: s,
    text: text?.trim().slice(0, 500) || undefined,
    tags: tags?.slice(0, 6).map((x) => String(x).slice(0, 40)),
  };
  await ns.put(`rating:${vid}:${id}`, JSON.stringify(rating));
  return { ok: true, id };
}

// ---------- серверные функции ----------

export const checkInFn = createServerFn({ method: "POST" })
  .inputValidator((d: { vid: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    if (!u) return { ok: false as const, reason: "нужен вход" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "хранилище недоступно" };
    return checkInCore(ns, u, data.vid);
  });

export const venuePulseFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { pulse: {} as Record<string, PulseLevel> };
  return { pulse: await pulseCore(ns) };
});

export const rateVisitFn = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; score: number; text?: string; tags?: string[] }) => d)
  .handler(async ({ data }) => {
    // Вход нужен, чтобы токен нельзя было перебрать снаружи, но кто именно
    // вошёл — в оценку не попадает и нигде рядом не сохраняется.
    const u = await currentUser();
    if (!u) return { ok: false as const, reason: "нужен вход" };
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "хранилище недоступно" };
    return rateVisitCore(ns, data.token, data.score, data.text, data.tags);
  });
