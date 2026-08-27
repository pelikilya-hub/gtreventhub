// Что площадка публикует о себе сама.
//
// Часы работы в базе GTR известны про малую часть площадок: их собирали
// руками, и это дорого. Но сами площадки публикуют часы, адрес и телефон
// разметкой на своих сайтах — это данные ОТ них, а не наша догадка.
//
// Такой факт всегда слабее того, что мы проверили сами, поэтому здесь он
// только заполняет пустое место и всегда идёт вместе с адресом страницы,
// откуда взят: BRO должен уметь сказать «по сайту площадки», а не выдать
// это за знание GTR.
import raw from "./data/venue-facts.json";

export type PublicFacts = {
  hours?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Страница, с которой снято. Без неё факт непроверяем. */
  source: string;
  /** Когда снято: расписание живое, и вчерашнее знание стареет. */
  fetchedAt: string;
};

type Row = PublicFacts & { id: string; name: string; status: string };

const BY_ID = new Map<string, PublicFacts>(
  (raw.venues as Row[])
    .filter((v) => v.status === "ok")
    .map(({ id: _id, name: _n, status: _s, ...facts }) => [_id, facts as PublicFacts]),
);

export const publicFactsOf = (venueId: string): PublicFacts | undefined => BY_ID.get(venueId);

/** Площадки, чей сайт в базе перестал существовать: домена нет вовсе,
 *  проверено внешним DNS. Такую ссылку гостю показывать нельзя — она не
 *  «временно не грузится», а никуда не ведёт. */
const DEAD = new Set(
  (raw.venues as Row[]).filter((v) => v.status === "dead-domain").map((v) => v.id),
);

export const siteIsDead = (venueId: string): boolean => DEAD.has(venueId);

/** Сколько площадок закрыто их собственными данными — для сводок. */
export const publicFactsCount = (): number => BY_ID.size;
