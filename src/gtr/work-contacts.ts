// Клиентский доступ к рабочим контактам.
//
// Контакты больше не лежат в бандле — их отдаёт сервер и только команде.
// Здесь один общий кэш на вкладку: экранов, которым нужны контакты,
// несколько, а тянуть один и тот же список по разу на каждый — глупо.
import { useEffect, useState } from "react";

import { venueContactsFn, type WorkContact } from "./kv-api";

let cache: WorkContact[] | null = null;
let inflight: Promise<WorkContact[]> | null = null;

const load = (): Promise<WorkContact[]> => {
  if (cache) return Promise.resolve(cache);
  if (!inflight)
    inflight = venueContactsFn()
      .then((r) => {
        cache = r.contacts;
        return cache;
      })
      // Роль без доступа получает пустой список — это не ошибка экрана,
      // а нормальный ответ сервера.
      .catch(() => [] as WorkContact[])
      .finally(() => {
        inflight = null;
      });
  return inflight;
};

/** Поиск контакта площадки. Пока список едет — undefined, экран просто
 *  показывает прочерк и дорисовывает контакт при готовности. */
export const useVenueContacts = (): ((venueId?: string) => WorkContact | undefined) => {
  const [list, setList] = useState<WorkContact[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    void load().then((c) => {
      if (alive) setList(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (venueId?: string) => (venueId ? list.find((c) => c.venueId === venueId) : undefined);
};

export type { WorkContact };
