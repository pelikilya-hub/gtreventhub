// Публичная афиша: что из ленты событий можно показать гостю без входа.
//
// Афиша — это то, ради чего продукт открывают, и до сих пор её нельзя было
// увидеть, не заведя аккаунт: витрина звала «открыть приложение», а
// приложение отвечало экраном входа. Здесь — узкий срез той же ленты, что
// видит «Сегодня» внутри: кто играет, где, когда, почём вход.
//
// Срез именно узкий. Наружу не уходят ни контакты площадок, ни их кабинеты,
// ни внутренние поля разведки (источник, исходный URL постера, совпадения
// с базой артистов): только то, что площадка сама опубликовала как анонс.
// Постер — через наш /api/poster, а не прямой ссылкой на чужой CDN.
import { createServerFn } from "@tanstack/react-start";

export type PublicEvent = {
  id: string;
  title: string;
  dateIso: string;
  time?: string;
  price?: string;
  poster: string;
  venue: string;
  region: string;
  /** Страница события у самой площадки — её публичный анонс. */
  url?: string;
};

export type PublicAfisha = {
  /** «Сегодня» по Пхукету: вычисляется на сервере, чтобы клиент и сервер
   *  не разошлись в дате и разметка не перерисовывалась при гидрации. */
  today: string;
  events: PublicEvent[];
  regions: Record<string, { ru: string; en: string; th: string }>;
};

/** Горизонт ленты: на столько вперёд у площадок реально есть анонсы. */
export const AFISHA_DAYS = 14;
const MAX_EVENTS = 160;

const safeUrl = (u: string | undefined) =>
  u && /^https?:\/\//i.test(u) ? u : undefined;

// Сборка ленты читает из KV запись каждой площадки. Для кабинета это
// терпимо, для открытой страницы — нет: гости и боты сожгли бы дневной
// лимит чтений. Держим готовый ответ в памяти изолята пять минут; афиша
// и так обновляется кроном раз в два часа.
const CACHE_TTL = 5 * 60_000;
let cache: { at: number; data: PublicAfisha } | null = null;

export const publicAfishaFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicAfisha> => {
    const { bkkToday } = await import("../gtr/afisha-parse");
    const today = bkkToday();
    if (
      cache &&
      cache.data.today === today &&
      Date.now() - cache.at < CACHE_TTL
    )
      return cache.data;
    const data = await buildAfisha(today);
    // Пустой ответ не кэшируем: сбой KV не должен прятать афишу на пять минут.
    if (data.events.length) cache = { at: Date.now(), data };
    return data;
  },
);

async function buildAfisha(today: string): Promise<PublicAfisha> {
  const { bkkToday } = await import("../gtr/afisha-parse");
  const empty: PublicAfisha = { today, events: [], regions: {} };
  const { getKvNs } = await import("../gtr/kv-ns");
  const ns = await getKvNs();
  if (!ns) return empty;
  const [{ collectCleanAfisha }, { V, regionOf, regionName }, { posterUrl }] =
    await Promise.all([
      import("../gtr/community"),
      import("../gtr/data/app-data"),
      import("../gtr/poster"),
    ]);
  const last = bkkToday(AFISHA_DAYS - 1);
  const items = await collectCleanAfisha(ns);
  const events: PublicEvent[] = [];
  const regions: PublicAfisha["regions"] = {};
  for (const e of items) {
    if (e.dateIso > last) break;
    const v = V(e.vid);
    // Площадки, которой нет в каталоге, гостю не покажем: без имени и
    // региона карточка превращается в загадку.
    if (!v.name) continue;
    const region = regionOf(v);
    regions[region] ??= {
      ru: regionName(region, "ru"),
      en: regionName(region, "en"),
      th: regionName(region, "th"),
    };
    events.push({
      id: `${e.vid}:${e.id}`,
      title: e.title,
      dateIso: e.dateIso,
      time: e.time || undefined,
      price: e.price || undefined,
      poster: posterUrl(e.vid, e.id),
      venue: v.name,
      region,
      url: safeUrl(e.url),
    });
    if (events.length >= MAX_EVENTS) break;
  }
  return { today, events, regions };
}
