// «Сегодня» — афиша внутри приложения: куда пойти в выбранный вечер.
// Наверху день и лента на две недели, дальше афиши событий сеткой, ниже
// площадки, открытые вечером. Бронь стола открывается шторкой поверх
// экрана: в сетке из двух колонок форма внутри карточки не помещалась.
// Маршрут вечера (бар-хоппинг с картой Google) и GPS-трекер на месте.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { GREEN, isNightVenue, nightOf, richOf, V, PH } from "../data/app-data";
import geoRaw from "../data/venue-geo.json";
import { bkkToday } from "../afisha-parse";
import { Chip, VenueLogo } from "../ui";
import { useGtr } from "../store";
import { allAfishaFn, bookTableFn, promptpayCfgFn, type PromptpayCfg, type VenueAfisha } from "../kv-api";
import { openAppLink } from "../applink";
import { PosterImg } from "../poster-img";
import { posterUrl } from "../poster";
import { PromptpayModal } from "../promptpay-ui";
import { SwipeToBook } from "../raw-pulse";
import { gpsTracker, useGpsTracking } from "../gps-track";
import { loadRoute, saveRoute } from "../evening-route";

const GEO = geoRaw as Record<string, { lat: number; lon: number; src: string }>;
type FeedItem = VenueAfisha["events"][number] & { vid: string };
type Venue = (typeof PH.venues)[number];

/** Сколько дней вперёд предлагаем лентой. Две недели — горизонт, на котором
 *  у площадок реально есть анонсы; дальше выбор идёт через поле даты. */
const STRIP_DAYS = 14;
/** Площадок за раз. Ночных мест на острове за двести пятьдесят — выданные
 *  разом, они превращали экран в ленту длиной в сто тысяч пикселей. */
const VENUE_PAGE = 8;

// Ночные площадки отбираем по сути места, а не по тому, дошли ли до него
// руки разведки. Места с разведанными часами идут первыми.
const nightVenues = () =>
  PH.venues
    .filter((v) => {
      const n = nightOf(v.id);
      return n.hours || n.entry || n.best || isNightVenue(v);
    })
    .sort((a, b) => {
      const rank = (t: string) =>
        /night ?club/i.test(t) ? 0 : /beach club/i.test(t) ? 1 : /live/i.test(t) ? 2 : 3;
      const known = (v: Venue) => (nightOf(v.id).hours ? 0 : 1);
      return known(a) - known(b) || rank(a.type) - rank(b.type) || a.name.localeCompare(b.name);
    });

// Тип места для фильтра. Порядок проверок важен: «beach club» — это
// пляжный клуб, а не клуб, «jazz lounge» — живая музыка, а не бар.
type Kind = "club" | "beach" | "live" | "bar";
const kindOf = (v: Venue): Kind | "" => {
  const s = `${v.type} ${v.tag ?? ""}`;
  if (/beach/i.test(s)) return "beach";
  if (/live|jazz|music/i.test(s)) return "live";
  if (/night ?club|club/i.test(s)) return "club";
  if (/bar|rooftop|lounge|speakeasy|pub/i.test(s)) return "bar";
  return "";
};

export function TonightScreen({ vid: fromVenue }: { vid?: string } = {}) {
  const { t, i18n } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState<string[]>([]);
  const [book, setBook] = useState<{ vid: string; title?: string } | null>(null);
  const [bkName, setBkName] = useState(user.name ?? "");
  const [bkPhone, setBkPhone] = useState("");
  const [bkGuests, setBkGuests] = useState(2);
  const [bkState, setBkState] = useState<string>("");
  const [kind, setKind] = useState<Kind | "">("");
  const [venueLimit, setVenueLimit] = useState(VENUE_PAGE);

  const [ppCfg, setPpCfg] = useState<PromptpayCfg | null>(null);
  const [ppFor, setPpFor] = useState<string>(""); // vid открытого QR-модала
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(false);
  const { location: currentLocation, error: gpsError, isTracking } = useGpsTracking(isTrackingEnabled);

  useEffect(() => {
    allAfishaFn()
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoaded(true));
    promptpayCfgFn().then((r) => setPpCfg(r.cfg)).catch(() => {});
    setRoute(loadRoute());
  }, []);

  // имя пользователя приходит асинхронно — подставляем, как только появилось
  useEffect(() => {
    if (!bkName && user.name) setBkName(user.name);
  }, [user.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Дата острова, а не телефона и не UTC: в Патонге с полуночи до семи
  // утра гринвичская дата ещё вчерашняя.
  const todayIso = bkkToday();
  const tomorrowIso = bkkToday(1);
  const [dayIso, setDayIso] = useState(todayIso);

  // Площадка, с которой пришли по кнопке «Что здесь сегодня».
  const [onlyVid, setOnlyVid] = useState(fromVenue ?? "");
  const only = onlyVid && V(onlyVid) ? onlyVid : "";

  const dayEvents = items.filter((e) => e.dateIso === dayIso && (!only || e.vid === only));
  const allVenues = useMemo(nightVenues, []);
  const venuesAll = only
    ? allVenues.filter((v) => v.id === only)
    : kind
      ? allVenues.filter((v) => kindOf(v) === kind)
      : allVenues;
  const venues = venuesAll.slice(0, venueLimit);
  const kinds = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of allVenues) {
      const k = kindOf(v);
      if (k) c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [allVenues]);

  // Сколько событий на каждый день ленты — число едет прямо на плашку.
  const byDay = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of items) if (!only || e.vid === only) c[e.dateIso] = (c[e.dateIso] ?? 0) + 1;
    return c;
  }, [items, only]);

  const strip = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, i) => bkkToday(i)),
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

  const openBook = (vid: string, title?: string) => {
    setBkState("");
    setBook({ vid, title });
  };

  const submitBooking = async (vid: string): Promise<{ ok: boolean; reason?: string }> => {
    if (!bkName.trim() || !bkPhone.trim()) {
      return { ok: false, reason: t("Укажите имя и телефон") };
    }
    try {
      const r = await bookTableFn({
        data: {
          vid,
          // Дата выбранного вечера, а не сегодняшняя.
          dateIso: dayIso,
          guests: bkGuests,
          name: bkName,
          phone: bkPhone,
          note: book?.title ? `Заявка из афиши: ${book.title}` : "Заявка из раздела «Сегодня»",
        },
      });
      if (r.ok) {
        setBkState(t("Заявка ушла — площадка свяжется с вами"));
        return { ok: true };
      }
      return { ok: false, reason: r.reason };
    } catch {
      return { ok: false, reason: t("Сервер недоступен") };
    }
  };

  // Дата говорит на языке интерфейса.
  const dayLocale = { ru: "ru-RU", en: "en-GB", th: "th-TH" }[i18n.language] ?? "en-GB";
  const dayLabel = new Date(`${dayIso}T12:00:00Z`).toLocaleDateString(dayLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const chipLabel = (iso: string) => {
    if (iso === todayIso) return t("Сегодня");
    if (iso === tomorrowIso) return t("Завтра");
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(dayLocale, {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const headline = dayIso === todayIso ? t("Сегодня") : dayIso === tomorrowIso ? t("Завтра") : dayLabel;

  const goVenue = (vid: string) =>
    navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid } });

  // ---------- карточка события: афиша целиком, время и вход поверх ----------
  const eventCard = (e: FeedItem, i: number) => {
    const v = V(e.vid);
    const inRoute = route.includes(e.vid);
    return (
      <article key={e.vid + e.id} className="gtr-af-ev" style={{ "--i": Math.min(i, 10) } as CSSProperties}>
        <button className="gtr-af-ev-img" onClick={() => openBook(e.vid, e.title)} aria-label={e.title}>
          <PosterImg src={posterUrl(e.vid, e.id)} alt={e.title} />
        </button>
        <div className="gtr-af-ev-body">
          {/* время, вход и «наш артист» — строкой под афишей, а не поверх:
              в углах постера обычно и стоят дата и имена */}
          {e.time || e.price || e.artistIds.length ? (
            <div className="gtr-af-ev-meta">
              {e.time ? <span className="gtr-af-ev-time">{e.time}</span> : null}
              {e.price ? <span className="gtr-af-ev-price">{t(e.price)}</span> : null}
              {e.artistIds.length ? <span className="gtr-af-ev-ours">{t("НАШ АРТИСТ")}</span> : null}
            </div>
          ) : null}
          <h3 className="gtr-af-ev-title">{e.title}</h3>
          <button className="gtr-af-ev-venue" onClick={() => goVenue(e.vid)}>
            {v.name}
            <span> · {v.area}</span>
          </button>
          <div className="gtr-af-ev-act">
            <button className="gtr-btn gtr-btn-red" onClick={() => openBook(e.vid, e.title)}>
              {t("Забронировать")}
            </button>
            <button
              className={`gtr-af-route${inRoute ? " on" : ""}`}
              onClick={() => toggleRoute(e.vid)}
              aria-pressed={inRoute}
              title={inRoute ? t("В маршруте") : t("В маршрут")}
            >
              {inRoute ? "✓" : "+"}
            </button>
          </div>
        </div>
      </article>
    );
  };

  // ---------- карточка площадки: снимок, часы, музыка ----------
  const venueCard = (v: Venue, i: number) => {
    const n = nightOf(v.id);
    const hero = richOf(v.id).hero;
    const inRoute = route.includes(v.id);
    const g = GEO[v.id];
    const line = [n.music, n.entry].filter(Boolean).map((s) => t(String(s))).join(" · ");
    return (
      <article key={v.id} className="gtr-af-venue" style={{ "--i": Math.min(i % VENUE_PAGE, 10) } as CSSProperties}>
        <button className="gtr-venue-shot gtr-af-venue-shot" onClick={() => goVenue(v.id)} aria-label={v.name}>
          {hero ? (
            <img
              src={hero}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <span className="gtr-af-venue-fade" />
          <VenueLogo vid={v.id} h={20} style={{ position: "absolute", left: 12, top: 10, zIndex: 2 }} />
          <span className="gtr-af-venue-name">
            <b>{v.name}</b>
            {n.hours ? (
              <span className="gtr-af-venue-hours">
                <span className="gtr-eq" aria-hidden>
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                {t(String(n.hours)).split("·")[0].trim()}
              </span>
            ) : null}
          </span>
        </button>
        <div className="gtr-af-venue-body">
          <div className="gtr-af-venue-line">{line || v.area}</div>
          {n.best ? <div className="gtr-af-venue-best">★ {t(n.best)}</div> : null}
          <div className="gtr-af-venue-act">
            <button className="gtr-btn gtr-btn-red" onClick={() => openBook(v.id)}>
              {t("Стол")}
            </button>
            {v.phone ? (
              <a className="gtr-btn" href={`tel:${String(v.phone).replace(/[^+\d]/g, "")}`}>
                {t("Позвонить")}
              </a>
            ) : null}
            {v.social ? (
              <a
                className="gtr-btn"
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
                href={`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("Маршрут")}
              </a>
            ) : null}
            <button
              className={`gtr-af-route${inRoute ? " on" : ""}`}
              onClick={() => toggleRoute(v.id)}
              aria-pressed={inRoute}
              title={inRoute ? t("В маршруте") : t("В маршрут")}
            >
              {inRoute ? "✓" : "+"}
            </button>
          </div>
        </div>
      </article>
    );
  };

  const KIND_LABEL: [Kind, string][] = [
    ["club", t("Клубы")],
    ["beach", t("Пляжные клубы")],
    ["live", t("Живая музыка")],
    ["bar", t("Бары и руфтопы")],
  ];

  return (
    <div className="gtr-af">
      {/* шапка: какой вечер и сколько в нём событий */}
      <header className="gtr-af-head">
        <div className="gtr-af-kick">{t("АФИША · ПХУКЕТ")}</div>
        <h1 className="gtr-af-h1">{headline}</h1>
        <div className="gtr-af-sub">
          {dayIso === todayIso || dayIso === tomorrowIso ? <span>{dayLabel}</span> : null}
          {dayEvents.length ? (
            <span>
              <b>{dayEvents.length}</b> {t("в афише")}
            </span>
          ) : null}
        </div>
      </header>

      {only ? (
        <div className="gtr-af-only">
          <VenueLogo vid={only} h={20} />
          <span className="gtr-af-only-name">{V(only).name}</span>
          <button className="gtr-btn" onClick={() => setOnlyVid("")}>
            {t("Показать весь остров")}
          </button>
        </div>
      ) : null}

      {/* выбор вечера: лента на две недели и поле даты для дальних анонсов */}
      <nav className="gtr-af-days" aria-label={t("Дата")}>
        <div className="gtr-map-row">
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
                {n ? <span className="gtr-af-day-n">{n}</span> : null}
              </button>
            );
          })}
          <input
            className="gtr-input gtr-af-date"
            type="date"
            value={dayIso}
            min={todayIso}
            onChange={(e) => setDayIso(e.target.value || todayIso)}
            aria-label={t("Дата")}
          />
        </div>
      </nav>

      {/* маршрут вечера — бар-хоппинг */}
      {route.length ? (
        <section className="gtr-af-route-bar">
          <div className="gtr-af-route-list">
            <span className="gtr-af-kick">{t("МАРШРУТ ВЕЧЕРА")}</span>
            {route.map((vid, i) => (
              <Chip key={vid} color="#7B4DFF">
                {i + 1}. {V(vid).name}
              </Chip>
            ))}
          </div>
          <div className="gtr-af-route-act">
            {routeUrl() ? (
              <a className="gtr-btn gtr-btn-red" href={routeUrl()} target="_blank" rel="noreferrer">
                {t("Открыть в Google Maps")} ↗
              </a>
            ) : null}
            {isTracking ? (
              <>
                <span className="gtr-af-gps">
                  <i /> {t("GPS ВКЛ")}
                </span>
                <button className="gtr-btn" onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "tracking" } })}>
                  {t("Карта")} →
                </button>
                <button
                  className="gtr-btn"
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
                onClick={() => {
                  gpsTracker.startTrack(route);
                  setIsTrackingEnabled(true);
                }}
              >
                {t("GPS трекер")}
              </button>
            )}
            <button
              className="gtr-btn gtr-btn-ghost"
              onClick={() => {
                setRoute([]);
                saveRoute([]);
                if (isTracking) setIsTrackingEnabled(false);
              }}
            >
              {t("Очистить")}
            </button>
          </div>
          {gpsError ? <div className="gtr-af-note gtr-af-note-red">{t("Ошибка GPS")}: {gpsError}</div> : null}
          {currentLocation ? (
            <div className="gtr-af-note">
              {t("Точность")}: ±{Math.round(currentLocation.accuracy)} {t("м")}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* события выбранного вечера */}
      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("События")}</h2>
        {dayEvents.length ? (
          <div className="gtr-af-grid">{dayEvents.map(eventCard)}</div>
        ) : loaded ? (
          <p className="gtr-af-empty">
            {only
              ? t("У этой площадки на выбранный день анонсов нет.")
              : t("На этот вечер анонсов пока нет — ниже места, открытые вечером.")}
          </p>
        ) : (
          <div className="gtr-af-grid" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="gtr-af-skel" />
            ))}
          </div>
        )}
      </section>

      {/* ночные площадки: фильтр по типу и порции по восемь */}
      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("Открыто вечером")}</h2>
        {only ? null : (
          <div className="gtr-map-row gtr-af-kinds">
            <button
              className={`gtr-map-chip${!kind ? " on" : ""}`}
              aria-pressed={!kind}
              onClick={() => {
                setKind("");
                setVenueLimit(VENUE_PAGE);
              }}
            >
              {t("Все")}
            </button>
            {KIND_LABEL.filter(([k]) => kinds[k]).map(([k, label]) => (
              <button
                key={k}
                className={`gtr-map-chip${kind === k ? " on" : ""}`}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setVenueLimit(VENUE_PAGE);
                }}
              >
                {label}
                <span className="gtr-af-day-n">{kinds[k]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="gtr-af-venues">{venues.map(venueCard)}</div>
        {venuesAll.length > venues.length ? (
          <button className="gtr-btn gtr-af-more" onClick={() => setVenueLimit((n) => n + VENUE_PAGE * 2)}>
            {t("Показать ещё")} · {venuesAll.length - venues.length}
          </button>
        ) : null}
      </section>

      {/* шторка брони: событие или площадка, имя, телефон, гости */}
      {book
        ? createPortal(
            <div className="gtr-portal gtr-af-sheet-scrim" onClick={() => setBook(null)}>
              <div
                className="gtr-af-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={t("Бронь стола")}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="gtr-af-sheet-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="gtr-af-kick">{t("Бронь стола")}</div>
                    <div className="gtr-af-sheet-title">{book.title || V(book.vid).name}</div>
                    <div className="gtr-af-sheet-sub">
                      {book.title ? `${V(book.vid).name} · ` : ""}
                      {dayLabel}
                    </div>
                  </div>
                  <button className="gtr-af-sheet-x" onClick={() => setBook(null)} aria-label={t("Закрыть")}>
                    ✕
                  </button>
                </div>
                <div className="gtr-af-sheet-form">
                  <label className="gtr-af-field">
                    <span>{t("Имя")}</span>
                    <input className="gtr-input" value={bkName} onChange={(e) => setBkName(e.target.value)} />
                  </label>
                  <label className="gtr-af-field">
                    <span>{t("Телефон / WhatsApp")}</span>
                    <input
                      className="gtr-input"
                      inputMode="tel"
                      value={bkPhone}
                      onChange={(e) => setBkPhone(e.target.value)}
                    />
                  </label>
                  <div className="gtr-af-field">
                    <span>{t("Гостей")}</span>
                    <div className="gtr-af-guests">
                      <button onClick={() => setBkGuests((g) => Math.max(1, g - 1))} aria-label="−">
                        −
                      </button>
                      <b>{bkGuests}</b>
                      <button onClick={() => setBkGuests((g) => Math.min(100, g + 1))} aria-label="+">
                        +
                      </button>
                    </div>
                  </div>
                  <SwipeToBook
                    label={t("ПРОВЕДИ ДЛЯ БРОНИ →")}
                    desktopLabel={t("ЗАБРОНИРОВАТЬ СТОЛ")}
                    sendingLabel={t("ОТПРАВЛЯЕМ…")}
                    doneLabel={t("✓ СТОЛ ЗАБРОНИРОВАН")}
                    onConfirm={() => submitBooking(book.vid)}
                  />
                  {ppCfg ? (
                    <button className="gtr-btn" onClick={() => setPpFor(book.vid)}>
                      {t("Оплатить депозит · PromptPay QR")}
                    </button>
                  ) : null}
                  {bkState ? <div className="gtr-af-note gtr-af-note-ok">{bkState}</div> : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {ppFor && ppCfg ? (
        <PromptpayModal cfg={ppCfg} title={`${t("Депозит")} · ${V(ppFor).name}`} onClose={() => setPpFor("")} />
      ) : null}
    </div>
  );
}
