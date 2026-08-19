// Карта Пхукета: 110 заведений, районы контурами, категории знаками.
//
// Что здесь важно по логике. Район — не фильтр списка, а область на
// карте: нажал «Патонг» — контур загорелся, карта подлетела к границам,
// остальные точки притухли, но не исчезли. Так видно и выбранное, и
// соседей, между которыми гость может перейти пешком.
//
// Контуры районов — настоящие рубежи, а не оболочка вокруг точек. Взяты
// административные границы тамбонов Пхукета из OpenStreetMap: тамбон
// отделяется от соседа ровно по дороге, хребту или берегу, потому что так
// его и нарезали на местности. Наш кластер собирается как объединение
// тамбонов, в которых реально стоят его площадки (scripts/map-districts-osm.py).
//
// Leaflet грузится только в браузере — SSR его не трогает.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "leaflet/dist/leaflet.css";

import geoRaw from "../data/venue-geo.json";
import shapesRaw from "../data/district-shapes.json";
import { PH, richOf } from "../data/app-data";
import { catOf, MAP_CATS, pinHtml } from "../map-style";

type Geo = Record<string, { lat: number; lon: number; src: string }>;
type Shape = {
  name: string;
  center: [number, number];
  count: number;
  tambons: string[];
  /** контуров может быть несколько: тамбон бывает с островами и анклавами */
  rings: [number, number][][];
};
const GEO = geoRaw as Geo;
const SHAPES = shapesRaw as unknown as Record<string, Shape>;

const ALL = "Все";

export function MapScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const L4 = useRef<{
    map: import("leaflet").Map;
    pins: import("leaflet").LayerGroup;
    areas: import("leaflet").LayerGroup;
    /** перерисовка точек: висит на zoomend/moveend, снимается при смене фильтров */
    redraw?: () => void;
  } | null>(null);
  const [tag, setTag] = useState(ALL);
  const [district, setDistrict] = useState(ALL);
  const [ready, setReady] = useState(false);

  // Считаем по тем площадкам, у которых есть координата: показывать в
  // счётчике то, чего на карте нет, — обманывать себя же.
  const onMap = useMemo(() => PH.venues.filter((v) => GEO[v.id]), []);
  const tags = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of onMap) c[v.tag] = (c[v.tag] || 0) + 1;
    return MAP_CATS.filter((x) => c[x.tag]).map((x) => ({ ...x, n: c[x.tag] }));
  }, [onMap]);
  const districts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of onMap) if (SHAPES[v.cluster]) c[v.cluster] = (c[v.cluster] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [onMap]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const L = await import("leaflet");
      if (!alive || !mapRef.current || L4.current) return;
      const map = L.map(mapRef.current, {
        center: [7.95, 98.34],
        zoom: 11,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap · &copy; CARTO",
        maxZoom: 19,
        className: "gtr-map-tiles",
      }).addTo(map);
      const areas = L.layerGroup().addTo(map);
      const pins = L.layerGroup().addTo(map);
      L4.current = { map, pins, areas };
      setReady(true);
    })();
    return () => {
      alive = false;
      L4.current?.map.remove();
      L4.current = null;
    };
  }, []);

  // Контуры районов. Выбранный горит, остальные держат тонкую пунктирную
  // линию — остров должен читаться целиком, даже когда смотришь на один
  // район.
  useEffect(() => {
    if (!ready || !L4.current) return;
    void (async () => {
      const L = await import("leaflet");
      const { areas, map } = L4.current!;
      areas.clearLayers();
      // Старый город и Пхукет-таун — один и тот же тамбон. Рисовать его
      // дважды нельзя: заливки складываются и район выглядит ярче
      // выбранного. Поэтому контур один, а зажигают его обе кнопки.
      const drawn = new Set<string>();
      for (const [key, sh] of Object.entries(SHAPES)) {
        const sig = sh.tambons.join("|");
        if (drawn.has(sig)) continue;
        drawn.add(sig);
        const on =
          district !== ALL && SHAPES[district] && SHAPES[district].tambons.join("|") === sig;
        const poly = L.polygon(sh.rings, {
          color: on ? "#E5231B" : "rgba(255,255,255,.26)",
          weight: on ? 2 : 1,
          dashArray: on ? undefined : "5 7",
          fillColor: on ? "#E5231B" : "#ffffff",
          fillOpacity: on ? 0.1 : 0.035,
          interactive: true,
          className: on ? "gtr-area on" : "gtr-area",
        }).addTo(areas);
        poly.on("click", () => setDistrict(on ? ALL : key));
        poly.bindTooltip(`${sh.name} · ${sh.count}`, {
          className: "gtr-area-tip",
          direction: "center",
        });
      }
      if (district !== ALL && SHAPES[district]) {
        map.flyToBounds(L.polygon(SHAPES[district].rings).getBounds(), {
          padding: [30, 30],
          duration: 0.7,
        });
      } else {
        map.flyTo([7.95, 98.34], 11, { duration: 0.7 });
      }
    })();
  }, [ready, district]);

  // Точки: знак категории в кольце её цвета, со склейкой близких.
  //
  // В Патонге тридцать шесть заведений стоят в полутора километрах друг
  // от друга, и на общем зуме они превращались в кашу из наложенных
  // кружков — половина площадок была просто не видна. Поэтому точки,
  // попавшие в одну ячейку экранной сетки, сливаются в один знак со
  // счётчиком; нажатие на него приближает карту к этой группе, и знаки
  // разлетаются сами.
  useEffect(() => {
    if (!ready || !L4.current) return;
    let stop = false;
    void (async () => {
      const L = await import("leaflet");
      const { pins, map } = L4.current!;

      const draw = () => {
        if (stop) return;
        pins.clearLayers();
        const z = map.getZoom();
        // Ближе к улице склейка мешает: там уже видно каждый дом.
        // Ячейка шире самого знака: центры соседних ячеек лежат на
        // расстоянии ячейки, а знак с счётчиком занимает 40 точек — при
        // равных значениях кусты садились друг на друга.
        const cell = z >= 15 ? 0 : z >= 13 ? 46 : 56;
        const shown = onMap.filter((v) => tag === ALL || v.tag === tag);

        type Bucket = { items: typeof shown; x: number; y: number };
        const grid = new Map<string, Bucket>();
        for (const v of shown) {
          const g = GEO[v.id]!;
          const pt = map.latLngToContainerPoint([g.lat, g.lon]);
          const key = cell ? `${Math.round(pt.x / cell)}:${Math.round(pt.y / cell)}` : v.id;
          const b = grid.get(key);
          if (b) b.items.push(v);
          else grid.set(key, { items: [v], x: pt.x, y: pt.y });
        }

        for (const b of grid.values()) {
          if (b.items.length === 1) {
            const v = b.items[0];
            const g = GEO[v.id]!;
            const cat = catOf(v.tag);
            const exact = g.src === "nominatim";
            const dim = district !== ALL && v.cluster !== district;
            const icon = L.divIcon({
              className: "",
              html: pinHtml(cat, exact, dim),
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            });
            const hero = richOf(v.id).hero;
            const html = `
              <div style="width:206px;font-family:'Golos Text',sans-serif">
                ${hero ? `<img src="${hero}" style="width:100%;height:92px;object-fit:cover;display:block;margin-bottom:7px" />` : ""}
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                  <span style="width:7px;height:7px;background:${cat.color};display:block"></span>
                  <span style="font:600 8.5px/1 'JetBrains Mono',monospace;letter-spacing:.1em;color:${cat.color};text-transform:uppercase">${t(cat.ru)}</span>
                </div>
                <div style="font:600 12.5px/1.3 'Golos Text',sans-serif;color:#fff">${v.name}</div>
                <div style="font:500 9.5px/1.4 monospace;color:rgba(255,255,255,.55);margin:3px 0 8px">${v.area}${exact ? "" : ` · ${t("примерно")}`}</div>
                <button data-vid="${v.id}" class="gtr-map-open" style="font:600 10px/1 'Golos Text',sans-serif;background:#E5231B;color:#fff;border:none;padding:7px 11px;cursor:pointer;width:100%">${t("Открыть заведение")} →</button>
              </div>`;
            L.marker([g.lat, g.lon], { icon, zIndexOffset: dim ? 0 : 400 })
              .addTo(pins)
              .bindPopup(html, { className: "gtr-popup" });
            continue;
          }

          // Группа. Знак берём у самой частой категории внутри — так
          // видно характер куста: пляжный, клубный или отельный.
          const byCat: Record<string, number> = {};
          for (const v of b.items) byCat[v.tag] = (byCat[v.tag] || 0) + 1;
          const top = Object.entries(byCat).sort((a, c) => c[1] - a[1])[0][0];
          const cat = catOf(top);
          const allDim =
            district !== ALL && b.items.every((v) => v.cluster !== district);
          const lat = b.items.reduce((s2, v) => s2 + GEO[v.id]!.lat, 0) / b.items.length;
          const lon = b.items.reduce((s2, v) => s2 + GEO[v.id]!.lon, 0) / b.items.length;
          const icon = L.divIcon({
            className: "",
            html: `<span class="gtr-map-cluster${allDim ? " off" : ""}" style="--c:${cat.color}">
                     <img src="/brand/emoji4/${cat.sticker}-256.png" alt="" />
                     <b>${b.items.length}</b>
                   </span>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          L.marker([lat, lon], { icon, zIndexOffset: allDim ? 0 : 300 })
            .addTo(pins)
            .on("click", () => map.flyTo([lat, lon], Math.min(17, z + 3), { duration: 0.6 }));
        }
      };

      draw();
      map.on("zoomend moveend", draw);
      L4.current!.redraw = draw;
    })();
    return () => {
      stop = true;
      const m = L4.current;
      if (m?.redraw) m.map.off("zoomend moveend", m.redraw);
    };
  }, [ready, tag, district, onMap, t]);

  // клики из попапов (HTML вне React)
  useEffect(() => {
    const h = (e: Event) => {
      const btn = (e.target as HTMLElement).closest?.(".gtr-map-open");
      const vid = btn?.getAttribute("data-vid");
      if (vid) navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid } });
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [navigate]);

  const shown = onMap.filter(
    (v) => (tag === ALL || v.tag === tag) && (district === ALL || v.cluster === district),
  ).length;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="gtr-oswald gtr-h1">{t("Карта")}</h1>
        <span className="gtr-mono" style={{ font: "600 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)", letterSpacing: ".12em" }}>
          {shown} / {onMap.length}
        </span>
      </div>

      {/* районы: выбор области, а не фильтр списка */}
      <div className="gtr-map-row">
        <button className={`gtr-map-chip${district === ALL ? " on" : ""}`} onClick={() => setDistrict(ALL)}>
          {t("Весь остров")}
        </button>
        {districts.map(([k, n]) => (
          <button
            key={k}
            className={`gtr-map-chip${district === k ? " on" : ""}`}
            onClick={() => setDistrict(district === k ? ALL : k)}
          >
            {k} · {n}
          </button>
        ))}
      </div>

      {/* категории: знак и цвет те же, что на точках */}
      <div className="gtr-map-row">
        <button className={`gtr-map-chip${tag === ALL ? " on" : ""}`} onClick={() => setTag(ALL)}>
          {t("Все категории")}
        </button>
        {tags.map((c) => (
          <button
            key={c.tag}
            className={`gtr-map-chip${tag === c.tag ? " on" : ""}`}
            style={tag === c.tag ? { borderColor: c.color, color: "#fff" } : undefined}
            onClick={() => setTag(tag === c.tag ? ALL : c.tag)}
          >
            <img src={`/brand/emoji4/${c.sticker}-256.png`} alt="" className="gtr-map-chip-stk" />
            <span style={{ color: tag === c.tag ? "#fff" : c.color }}>{t(c.ru)}</span>
            <span style={{ opacity: 0.5 }}>{c.n}</span>
          </button>
        ))}
      </div>

      <div ref={mapRef} className="gtr-map-canvas" />
    </div>
  );
}
