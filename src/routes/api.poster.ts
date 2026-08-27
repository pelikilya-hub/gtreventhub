// Единственный адрес картинки события: /api/poster?k=<vid>:<slug>.
//
// Ручка отвечает картинкой ВСЕГДА. Есть кэшированный постер площадки —
// отдаём его; нет — рисуем афишу в стиле площадки прямо здесь. Поэтому
// интерфейсу не нужно знать, чем закончилась разведка: он ставит один и тот
// же src и никогда не получает дырку в ленте. Когда крон дотянет настоящий
// постер, тот же адрес молча начнёт отдавать его.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import { parsePosterKey, posterSlug, posterSvg } from "../gtr/poster";
import type { VenueAfisha } from "../gtr/afisha";

// Нарисованная афиша живёт в кэше час: событие может получить настоящий
// постер уже на следующем прогоне крона, и держать заглушку сутки нельзя.
const DRAWN_TTL = 3600;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const POSTER_MAX_BYTES = 2_500_000;

const toB64 = (u8: Uint8Array) => {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
};

/** Скачать оригинал постера у площадки. Реферер обязателен: CDN половины
 *  сайтов отдаёт картинку только «со своей страницы». */
async function pullPoster(
  src: string,
  referer: string,
): Promise<{ ct: string; b64: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  try {
    const res = await fetch(src, {
      headers: { "user-agent": UA, referer, accept: "image/*,*/*" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > POSTER_MAX_BYTES) return null;
    const bytes = new Uint8Array(buf);
    return { ct, b64: toB64(bytes), bytes };
  } catch {
    return null;
  }
}

const drawn = (svg: string, status = 200) =>
  new Response(svg, {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": `public, max-age=${DRAWN_TTL}`,
    },
  });

export const Route = createFileRoute("/api/poster")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const k = new URL(request.url).searchParams.get("k") ?? "";
        const parsed = parsePosterKey(k);
        if (!parsed) return new Response("bad key", { status: 400 });
        const { vid, slug } = parsed;

        const ns = await getKvNs();
        if (!ns) return new Response("no kv", { status: 503 });

        const rec = await kvGetJson<{ ct: string; b64: string }>(ns, `poster:${vid}:${slug}`);
        if (rec) {
          const bin = atob(rec.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Response(bytes, {
            headers: {
              "content-type": rec.ct,
              "cache-control": "public, max-age=86400, immutable",
            },
          });
        }

        // Кэша нет. Событие ищем в афише площадки: там лежат название, дата
        // и адрес оригинальной картинки.
        const afisha = await kvGetJson<VenueAfisha>(ns, `venueevents:${vid}`);
        const ev = (afisha?.events ?? []).find((e) => posterSlug(e.id) === slug);
        const { V } = await import("../gtr/data/app-data");
        const { catOf } = await import("../gtr/map-style");
        const venue = V(vid);
        if (!ev && !venue) return new Response("not found", { status: 404 });

        // Оригинал у площадки есть, но крон до него ещё не дошёл — тянем
        // сейчас и кладём в кэш. Ждать следующего прогона незачем: гость
        // смотрит афишу сегодня, а адрес запрошен ровно один раз на событие.
        const src = ev?.posterSrc || ev?.poster || "";
        if (/^https?:\/\//.test(src)) {
          const got = await pullPoster(src, ev?.url || src);
          if (got) {
            await ns
              .put(`poster:${vid}:${slug}`, JSON.stringify({ ct: got.ct, b64: got.b64 }))
              .catch(() => {
                // KV не принял — картинку всё равно отдадим этому гостю
              });
            return new Response(got.bytes, {
              headers: {
                "content-type": got.ct,
                "cache-control": "public, max-age=86400, immutable",
              },
            });
          }
        }

        // Оригинала нет. Дальше — фото самой площадки: живой кадр заведения
        // читается как афиша вечера куда лучше, чем любая рисованная
        // заглушка, а карточка в ленте всё равно кладёт поверх название и
        // дату. Фото наше, лежит рядом в /venues — отдаём редиректом, чтобы
        // не гонять мегабайты через воркер.
        const { richOf } = await import("../gtr/data/app-data");
        const hero = richOf(vid).hero;
        if (hero && hero.startsWith("/venues/"))
          return new Response(null, {
            status: 302,
            headers: { location: hero, "cache-control": `public, max-age=${DRAWN_TTL}` },
          });

        return drawn(
          posterSvg({
            title: ev?.title || venue?.name || "GTR EVENT",
            dateIso: ev?.dateIso ?? "",
            venueName: venue?.name ?? "",
            room: ev?.room,
            accent: catOf(venue?.tag ?? "").color,
          }),
        );
      },
    },
  },
});
