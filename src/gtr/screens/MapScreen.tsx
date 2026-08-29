// Карта Таиланда: регионы чипами, районы контурами, категории знаками.
// Контуры есть во всех шести регионах — Пхукет, Самуи, Панган, Паттайя,
// Бангкок, Пханг-Нга.
//
// Что здесь важно по логике. Район — не фильтр списка, а область на
// карте: нажал «Патонг» — контур загорелся, карта подлетела к границам,
// остальные точки притухли, но не исчезли. Так видно и выбранное, и
// соседей, между которыми гость может перейти пешком.
//
// Откуда берётся контур — двумя способами, и способ виден глазом
// (scripts/map-districts-all.py). Там, где OpenStreetMap знает
// административную сетку целиком — Пхукет и Бангкок, — район собирается
// объединением тамбонов и кхвэнгов, в которых реально стоят его площадки:
// такая линия идёт по дороге, хребту или берегу, потому что так её и
// нарезали на местности. Где сетки нет — Самуи, Панган, Паттайя,
// Пханг-Нга, — рисуется зона вокруг наших же точек, и у неё частый
// пунктир вместо сплошной линии: это не кадастровая граница, и
// притворяться ею она не должна.
//
// Три вещи карта долго не умела, хотя данные для них были.
//
// Найти площадку по названию. Больше сотни точек, и единственным способом
// добраться до конкретной было вспомнить её район и перебрать знаки
// глазами. Теперь есть строка поиска: она же понимает район и тип.
//
// Показать, где сегодня что-то происходит. Продукт про ночную жизнь
// рисовал, где заведения стоят, — но не где сегодня играют. Афиша у нас
// была, до карты она не доезжала.
//
// Ответить «что рядом со мной». Точка своего положения ставилась, а
// списка ближайшего не было: расстояние гость прикидывал на глаз по
// масштабной линейке.
//
// Leaflet грузится только в браузере — SSR его не трогает.
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "leaflet/dist/leaflet.css";
import { addDarkBasemap } from "../map-tiles";

import geoRaw from "../data/venue-geo.json";
import shapesRaw from "../data/district-shapes.json";
import { PH, REGIONS, regionName, regionOf, richOf, V } from "../data/app-data";
import { catOf, MAP_CATS, pinHtml } from "../map-style";
import { useMyLocation } from "../geo-me";
import { gpsTracker } from "../gps-track";
import { mapAfishaFn, type MapAfisha } from "../kv-api";
import { driveUrl, findVenues, kmLabel, nearestOrder, straightKm, walkable } from "../map-find";
import { loadRoute, roadRoute, routeLabel, saveRoute, type LatLon, type RoadRoute } from "../evening-route";

type Geo = Record<string, { lat: number; lon: number; src: string }>;
type Shape = {
  name: string;
  center: [number, number];
  count: number;
  tambons: string[];
  /** «osm» — административная граница по дороге, хребту или берегу;
   *  «venues» — зона вокруг наших точек там, где настоящей границы в
   *  OpenStreetMap нет. Рисуются по-разному: линия против пунктира. */
  src: "osm" | "venues";
  /** контуров может быть несколько: тамбон бывает с островами и анклавами */
  rings: [number, number][][];
};
const GEO = geoRaw as Geo;
/** Районы всех регионов: код региона → кластер → контур.
 *
 *  Лежат в общем чанке данных вместе с базой площадок. Отдельной загрузки
 *  не делаем: сборщик всё равно сводит их в тот же чанк, а ленивый импорт
 *  тогда только усложняет экран, ничего не выигрывая. */
const SHAPES = shapesRaw as unknown as Record<string, Record<string, Shape>>;

const ALL = "Все";

// Выбор региона и категории переживает перезагрузку. Гость на Самуи
// открывал карту и каждый раз видел Пхукет: остров по умолчанию —
// исторический, а не его. Район не запоминаем сознательно: это выбор на
// один взгляд, и застрявший на «Патонге» фильтр читается как поломка.
const PREF_KEY = "gtr-map-view";
type Pref = { region?: string; tag?: string };
const loadPref = (): Pref => {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Pref;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
};
const savePref = (p: Pref) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* приватный режим Safari — выбор просто не переживёт перезагрузку */
  }
};

export function MapScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const L4 = useRef<{
    map: import("leaflet").Map;
    pins: import("leaflet").LayerGroup;
    areas: import("leaflet").LayerGroup;
    /** слой «я и мой вечер»: своя точка, радиус точности, дорога, остановки */
    mine: import("leaflet").LayerGroup;
    /** перерисовка точек: висит на zoomend/moveend, снимается при смене фильтров */
    redraw?: () => void;
  } | null>(null);
  const [tag, setTag] = useState(ALL);
  const [district, setDistrict] = useState(ALL);
  const [region, setRegion] = useState("phuket");
  const [ready, setReady] = useState(false);
  // Смена региона обнуляет район: кластеры соседнего региона тут не живут.
  const pickRegion = (code: string) => {
    setRegion(code);
    setDistrict(ALL);
    savePref({ ...loadPref(), region: code });
  };
  const pickTag = (next: string) => {
    setTag(next);
    savePref({ ...loadPref(), tag: next });
  };
  useEffect(() => {
    const p = loadPref();
    if (p.region && REGIONS[p.region]) setRegion(p.region);
    if (p.tag) setTag(p.tag);
  }, []);

  // Поиск по названию, району и типу.
  const [q, setQ] = useState("");
  // Афиша: у кого сегодня событие, у кого ближайшее и когда.
  const [afisha, setAfisha] = useState<MapAfisha | null>(null);
  const [tonightOnly, setTonightOnly] = useState(false);
  useEffect(() => {
    mapAfishaFn()
      .then(setAfisha)
      .catch(() => setAfisha(null));
  }, []);
  const todaySet = useMemo(() => new Set(afisha?.today ?? []), [afisha]);
  // Единицы расстояния берём из словаря: интерфейс трёхъязычный, а
  // «4.7 км» в английской версии — ровно та мелочь, по которой видно,
  // что перевод делали не до конца.
  const units = useMemo(() => ({ m: t("м"), km: t("км") }), [t]);

  // Своя точка и маршрут вечера. Маршрут собирается на экране «Сегодня» и
  // до сих пор жил только там: на карте острова его не было вовсе.
  const { pos: me, state: geoState, error: geoError, ask: askGeo } = useMyLocation();
  const [route, setRoute] = useState<string[]>([]);
  const [road, setRoad] = useState<RoadRoute | null>(null);
  useEffect(() => setRoute(loadRoute()), []);
  const setSavedRoute = useCallback((next: string[] | ((cur: string[]) => string[])) => {
    setRoute((cur) => {
      const out = typeof next === "function" ? next(cur) : next;
      saveRoute(out);
      return out;
    });
  }, []);

  // Считаем по тем площадкам, у которых есть координата: показывать в
  // счётчике то, чего на карте нет, — обманывать себя же.
  const onMap = useMemo(
    () => PH.venues.filter((v) => GEO[v.id] && regionOf(v) === region),
    [region],
  );
  // Регионы показываем только те, где есть точки: пустой чип — обещание,
  // которое карта не сдержит. Порядок — как в реестре.
  const regionRow = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of PH.venues) if (GEO[v.id]) c[regionOf(v)] = (c[regionOf(v)] || 0) + 1;
    return Object.keys(REGIONS)
      .filter((code) => c[code])
      .map((code) => [code, c[code]] as const);
  }, []);
  const tags = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of onMap) c[v.tag] = (c[v.tag] || 0) + 1;
    return MAP_CATS.filter((x) => c[x.tag]).map((x) => ({ ...x, n: c[x.tag] }));
  }, [onMap]);
  /** Контуры текущего региона. Кластер без контура на карте не рисуется,
   *  но кнопкой-фильтром остаётся. */
  const shapes = useMemo(() => SHAPES[region] ?? {}, [region]);

  const districts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of onMap) if (shapes[v.cluster]) c[v.cluster] = (c[v.cluster] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [onMap, shapes]);

  /** Сколько площадок региона играют сегодня — цифра на переключателе.
   *  Ноль значит «сегодня тихо», и переключатель тогда не показываем:
   *  кнопка, которая гарантированно даёт пустой экран, — ловушка. */
  const tonightN = useMemo(
    () => onMap.filter((v) => todaySet.has(v.id)).length,
    [onMap, todaySet],
  );
  useEffect(() => {
    if (tonightOnly && !tonightN) setTonightOnly(false);
  }, [tonightOnly, tonightN]);

  /** Что реально видно на карте — один список для точек, счётчика и
   *  панели «рядом». Раньше фильтры считались в трёх местах по-разному. */
  const visible = useMemo(
    () =>
      onMap.filter(
        (v) =>
          (tag === ALL || v.tag === tag) &&
          (district === ALL || v.cluster === district) &&
          (!tonightOnly || todaySet.has(v.id)),
      ),
    [onMap, tag, district, tonightOnly, todaySet],
  );

  // Поиск идёт по всей базе с координатами, а не по текущему региону:
  // человек, который ищет «Illuzion», не обязан сперва угадать остров.
  const hits = useMemo(
    () => findVenues(q, PH.venues.filter((v) => GEO[v.id])),
    [q],
  );

  // Центр карты как точка отсчёта для «рядом», когда геолокации нет.
  // Расстояние до середины того, на что смотришь, — честный ответ на
  // «что тут поблизости», и он не требует разрешений.
  const [center, setCenter] = useState<LatLon>([7.95, 98.34]);
  const from: LatLon | null = me ? [me.lat, me.lon] : center;

  /** Ближайшие к точке отсчёта — панель рядом с картой. */
  const nearby = useMemo(() => {
    if (!from) return [];
    return visible
      .map((v) => {
        const g = GEO[v.id]!;
        return { v, km: straightKm(from, [g.lat, g.lon]) };
      })
      .sort((a, b) => a.km - b.km)
      .slice(0, 60);
  }, [visible, from?.[0], from?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Подлёт к площадке из поиска или из списка. Зум 17 не случаен: на нём
  // склейка точек выключена, поэтому у площадки гарантированно есть свой
  // знак — и попап откроется на нём, а не на кусте из шести соседей.
  const pending = useRef<string | null>(null);
  const focusVenue = useCallback(
    (vid: string) => {
      const g = GEO[vid];
      const v = V(vid);
      if (!g || !L4.current) return;
      // Площадка в другом регионе — сперва переключаем регион, иначе она
      // не попадёт в отрисовку и подлёт закончится пустым местом.
      if (v && regionOf(v) !== region) {
        setRegion(regionOf(v));
        setDistrict(ALL);
      }
      setTag(ALL);
      setTonightOnly(false);
      pending.current = vid;
      L4.current.map.flyTo([g.lat, g.lon], 17, { duration: 0.8 });
    },
    [region],
  );

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
      addDarkBasemap(L, map);
      const areas = L.layerGroup().addTo(map);
      const pins = L.layerGroup().addTo(map);
      // Свой слой поверх точек: дорога и «я» не должны тонуть под кустами.
      const mine = L.layerGroup().addTo(map);
      L4.current = { map, pins, areas, mine };
      const track = () => {
        const c = map.getCenter();
        setCenter([c.lat, c.lng]);
      };
      track();
      map.on("moveend", track);
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
      // Ключ склейки — набор границ; у зон он пустой, поэтому склеиваем их
      // по имени: две зоны никогда не совпадают.
      const drawn = new Set<string>();
      const sigOf = (sh: Shape) => (sh.tambons.length ? sh.tambons.join("|") : `~${sh.name}`);
      for (const [key, sh] of Object.entries(shapes)) {
        const sig = sigOf(sh);
        if (drawn.has(sig)) continue;
        drawn.add(sig);
        const on = district !== ALL && shapes[district] && sigOf(shapes[district]) === sig;
        // Зона по нашим точкам — не кадастровая линия, и выглядеть как
        // граница она не должна: у неё пунктир и в невыбранном виде тоже.
        const zone = sh.src === "venues";
        const poly = L.polygon(sh.rings, {
          color: on ? "#E5231B" : "rgba(255,255,255,.26)",
          weight: on ? 2 : 1,
          dashArray: on && !zone ? undefined : zone ? "2 6" : "5 7",
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
      // Подлёт к площадке главнее подлёта к району: он только что заказан
      // человеком, а район — фон, на котором это происходит.
      if (pending.current) return;
      if (district !== ALL && shapes[district]) {
        map.flyToBounds(L.polygon(shapes[district].rings).getBounds(), {
          padding: [30, 30],
          duration: 0.7,
        });
      } else {
        const reg = REGIONS[region];
        map.flyTo(reg?.center ?? [7.95, 98.34], reg?.zoom ?? 11, { duration: 0.7 });
      }
    })();
  }, [ready, district, region, shapes]);

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

        type Bucket = { items: typeof visible; x: number; y: number };
        const grid = new Map<string, Bucket>();
        for (const v of visible) {
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
            const inRoute = route.includes(v.id);
            const live = todaySet.has(v.id);
            const soon = afisha?.next[v.id];
            const icon = L.divIcon({
              className: "",
              // Огонёк над знаком: сегодня здесь играют. Он не заменяет
              // категорию, а надстраивается над ней — заведение остаётся
              // клубом или пляжем, просто сегодня у него вечер.
              html: pinHtml(cat, exact, dim) + (live ? `<i class="gtr-map-live"></i>` : ""),
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            });
            const hero = richOf(v.id).hero;
            const km = from ? straightKm(from, [g.lat, g.lon]) : null;
            const distLine =
              km === null
                ? ""
                : `<div style="font:600 11px/1 'JetBrains Mono',monospace;color:${walkable(km) ? "#A8E06B" : "rgba(255,255,255,.6)"};margin-bottom:7px">${me ? t("от вас") : t("от центра карты")} · ${kmLabel(km, units)}${walkable(km) ? ` · ${t("пешком")}` : ""}</div>`;
            const liveLine = live
              ? `<div style="font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.07em;color:#E5231B;margin-bottom:6px">● ${t("СЕГОДНЯ ИГРАЮТ")}</div>`
              : soon
                ? `<div style="font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.07em;color:var(--gtr-t3);margin-bottom:6px">${t("ближайшее")} · ${soon.slice(8, 10)}.${soon.slice(5, 7)}</div>`
                : "";
            const html = `
              <div style="width:212px;font-family:'Golos Text',sans-serif">
                ${hero ? `<img src="${hero}" style="width:100%;height:92px;object-fit:cover;display:block;margin-bottom:7px" />` : ""}
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                  <span style="width:7px;height:7px;background:${cat.color};display:block"></span>
                  <span style="font:600 10px/1 'JetBrains Mono',monospace;letter-spacing:.07em;color:${cat.color};text-transform:uppercase">${t(cat.ru)}</span>
                </div>
                <div style="font:600 13px/1.45 'Golos Text',sans-serif;color:#fff">${v.name}</div>
                <div style="font:500 11px/1.5 monospace;color:rgba(255,255,255,.72);margin:3px 0 6px">${v.area}${exact ? "" : ` · ${t("примерно")}`}</div>
                ${liveLine}${distLine}
                <button data-vid="${v.id}" class="gtr-map-route" style="font:600 12px/1 'Golos Text',sans-serif;background:${inRoute ? "rgba(123,77,255,.18)" : "transparent"};color:${inRoute ? "#7B4DFF" : "#fff"};border:1px solid ${inRoute ? "#7B4DFF" : "rgba(255,255,255,.25)"};padding:8px 11px;cursor:pointer;width:100%;margin-bottom:6px">${inRoute ? `✓ ${t("В маршруте")}` : `+ ${t("В маршрут вечера")}`}</button>
                <div style="display:flex;gap:6px">
                  <button data-vid="${v.id}" class="gtr-map-open" style="flex:1;font:600 12px/1 'Golos Text',sans-serif;background:#E5231B;color:#fff;border:none;padding:8px 11px;cursor:pointer">${t("Открыть")} →</button>
                  <a href="${driveUrl(g.lat, g.lon)}" target="_blank" rel="noopener noreferrer" style="flex:1;text-align:center;font:600 12px/1 'Golos Text',sans-serif;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.25);padding:8px 11px;text-decoration:none">${t("Доехать")} ↗</a>
                </div>
              </div>`;
            const marker = L.marker([g.lat, g.lon], { icon, zIndexOffset: dim ? 0 : live ? 500 : 400 })
              .addTo(pins)
              .bindPopup(html, { className: "gtr-popup" });
            // Заказанный подлёт: знак только что появился на нужном зуме —
            // открываем на нём попап и снимаем заказ.
            if (pending.current === v.id) {
              pending.current = null;
              marker.openPopup();
            }
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
          const liveN = b.items.filter((v) => todaySet.has(v.id)).length;
          const lat = b.items.reduce((s2, v) => s2 + GEO[v.id]!.lat, 0) / b.items.length;
          const lon = b.items.reduce((s2, v) => s2 + GEO[v.id]!.lon, 0) / b.items.length;
          const icon = L.divIcon({
            className: "",
            html: `<span class="gtr-map-cluster${allDim ? " off" : ""}${liveN ? " live" : ""}" style="--c:${cat.color}">
                     <img src="/brand/emoji4/${cat.sticker}-256.png" alt="" />
                     <b>${b.items.length}</b>
                   </span>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          L.marker([lat, lon], { icon, zIndexOffset: allDim ? 0 : 300 })
            .addTo(pins)
            .bindTooltip(
              liveN ? `${b.items.length} · ${liveN} ${t("сегодня играют")}` : String(b.items.length),
              { direction: "top", className: "gtr-area-tip" },
            )
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
    // route в зависимостях: попап показывает «✓ В маршруте» текущим
    // состоянием, поэтому точки перерисовываем и при смене маршрута.
  }, [ready, district, visible, t, route, todaySet, afisha, me, from?.[0], from?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // Дорога вечера. Считаем от своей точки, если она известна: гость стоит
  // не в первом баре списка, и «сколько ехать» начинается с того места, где
  // он сейчас. Ответ маршрутизатора кэшируется в evening-route.
  const stops = useMemo(
    () => route.map((vid) => GEO[vid]).filter(Boolean).map((g) => [g.lat, g.lon] as LatLon),
    [route],
  );
  useEffect(() => {
    if (stops.length < 1) {
      setRoad(null);
      return;
    }
    let alive = true;
    const pts: LatLon[] = me ? [[me.lat, me.lon], ...stops] : stops;
    void roadRoute(pts).then((r) => {
      if (alive) setRoad(r);
    });
    return () => {
      alive = false;
    };
    // me по координатам, а не по объекту: watchPosition отдаёт новый объект
    // на каждый чих датчика, и маршрут пересчитывался бы бесконечно.
  }, [stops, me?.lat, me?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Рисуем «я и мой вечер»: точка, радиус точности, дорога, остановки.
  useEffect(() => {
    if (!ready || !L4.current) return;
    let stop = false;
    void (async () => {
      const L = await import("leaflet");
      if (stop || !L4.current) return;
      const { mine } = L4.current;
      mine.clearLayers();

      if (road?.line.length) {
        // Тень под линией: по тёмным тайлам тонкая фиолетовая нитка теряется
        // на дорогах и берегах — снизу кладём широкую тёмную подложку.
        L.polyline(road.line, { color: "#0A0B0D", weight: 8, opacity: 0.55 }).addTo(mine);
        L.polyline(road.line, {
          color: "#7B4DFF",
          weight: 4,
          opacity: 0.95,
          // Прямая — это признание, что дороги мы не знаем. Пунктир говорит
          // об этом честно, вместо того чтобы выдавать её за маршрут.
          dashArray: road.real ? undefined : "7 8",
        }).addTo(mine);
      }

      stops.forEach((p, i) => {
        const vid = route[i];
        L.marker(p, {
          zIndexOffset: 600,
          icon: L.divIcon({
            className: "",
            html: `<span class="gtr-map-stop">${i + 1}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        })
          .addTo(mine)
          .bindTooltip(`${i + 1}. ${V(vid)?.name ?? ""}`, { direction: "top", className: "gtr-area-tip" });
      });

      if (me) {
        // Круг точности рисуем только когда он о чём-то говорит: при ±5 м
        // это точка под маркером, а при ±2 км — честное «где-то здесь».
        if (me.accuracy > 25)
          L.circle([me.lat, me.lon], {
            radius: me.accuracy,
            color: "#4A90E2",
            weight: 1,
            opacity: 0.5,
            fillColor: "#4A90E2",
            fillOpacity: 0.1,
          }).addTo(mine);
        L.marker([me.lat, me.lon], {
          zIndexOffset: 1000,
          icon: L.divIcon({ className: "", html: `<span class="gtr-map-me"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        })
          .addTo(mine)
          .bindTooltip(t("Вы здесь"), { direction: "top", className: "gtr-area-tip" });
      }
    })();
    return () => {
      stop = true;
    };
  }, [ready, road, stops, route, me, t]);

  // Первый раз, когда позиция найдена, — показываем её. Дальше карту не
  // трогаем: гость двигает её сам, и рывок к себе на каждом обновлении
  // датчика не даёт ничего рассмотреть.
  const centred = useRef(false);
  useEffect(() => {
    if (!ready || !me || centred.current || !L4.current) return;
    centred.current = true;
    L4.current.map.flyTo([me.lat, me.lon], 14, { duration: 0.8 });
  }, [ready, me]);

  // клики из попапов (HTML вне React)
  useEffect(() => {
    const h = (e: Event) => {
      const el = e.target as HTMLElement;
      const open = el.closest?.(".gtr-map-open");
      if (open) {
        const vid = open.getAttribute("data-vid");
        if (vid) navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid } });
        return;
      }
      // Собрать маршрут прямо на карте: тап по «в маршрут» добавляет или
      // убирает площадку. Линия и подпись километража перерисуются сами,
      // маршрут — тот же, что на «Сегодня» и в трекере (общее хранилище).
      const routeBtn = el.closest?.(".gtr-map-route");
      if (routeBtn) {
        const vid = routeBtn.getAttribute("data-vid");
        if (vid) setSavedRoute((cur) => (cur.includes(vid) ? cur.filter((x) => x !== vid) : [...cur, vid]));
      }
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [navigate, setSavedRoute]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="gtr-oswald gtr-h1">{t("Карта")}</h1>
        <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)", letterSpacing: ".12em" }}>
          {visible.length} / {onMap.length}
        </span>
      </div>

      {/* Поиск и переключатель «сегодня» — одна строка: два способа
          сузить сотню точек до той, ради которой сюда пришли. */}
      <div className="gtr-map-find">
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <input
            className="gtr-input"
            style={{ width: "100%", padding: "9px 30px 9px 11px", fontSize: 13 }}
            placeholder={t("Найти площадку, район или тип…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key === "Enter" && hits[0]) {
                focusVenue(hits[0].id);
                setQ("");
              }
            }}
          />
          {q ? (
            <button
              aria-label={t("Очистить")}
              onClick={() => setQ("")}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--gtr-t3)",
                cursor: "pointer",
                font: "500 15px/1 'Golos Text',sans-serif",
                padding: 4,
              }}
            >
              ✕
            </button>
          ) : null}
          {hits.length ? (
            <div className="gtr-map-hits">
              {hits.map((v) => {
                const cat = catOf(v.tag);
                return (
                  <button
                    key={v.id}
                    className="gtr-map-hit"
                    onClick={() => {
                      focusVenue(v.id);
                      setQ("");
                    }}
                  >
                    <span style={{ width: 7, height: 7, background: cat.color, display: "block", flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block", font: "600 13px/1.4 'Golos Text',sans-serif", color: "#fff" }}>
                        {v.name}
                      </span>
                      <span
                        className="gtr-mono"
                        style={{ display: "block", font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                      >
                        {v.area} · {t(cat.ru)}
                      </span>
                    </span>
                    {todaySet.has(v.id) ? (
                      <span style={{ font: "700 10px/1 'JetBrains Mono',monospace", color: "#E5231B", flex: "none" }}>
                        ●
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {tonightN ? (
          <button
            className={`gtr-map-chip${tonightOnly ? " on" : ""}`}
            style={tonightOnly ? { borderColor: "#E5231B" } : undefined}
            onClick={() => setTonightOnly(!tonightOnly)}
          >
            <span style={{ color: "#E5231B" }}>●</span> {t("Сегодня играют")} · {tonightN}
          </button>
        ) : null}
      </div>

      {/* регионы: Пхукет — исторический дом, остальные подключаются по мере
          наполнения. Чип виден только когда региону есть что показать. */}
      {regionRow.length > 1 && (
        <div className="gtr-map-row">
          {regionRow.map(([code, n]) => (
            <button
              key={code}
              className={`gtr-map-chip${region === code ? " on" : ""}`}
              onClick={() => pickRegion(code)}
            >
              {regionName(code, i18n.language)} · {n}
            </button>
          ))}
        </div>
      )}

      {/* районы: выбор области, а не фильтр списка */}
      <div className="gtr-map-row">
        <button className={`gtr-map-chip${district === ALL ? " on" : ""}`} onClick={() => setDistrict(ALL)}>
          {region === "phuket" ? t("Весь остров") : t("Весь регион")}
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
        <button className={`gtr-map-chip${tag === ALL ? " on" : ""}`} onClick={() => pickTag(ALL)}>
          {t("Все категории")}
        </button>
        {tags.map((c) => (
          <button
            key={c.tag}
            className={`gtr-map-chip${tag === c.tag ? " on" : ""}`}
            style={tag === c.tag ? { borderColor: c.color, color: "#fff" } : undefined}
            onClick={() => pickTag(tag === c.tag ? ALL : c.tag)}
          >
            <img src={`/brand/emoji4/${c.sticker}-256.png`} alt="" className="gtr-map-chip-stk" />
            <span style={{ color: tag === c.tag ? "#fff" : c.color }}>{t(c.ru)}</span>
            <span style={{ opacity: 0.5 }}>{c.n}</span>
          </button>
        ))}
      </div>

      {/* Своя точка и маршрут вечера */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "10px 0 0",
          font: "500 12.5px/1.5 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
        }}
      >
        {geoState === "on" ? (
          <span className="gtr-mono" style={{ font: "600 11.5px/1 'JetBrains Mono',monospace", color: "#4A90E2" }}>
            {t("Вы здесь")}
            {me && me.accuracy > 25 ? ` · ±${Math.round(me.accuracy)} ${t("м")}` : ""}
          </span>
        ) : (
          <button className="gtr-btn" onClick={askGeo} disabled={geoState === "asking"}>
            {geoState === "asking" ? `${t("Ищем вас")}…` : t("Показать меня на карте")}
          </button>
        )}
        {geoState === "denied" ? (
          <span style={{ color: "var(--gtr-t3)" }}>
            {t("Доступ к геолокации закрыт — включите его в настройках браузера для этого сайта.")}
          </span>
        ) : null}
        {geoState === "unavailable" && geoError ? (
          <span style={{ color: "var(--gtr-t3)" }}>{t("Не удалось определить местоположение")}</span>
        ) : null}

        {route.length ? (
          <>
            <span style={{ color: "var(--gtr-t3)" }}>·</span>
            <span className="gtr-mono" style={{ font: "600 11.5px/1 'JetBrains Mono',monospace", color: "#7B4DFF" }}>
              {t("МАРШРУТ ВЕЧЕРА")} · {route.length}
              {road ? ` · ${routeLabel(road)}` : ""}
            </span>
            {road && !road.real ? (
              <span style={{ color: "var(--gtr-t3)" }}>
                {t("дорога недоступна — показана прямая")}
              </span>
            ) : null}
            {/* Начать вечер: запускаем марафон-трекер по собранному маршруту
                и уходим на экран трекера с чек-инами. Нужно ≥2 точки —
                маршрут из одной остановки это не марафон. */}
            {route.length >= 2 ? (
              <button
                className="gtr-btn gtr-btn-red"
                style={{ padding: "6px 11px", fontSize: 12 }}
                onClick={() => {
                  gpsTracker.startTrack(route);
                  navigate({ to: "/gtr/$screen", params: { screen: "tracking" } });
                }}
              >
                {t("Начать вечер")} →
              </button>
            ) : null}
            <button
              className="gtr-btn"
              style={{ padding: "6px 11px", fontSize: 12 }}
              onClick={() => setSavedRoute([])}
            >
              {t("Очистить")}
            </button>
          </>
        ) : (
          <span style={{ color: "var(--gtr-t3)" }}>
            {t("Нажмите на площадку и добавьте её «в маршрут вечера» — соберите бар-хоппинг прямо на карте.")}
          </span>
        )}
      </div>

      {/* Порядок остановок. Раньше он был порядком добавления и никак не
          правился: убрать точку можно было только найдя её же на карте. */}
      {route.length > 1 ? (
        <div className="gtr-map-stops">
          {route.map((vid, i) => {
            const v = V(vid);
            const g = GEO[vid];
            const prev = i > 0 ? GEO[route[i - 1]] : null;
            const leg = prev && g ? straightKm([prev.lat, prev.lon], [g.lat, g.lon]) : null;
            return (
              <div key={vid} className="gtr-map-stop-row">
                <span className="gtr-map-stop-n">{i + 1}</span>
                <button
                  className="gtr-map-stop-name"
                  onClick={() => focusVenue(vid)}
                  title={t("Показать на карте")}
                >
                  {v?.name ?? vid}
                  {leg !== null ? (
                    <span className="gtr-mono" style={{ marginLeft: 8, color: "var(--gtr-t3)", fontSize: 11 }}>
                      +{kmLabel(leg, units)}
                    </span>
                  ) : null}
                </button>
                <button
                  className="gtr-btn"
                  style={{ padding: "3px 7px", fontSize: 12 }}
                  disabled={i === 0}
                  aria-label={t("Выше")}
                  onClick={() =>
                    setSavedRoute((cur) => {
                      const n = [...cur];
                      [n[i - 1], n[i]] = [n[i], n[i - 1]];
                      return n;
                    })
                  }
                >
                  ↑
                </button>
                <button
                  className="gtr-btn"
                  style={{ padding: "3px 7px", fontSize: 12 }}
                  disabled={i === route.length - 1}
                  aria-label={t("Ниже")}
                  onClick={() =>
                    setSavedRoute((cur) => {
                      const n = [...cur];
                      [n[i], n[i + 1]] = [n[i + 1], n[i]];
                      return n;
                    })
                  }
                >
                  ↓
                </button>
                <button
                  className="gtr-btn"
                  style={{ padding: "3px 7px", fontSize: 12, color: "#E5231B" }}
                  aria-label={t("Убрать")}
                  onClick={() => setSavedRoute((cur) => cur.filter((x) => x !== vid))}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            className="gtr-btn"
            style={{ padding: "6px 11px", fontSize: 12, justifySelf: "start" }}
            onClick={() =>
              setSavedRoute((cur) =>
                nearestOrder(from, cur, (vid) => {
                  const g = GEO[vid];
                  return g ? [g.lat, g.lon] : null;
                }),
              )
            }
          >
            {t("Собрать по кратчайшей")}
          </button>
        </div>
      ) : null}

      {/* Карта и список рядом. На телефоне список уходит под карту —
          gtr-md-stack ломает сетку в один столбец на 860px. */}
      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1fr 292px", gap: 12, alignItems: "start" }}
      >
        <div ref={mapRef} className="gtr-map-canvas" />
        <div className="gtr-map-side">
          <div className="gtr-map-side-head">
            <span className="gtr-mono" style={{ font: "600 10px/1 'JetBrains Mono',monospace", letterSpacing: ".12em", color: "var(--gtr-t2)" }}>
              {me ? t("БЛИЖЕ ВСЕГО К ВАМ") : t("В ЦЕНТРЕ КАРТЫ")}
            </span>
            <span className="gtr-mono" style={{ font: "600 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
              {nearby.length}
            </span>
          </div>
          {nearby.length ? (
            <div className="gtr-map-side-list">
              {nearby.map(({ v, km }) => {
                const cat = catOf(v.tag);
                const live = todaySet.has(v.id);
                const inRoute = route.includes(v.id);
                return (
                  <div key={v.id} className="gtr-map-side-row">
                    <button className="gtr-map-side-pick" onClick={() => focusVenue(v.id)}>
                      <span style={{ width: 6, height: 6, background: cat.color, display: "block", flex: "none" }} />
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <span
                          style={{
                            display: "block",
                            font: "600 12.5px/1.4 'Golos Text',sans-serif",
                            color: "#fff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {live ? <span style={{ color: "#E5231B", marginRight: 5 }}>●</span> : null}
                          {v.name}
                        </span>
                        <span
                          className="gtr-mono"
                          style={{
                            display: "block",
                            font: "500 10.5px/1.5 'JetBrains Mono',monospace",
                            color: walkable(km) ? "#A8E06B" : "var(--gtr-t3)",
                          }}
                        >
                          {kmLabel(km, units)}
                          {walkable(km) ? ` · ${t("пешком")}` : ""} · {v.area}
                        </span>
                      </span>
                    </button>
                    <button
                      className="gtr-map-side-add"
                      title={inRoute ? t("В маршруте") : t("В маршрут вечера")}
                      style={inRoute ? { color: "#7B4DFF", borderColor: "#7B4DFF" } : undefined}
                      onClick={() =>
                        setSavedRoute((cur) =>
                          cur.includes(v.id) ? cur.filter((x) => x !== v.id) : [...cur, v.id],
                        )
                      }
                    >
                      {inRoute ? "✓" : "+"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "14px 12px", font: "500 12.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Под выбранные фильтры ничего не попало — снимите часть условий.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
