// GPS-трекер: визуальное отображение маршрута, чек-ины, статистика вечера.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "leaflet/dist/leaflet.css";

import { V } from "../data/app-data";
import geoRaw from "../data/venue-geo.json";
import { Card, Eyebrow } from "../ui";
import { gpsTracker, useGpsTracking, type ActiveTrack } from "../gps-track";

const GEO = geoRaw as Record<string, { lat: number; lon: number; src: string }>;

export function TrackingScreen() {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const L4 = useRef<{
    map: import("leaflet").Map;
    userMarker?: import("leaflet").Marker;
    routePolyline?: import("leaflet").Polyline;
    checkInMarkers: Map<string, import("leaflet").Marker>;
  } | null>(null);

  const [track, setTrack] = useState<ActiveTrack | null>(null);
  const [selectedVid, setSelectedVid] = useState<string>("");
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingText, setRatingText] = useState("");
  const { location: currentLocation, error: gpsError, isTracking } = useGpsTracking(true);

  // Загружаем трек при монтировании
  useEffect(() => {
    const active = gpsTracker.getActiveTrack();
    setTrack(active);
  }, []);

  // Инициализируем карту
  useEffect(() => {
    if (!mapRef.current || L4.current) return;

    void (async () => {
      const L = await import("leaflet");

      // Если нет активного трека, показываем последнюю позицию
      const center: [number, number] = currentLocation
        ? [currentLocation.lat, currentLocation.lon]
        : [7.95, 98.34];

      const map = L.map(mapRef.current!, {
        center,
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap · &copy; CARTO",
        maxZoom: 19,
        className: "gtr-map-tiles",
      }).addTo(map);

      L4.current = {
        map,
        checkInMarkers: new Map(),
      };
    })();

    return () => {
      L4.current?.map.remove();
      L4.current = null;
    };
  }, []);

  // Обновляем позицию юзера на карте
  useEffect(() => {
    if (!L4.current || !currentLocation || !mapRef.current) return;

    void (async () => {
      const L = await import("leaflet");
      if (!L4.current) return;

      const userIcon = L.icon({
        iconUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='8' fill='%234A90E2'/%3E%3Ccircle cx='12' cy='12' r='6' fill='%23fff' opacity='0.8'/%3E%3C/svg%3E",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      if (L4.current.userMarker) {
        L4.current.userMarker.setLatLng([currentLocation.lat, currentLocation.lon]);
      } else {
        L4.current.userMarker = L.marker([currentLocation.lat, currentLocation.lon], {
          icon: userIcon,
          zIndexOffset: 1000,
        }).addTo(L4.current.map);
      }

      L4.current.map.panTo([currentLocation.lat, currentLocation.lon]);
    })();
  }, [currentLocation]);

  // Рисуем маршрут и чек-ины
  useEffect(() => {
    if (!L4.current || !track) return;

    void (async () => {
      const L = await import("leaflet");

      // Рисуем маршрут
      if (L4.current!.routePolyline) {
        L4.current!.map.removeLayer(L4.current!.routePolyline);
      }

      const routePoints: [number, number][] = [];
      for (const vid of track.routeIds) {
        const g = GEO[vid];
        if (g) routePoints.push([g.lat, g.lon]);
      }

      if (routePoints.length > 1) {
        L4.current!.routePolyline = L.polyline(routePoints, {
          color: "#7B4DFF",
          weight: 2,
          opacity: 0.7,
          dashArray: "5,5",
        }).addTo(L4.current!.map);
      }

      // Рисуем маркеры чек-инов
      L4.current!.checkInMarkers.forEach((marker) => L4.current!.map.removeLayer(marker));
      L4.current!.checkInMarkers.clear();

      for (let i = 0; i < track.routeIds.length; i++) {
        const vid = track.routeIds[i];
        const g = GEO[vid];
        if (!g) continue;

        const checkIn = track.checkIns.find((c) => c.vid === vid);
        const visited = !!checkIn?.arrivedAt;
        const idx = i + 1;

        const checkInIcon = L.divIcon({
          className: "",
          html: `<div style="
            display:flex;align-items:center;justify-content:center;
            width:34px;height:34px;
            border-radius:50%;
            background:${visited ? "#E5231B" : "#7B4DFF"};
            border:2px solid #fff;
            color:#fff;
            font-weight:700;
            font-size:14px;
            font-family:monospace;
          ">${idx}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = L.marker([g.lat, g.lon], { icon: checkInIcon })
          .bindPopup(
            // Разметка строкой — значит t() внутри не сработает: подписи
            // переводим здесь и передаём готовыми.
            `<div style="font-family:'Golos Text',sans-serif;width:190px">
            <div style="font:600 13px/1.45 'Golos Text',sans-serif;margin-bottom:8px">${V(vid).name}</div>
            ${
              visited
                ? `<div style="font:500 11px/1.5 'JetBrains Mono',monospace;color:rgba(255,255,255,.72);margin-bottom:6px">✓ ${t("Посещено")}</div>`
                : ""
            }
            <button data-check-in="${vid}" style="
              background:#7B4DFF;color:#fff;border:none;padding:8px 10px;
              width:100%;cursor:pointer;font:600 12px/1 'Golos Text',sans-serif
            ">${visited ? t("Чек-аут") : t("Чек-ин")}</button>
          </div>`,
            { className: "gtr-popup" },
          )
          .addTo(L4.current!.map);

        L4.current!.checkInMarkers.set(vid, marker);
      }
    })();
    // t в зависимостях: подписи внутри попапа собираются строкой один раз,
    // без этого смена языка не доедет до уже нарисованных маркеров.
  }, [track, t]);

  // Обновляем трек в реальном времени
  useEffect(() => {
    const interval = setInterval(() => {
      const active = gpsTracker.getActiveTrack();
      setTrack(active);
    }, 2000); // обновляем каждые 2 сек

    return () => clearInterval(interval);
  }, []);

  // Обработчики для чек-инов (клики на маркерах)
  useEffect(() => {
    const handleCheckIn = (e: Event) => {
      const btn = (e.target as HTMLElement).closest?.("[data-check-in]");
      const vid = btn?.getAttribute("data-check-in");
      if (vid) setSelectedVid(vid);
    };

    document.addEventListener("click", handleCheckIn);
    return () => document.removeEventListener("click", handleCheckIn);
  }, []);

  if (!track) {
    return (
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 20 }}>
        <Card style={{ padding: 20, textAlign: "center" }}>
          <div style={{ font: "600 14px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {t("GPS-трекер маршрута не активирован")}
          </div>
          <div
            style={{
              font: "500 13px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t3)",
              marginTop: 8,
            }}
          >
            {t("Выберите маршрут вечера и нажмите «GPS трекер» на экране «Сегодня»")}
          </div>
        </Card>
      </div>
    );
  }

  const stats = gpsTracker.getStats();
  const elapsedMins = Math.floor(stats.elapsed / 60000);
  const elapsedHours = Math.floor(elapsedMins / 60);

  const checkIn = selectedVid ? track.checkIns.find((c) => c.vid === selectedVid) : null;
  const isCheckedIn = checkIn?.arrivedAt && !checkIn?.leftAt;

  return (
    <div
      className="gtr-md-stack"
      style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}
    >
      {/* Карта */}
      <div>
        <div ref={mapRef} className="gtr-track-canvas" />
      </div>

      {/* Панель справа */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 0 }}>
        {/* Статистика */}
        <Card style={{ padding: 14 }}>
          <Eyebrow style={{ marginBottom: 10 }}>{t("СТАТИСТИКА")}</Eyebrow>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              font: "500 12px/1.5 'Golos Text',sans-serif",
            }}
          >
            <div>
              <div style={{ color: "var(--gtr-t3)", marginBottom: 2 }}>{t("Время")}</div>
              <div style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "#7B4DFF" }}>
                {elapsedHours}:{String(elapsedMins % 60).padStart(2, "0")}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--gtr-t3)", marginBottom: 2 }}>{t("Расстояние")}</div>
              <div style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "#7B4DFF" }}>
                {stats.distanceTraveled}м
              </div>
            </div>
            <div>
              <div style={{ color: "var(--gtr-t3)", marginBottom: 2 }}>{t("Места")}</div>
              <div style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "#7B4DFF" }}>
                {stats.venuesVisited}/{track.routeIds.length}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--gtr-t3)", marginBottom: 2 }}>{t("Час/место")}</div>
              <div style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "#7B4DFF" }}>
                {stats.avgTimePerVenue}м
              </div>
            </div>
          </div>
          {gpsError && (
            <div style={{ marginTop: 10, color: "#E5231B", fontSize: 12, lineHeight: 1.4 }}>
              {t("Ошибка GPS")}: {gpsError}
            </div>
          )}
          {currentLocation && (
            <div style={{ marginTop: 10, color: "#7B4DFF", fontSize: 11, fontFamily: "monospace" }}>
              Точность: ±{Math.round(currentLocation.accuracy)}м
            </div>
          )}
        </Card>

        {/* Маршрут */}
        {/* Потолок высоты нужен только в колонке рядом с картой. В столбике на
            телефоне список маршрута идёт следом за картой и режется зря. */}
        <Card className="gtr-track-list" style={{ padding: 14, flex: 1, overflow: "auto" }}>
          <Eyebrow style={{ marginBottom: 10 }}>{t("МАРШРУТ")}</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {track.routeIds.map((vid, i) => {
              const checkIn = track.checkIns.find((c) => c.vid === vid);
              const visited = !!checkIn?.arrivedAt;
              const arrivalTime = checkIn?.arrivedAt ? new Date(checkIn.arrivedAt).toLocaleTimeString() : "";

              return (
                <button
                  key={vid}
                  onClick={() => setSelectedVid(vid)}
                  style={{
                    background: selectedVid === vid ? "rgba(123,77,255,.15)" : "transparent",
                    border: `1px solid ${selectedVid === vid ? "#7B4DFF" : "rgba(255,255,255,.1)"}`,
                    color: selectedVid === vid ? "#7B4DFF" : "inherit",
                    padding: "8px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    textAlign: "left",
                    font: "500 12px/1.45 'Golos Text',sans-serif",
                    transition: "all .2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        // Маршрут бывает длиннее девяти точек: двузначный
                        // номер обязан помещаться, а кружок — не сжиматься
                        // под длинным названием площадки рядом.
                        flex: "0 0 auto",
                        borderRadius: "50%",
                        background: visited ? "#E5231B" : "#7B4DFF",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {visited ? "✓" : i + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {V(vid).name}
                      </div>
                      {arrivalTime && (
                        <div style={{ font: "500 11px/1 monospace", opacity: 0.7 }}>в {arrivalTime}</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Чек-ин форма */}
        {selectedVid && (
          <Card style={{ padding: 14 }}>
            <Eyebrow style={{ marginBottom: 10 }}>{t("ЧЕК-ИН")}</Eyebrow>
            <div style={{ display: "grid", gap: 8 }}>
              <button
                className="gtr-btn"
                style={{
                  padding: "8px 12px",
                  background: isCheckedIn ? "#E5231B" : "#7B4DFF",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                }}
                onClick={() => {
                  if (isCheckedIn) {
                    gpsTracker.checkOutVenue(selectedVid);
                  } else {
                    gpsTracker.checkInVenue(selectedVid);
                  }
                  const active = gpsTracker.getActiveTrack();
                  setTrack(active);
                }}
              >
                {isCheckedIn ? t("Чек-аут") : t("Чек-ин")}
              </button>

              {checkIn?.arrivedAt && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--gtr-t2)" }}>
                      {t("Оценка")}
                    </label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setRatingScore(star)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: 16,
                            cursor: "pointer",
                            opacity: star <= ratingScore ? 1 : 0.3,
                          }}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    placeholder={t("Впечатление от места...")}
                    value={ratingText}
                    onChange={(e) => setRatingText(e.target.value)}
                    style={{
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.1)",
                      color: "inherit",
                      padding: "6px 8px",
                      borderRadius: 3,
                      font: "500 12px/1.5 'Golos Text',sans-serif",
                      resize: "none",
                      height: 60,
                    }}
                  />

                  <button
                    className="gtr-btn"
                    style={{
                      padding: "6px 10px",
                      fontSize: 12,
                    }}
                    onClick={() => {
                      gpsTracker.rateVenue(selectedVid, ratingScore, ratingText);
                      const active = gpsTracker.getActiveTrack();
                      setTrack(active);
                      setRatingScore(5);
                      setRatingText("");
                    }}
                  >
                    {t("Сохранить отзыв")}
                  </button>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
