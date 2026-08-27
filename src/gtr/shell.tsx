import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { logoutFn, type SessionUser } from "./auth";
import {
  eventAlerts,
  NAV_ARTIST,
  NAV_NET,
  canPrivate,
  NAV_PLATFORM_VENUE,
  NAV_PRIVATE,
  NAV_TABS,
  NAV_VENUE,
  NAV_VENUE_CABINET,
  NAV_VISITOR,
  STATUS_COLOR,
  STATUS_LABEL,
  V,
  type ScreenId,
} from "./data/app-data";
import { useContent } from "./content";
import { GtrProvider, useGtr } from "./store";
import { Eyebrow, Icon } from "./ui";
import { setUiLang, UI_LANGS, type UiLang } from "./i18n";
import { useTranslation } from "react-i18next";

import { DashScreen } from "./screens/Dash";
import { PrivateScreen } from "./screens/Private";
import { CalendarScreen } from "./screens/Calendar";
import { ConstructorScreen } from "./screens/Constructor";
import { EventsScreen } from "./screens/Events";
import {
  AccessScreen,
  AdminScreen,
  FinanceScreen,
  InquiriesScreen,
  SpacesScreen,
  VenueScreen,
} from "./screens/Misc";
import { BaseScreen, VenueCardScreen } from "./screens/Base";
import { ContactsScreen } from "./screens/Contacts";
import {
  AiMatchScreen,
  CommunityScreen,
  FeedScreen,
} from "./screens/Platform";
import { TonightScreen } from "./screens/Tonight";
import { TrackingScreen } from "./screens/Tracking";
import { PhrasesScreen } from "./screens/Phrases";
import { ScreenErrorBoundary } from "./error-boundary";
import { UpdateGate } from "./update-gate";
import { useDeviceTilt } from "./motion";
import { GtrDancer } from "./dancer";
import { GtrPlayerBar } from "./player";
import { broFlagsFn } from "./kv-api";

const GtrBroOverlay = lazy(() =>
  import("./bro/BroOverlay").then((m) => ({ default: m.GtrBroOverlay })),
);
import {
  MyShowsScreen,
  PromoScreen,
  VisasScreen,
} from "./screens/Platform";

const ArtistsScreen = lazy(() =>
  import("./screens/Artists").then((m) => ({ default: m.ArtistsScreen })),
);
const OutreachScreen = lazy(() =>
  import("./screens/Outreach").then((m) => ({ default: m.OutreachScreen })),
);
const DraftsScreen = lazy(() =>
  import("./screens/Drafts").then((m) => ({ default: m.DraftsScreen })),
);
const VendorsScreen = lazy(() =>
  import("./screens/Vendors").then((m) => ({ default: m.VendorsScreen })),
);
const MapScreen = lazy(() =>
  import("./screens/MapScreen").then((m) => ({ default: m.MapScreen })),
);
const AfishaGenScreen = lazy(() =>
  import("./screens/AfishaGen").then((m) => ({ default: m.AfishaGenScreen })),
);

export type GtrSearch = { vid?: string; artist?: string; draft?: string };

// Переключатель языка в шапке: RU / EN / TH одним тапом, мгновенно —
// в мобильной шапке справа и в сайдбаре десктопа под логотипом
function LangSwitch({ style }: { style?: import("react").CSSProperties }) {
  const { i18n: i } = useTranslation();
  const cur = (i.language as UiLang) || "ru";
  return (
    <div style={{ display: "inline-flex", border: "1px solid rgba(255,255,255,.16)", ...style }}>
      {UI_LANGS.map(([code]) => (
        <button
          key={code}
          onClick={() => setUiLang(code)}
          aria-pressed={cur === code}
          style={{
            padding: "6px 9px",
            cursor: "pointer",
            font: "700 11px/1 'JetBrains Mono',monospace",
            letterSpacing: ".08em",
            border: "none",
            background: cur === code ? "#E5231B" : "transparent",
            color: cur === code ? "#fff" : "rgba(255,255,255,.55)",
          }}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function GtrShell({
  user,
  screen,
  search,
}: {
  user: SessionUser;
  screen: ScreenId;
  search: GtrSearch;
}) {
  return (
    <GtrProvider user={user}>
      <ShellInner screen={screen} search={search} />
    </GtrProvider>
  );
}

function ShellInner({ screen, search }: { screen: ScreenId; search: GtrSearch }) {
  const { t } = useTranslation();
  const { user, peers, draftsOf } = useGtr();
  const { editMode, setEditMode } = useContent();
  const navigate = useNavigate();
  const venue = user.venueId ? V(user.venueId) : null;

  // Мобильное меню: на узком экране сайдбар живёт как выезжающая панель
  const [navOpen, setNavOpen] = useState(false);

  // Поворот телефона: на переходе портрет↔ландшафт раскладка
  // перекомпоновывается, и раньше это был резкий скачок. Ловим смену
  // ориентации и на полсекунды включаем класс — по нему CSS проигрывает
  // мягкий перевод сцены, а не рывок. Строчку закрываем ещё и на resize:
  // на части Android orientationchange приходит без matchMedia-события.
  const [rotating, setRotating] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    let timer = 0;
    const pulse = () => {
      setRotating(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRotating(false), 520);
    };
    mq.addEventListener?.("change", pulse);
    window.addEventListener("orientationchange", pulse);
    return () => {
      mq.removeEventListener?.("change", pulse);
      window.removeEventListener("orientationchange", pulse);
      window.clearTimeout(timer);
    };
  }, []);

  // GTR BRO: центральная кнопка GTR — активатор голоса. Флаг спрашиваем
  // один раз: пока фича выключена, кнопка работает как раньше и никому
  // ничего не обещает.
  const [broOn, setBroOn] = useState(false);
  const [broProv, setBroProv] = useState<"openai" | "gemini">("gemini");
  const [broOpen, setBroOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    broFlagsFn()
      .then((f) => {
        if (!alive) return;
        setBroOn(Boolean(f.enabled && f.keyReady));
        setBroProv(f.provider);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Экраны зовут BRO событием окна (в дереве компонентов до setBroOpen не
  // дотянуться): дайджест гостя «чем бро может помочь сегодня» открывает
  // помощника, не пробрасывая колбэк через полприложения. Открываем только
  // когда голос реально включён — иначе окно пустое.
  const broOnRef = useRef(broOn);
  broOnRef.current = broOn;
  useEffect(() => {
    const open = () => { if (broOnRef.current) setBroOpen(true); };
    window.addEventListener("gtr:bro-open", open);
    return () => window.removeEventListener("gtr:bro-open", open);
  }, []);
  useDeviceTilt(); // гироскоп: наклон телефона двигает атмосферный свет

  const go = (id: ScreenId) => {
    setNavOpen(false);
    navigate({ to: "/gtr/$screen", params: { screen: id } });
  };

  // Живые проблемы/задержки по всем событиям площадки — для счётчика и тостов.
  // Событий теперь может быть несколько, поэтому счётчик собирается по всем.
  const problemAlerts = useMemo(() => {
    if (!user.venueId) return [];
    return draftsOf(user.venueId)
      .flatMap((d) => eventAlerts(d.graph, venue ?? undefined, {}))
      .filter((a) => a.severity === "problem" || a.severity === "delay");
  }, [user.venueId, draftsOf, venue]);
  const problemCount = problemAlerts.length;

  // Тост только на НОВУЮ проблему/задержку (не на каждый ререндер и не на
  // проблемы, которые уже были при заходе).
  const seenRef = useRef<Set<string> | null>(null);
  const sig = problemAlerts
    .map((a) => `${a.severity}|${a.title}|${a.reason}`)
    .sort()
    .join("¦");
  useEffect(() => {
    const keys = new Set(sig ? sig.split("¦") : []);
    if (seenRef.current === null) {
      seenRef.current = keys; // первый рендер — только запоминаем, без тостов
      return;
    }
    for (const a of problemAlerts) {
      const k = `${a.severity}|${a.title}|${a.reason}`;
      if (!seenRef.current.has(k)) {
        toast(`${STATUS_LABEL[a.severity]}: ${a.title}`, {
          description: a.reason,
          style: { borderLeft: `3px solid ${STATUS_COLOR[a.severity]}` },
          action: {
            label: "Открыть",
            onClick: () => go("constructor"),
          },
        });
      }
    }
    seenRef.current = keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Три вариации меню платформы + операционные группы команд
  const canAfishaGen = Boolean(user.boss) || user.role === "organizer";
  const isArtist = user.role === "artist";
  const isVisitor = user.role === "visitor";
  // Площадка видит только свой кабинет: своя программа, свои заявки,
  // свой паспорт. Базы других заведений, каталога артистов и нашего
  // конструктора в её меню нет вовсе — это внутренняя кухня GTR.
  const isVenueAcc = user.role === "venue";
  const navVenue = isArtist
    ? NAV_ARTIST
    : isVisitor
      ? NAV_VISITOR
      : isVenueAcc
        ? NAV_VENUE_CABINET
        : user.role === "organizer"
        ? NAV_VENUE.filter(([id]) => ["dash", "calendar", "events", "constructor"].includes(id))
        : user.role === "gtr"
          ? NAV_VENUE.filter(([id]) => !["venue", "spaces"].includes(id))
          : NAV_VENUE;
  const navNet = (
    isArtist || isVisitor || isVenueAcc
      ? ([] as typeof NAV_NET)
      : user.role === "gtr"
        ? [...NAV_NET, ...NAV_PLATFORM_VENUE.filter(([id]) => !["artists", "vendors"].includes(id))]
        : [
            ...NAV_PLATFORM_VENUE,
            ...NAV_NET.filter(([id]) => !["admin", "artists", "vendors"].includes(id)),
          ]
  ).filter(([id]) => id !== "afishagen" || canAfishaGen);

  // Private (виллы) — организаторам, PRO и команде. Посетителю-PRO меню
  // сети пустое, поэтому пункт добавляем отдельно, а не фильтром.
  const navNetFull = canPrivate(user) ? [...navNet, NAV_PRIVATE] : navNet;

  const NavGroup = ({ label, items }: { label: string; items: typeof NAV_VENUE }) => (
    <div style={{ marginBottom: 18 }}>
      <Eyebrow style={{ padding: "0 11px", marginBottom: 8 }}>{label}</Eyebrow>
      <div style={{ display: "grid", gap: 2 }}>
        {items.map(([id, title, icon, badge]) => {
          const on = screen === id || (id === "base" && screen === "venueCard");
          const alarm = id === "constructor" && problemCount > 0;
          return (
            <button key={id} className={`gtr-nav-item ${on ? "on" : ""}`} onClick={() => go(id)}>
              <Icon d={icon} size={15} />
              <span style={{ flex: 1, minWidth: 0 }}>{t(title)}</span>
              {alarm ? (
                <span
                  className="gtr-mono gtr-presence"
                  title={`${problemCount} требует внимания`}
                  style={{
                    font: "700 11px/1 'JetBrains Mono',monospace",
                    color: "#fff",
                    background: "#E5231B",
                    borderRadius: 0,
                    padding: "3px 6px",
                  }}
                >
                  {problemCount}
                </span>
              ) : badge ? (
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 11px/1 'JetBrains Mono',monospace",
                    color: "rgba(255,255,255,.45)",
                    background: "rgba(255,255,255,.09)",
                    borderRadius: 0,
                    padding: "3px 5px",
                  }}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={`gtr-shell ${navOpen ? "nav-open" : ""}${rotating ? " gtr-rotating" : ""}`}>
      {/* атмосфера вечеринки: дрейфующий рассеянный свет за всем контентом */}
      <div className="gtr-atmo" aria-hidden>
        <span /><span /><span /><span />
      </div>
      {/* ---------- мобильная шапка ---------- */}
      <header className="gtr-topbar">
        <button
          className="gtr-burger"
          aria-label={t("Меню")}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        {/* Логотипу разрешено ужиматься, переключателю языка — нет: на
            узком телефоне переполняться должна картинка, а не кнопки,
            по которым человек попадает пальцем. */}
        <img
          src="/brand/GTR_primary_dark_clean.svg"
          alt="GTR — Global Transformation Reality"
          style={{ height: 30, width: "auto", minWidth: 0, maxWidth: "46vw", objectFit: "contain" }}
        />
        {/* GTR SOUND живёт в шапке узкой полосой.
            В футере он занимал целую строку над таб-баром и налезал на
            содержимое: в списке заявок кнопки и текст уходили под него.
            В шапке места ровно на то, что нужно на ходу, — играть,
            следующий трек и что сейчас звучит. */}
        <GtrPlayerBar />
        <LangSwitch style={{ marginLeft: "auto", flex: "none" }} />
      </header>
      {/* скрим всегда в DOM: видимость через CSS-фейд, чтобы меню не моргало */}
      <div className="gtr-scrim" aria-hidden={!navOpen} onClick={() => setNavOpen(false)} />

      {/* ---------- сайдбар ---------- */}
      <aside className="gtr-sidebar">
        {/* Шапка меню закреплена: список разделов длинный, и при его
            прокрутке логотип, языки и карточка профиля уезжали наверх —
            на телефоне прямо под системные часы, потому что контент
            приложения идёт под статус-бар. Прокручивается только список. */}
        <div className="gtr-side-head">
        <div className="gtr-neon" style={{ padding: "0 11px", marginBottom: 14 }}>
          <img
            src="/brand/GTR_primary_dark_clean.svg"
            alt="GTR — Global Transformation Reality"
            style={{ height: 44, width: "auto", display: "block" }}
          />
        </div>
        <div style={{ padding: "0 11px", marginBottom: 16 }}>
          <LangSwitch />
        </div>

        {/* пользователь */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 9px",
            borderRadius: 0,
            border: "1px solid #E5231B",
            background: "rgba(229,35,27,.14)",
            marginBottom: 18,
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              flex: "none",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "700 11px/1 Oswald,sans-serif",
              background: "#E5231B",
            }}
          >
            {user.initials}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", font: "600 13px/1.2 'Golos Text',sans-serif" }}>
              {t(user.roleLabel)}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 3,
                font: "500 11px/1.2 'JetBrains Mono',monospace",
                color: "rgba(255,255,255,.45)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {venue ? venue.name : t("Сеть · 110 площадок")}
            </span>
          </span>
        </div>
        </div>

        <NavGroup label={isArtist || isVisitor ? t("ПЛАТФОРМА") : t("ПЛОЩАДКА")} items={navVenue} />
        {navNetFull.length ? <NavGroup label={t("СЕТЬ GTR")} items={navNetFull} /> : null}

        <div className="gtr-navfoot" style={{ marginTop: "auto" }}>
          {peers.length > 0 ? (
            <div style={{ padding: "0 11px", marginBottom: 12 }}>
              <Eyebrow style={{ marginBottom: 8 }}>{t("СЕЙЧАС В СИСТЕМЕ")}</Eyebrow>
              <div style={{ display: "flex", gap: 6 }}>
                {peers.slice(0, 5).map((p) => (
                  <span
                    key={p.id}
                    className="gtr-presence"
                    title={`${p.roleLabel} · ${p.name}`}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "700 10px/1 Oswald,sans-serif",
                      background: "rgba(46,204,113,.18)",
                      border: "1px solid rgba(46,204,113,.5)",
                      color: "#2ECC71",
                    }}
                  >
                    {p.initials}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <button
            className="gtr-nav-item"
            onClick={() => setEditMode(!editMode)}
            style={
              editMode
                ? {
                    background: "rgba(229,35,27,.16)",
                    color: "#fff",
                    boxShadow: "inset 2px 0 0 #E5231B",
                  }
                : undefined
            }
          >
            <Icon d="M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" size={15} />
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>{t("Режим правки")}</span>
            <span
              className="gtr-mono"
              style={{
                font: "700 10px/1 'JetBrains Mono',monospace",
                color: editMode ? "#E5231B" : "rgba(255,255,255,.4)",
              }}
            >
              {editMode ? t("ВКЛ") : t("ВЫКЛ")}
            </span>
          </button>
          <button
            className="gtr-nav-item"
            onClick={async () => {
              await logoutFn();
              navigate({ to: "/gtr/login" });
            }}
          >
            <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9" size={15} />
            {/* Почта длиннее панели: на телефоне «выйти · fedor.pavlysh@gtr.events»
                не помещалось в строку и уезжало за край. Ставим её второй
                строкой и обрезаем, действие остаётся читаемым всегда. */}
            <span style={{ display: "grid", gap: 1, minWidth: 0, textAlign: "left" }}>
              <span>{t("Выйти")}</span>
              <span
                className="gtr-mono"
                style={{
                  font: "500 11px/1.2 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.email}
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* ---------- контент ---------- */}
      <main className="gtr-main">
        <div key={screen} className="gtr-screenin">
        <Suspense
          fallback={
            <div
              style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,.4)" }}
              className="gtr-mono"
            >
              {t("Загрузка…")}
            </div>
          }
        >
          {/* Падение раздела больше не превращается в пустую страницу:
              человек видит, что упало, и может перезапустить, а команда
              видит текст ошибки прямо на экране. */}
          <UpdateGate />
          <ScreenErrorBoundary key={screen} where={screen} detailed={!["visitor", "artist"].includes(user.role)}>
            <ScreenSwitch screen={screen} search={search} />
          </ScreenErrorBoundary>
        </Suspense>
        </div>
      </main>

      <GtrDancer />

      {/* ---------- нижняя навигация (телефон и iPad) ---------- */}
      <nav className="gtr-tabbar" aria-label={t("Основные разделы")}>
        {NAV_TABS.map(([id, label, d]) => {
          const on = screen === id;
          const center = !d;
          return (
            <button
              key={id}
              className={`gtr-tab${center ? " gtr-tab-center" : ""}${on ? " on" : ""}`}
              aria-current={on ? "page" : undefined}
              // Центральная кнопка зовёт голос, когда он включён. Долгое
              // нажатие всегда ведёт на экран «Сегодня» — чтобы голос не
              // отбирал у продукта существующий путь.
              onContextMenu={center && broOn ? (e) => { e.preventDefault(); go(id); } : undefined}
              onClick={() => (center && broOn ? setBroOpen(true) : go(id))}
            >
              {center ? (
                <span className="gtr-tab-core">
                  <img src="/raw-pulse/handle-logo.webp" alt="" aria-hidden />
                </span>
              ) : (
                <Icon d={d} size={23} />
              )}
              <span className="gtr-tab-label">{t(label)}</span>
            </button>
          );
        })}
      </nav>

      {/* Вызов BRO на десктопе: нижней панели на широком экране нет, и без
          этого значка помощник был доступен только с телефона. */}
      {broOn && !broOpen && (
        <button
          className="gtr-bro-dock"
          onClick={() => setBroOpen(true)}
          aria-label={t("Открыть GTR BRO")}
          title={t("GTR BRO")}
        >
          <img src="/raw-pulse/handle-logo.webp" alt="" aria-hidden draggable={false} />
          <span>BRO</span>
        </button>
      )}

      {broOn && (
        <Suspense fallback={null}>
          <GtrBroOverlay
            open={broOpen}
            onClose={() => setBroOpen(false)}
            screen={screen}
            boss={Boolean(user.boss)}
            userName={user.name}
            role={user.role}
            provider={broProv}
            onNavigate={(route, entityId) => {
              setBroOpen(false);
              if (route === "venueCard" && entityId)
                navigate({ to: "/gtr/$screen", params: { screen: "base" }, search: { vid: entityId } });
              else go(route as ScreenId);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

// Private закрыт: прямой переход по адресу без прав показывает отказ, а не
// содержимое. Данные вилл публичные (trip.com), поэтому это разграничение
// продукта, а не защита секретов — наценку GTR при необходимости надо
// уносить на сервер отдельно.
function PrivateGate() {
  const { user } = useGtr();
  const { t } = useTranslation();
  if (!canPrivate(user)) {
    return (
      <div style={{ padding: "48px 8px", maxWidth: "52ch" }}>
        <Eyebrow>PRIVATE</Eyebrow>
        <div style={{ font: "600 15px/1.5 'Golos Text',sans-serif", margin: "10px 0 8px" }}>
          {t("Раздел доступен организаторам и участникам Комьюнити PRO")}
        </div>
        <div style={{ font: "500 12.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {t("Виллы под приватные события открываются вместе с подпиской PRO. Напишите команде GTR — подключим.")}
        </div>
      </div>
    );
  }
  return <PrivateScreen />;
}

function ScreenSwitch({ screen, search }: { screen: ScreenId; search: GtrSearch }) {
  switch (screen) {
    case "dash":
      return <DashScreen />;
    case "calendar":
      return <CalendarScreen />;
    case "constructor":
      return <ConstructorScreen draftId={search.draft} />;
    case "events":
      return <EventsScreen newForVenue={search.vid} />;
    case "inquiries":
      return <InquiriesScreen />;
    case "spaces":
      return <SpacesScreen />;
    case "venue":
      return <VenueScreen />;
    case "finance":
      return <FinanceScreen />;
    case "artists":
      return <ArtistsScreen artistId={search.artist} />;
    case "vendors":
      return <VendorsScreen />;
    case "base":
      return <BaseScreen />;
    case "venueCard":
      return <VenueCardScreen vid={search.vid} />;
    case "access":
      return <AccessScreen />;
    case "contacts":
      return <ContactsScreen />;
    case "afishagen":
      return <AfishaGenScreen />;
    case "map":
      return <MapScreen />;
    case "feed":
      return <FeedScreen />;
    case "tonight":
      return <TonightScreen vid={search.vid} />;
    case "tracking":
      return <TrackingScreen />;
    case "aimatch":
      return <AiMatchScreen />;
    case "phrases":
      return <PhrasesScreen />;
    case "private":
      return <PrivateGate />;
    case "community":
      return <CommunityScreen />;
    case "visas":
      return <VisasScreen />;
    case "promo":
      return <PromoScreen vid={search.vid} />;
    case "outreach":
      return <OutreachScreen />;
    case "drafts":
      return <DraftsScreen />;
    case "myshows":
      return <MyShowsScreen />;
    case "admin":
      return <AdminScreen />;
    default:
      return <DashScreen />;
  }
}
