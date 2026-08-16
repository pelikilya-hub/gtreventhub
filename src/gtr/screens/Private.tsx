// PRIVATE — виллы под приватные события. Данные (фото, видео, описание,
// рейтинг, координаты) забираются с trip.com скриптом scripts/trip-villa.mjs
// и ложатся в общую базу площадок: поэтому вилла сразу видна в конструкторе
// события и на карте, без отдельной ветки кода.
//
// Бронь: у trip.com нет публичного API занятости — живой календарь можно
// получить только через их партнёрскую программу. Пока честный путь —
// глубокая ссылка с выбранными датами: она открывает объект уже с этими
// датами, и занятость показывает сам trip.com.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import villasRaw from "../data/villas.json";
import { PH, richOf, V } from "../data/app-data";
import { Card, Chip, Eyebrow } from "../ui";
import { GtrLightbox } from "../lightbox";

type Villa = {
  id: string;
  name: string;
  tripId: number;
  tripUrl: string;
  stars: number | null;
  rating: number | null;
  ratingOf: number;
  reviews: number;
  host: string;
  currency: string;
  basePriceRaw: number | null;
  basePriceNights?: number;   // за сколько ночей цифра выше (если подтверждено)
  basePerNight?: number;      // база trip.com за ночь
  gtrPerNight?: number;       // наш прайс за ночь = база +15%
  priceNote?: string;
  priceCheckedAt?: string | null;
  markup: number;
  gtrPrice: number | null;
  needsPriceCheck: boolean;
  photos: string[];
  video: string;
};

const RAW = villasRaw as { meta: { markup: number }; villas: Villa[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

// Глубокая ссылка на trip.com с датами: занятость и цену показывает сам
// trip.com — мы не выдумываем доступность, которой не знаем.
const tripLink = (v: Villa, from: string, to: string) =>
  `https://www.trip.com/hotels/detail/?hotelId=${v.tripId}` +
  `&checkIn=${from}&checkOut=${to}&curr=THB&locale=ru-RU`;

export function PrivateScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [from, setFrom] = useState(plusDays(1));
  const [to, setTo] = useState(plusDays(3));
  const [box, setBox] = useState<{ imgs: string[]; i: number } | null>(null);

  const villas = useMemo(
    () => RAW.villas.filter((v) => PH.venues.some((p) => p.id === v.id)),
    [],
  );

  return (
    <div className="gtr-screenin">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="gtr-h1 gtr-macro">PRIVATE</h1>
        <Chip color="#E5231B">{villas.length} {t("вилл")}</Chip>
      </div>
      <p
        style={{
          font: "500 12.5px/1.6 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          maxWidth: "64ch",
          margin: "6px 0 16px",
        }}
      >
        {t(
          "Виллы под приватные события: вечеринка у бассейна, ретрит, съёмка. Каждая вилла — обычная площадка в базе, поэтому доступна в конструкторе события и отмечена на карте.",
        )}
      </p>

      {/* даты: ими собирается ссылка на trip.com — занятость показывает он */}
      <Card style={{ padding: 12, marginBottom: 14 }}>
        <Eyebrow>{t("ДАТЫ ДЛЯ ПРОВЕРКИ ЗАНЯТОСТИ")}</Eyebrow>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input
            className="gtr-input"
            style={{ flex: "1 1 140px" }}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            className="gtr-input"
            style={{ flex: "1 1 140px" }}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div
          className="gtr-mono"
          style={{ font: "500 9.5px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginTop: 8 }}
        >
          {t("Занятость и итоговую цену показывает trip.com — открываем объект сразу на эти даты.")}
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {villas.map((v) => {
          const venue = V(v.id);
          const rich = richOf(v.id);
          const gallery = v.photos.length ? v.photos : rich.gallery ?? [];
          return (
            <Card key={v.id} style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden" }}>
                {v.video ? (
                  <video
                    src={v.video}
                    poster={rich.hero}
                    muted
                    loop
                    playsInline
                    autoPlay
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : rich.hero ? (
                  <img
                    src={rich.hero}
                    alt=""
                    loading="lazy"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : null}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(180deg, rgba(10,11,13,.05) 45%, rgba(10,11,13,.92) 100%)",
                    pointerEvents: "none",
                  }}
                />
                <span
                  className="gtr-mono"
                  style={{
                    position: "absolute", left: 12, top: 10,
                    font: "700 8.5px/1 'JetBrains Mono',monospace",
                    letterSpacing: ".14em", padding: "4px 7px",
                    background: "rgba(229,35,27,.85)", color: "#fff",
                  }}
                >
                  PRIVATE
                </span>
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 9 }}>
                  <div style={{ font: "600 14px/1.3 'Golos Text',sans-serif", color: "#fff" }}>
                    {v.name}
                  </div>
                  <div
                    className="gtr-mono"
                    style={{ font: "500 9.5px/1.5 'JetBrains Mono',monospace", color: "rgba(255,255,255,.7)", marginTop: 3 }}
                  >
                    {venue.area}
                    {v.rating ? ` · ★ ${v.rating}/${v.ratingOf} (${v.reviews})` : ""}
                    {v.stars ? ` · ${v.stars}★` : ""}
                  </div>
                </div>
              </div>

              <div style={{ padding: "11px 13px 13px" }}>
                {/* цена: показываем только подтверждённую. Пока база не
                    сверена, не выдаём наценённую цифру за факт. */}
                {v.gtrPrice ? (
                  <div style={{ marginBottom: 9 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ font: "700 17px/1 'JetBrains Mono',monospace", color: "#fff" }}>
                        ฿{v.gtrPrice.toLocaleString("ru-RU")}
                      </span>
                      <span
                        className="gtr-mono"
                        style={{ font: "500 9.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
                      >
                        {t("за ночь")} · GTR +{Math.round((v.markup - 1) * 100)}%
                      </span>
                    </div>
                    {/* база trip.com видна рядом: менеджер всегда знает, из
                        чего сложилась наша цена, и не считает в уме */}
                    <div
                      className="gtr-mono"
                      style={{ font: "500 9px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginTop: 3 }}
                    >
                      trip.com ฿{v.basePerNight?.toLocaleString("ru-RU")}/{t("ночь")}
                      {v.basePriceNights
                        ? ` · ${v.basePriceRaw?.toLocaleString("ru-RU")} ฿ / ${v.basePriceNights} ноч.`
                        : ""}
                      {v.priceCheckedAt ? ` · ${t("сверено")} ${v.priceCheckedAt}` : ""}
                    </div>
                  </div>
                ) : (
                  <div
                    className="gtr-mono"
                    style={{
                      font: "500 9.5px/1.5 'JetBrains Mono',monospace",
                      color: "var(--gtr-amber)",
                      marginBottom: 8,
                      border: "1px solid rgba(245,166,35,.35)",
                      padding: "6px 8px",
                    }}
                  >
                    {t("ЦЕНА НЕ ПОДТВЕРЖДЕНА")} · trip.com: {v.currency}{" "}
                    {v.basePriceRaw?.toLocaleString("ru-RU") ?? "—"}{" "}
                    {t("(«средняя от», не факт что за ночь)")}
                  </div>
                )}

                {gallery.length ? (
                  <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 6, marginBottom: 9 }}>
                    {gallery.slice(0, 8).map((src, i) => (
                      <img
                        key={src}
                        src={src}
                        alt=""
                        loading="lazy"
                        onClick={() => setBox({ imgs: gallery, i })}
                        style={{
                          width: 68, height: 48, objectFit: "cover",
                          flex: "none", cursor: "pointer", opacity: 0.85,
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <a
                    className="gtr-btn gtr-btn-red"
                    href={tripLink(v, from, to)}
                    target="_blank"
                    rel="noopener"
                    style={{ textDecoration: "none" }}
                  >
                    {t("Занятость и бронь · trip.com")}
                  </a>
                  <button
                    className="gtr-btn"
                    onClick={() =>
                      navigate({
                        to: "/gtr/$screen",
                        params: { screen: "constructor" },
                        search: { vid: v.id },
                      })
                    }
                  >
                    {t("В конструктор")}
                  </button>
                  <button
                    className="gtr-btn gtr-btn-ghost"
                    onClick={() =>
                      navigate({
                        to: "/gtr/$screen",
                        params: { screen: "venueCard" },
                        search: { vid: v.id },
                      })
                    }
                  >
                    {t("Паспорт")}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {box ? (
        <GtrLightbox images={box.imgs} index={box.i} onClose={() => setBox(null)} credit="trip.com" />
      ) : null}
    </div>
  );
}
