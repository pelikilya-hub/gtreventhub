import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { logoutFn, type SessionUser } from "./auth";
import {
  eventAlerts,
  NAV_NET,
  NAV_VENUE,
  STATUS_COLOR,
  STATUS_LABEL,
  V,
  type ScreenId,
} from "./data/app-data";
import { useContent } from "./content";
import { GtrProvider, useGtr } from "./store";
import { Eyebrow, Icon } from "./ui";

import { DashScreen } from "./screens/Dash";
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

const ArtistsScreen = lazy(() =>
  import("./screens/Artists").then((m) => ({ default: m.ArtistsScreen })),
);
const VendorsScreen = lazy(() =>
  import("./screens/Vendors").then((m) => ({ default: m.VendorsScreen })),
);

export type GtrSearch = { vid?: string; artist?: string; draft?: string };

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
  const { user, peers, draftsOf } = useGtr();
  const { editMode, setEditMode } = useContent();
  const navigate = useNavigate();
  const venue = user.venueId ? V(user.venueId) : null;

  // Мобильное меню: на узком экране сайдбар живёт как выезжающая панель
  const [navOpen, setNavOpen] = useState(false);

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

  const navVenue =
    user.role === "gtr" || user.role === "artist"
      ? NAV_VENUE.filter(([id]) => id === "dash")
      : NAV_VENUE;
  const navNet =
    user.role === "gtr"
      ? NAV_NET
      : user.role === "artist"
        ? NAV_NET.filter(([id]) => id === "artists")
        : NAV_NET.filter(([id]) => id !== "admin");

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
              <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
              {alarm ? (
                <span
                  className="gtr-mono gtr-presence"
                  title={`${problemCount} требует внимания`}
                  style={{
                    font: "700 9px/1 'JetBrains Mono',monospace",
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
                    font: "600 9px/1 'JetBrains Mono',monospace",
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
    <div className={`gtr-shell ${navOpen ? "nav-open" : ""}`}>
      {/* ---------- мобильная шапка ---------- */}
      <header className="gtr-topbar">
        <button
          className="gtr-burger"
          aria-label="Меню"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <img
          src="/brand/GTR_primary_dark_clean.svg"
          alt="GTR — Global Transformation Reality"
          style={{ height: 30, width: "auto" }}
        />
      </header>
      {navOpen ? <div className="gtr-scrim" onClick={() => setNavOpen(false)} /> : null}

      {/* ---------- сайдбар ---------- */}
      <aside className="gtr-sidebar">
        <div className="gtr-neon" style={{ padding: "0 11px", marginBottom: 22 }}>
          <img
            src="/brand/GTR_primary_dark_clean.svg"
            alt="GTR — Global Transformation Reality"
            style={{ height: 44, width: "auto", display: "block" }}
          />
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
              font: "700 9.5px/1 Oswald,sans-serif",
              background: "#E5231B",
            }}
          >
            {user.initials}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", font: "600 11.5px/1.2 'Golos Text',sans-serif" }}>
              {user.roleLabel}
            </span>
            <span
              style={{
                display: "block",
                marginTop: 3,
                font: "500 9px/1.2 'JetBrains Mono',monospace",
                color: "rgba(255,255,255,.45)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {venue ? venue.name : "Сеть · 97 площадок"}
            </span>
          </span>
        </div>

        <NavGroup label="ПЛОЩАДКА" items={navVenue} />
        <NavGroup label="СЕТЬ GTR" items={navNet} />

        <div style={{ marginTop: "auto" }}>
          {peers.length > 0 ? (
            <div style={{ padding: "0 11px", marginBottom: 12 }}>
              <Eyebrow style={{ marginBottom: 8 }}>СЕЙЧАС В СИСТЕМЕ</Eyebrow>
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
                      font: "700 8.5px/1 Oswald,sans-serif",
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
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>Режим правки</span>
            <span
              className="gtr-mono"
              style={{
                font: "700 8px/1 'JetBrains Mono',monospace",
                color: editMode ? "#E5231B" : "rgba(255,255,255,.4)",
              }}
            >
              {editMode ? "ВКЛ" : "ВЫКЛ"}
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
            Выйти · {user.email}
          </button>
        </div>
      </aside>

      {/* ---------- контент ---------- */}
      <main key={screen} className="gtr-fade gtr-main">
        <Suspense
          fallback={
            <div
              style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,.4)" }}
              className="gtr-mono"
            >
              Загрузка…
            </div>
          }
        >
          <ScreenSwitch screen={screen} search={search} />
        </Suspense>
      </main>
    </div>
  );
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
    case "admin":
      return <AdminScreen />;
    default:
      return <DashScreen />;
  }
}
