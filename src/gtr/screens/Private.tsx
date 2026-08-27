// PRIVATE — виллы под приватные события. Данные (фото, видео, описание,
// рейтинг, координаты) забираются с trip.com скриптом scripts/trip-villa.mjs
// и ложатся в общую базу площадок: поэтому вилла сразу видна в конструкторе
// события и на карте, без отдельной ветки кода.
//
// Бронь: у trip.com нет публичного API занятости — живой календарь можно
// получить только через их партнёрскую программу. Пока честный путь —
// глубокая ссылка с выбранными датами: она открывает объект уже с этими
// датами, и занятость показывает сам trip.com.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import villasRaw from "../data/villas.json";
import { PH, richOf, V } from "../data/app-data";
import { setVillaPriceFn, villaPricesFn } from "../kv-api";
import { useGtr } from "../store";
import { checkLink, daysSince, PRICE_TTL_DAYS, VILLA_MARKUP, type VillaPrice } from "../villa-price";
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
  const { user } = useGtr();
  const [from, setFrom] = useState(plusDays(1));
  const [to, setTo] = useState(plusDays(3));
  const [box, setBox] = useState<{ imgs: string[]; i: number } | null>(null);
  // живые ставки из KV: villas.json хранит статику с trip.com, а цена
  // меняется каждый день и живёт отдельно
  const [prices, setPrices] = useState<Record<string, VillaPrice>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    villaPricesFn()
      .then((r) => setPrices(r.prices))
      .catch(() => {});
  }, []);

  const canEditPrice = user.role === "gtr";
  const savePrice = async (vid: string) => {
    const val = Number(draft[vid]);
    if (!Number.isFinite(val) || val <= 0) return;
    setBusy(vid);
    try {
      const r = await setVillaPriceFn({ data: { vid, basePerNight: val } });
      if (r.ok) {
        setPrices((p) => ({ ...p, [vid]: r.price }));
        setDraft((d) => ({ ...d, [vid]: "" }));
      }
    } catch {
      /* локальный режим — цена останется прежней */
    }
    setBusy("");
  };

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
          style={{ font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginTop: 8 }}
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
          // живая ставка из KV главнее статики в JSON
          const live = prices[v.id];
          const base = live?.basePerNight ?? v.basePerNight ?? null;
          const gtr = live?.gtrPerNight ?? v.gtrPerNight ?? null;
          const checked = live?.checkedAt ?? v.priceCheckedAt ?? null;
          const fresh = Boolean(checked) && daysSince(checked as string) <= PRICE_TTL_DAYS;
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
                    font: "700 10px/1 'JetBrains Mono',monospace",
                    letterSpacing: ".14em", padding: "4px 7px",
                    background: "rgba(229,35,27,.85)", color: "#fff",
                  }}
                >
                  PRIVATE
                </span>
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 9 }}>
                  <div style={{ font: "600 14px/1.45 'Golos Text',sans-serif", color: "#fff" }}>
                    {v.name}
                  </div>
                  <div
                    className="gtr-mono"
                    style={{ font: "500 11px/1.5 'JetBrains Mono',monospace", color: "rgba(255,255,255,.7)", marginTop: 3 }}
                  >
                    {venue.area}
                    {v.rating ? ` · ★ ${v.rating}/${v.ratingOf} (${v.reviews})` : ""}
                    {v.stars ? ` · ${v.stars}★` : ""}
                  </div>
                </div>
              </div>

              <div style={{ padding: "11px 13px 13px" }}>
                {/* цена: только подтверждённая ставка. Свежесть видна явно —
                    «сверено сегодня» и «цена от вчера» это разные вещи, когда
                    по ней выставляют счёт клиенту. */}
                {gtr ? (
                  <div style={{ marginBottom: 9 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ font: "700 17px/1 'JetBrains Mono',monospace", color: "#fff" }}>
                        ฿{gtr.toLocaleString("ru-RU")}
                      </span>
                      <span
                        className="gtr-mono"
                        style={{ font: "500 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
                      >
                        {t("за ночь")} · GTR +{Math.round((VILLA_MARKUP - 1) * 100)}%
                      </span>
                      <span
                        className="gtr-mono"
                        style={{
                          font: "700 10px/1 'JetBrains Mono',monospace",
                          letterSpacing: ".1em",
                          padding: "3px 6px",
                          color: fresh ? "#7BE38A" : "var(--gtr-amber)",
                          border: `1px solid ${fresh ? "rgba(123,227,138,.4)" : "rgba(245,166,35,.4)"}`,
                        }}
                      >
                        {fresh ? t("СВЕРЕНО СЕГОДНЯ") : t("ЦЕНА УСТАРЕЛА")}
                      </span>
                    </div>
                    {/* база trip.com видна рядом: менеджер всегда знает, из
                        чего сложилась наша цена, и не считает в уме */}
                    <div
                      className="gtr-mono"
                      style={{ font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginTop: 3 }}
                    >
                      trip.com ฿{base?.toLocaleString("ru-RU")}/{t("ночь")}
                      {checked ? ` · ${t("сверено")} ${checked}` : ""}
                      {live?.by ? ` · ${live.by.split("@")[0]}` : ""}
                    </div>
                  </div>
                ) : (
                  <div
                    className="gtr-mono"
                    style={{
                      font: "500 11px/1.5 'JetBrains Mono',monospace",
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

                {/* ежедневная сверка: цифру вбивает GTR-админ, наценку
                    считает сервер. Ссылка открывает объект на завтра —
                    ровно ту дату, по которой сверяем. */}
                {canEditPrice ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 9, flexWrap: "wrap" }}>
                    <input
                      className="gtr-input"
                      style={{ flex: "1 1 120px", minWidth: 100 }}
                      inputMode="numeric"
                      placeholder={t("база ฿/ночь")}
                      value={draft[v.id] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [v.id]: e.target.value }))}
                    />
                    <button
                      className="gtr-btn"
                      disabled={busy === v.id || !draft[v.id]}
                      onClick={() => savePrice(v.id)}
                    >
                      {busy === v.id ? t("…") : t("Сверено")}
                    </button>
                    <a
                      className="gtr-btn gtr-btn-ghost"
                      href={checkLink(v.tripId)}
                      target="_blank"
                      rel="noopener"
                      style={{ textDecoration: "none" }}
                    >
                      {t("Проверить на завтра")}
                    </a>
                  </div>
                ) : null}

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
