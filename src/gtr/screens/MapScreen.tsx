// Карта Пхукета: все 104 заведений точками (точный геокод или центр района),
// тёмные тайлы Carto, попап с фото и переходом в паспорт. Leaflet грузится
// только в браузере — SSR его не трогает.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "leaflet/dist/leaflet.css";

import geoRaw from "../data/venue-geo.json";
import { PH, richOf } from "../data/app-data";
import { Chip } from "../ui";

type Geo = Record<string, { lat: number; lon: number; src: string }>;
const GEO = geoRaw as Geo;

export function MapScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ map: import("leaflet").Map; layer: import("leaflet").LayerGroup } | null>(null);
  const [tag, setTag] = useState("Все");
  const [ready, setReady] = useState(false);

  const tags = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of PH.venues) if (GEO[v.id]) c[v.tag] = (c[v.tag] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const L = await import("leaflet");
      if (!alive || !mapRef.current || leafletRef.current) return;
      const map = L.map(mapRef.current, {
        center: [7.95, 98.34],
        zoom: 11,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; OpenStreetMap · &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      leafletRef.current = { map, layer };
      setReady(true);
    })();
    return () => {
      alive = false;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    };
  }, []);

  // маркеры: фирменные квадраты, красный — точный адрес, серый — район
  useEffect(() => {
    if (!ready || !leafletRef.current) return;
    void (async () => {
      const L = await import("leaflet");
      const { layer } = leafletRef.current!;
      layer.clearLayers();
      for (const v of PH.venues) {
        const g = GEO[v.id];
        if (!g || (tag !== "Все" && v.tag !== tag)) continue;
        const exact = g.src === "nominatim";
        const icon = L.divIcon({
          className: "",
          html: `<span style="display:block;width:13px;height:13px;background:${exact ? "#E5231B" : "rgba(255,255,255,.55)"};border:2px solid #0A0B0D;box-shadow:0 0 0 1px ${exact ? "#E5231B" : "rgba(255,255,255,.35)"}"></span>`,
          iconSize: [13, 13],
          iconAnchor: [7, 7],
        });
        const hero = richOf(v.id).hero;
        const html = `
          <div style="width:200px;font-family:'Golos Text',sans-serif">
            ${hero ? `<img src="${hero}" style="width:100%;height:92px;object-fit:cover;display:block;margin-bottom:7px" />` : ""}
            <div style="font:600 12.5px/1.3 'Golos Text',sans-serif;color:#fff">${v.name}</div>
            <div style="font:500 9.5px/1.4 monospace;color:rgba(255,255,255,.55);margin:3px 0 8px">${v.type} · ${v.area}${exact ? "" : ` · ${t("примерно")}`}</div>
            <button data-vid="${v.id}" class="gtr-map-open" style="font:600 10px/1 'Golos Text',sans-serif;background:#E5231B;color:#fff;border:none;padding:7px 11px;cursor:pointer;width:100%">${t("Открыть заведение")} →</button>
          </div>`;
        L.marker([g.lat, g.lon], { icon }).addTo(layer).bindPopup(html, { className: "gtr-popup" });
      }
    })();
  }, [ready, tag, t]);

  // клики из попапов (HTML вне React)
  useEffect(() => {
    const h = (e: Event) => {
      const btn = (e.target as HTMLElement).closest?.(".gtr-map-open");
      const vid = btn?.getAttribute("data-vid");
      if (vid)
        navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid } });
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [navigate]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 className="gtr-oswald gtr-h1">{t("Карта")}</h1>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Chip color="#E5231B">{t("ТОЧНЫЙ АДРЕС")}</Chip>
          <Chip color="rgba(255,255,255,.5)">{t("РАЙОН")}</Chip>
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
          {[["Все", PH.venues.length] as [string, number], ...tags].map(([k, n]) => (
            <button
              key={k}
              onClick={() => setTag(k)}
              style={{
                border: `1px solid ${tag === k ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                background: tag === k ? "rgba(229,35,27,.15)" : "transparent",
                color: tag === k ? "#fff" : "rgba(255,255,255,.6)",
                padding: "6px 10px",
                cursor: "pointer",
                font: "500 10.5px/1 'Golos Text',sans-serif",
              }}
            >
              {k === "Все" ? t("Все") : k} · {n}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={mapRef}
        style={{
          height: "calc(100dvh - 190px)",
          minHeight: 420,
          border: "1px solid rgba(255,255,255,.1)",
          background: "#0A0B0D",
        }}
      />
    </div>
  );
}
