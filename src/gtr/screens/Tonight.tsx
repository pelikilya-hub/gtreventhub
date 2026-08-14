// «Сегодня»: куда пойти прямо сейчас. События дня из афиш + ночные площадки
// с часами и входом (nightlife-свип), бронь стола и контакты в одно касание,
// «маршрут вечера» — бар-хоппинг по нескольким местам с картой Google.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GREEN, nightOf, richOf, V, PH } from "../data/app-data";
import geoRaw from "../data/venue-geo.json";
import { Card, Chip, Eyebrow, tint } from "../ui";
import { useGtr } from "../store";
import { allAfishaFn, bookTableFn, promptpayCfgFn, type PromptpayCfg, type VenueAfisha } from "../kv-api";
import { openAppLink } from "../applink";
import { PromptpayModal } from "../promptpay-ui";

const GEO = geoRaw as Record<string, { lat: number; lon: number; src: string }>;
type FeedItem = VenueAfisha["events"][number] & { vid: string };

const ROUTE_KEY = "gtr-evening-route";
const loadRoute = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(ROUTE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

// Ночные площадки: есть часы/вход из свипа гайдов — их и предлагаем вечером
const nightVenues = () =>
  PH.venues
    .filter((v) => {
      const n = nightOf(v.id);
      return n.hours || n.entry || n.best;
    })
    .sort((a, b) => {
      const rank = (t: string) =>
        /night ?club/i.test(t) ? 0 : /beach club/i.test(t) ? 1 : /live/i.test(t) ? 2 : 3;
      return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name);
    });

export function TonightScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [route, setRoute] = useState<string[]>([]);
  const [bookVid, setBookVid] = useState<string>("");
  const [bkName, setBkName] = useState(user.name ?? "");
  const [bkPhone, setBkPhone] = useState("");
  const [bkGuests, setBkGuests] = useState(2);
  const [bkState, setBkState] = useState<string>("");

  const [ppCfg, setPpCfg] = useState<PromptpayCfg | null>(null);
  const [ppFor, setPpFor] = useState<string>(""); // vid открытого QR-модала

  useEffect(() => {
    allAfishaFn().then((r) => setItems(r.items)).catch(() => {});
    promptpayCfgFn().then((r) => setPpCfg(r.cfg)).catch(() => {});
    setRoute(loadRoute());
  }, []);

  // имя пользователя приходит асинхронно — подставляем, как только появилось
  useEffect(() => {
    if (!bkName && user.name) setBkName(user.name);
  }, [user.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const todayEvents = items.filter((e) => e.dateIso === todayIso);
  const tomorrowEvents = items.filter((e) => e.dateIso === tomorrowIso);
  const venues = useMemo(nightVenues, []);

  const toggleRoute = (vid: string) => {
    const next = route.includes(vid) ? route.filter((x) => x !== vid) : [...route, vid];
    setRoute(next);
    localStorage.setItem(ROUTE_KEY, JSON.stringify(next));
  };

  const routeUrl = () => {
    const pts = route
      .map((vid) => GEO[vid])
      .filter(Boolean)
      .map((g) => `${g.lat},${g.lon}`);
    return pts.length >= 1 ? `https://www.google.com/maps/dir/${pts.join("/")}` : "";
  };

  const submitBooking = async (vid: string) => {
    setBkState("…");
    try {
      const r = await bookTableFn({
        data: {
          vid,
          dateIso: todayIso,
          guests: bkGuests,
          name: bkName,
          phone: bkPhone,
          note: "Заявка из раздела «Сегодня»",
        },
      });
      setBkState(r.ok ? t("Заявка ушла — площадка свяжется с вами") : (r.reason ?? "…"));
      if (r.ok) setTimeout(() => setBookVid(""), 1600);
    } catch {
      setBkState(t("Сервер недоступен"));
    }
  };

  const dayLabel = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const eventCard = (e: FeedItem) => {
    const v = V(e.vid);
    return (
      <Card key={e.vid + e.id} style={{ padding: 0, overflow: "hidden" }}>
        {e.poster ? (
          <div style={{ position: "relative", aspectRatio: "4/5", overflow: "hidden" }}>
            <img
              src={e.poster}
              alt=""
              loading="lazy"
              onError={(ev) => {
                (ev.currentTarget as HTMLImageElement).style.display = "none";
              }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            {e.artistIds.length ? (
              <span
                className="gtr-mono"
                style={{
                  position: "absolute",
                  top: 9,
                  left: 9,
                  font: "700 9px/1 'JetBrains Mono',monospace",
                  padding: "4px 7px",
                  background: "rgba(229,35,27,.85)",
                  color: "#fff",
                  letterSpacing: ".1em",
                }}
              >
                {t("НАШ АРТИСТ")}
              </span>
            ) : null}
          </div>
        ) : null}
        <div style={{ padding: "11px 14px 13px" }}>
          <div style={{ font: "600 13px/1.35 'Golos Text',sans-serif" }}>{e.title}</div>
          <div
            style={{
              margin: "5px 0 8px",
              font: "500 10.5px/1.45 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {v.name} · {v.area}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="gtr-btn" style={{ padding: "6px 10px", fontSize: 10.5 }} onClick={() => setBookVid(bookVid === e.vid ? "" : e.vid)}>
              {t("Стол")}
            </button>
            <button
              className="gtr-btn"
              style={{ padding: "6px 10px", fontSize: 10.5 }}
              onClick={() =>
                navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: e.vid } })
              }
            >
              {t("Площадка")} →
            </button>
            <button
              className="gtr-btn"
              style={{
                padding: "6px 10px",
                fontSize: 10.5,
                borderColor: route.includes(e.vid) ? GREEN : undefined,
                color: route.includes(e.vid) ? GREEN : undefined,
              }}
              onClick={() => toggleRoute(e.vid)}
            >
              {route.includes(e.vid) ? `✓ ${t("В маршруте")}` : `+ ${t("В маршрут")}`}
            </button>
          </div>
          {bookVid === e.vid ? bookingForm(e.vid) : null}
        </div>
      </Card>
    );
  };

  const bookingForm = (vid: string) => (
    <div style={{ marginTop: 10, display: "grid", gap: 7 }}>
      <div style={{ display: "flex", gap: 7 }}>
        <input
          className="gtr-input"
          style={{ flex: 1 }}
          placeholder={t("Имя")}
          value={bkName}
          onChange={(e) => setBkName(e.target.value)}
        />
        <input
          className="gtr-input"
          style={{ width: 74 }}
          type="number"
          min={1}
          max={100}
          value={bkGuests}
          onChange={(e) => setBkGuests(Number(e.target.value))}
        />
      </div>
      <input
        className="gtr-input"
        placeholder={t("Телефон / WhatsApp")}
        value={bkPhone}
        onChange={(e) => setBkPhone(e.target.value)}
      />
      <button className="gtr-btn gtr-btn-red" onClick={() => submitBooking(vid)}>
        {t("Забронировать на сегодня")}
      </button>
      {ppCfg ? (
        <button className="gtr-btn" onClick={() => setPpFor(vid)}>
          {t("Оплатить депозит · PromptPay QR")}
        </button>
      ) : null}
      {bkState ? (
        <div className="gtr-mono" style={{ font: "500 10px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
          {bkState}
        </div>
      ) : null}
    </div>
  );

  const venueCard = (v: (typeof PH.venues)[number]) => {
    const n = nightOf(v.id);
    const hero = richOf(v.id).hero;
    const inRoute = route.includes(v.id);
    const g = GEO[v.id];
    return (
      <Card key={v.id} style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ position: "relative", aspectRatio: "16/7", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(135deg, rgba(255,255,255,.028) 0 2px, transparent 2px 9px), linear-gradient(160deg, #17181C 0%, #0C0D10 100%)",
            }}
          />
          {hero ? (
            <img
              src={hero}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(10,11,13,.04) 40%, rgba(10,11,13,.92) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 13,
              right: 13,
              bottom: 9,
              display: "flex",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <span style={{ font: "600 13.5px/1.25 'Golos Text',sans-serif", flex: 1, minWidth: 0 }}>
              {v.name}
            </span>
            {n.hours ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
                <span className="gtr-eq" aria-hidden>
                  <span /><span /><span /><span />
                </span>
                <span
                  className="gtr-mono"
                  style={{ font: "600 9.5px/1 'JetBrains Mono',monospace", color: GREEN, whiteSpace: "nowrap" }}
                >
                  {n.hours.split("·")[0].trim()}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ padding: "10px 14px 13px" }}>
          <div
            style={{
              font: "500 10.5px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
              marginBottom: 7,
            }}
          >
            {[n.music, n.entry].filter(Boolean).join(" · ") || `${v.type} · ${v.area}`}
          </div>
          {n.best ? (
            <div
              style={{
                font: "500 10.5px/1.5 'Golos Text',sans-serif",
                color: tint("#F5A623", 0.9),
                marginBottom: 8,
              }}
            >
              ★ {n.best}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="gtr-btn"
              style={{ padding: "6px 10px", fontSize: 10.5 }}
              onClick={() => setBookVid(bookVid === v.id ? "" : v.id)}
            >
              {t("Стол")}
            </button>
            {v.phone ? (
              <a
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 10.5, textDecoration: "none" }}
                href={`tel:${String(v.phone).replace(/[^+\d]/g, "")}`}
              >
                {t("Позвонить")}
              </a>
            ) : null}
            {v.social ? (
              <a
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 10.5, textDecoration: "none" }}
                href={String(v.social)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openAppLink(String(v.social));
                }}
              >
                IG
              </a>
            ) : null}
            {g ? (
              <a
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 10.5, textDecoration: "none" }}
                href={`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("Маршрут")}
              </a>
            ) : null}
            <button
              className="gtr-btn"
              style={{
                padding: "6px 10px",
                fontSize: 10.5,
                borderColor: inRoute ? GREEN : undefined,
                color: inRoute ? GREEN : undefined,
              }}
              onClick={() => toggleRoute(v.id)}
            >
              {inRoute ? `✓ ${t("В маршруте")}` : `+ ${t("В маршрут")}`}
            </button>
          </div>
          {bookVid === v.id ? bookingForm(v.id) : null}
        </div>
      </Card>
    );
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <h1 className="gtr-oswald gtr-h1">{t("Сегодня на Пхукете")}</h1>
        <span
          className="gtr-mono"
          style={{ font: "600 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {dayLabel}
        </span>
      </div>
      <div
        style={{
          font: "500 11.5px/1.5 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          marginBottom: 14,
        }}
      >
        {t("Выберите вечер: события дня, открытые площадки, бронь стола и маршрут по нескольким местам.")}
      </div>

      {/* Маршрут вечера — бар-хоппинг */}
      {route.length ? (
        <Card style={{ padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Eyebrow>{t("МАРШРУТ ВЕЧЕРА")} · {route.length}</Eyebrow>
            {route.map((vid, i) => (
              <Chip key={vid} color="#7B4DFF">
                {i + 1}. {V(vid).name}
              </Chip>
            ))}
            <span style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
              {routeUrl() ? (
                <a
                  className="gtr-btn"
                  style={{ padding: "6px 10px", fontSize: 10.5, textDecoration: "none" }}
                  href={routeUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Открыть в Google Maps")} ↗
                </a>
              ) : null}
              <button
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 10.5 }}
                onClick={() => {
                  setRoute([]);
                  localStorage.setItem(ROUTE_KEY, "[]");
                }}
              >
                {t("Очистить")}
              </button>
            </span>
          </div>
        </Card>
      ) : null}

      {/* События сегодня из афиш площадок */}
      <Eyebrow style={{ marginBottom: 10 }}>
        {t("СОБЫТИЯ СЕГОДНЯ")} · {todayEvents.length}
      </Eyebrow>
      {todayEvents.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
            gap: 11,
            marginBottom: 18,
          }}
        >
          {todayEvents.map(eventCard)}
        </div>
      ) : (
        <div
          style={{
            font: "500 11px/1.5 'Golos Text',sans-serif",
            color: "var(--gtr-t3)",
            margin: "0 0 18px",
          }}
        >
          {t("В афишах пока нет событий на сегодня — ниже площадки, открытые вечером.")}
        </div>
      )}

      {tomorrowEvents.length ? (
        <>
          <Eyebrow style={{ marginBottom: 10 }}>
            {t("ЗАВТРА")} · {tomorrowEvents.length}
          </Eyebrow>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
              gap: 11,
              marginBottom: 18,
            }}
          >
            {tomorrowEvents.map(eventCard)}
          </div>
        </>
      ) : null}

      {/* Ночные площадки: часы, вход, фирменные ночи */}
      <Eyebrow style={{ marginBottom: 10 }}>
        {t("ОТКРЫТО ВЕЧЕРОМ")} · {venues.length}
      </Eyebrow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        {venues.map(venueCard)}
      </div>
      <div
        className="gtr-mono"
        style={{
          marginTop: 14,
          font: "500 9.5px/1.6 'JetBrains Mono',monospace",
          color: "var(--gtr-t3)",
        }}
      >
        {ppCfg
          ? t("Часы и вход — по данным гайдов. Оплата: PromptPay QR прямо из брони.")
          : t("Часы и вход — по данным гайдов; онлайн-оплата входа появится после подключения эквайринга.")}
      </div>
      {ppFor && ppCfg ? (
        <PromptpayModal
          cfg={ppCfg}
          title={`${t("Депозит")} · ${V(ppFor).name}`}
          onClose={() => setPpFor("")}
        />
      ) : null}
    </div>
  );
}
