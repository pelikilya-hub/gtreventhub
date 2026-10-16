// Афиша по маршруту — публичная выдача для партнёрских витрин (первый
// потребитель — bangtaostyle.com: тур идёт кольцом по регионам, и гостям
// тура показываем, что идёт в каждом городе в дни, когда там будет экипаж).
//
// Только чтение и только то, что и так видно в публичной ленте: та же
// чистка и дедуп, что у allAfishaFn (collectCleanAfisha). Контакты площадок,
// разведка и внутренние поля сюда не попадают. Ссылки ведут в GTR Event
// (/gtr/tonight?vid=…) с utm — витрина работает и как реклама продукта.
//
//   GET /api/route-events?from=2026-10-25&to=2026-11-15&regions=phuket,smu,pgn,bkk,pty
import { createFileRoute } from "@tanstack/react-router";

import { APP_URL } from "../gtr/app-url";
import { getKvNs } from "../gtr/kv-ns";

const PARTNER_ORIGINS = ["https://bangtaostyle.com", "https://www.bangtaostyle.com"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 300;

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  return PARTNER_ORIGINS.includes(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : { vary: "origin" };
}

export type RouteEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  price?: string;
  poster?: string; // абсолютный URL
  venue: string;
  venueId: string;
  region: string; // код из regions.json
  lat?: number;
  lon?: number;
  url: string; // карточка вечера в GTR Event, а для площадок вне базы — страница RA
  source?: "gtr" | "ra"; // ra — лента Resident Advisor по стране (afisha-ra-area)
};

export const Route = createFileRoute("/api/route-events")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const u = new URL(request.url);
        const from = u.searchParams.get("from") || "";
        const to = u.searchParams.get("to") || "";
        const want = new Set((u.searchParams.get("regions") || "").split(",").map((s) => s.trim()).filter(Boolean));
        const headers = {
          "content-type": "application/json",
          // афиша обновляется кроном раз в 6 часов — 15 минут кэша с запасом
          "cache-control": "public, max-age=900",
          ...cors(request),
        };
        if ((from && !ISO.test(from)) || (to && !ISO.test(to))) {
          return new Response(JSON.stringify({ error: "from/to must be YYYY-MM-DD" }), { status: 400, headers });
        }
        const ns = await getKvNs();
        if (!ns) return new Response(JSON.stringify({ items: [] }), { headers });

        const { collectCleanAfisha } = await import("../gtr/community");
        const { V, regionOf, REGIONS } = await import("../gtr/data/app-data");
        const geo = (await import("../gtr/data/venue-geo.json")).default as Record<string, { lat?: number; lon?: number }>;
        const items: RouteEvent[] = [];
        for (const e of await collectCleanAfisha(ns)) {
          if (from && e.dateIso < from) continue;
          if (to && e.dateIso > to) continue;
          const venue = V(e.vid);
          const region = regionOf(venue);
          if (want.size && !want.has(region)) continue;
          const g = geo[e.vid];
          const poster = e.poster ? (e.poster.startsWith("/") ? APP_URL + e.poster : e.poster) : undefined;
          items.push({
            id: e.id,
            title: e.title,
            date: e.dateIso,
            time: e.time || undefined,
            price: e.price || undefined,
            poster: poster && /^https:\/\//.test(poster) ? poster : undefined,
            venue: e.venueName || venue.name || "",
            venueId: e.vid,
            region,
            lat: typeof g?.lat === "number" ? g.lat : undefined,
            lon: typeof g?.lon === "number" ? g.lon : undefined,
            url: `${APP_URL}/gtr/tonight?vid=${encodeURIComponent(e.vid)}&utm_source=bangtaostyle&utm_medium=route`,
            source: "gtr",
          });
          if (items.length >= MAX_ITEMS) break;
        }
        // Своя афиша покрывает только Пхукет; остальной маршрут — лента RA
        // по стране. Вечер, который уже есть у нас, второй раз не выводим.
        const { readRaRoute } = await import("../gtr/afisha-ra-area");
        const have = new Set(items.map((i) => `${i.date}|${i.title.toLowerCase().slice(0, 12)}`));
        for (const e of await readRaRoute(ns).catch(() => [])) {
          if (items.length >= MAX_ITEMS) break;
          if (from && e.dateIso < from) continue;
          if (to && e.dateIso > to) continue;
          if (want.size && !want.has(e.region)) continue;
          const k = `${e.dateIso}|${e.title.toLowerCase().slice(0, 12)}`;
          if (have.has(k)) continue;
          have.add(k);
          const g = e.vid ? geo[e.vid] : undefined;
          items.push({
            id: e.id,
            title: e.title,
            date: e.dateIso,
            time: e.time,
            poster: e.poster,
            venue: e.vid ? V(e.vid).name || e.venue : e.venue,
            venueId: e.vid || "",
            region: e.region,
            lat: typeof g?.lat === "number" ? g.lat : undefined,
            lon: typeof g?.lon === "number" ? g.lon : undefined,
            url: e.vid
              ? `${APP_URL}/gtr/tonight?vid=${encodeURIComponent(e.vid)}&utm_source=bangtaostyle&utm_medium=route`
              : e.url,
            source: "ra",
          });
        }
        items.sort((a, b) => a.date.localeCompare(b.date));
        const regions = Object.fromEntries(Object.entries(REGIONS).map(([k, r]) => [k, { ru: r.ru, en: r.en }]));
        return new Response(JSON.stringify({ items, regions, source: APP_URL }), { headers });
      },
      OPTIONS: ({ request }: { request: Request }) =>
        new Response(null, { status: 204, headers: { ...cors(request), "access-control-allow-methods": "GET", "access-control-max-age": "86400" } }),
    },
  },
});
