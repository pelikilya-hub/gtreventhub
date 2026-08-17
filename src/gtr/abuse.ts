// Защита от злоупотреблений: перебор паролей, массовая регистрация,
// выкачивание базы через рабочие ручки.
//
// Считаем в KV скользящими окнами по ключу «что делаем + кто делает».
// Кто — это IP от Cloudflare (cf-connecting-ip), который подделать
// нельзя: заголовок ставит сам край сети, а не клиент.
//
// Мера намеренно мягкая по числам и жёсткая по сути: живому человеку
// лимиты незаметны, а скрипту, перебирающему пароли или тянущему базу
// по одной карточке, — нет.
import { getRequestHeader } from "@tanstack/react-start/server";

import { getKvNs, type KvNs } from "./kv-ns";

/** Клиент запроса. За Cloudflare это подставляет край сети. */
export const clientIp = (): string => {
  const h =
    getRequestHeader("cf-connecting-ip") ||
    getRequestHeader("x-real-ip") ||
    (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim();
  return (h || "unknown").slice(0, 64);
};

export type Limit = { hits: number; windowSec: number };

/** Порог сработал? Возвращает true, если лимит уже исчерпан.
 *
 *  Окно фиксированное, а не скользящее: на границе окна злоумышленник
 *  получает двойную квоту. Для защиты от перебора этого достаточно, а
 *  за точность пришлось бы платить лишними записями в KV. */
export const tooMany = async (
  bucket: string,
  who: string,
  { hits, windowSec }: Limit,
  ns?: KvNs | null,
): Promise<boolean> => {
  const kv = ns ?? (await getKvNs());
  // Без хранилища лимиты не работают — блокировать вход из-за этого
  // нельзя: продукт станет недоступен от собственной защиты.
  if (!kv) return false;
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${bucket}:${who}:${slot}`;
  const now = Number((await kv.get(key)) ?? 0);
  if (now >= hits) return true;
  await kv.put(key, String(now + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return false;
};

/** Готовые пороги. Держим их в одном месте: разные числа в разных
 *  ручках — верный способ забыть, где стоит дыра. */
export const LIMITS = {
  /** Вход: перебор пароля по одному аккаунту и с одного адреса. */
  login: { hits: 8, windowSec: 300 } as Limit,
  loginDay: { hits: 60, windowSec: 3600 } as Limit,
  /** Регистрация: живой человек заводит аккаунт раз, а не двадцать. */
  signup: { hits: 5, windowSec: 3600 } as Limit,
  /** Заявка на роль. */
  apply: { hits: 4, windowSec: 3600 } as Limit,
  /** Рабочие контакты: команда открывает карточки, а не выкачивает базу. */
  contacts: { hits: 120, windowSec: 3600 } as Limit,
  /** BRO: разговор, а не бесплатный доступ к чужой модели. */
  bro: { hits: 90, windowSec: 3600 } as Limit,
} as const;

export const TOO_MANY_MSG =
  "Слишком много попыток подряд. Подожди пару минут — защита от перебора.";
