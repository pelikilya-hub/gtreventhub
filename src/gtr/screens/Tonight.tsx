// «Сегодня»: куда пойти прямо сейчас. События дня из афиш + ночные площадки
// с часами и входом (nightlife-свип), бронь стола и контакты в одно касание,
// «маршрут вечера» — бар-хоппинг по нескольким местам с картой Google.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GREEN, isNightVenue, nightOf, richOf, V, PH } from "../data/app-data";
import geoRaw from "../data/venue-geo.json";
import { bkkToday } from "../afisha-parse";
import { Card, Chip, Eyebrow, tint, VenueLogo } from "../ui";
import { useGtr } from "../store";
import { allAfishaFn, bookTableFn, promptpayCfgFn, type PromptpayCfg, type VenueAfisha } from "../kv-api";
import { openAppLink } from "../applink";
import { PromptpayModal } from "../promptpay-ui";
import { SwipeToBook } from "../raw-pulse";
import { gpsTracker, useGpsTracking } from "../gps-track";
import { loadRoute, saveRoute } from "../evening-route";

const GEO = geoRaw as Record<string, { lat: number; lon: number; src: string }>;
type FeedItem = VenueAfisha["events"][number] & { vid: string };

/** Сколько дней вперёд предлагаем лентой. Две недели — горизонт, на котором
 *  у площадок реально есть анонсы; дальше выбор идёт через поле даты. */
const STRIP_DAYS = 14;

// Ночные площадки отбираем по сути места, а не по тому, дошли ли до него
// руки разведки. Прежний фильтр требовал часов или цены входа — и прятал
// вечером клуб, лайв-бар и полдюжины руфтопов только потому, что свип
// гайдов их ещё не закрыл. Места с разведанными часами идут первыми.
const nightVenues = () =>
  PH.venues
    .filter((v) => {
      const n = nightOf(v.id);
      return n.hours || n.entry || n.best || isNightVenue(v);
    })
    .sort((a, b) => {
      const rank = (t: string) =>
        /night ?club/i.test(t) ? 0 : /beach club/i.test(t) ? 1 : /live/i.test(t) ? 2 : 3;
      return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name);
    });

export function TonightScreen() {
  const { t, i18n } = useTranslation();
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
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(false);
  const { location: currentLocation, error: gpsError, isTracking } = useGpsTracking(isTrackingEnabled);
  const active = gpsTracker.getActiveTrack();

  useEffect(() => {
    allAfishaFn().then((r) => setItems(r.items)).catch(() => {});
    promptpayCfgFn().then((r) => setPpCfg(r.cfg)).catch(() => {});
    setRoute(loadRoute());
  }, []);

  // имя пользователя приходит асинхронно — подставляем, как только появилось
  useEffect(() => {
    if (!bkName && user.name) setBkName(user.name);
  }, [user.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Дата острова, а не телефона и не UTC. toISOString() отдаёт гринвичскую
  // дату: в Патонге с полуночи до семи утра — самые часы этого экрана — она
  // ещё вчерашняя, и «Сегодня» показывало вчерашнюю программу, пока шапка
  // рядом рисовала правильное число местной датой.
  const todayIso = bkkToday();
  const tomorrowIso = bkkToday(1);

  // Выбранный вечер. Раньше экран жёстко показывал два блока — сегодня и
  // завтра, — и события пятницы посмотреть было нечем: гость видел всю
  // ленту без возможности выбрать день. Теперь день один и выбирается.
  const [dayIso, setDayIso] = useState(todayIso);
  const dayEvents = items.filter((e) => e.dateIso === dayIso);
  const venues = useMemo(nightVenues, []);

  // Сколько событий на каждый день ленты — число едет прямо на плашку,
  // чтобы было видно, где вечер живой, ещё до нажатия.
  const byDay = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of items) c[e.dateIso] = (c[e.dateIso] ?? 0) + 1;
    return c;
  }, [items]);

  const strip = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, i) => bkkToday(i)),
    // bkkToday читает часы: пересчитываем на смене суток, а не раз навсегда.
    [todayIso],
  );

  const toggleRoute = (vid: string) => {
    const next = route.includes(vid) ? route.filter((x) => x !== vid) : [...route, vid];
    setRoute(next);
    saveRoute(next);
  };

  const routeUrl = () => {
    const pts = route
      .map((vid) => GEO[vid])
      .filter(Boolean)
      .map((g) => `${g.lat},${g.lon}`);
    return pts.length >= 1 ? `https://www.google.com/maps/dir/${pts.join("/")}` : "";
  };

  const submitBooking = async (vid: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!bkName.trim() || !bkPhone.trim()) {
      return { ok: false, reason: t("Укажите имя и телефон") };
    }
    try {
      const r = await bookTableFn({
        data: {
          vid,
          // Дата выбранного вечера, а не сегодняшняя. Раньше сюда жёстко
          // уезжал todayIso: гость бронировал стол из блока «Завтра», а
          // площадка ждала его сегодня.
          dateIso: dayIso,
          guests: bkGuests,
          name: bkName,
          phone: bkPhone,
          note: "Заявка из раздела «Сегодня»",
        },
      });
      if (r.ok) {
        setBkState(t("Заявка ушла — площадка свяжется с вами"));
        setTimeout(() => setBookVid(""), 1600);
        return { ok: true };
      }
      return { ok: false, reason: r.reason };
    } catch {
      return { ok: false, reason: t("Сервер недоступен") };
    }
  };

  // Дата говорит на языке интерфейса: русская «среда, 19 августа» в
  // английской версии читалась как недоделка.
  const dayLocale = { ru: "ru-RU", en: "en-GB", th: "th-TH" }[i18n.language] ?? "en-GB";
  // Число берём то же, по которому отобран список, — день острова. Иначе у
  // гостя из другого пояса шапка и программа под ней расходятся на сутки.
  const dayLabel = new Date(`${dayIso}T12:00:00Z`).toLocaleDateString(dayLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  // Короткая подпись на плашке ленты: «пт 29». Полное название дня в ряд
  // из четырнадцати кнопок не помещается ни на одном телефоне.
  const chipLabel = (iso: string) => {
    if (iso === todayIso) return t("Сегодня");
    if (iso === tomorrowIso) return t("Завтра");
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(dayLocale, {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };

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
                  font: "700 11px/1 'JetBrains Mono',monospace",
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
          <div style={{ font: "600 13px/1.45 'Golos Text',sans-serif" }}>{e.title}</div>
          <div
            style={{
              margin: "5px 0 8px",
              font: "500 12px/1.45 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {v.name} · {v.area}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="gtr-btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setBookVid(bookVid === e.vid ? "" : e.vid)}>
              {t("Стол")}
            </button>
            <button
              className="gtr-btn"
              style={{ padding: "6px 10px", fontSize: 12 }}
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
                fontSize: 12,
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
      <SwipeToBook onConfirm={() => submitBooking(vid)} />
      {ppCfg ? (
        <button className="gtr-btn" onClick={() => setPpFor(vid)}>
          {t("Оплатить депозит · PromptPay QR")}
        </button>
      ) : null}
      {bkState ? (
        <div className="gtr-mono" style={{ font: "500 12px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
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
        <div className="gtr-venue-shot">
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
              background:
                "linear-gradient(180deg, rgba(10,11,13,.5) 0%, rgba(10,11,13,.1) 20%, rgba(10,11,13,0) 42%, rgba(10,11,13,.6) 72%, rgba(10,11,13,.95) 100%)",
            }}
          />
          {/* Знак в верхнем углу снимка: гость листает афишу быстро и
              узнаёт место по логотипу раньше, чем прочитает название. */}
          <VenueLogo vid={v.id} h={20} style={{ position: "absolute", left: 12, top: 10, zIndex: 2 }} />
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
            <span
              className="gtr-oswald"
              style={{
                font: "700 18px/1.1 Oswald,sans-serif",
                letterSpacing: ".005em",
                textTransform: "uppercase",
                textShadow: "0 1px 12px rgba(0,0,0,.55)",
                flex: 1,
                minWidth: 0,
              }}
            >
              {v.name}
            </span>
            {n.hours ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
                <span className="gtr-eq" aria-hidden>
                  <span /><span /><span /><span />
                </span>
                <span
                  className="gtr-mono"
                  style={{ font: "600 11px/1 'JetBrains Mono',monospace", color: GREEN, whiteSpace: "nowrap" }}
                >
                  {t(String(n.hours)).split("·")[0].trim()}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ padding: "10px 14px 13px" }}>
          <div
            style={{
              font: "500 12px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
              marginBottom: 7,
            }}
          >
            {[n.music, n.entry].filter(Boolean).map((s) => t(String(s))).join(" · ") || `${v.type} · ${v.area}`}
          </div>
          {n.best ? (
            <div
              style={{
                font: "500 12px/1.5 'Golos Text',sans-serif",
                color: tint("#F5A623", 0.9),
                marginBottom: 8,
              }}
            >
              ★ {t(n.best)}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="gtr-btn"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={() => setBookVid(bookVid === v.id ? "" : v.id)}
            >
              {t("Стол")}
            </button>
            {v.phone ? (
              <a
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }}
                href={`tel:${String(v.phone).replace(/[^+\d]/g, "")}`}
              >
                {t("Позвонить")}
              </a>
            ) : null}
            {v.social ? (
              <a
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }}
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
                style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }}
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
                fontSize: 12,
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
          style={{ font: "600 13px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {dayLabel}
        </span>
      </div>
      <div
        style={{
          font: "500 13px/1.5 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          marginBottom: 14,
        }}
      >
        {t("Выберите вечер: события дня, открытые площадки, бронь стола и маршрут по нескольким местам.")}
      </div>

      {/* Выбор вечера. Лента на две недели вперёд плюс поле даты для всего,
          что дальше: у площадок бывают анонсы за месяц, и упираться в
          горизонт ленты гость не должен. */}
      <div className="gtr-map-row" style={{ marginBottom: 8 }}>
        {strip.map((iso) => {
          const on = iso === dayIso;
          const n = byDay[iso] ?? 0;
          return (
            <button
              key={iso}
              className={`gtr-map-chip${on ? " on" : ""}`}
              onClick={() => setDayIso(iso)}
              aria-pressed={on}
            >
              {chipLabel(iso)}
              {/* Ноль не рисуем: пустая плашка и так читается как пустой
                  день, а «· 0» превращает ленту в частокол нулей. */}
              {n ? <span style={{ opacity: 0.55 }}> · {n}</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input
          className="gtr-input"
          type="date"
          value={dayIso}
          min={todayIso}
          onChange={(e) => setDayIso(e.target.value || todayIso)}
          style={{ maxWidth: 190 }}
          aria-label={t("Дата")}
        />
        {dayIso !== todayIso ? (
          <button className="gtr-btn" onClick={() => setDayIso(todayIso)}>
            {t("Вернуться к сегодня")}
          </button>
        ) : null}
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
            <span style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center" }}>
              {routeUrl() ? (
                <a
                  className="gtr-btn"
                  style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }}
                  href={routeUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Открыть в Google Maps")} ↗
                </a>
              ) : null}
              {isTracking ? (
                <>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 11px/1 'JetBrains Mono',monospace",
                      color: "#E5231B",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#E5231B",
                        animation: "pulse 1s infinite",
                      }}
                    />
                    {t("GPS ВКЛ")}
                  </span>
                  <button
                    className="gtr-btn"
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "tracking" } })}
                  >
                    {t("Карта")} →
                  </button>
                  <button
                    className="gtr-btn"
                    style={{ padding: "6px 10px", fontSize: 12, color: "#E5231B", borderColor: "#E5231B" }}
                    onClick={() => {
                      setIsTrackingEnabled(false);
                      gpsTracker.endTrack();
                    }}
                  >
                    {t("Завершить")}
                  </button>
                </>
              ) : (
                <button
                  className="gtr-btn"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => {
                    gpsTracker.startTrack(route);
                    setIsTrackingEnabled(true);
                  }}
                >
                  {t("GPS трекер")} 📍
                </button>
              )}
              <button
                className="gtr-btn"
                style={{ padding: "6px 10px", fontSize: 12 }}
                onClick={() => {
                  setRoute([]);
                  saveRoute([]);
                  if (isTracking) setIsTrackingEnabled(false);
                }}
              >
                {t("Очистить")}
              </button>
            </span>
          </div>
          {gpsError && (
            <div
              className="gtr-mono"
              style={{
                font: "500 11px/1.45 'JetBrains Mono',monospace",
                color: "#E5231B",
                marginTop: 8,
              }}
            >
              {t("Ошибка GPS")}: {gpsError}
            </div>
          )}
          {currentLocation && (
            <div
              className="gtr-mono"
              style={{
                font: "500 11px/1.45 'JetBrains Mono',monospace",
                color: GREEN,
                marginTop: 8,
              }}
            >
              Точность: ±{Math.round(currentLocation.accuracy)}м
            </div>
          )}
        </Card>
      ) : null}

      {/* События выбранного вечера из афиш площадок */}
      <Eyebrow style={{ marginBottom: 10 }}>
        {dayIso === todayIso ? t("СОБЫТИЯ СЕГОДНЯ") : dayLabel.toUpperCase()} · {dayEvents.length}
      </Eyebrow>
      {dayEvents.length ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
            gap: 11,
            marginBottom: 18,
          }}
        >
          {dayEvents.map(eventCard)}
        </div>
      ) : (
        <div
          style={{
            font: "500 13px/1.5 'Golos Text',sans-serif",
            color: "var(--gtr-t3)",
            margin: "0 0 18px",
          }}
        >
          {dayIso === todayIso
            ? t("В афишах пока нет событий на сегодня — ниже площадки, открытые вечером.")
            : t("На этот день в афишах пока пусто — выберите другую дату или смотрите площадки ниже.")}
        </div>
      )}

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
          font: "500 11px/1.6 'JetBrains Mono',monospace",
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
