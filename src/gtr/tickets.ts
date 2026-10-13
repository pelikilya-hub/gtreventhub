// Билеты: продажа на событие с оплатой PromptPay и ручным подтверждением.
//
// Первая версия продаж — без эквайринга. Гость выбирает количество,
// получает QR PromptPay на точную сумму с кодом заказа и платит в своём
// банке: деньги уходят напрямую на реквизит из настроек BOSS. Команда
// сверяет поступление и подтверждает заказ в кабинете — у гостя на
// странице заказа появляется билет с QR. На входе билет гасится по коду.
//
// Модуль отдельный: свои ключи в KV (tix:*), существующие брони, бот и
// кроны не меняются. Уведомление команде — обычным сообщением в Telegram
// со ссылкой в кабинет, без кнопок: кнопки потребовали бы правки бота.
import { createServerFn } from "@tanstack/react-start";

import { currentUser } from "./auth";
import { getKvNs, kvGetJson, type KvNs } from "./kv-ns";

export type TicketEvent = {
  id: string;
  title: string;
  dateIso: string;
  time?: string;
  vid?: string;
  venueName?: string;
  /** Постер: ссылка на картинку (наш /api/poster или внешний адрес). */
  poster?: string;
  desc?: string;
  /** Цена одного билета, ฿. */
  price: number;
  /** Тираж. */
  capacity: number;
  /** Подтверждённо продано, шт. */
  sold: number;
  active: boolean;
  createdBy: string;
  ts: number;
};

export type TicketOrderStatus = "pending" | "paid" | "rejected" | "used";
export type TicketOrder = {
  id: string;
  evId: string;
  name: string;
  phone: string;
  qty: number;
  amount: number;
  /** Короткий код: его гость пишет в комментарии к переводу и называет на входе. */
  ref: string;
  status: TicketOrderStatus;
  /** Гость нажал «Я оплатил». */
  claimed?: boolean;
  ts: number;
  decidedAt?: number;
  decidedBy?: string;
  usedAt?: number;
  usedBy?: string;
};

export type PublicPayCfg = { id: string; name: string } | null;

const EV = (id: string) => `tix:ev:${id}`;
const EVS = "tix:evs";
const ORD = (id: string) => `tix:ord:${id}`;
const ORDS = (evId: string) => `tix:ords:${evId}`;
const REF = (ref: string) => `tix:ref:${ref}`;

/** Неоплаченный заказ держит места сутки — дальше не мешает продажам. */
const HOLD_MS = 24 * 3600_000;
const MAX_QTY = 10;

// Без похожих знаков: код диктуют на входе и переписывают в банке.
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randCode = (n: number) => {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => ALPHA[b % ALPHA.length]).join("");
};
const randId = (n = 18) => {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => (b % 36).toString(36)).join("");
};

const canManage = (u: { role?: string; boss?: boolean } | null) =>
  Boolean(u && (u.boss || u.role === "gtr"));
const canCheckIn = (u: { role?: string; boss?: boolean } | null) =>
  Boolean(u && (u.boss || ["gtr", "owner", "pr", "sales"].includes(u.role ?? "")));

const readList = async (ns: KvNs, key: string) => (await kvGetJson<string[]>(ns, key)) ?? [];

const ordersOf = async (ns: KvNs, evId: string) =>
  (await Promise.all((await readList(ns, ORDS(evId))).map((id) => kvGetJson<TicketOrder>(ns, ORD(id))))).filter(
    (o): o is TicketOrder => Boolean(o),
  );

/** Сколько мест занято: подтверждённые + свежие неоплаченные заказы. */
const heldQty = (orders: TicketOrder[]) =>
  orders
    .filter((o) => o.status === "pending" && Date.now() - o.ts < HOLD_MS)
    .reduce((s, o) => s + o.qty, 0);

const publicEvent = (e: TicketEvent, orders: TicketOrder[]) => ({
  id: e.id,
  title: e.title,
  dateIso: e.dateIso,
  time: e.time,
  vid: e.vid,
  venueName: e.venueName,
  poster: e.poster,
  desc: e.desc,
  price: e.price,
  left: Math.max(0, e.capacity - e.sold - heldQty(orders)),
  active: e.active,
});
export type PublicTicketEvent = ReturnType<typeof publicEvent>;

const payCfg = async (ns: KvNs): Promise<PublicPayCfg> => {
  const c = await kvGetJson<{ id: string; name: string }>(ns, "setting:promptpay");
  return c?.id ? { id: c.id, name: c.name || "GTR Event" } : null;
};

// ---------- публичное ----------

/** События с билетами в продаже: для афиши и витрины. */
export const ticketEventsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ns = await getKvNs();
  if (!ns) return { items: [] as PublicTicketEvent[] };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const evs = (await Promise.all((await readList(ns, EVS)).map((id) => kvGetJson<TicketEvent>(ns, EV(id))))).filter(
    (e): e is TicketEvent => Boolean(e && e.active && e.dateIso >= today),
  );
  const items = await Promise.all(evs.map(async (e) => publicEvent(e, await ordersOf(ns, e.id))));
  items.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return { items };
});

/** Страница события: само событие, остаток мест и реквизит для QR. */
export const ticketEventFn = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "Продажа билетов временно недоступна" };
    const e = await kvGetJson<TicketEvent>(ns, EV(String(data.id).slice(0, 40)));
    if (!e) return { ok: false as const, reason: "Событие не найдено" };
    return { ok: true as const, event: publicEvent(e, await ordersOf(ns, e.id)), pay: await payCfg(ns) };
  });

/** Заказ: создаётся неоплаченным, держит места сутки. */
export const buyTicketFn = createServerFn({ method: "POST" })
  .inputValidator((d: { evId: string; name: string; phone: string; qty: number }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "Продажа билетов временно недоступна" };
    const { clientIp, tooMany, TOO_MANY_MSG } = await import("./abuse");
    if (await tooMany("tixbuy", clientIp() || "noip", { hits: 8, windowSec: 900 }, ns))
      return { ok: false as const, reason: TOO_MANY_MSG };
    const name = String(data.name ?? "").trim().slice(0, 80);
    const phone = String(data.phone ?? "").trim().slice(0, 40);
    const qty = Math.round(Number(data.qty));
    if (!name || phone.replace(/\D/g, "").length < 6)
      return { ok: false as const, reason: "Укажите имя и телефон" };
    if (!(qty >= 1 && qty <= MAX_QTY)) return { ok: false as const, reason: "От 1 до 10 билетов за раз" };
    const e = await kvGetJson<TicketEvent>(ns, EV(String(data.evId).slice(0, 40)));
    if (!e || !e.active) return { ok: false as const, reason: "Продажа на это событие закрыта" };
    const orders = await ordersOf(ns, e.id);
    if (e.capacity - e.sold - heldQty(orders) < qty)
      return { ok: false as const, reason: "Столько билетов уже нет" };
    let ref = randCode(6);
    for (let i = 0; i < 4 && (await ns.get(REF(ref))); i++) ref = randCode(6);
    const order: TicketOrder = {
      id: randId(),
      evId: e.id,
      name,
      phone,
      qty,
      amount: e.price * qty,
      ref,
      status: "pending",
      ts: Date.now(),
    };
    await ns.put(ORD(order.id), JSON.stringify(order));
    await ns.put(REF(ref), order.id);
    await ns.put(ORDS(e.id), JSON.stringify([...(await readList(ns, ORDS(e.id))), order.id]));
    await notifyTeam(
      ns,
      `🎟 <b>Заказ билетов</b> · ${esc(e.title)} · ${e.dateIso}\n${qty} × ฿${e.price} = <b>฿${order.amount}</b>\n${esc(name)} · ${esc(phone)}\nКод: <b>${ref}</b> — сверьте поступление и подтвердите в кабинете BOSS.`,
    );
    return { ok: true as const, id: order.id, ref, amount: order.amount };
  });

/** Страница заказа: по длинному случайному id, без входа. */
export const ticketOrderFn = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "Продажа билетов временно недоступна" };
    const o = await kvGetJson<TicketOrder>(ns, ORD(String(data.id).slice(0, 40)));
    if (!o) return { ok: false as const, reason: "Заказ не найден" };
    const e = await kvGetJson<TicketEvent>(ns, EV(o.evId));
    return {
      ok: true as const,
      order: { id: o.id, ref: o.ref, qty: o.qty, amount: o.amount, name: o.name, status: o.status, claimed: Boolean(o.claimed) },
      event: e ? publicEvent(e, []) : null,
      pay: await payCfg(ns),
    };
  });

/** «Я оплатил»: команде уходит напоминание сверить поступление. */
export const claimPaidFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const ns = await getKvNs();
    if (!ns) return { ok: false as const, reason: "Продажа билетов временно недоступна" };
    const o = await kvGetJson<TicketOrder>(ns, ORD(String(data.id).slice(0, 40)));
    if (!o) return { ok: false as const, reason: "Заказ не найден" };
    if (o.status !== "pending" || o.claimed) return { ok: true as const };
    o.claimed = true;
    await ns.put(ORD(o.id), JSON.stringify(o));
    const e = await kvGetJson<TicketEvent>(ns, EV(o.evId));
    await notifyTeam(
      ns,
      `💸 Гость сообщил об оплате · код <b>${o.ref}</b> · ฿${o.amount}\n${esc(o.name)} · ${esc(e?.title ?? "")}\nПроверьте поступление и подтвердите в кабинете BOSS.`,
    );
    return { ok: true as const };
  });

// ---------- команда ----------

/** Все события и заказы — для кабинета BOSS. */
export const ticketsAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const u = await currentUser();
  const ns = await getKvNs();
  if (!ns || !canManage(u)) return { ok: false as const, events: [] };
  const evs = (await Promise.all((await readList(ns, EVS)).map((id) => kvGetJson<TicketEvent>(ns, EV(id))))).filter(
    (e): e is TicketEvent => Boolean(e),
  );
  const events = await Promise.all(
    evs.map(async (e) => {
      const orders = (await ordersOf(ns, e.id)).sort((a, b) => b.ts - a.ts);
      return { event: e, left: Math.max(0, e.capacity - e.sold - heldQty(orders)), orders };
    }),
  );
  events.sort((a, b) => b.event.dateIso.localeCompare(a.event.dateIso));
  return { ok: true as const, events };
});

/** Завести или поправить событие с билетами. */
export const saveTicketEventFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id?: string;
      title: string;
      dateIso: string;
      time?: string;
      vid?: string;
      venueName?: string;
      poster?: string;
      desc?: string;
      price: number;
      capacity: number;
      active?: boolean;
    }) => d,
  )
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (!canManage(u)) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const title = String(data.title ?? "").trim().slice(0, 120);
    const dateIso = String(data.dateIso ?? "");
    const price = Math.round(Number(data.price));
    const capacity = Math.round(Number(data.capacity));
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso))
      return { ok: false as const, reason: "Нужны название и дата" };
    if (!(price > 0 && price <= 1_000_000)) return { ok: false as const, reason: "Цена билета — больше нуля" };
    if (!(capacity >= 1 && capacity <= 100_000)) return { ok: false as const, reason: "Тираж — от 1 билета" };
    const prev = data.id ? await kvGetJson<TicketEvent>(ns, EV(String(data.id).slice(0, 40))) : null;
    const poster = String(data.poster ?? "").trim();
    const e: TicketEvent = {
      id: prev?.id ?? `EV${randCode(6)}`,
      title,
      dateIso,
      time: String(data.time ?? "").slice(0, 5) || undefined,
      vid: String(data.vid ?? "").slice(0, 32) || undefined,
      venueName: String(data.venueName ?? "").trim().slice(0, 120) || undefined,
      poster: /^(https?:\/\/|\/)/.test(poster) ? poster.slice(0, 500) : undefined,
      desc: String(data.desc ?? "").trim().slice(0, 600) || undefined,
      price,
      capacity: Math.max(capacity, prev?.sold ?? 0),
      sold: prev?.sold ?? 0,
      active: data.active ?? prev?.active ?? true,
      createdBy: prev?.createdBy ?? u.email,
      ts: prev?.ts ?? Date.now(),
    };
    await ns.put(EV(e.id), JSON.stringify(e));
    if (!prev) await ns.put(EVS, JSON.stringify([...(await readList(ns, EVS)), e.id]));
    return { ok: true as const, event: e };
  });

/** Решение по заказу: оплата пришла — билет выдан; нет — заказ отклонён. */
export const decideTicketOrderFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; ok: boolean }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (!canManage(u)) return { ok: false as const, reason: "только BOSS / GTR-админ" };
    const o = await kvGetJson<TicketOrder>(ns, ORD(String(data.id).slice(0, 40)));
    if (!o) return { ok: false as const, reason: "Заказ не найден" };
    if (o.status !== "pending") return { ok: false as const, reason: "Заказ уже обработан" };
    const e = await kvGetJson<TicketEvent>(ns, EV(o.evId));
    if (!e) return { ok: false as const, reason: "Событие не найдено" };
    o.status = data.ok ? "paid" : "rejected";
    o.decidedAt = Date.now();
    o.decidedBy = u.email;
    if (data.ok) {
      e.sold += o.qty;
      await ns.put(EV(e.id), JSON.stringify(e));
    }
    await ns.put(ORD(o.id), JSON.stringify(o));
    return { ok: true as const, order: o };
  });

/** Вход: билет гасится по коду заказа или по QR (в нём id заказа). */
export const checkInTicketFn = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    const u = await currentUser();
    const ns = await getKvNs();
    if (!u || !ns) return { ok: false as const, reason: "нужен вход" };
    if (!canCheckIn(u)) return { ok: false as const, reason: "Нет прав на проверку билетов" };
    const raw = String(data.code ?? "").trim();
    const fromQr = raw.match(/GTR-TIX:([a-z0-9]{10,40})/i)?.[1];
    const id = fromQr ?? (await ns.get(REF(raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))));
    const o = id ? await kvGetJson<TicketOrder>(ns, ORD(id)) : null;
    if (!o) return { ok: false as const, reason: "Билет не найден" };
    const e = await kvGetJson<TicketEvent>(ns, EV(o.evId));
    const info = { ref: o.ref, name: o.name, qty: o.qty, title: e?.title ?? "", dateIso: e?.dateIso ?? "" };
    if (o.status === "used") return { ok: false as const, reason: "Билет уже погашен", info };
    if (o.status !== "paid") return { ok: false as const, reason: "Билет не оплачен", info };
    o.status = "used";
    o.usedAt = Date.now();
    o.usedBy = u.email;
    await ns.put(ORD(o.id), JSON.stringify(o));
    return { ok: true as const, info };
  });

// ---------- служебное ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function notifyTeam(ns: KvNs, text: string) {
  try {
    const { notifyAdminsTg } = await import("./kv-api");
    await notifyAdminsTg(ns, text);
  } catch {
    // Telegram недоступен — заказ всё равно сохранён и виден в кабинете
  }
}
