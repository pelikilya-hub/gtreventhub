import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  calPaletteOf,
  loadArtists,
  MONTHS,
  roomsOf,
  type Artist,
  type CalEvent,
} from "../data/app-data";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";
import { Card, Chip, Eyebrow } from "../ui";
import { useEffect } from "react";
import { PH, V, draftTitle } from "../data/app-data";
import { afishaVenuesFn, listAfishaFn } from "../kv-api";

const WD = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const WD_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function CalendarScreen() {
  const { t } = useTranslation();
  const { user, shared, setEvents } = useGtr();
  // Режим: «наши события» (по умолчанию для штаба) или календарь площадки
  const [scope, setScope] = useState<string>(user.venueId || "ours");
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const [afishaVids, setAfishaVids] = useState<string[]>([]);
  const [afisha, setAfisha] = useState<{ id: string; title: string; dateIso: string; url: string; artistIds: string[] }[]>([]);
  const vid = scope === "ours" ? "" : scope;
  const rooms = roomsOf(vid || "VEN-0013");

  useEffect(() => {
    afishaVenuesFn().then((r) => setAfishaVids(r.vids)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!vid) return setAfisha([]);
    listAfishaFn({ data: { vid } })
      .then((r) => setAfisha((r.events as typeof afisha) ?? []))
      .catch(() => setAfisha([]));
  }, [vid]);

  const [month, setMonth] = useState(7);
  const [year, setYear] = useState(2026);
  const navigate = useNavigate();
  const [selDay, setSelDay] = useState(8);
  const [room, setRoom] = useState("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [lineupArtists, setLineupArtists] = useState<Artist[]>([]);

  useEffect(() => {
    if (!shared.lineup.length) return;
    loadArtists().then((base) =>
      setLineupArtists(
        shared.lineup
          .map((id) => base.artists.find((a) => a.id === id))
          .filter(Boolean) as Artist[],
      ),
    );
  }, [shared.lineup]);

  const roomColor = (k: string) => rooms.find((r) => r[0] === k)?.[2] ?? "rgba(255,255,255,.3)";
  const roomName = (k: string) => rooms.find((r) => r[0] === k)?.[1] ?? k;

  const allEvents = useMemo(
    () =>
      shared.events.filter(
        (e) =>
          e.venueId === vid &&
          e.month === month &&
          e.year === year &&
          (room === "all" || e.room === room),
      ),
    [shared.events, vid, month, year, room],
  );

  // Наши события: черновики с датой; в режиме площадки — только её
  const oursMonth = useMemo(() => {
    return shared.drafts
      .filter((d) => d.dateIso)
      .filter((d) => (vid ? d.venueId === vid : true))
      .map((d) => {
        const [y, m, dd] = (d.dateIso as string).split("-").map(Number);
        return { y, m: m - 1, d: dd, id: d.id, title: draftTitle(d), venueId: d.venueId };
      })
      .filter((x) => x.y === year && x.m === month);
  }, [shared.drafts, vid, year, month]);

  const afishaMonth = useMemo(
    () =>
      afisha
        .map((e) => {
          const [y, m, dd] = e.dateIso.split("-").map(Number);
          return { ...e, y, m: m - 1, d: dd };
        })
        .filter((x) => x.y === year && x.m === month),
    [afisha, year, month],
  );

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayD = year === 2026 && month === 7 ? 6 : -1;

  const dayList = allEvents
    .filter((e) => e.day === selDay)
    .sort((a, b) => a.start.localeCompare(b.start));
  const oursDay = oursMonth.filter((e) => e.d === selDay);
  const afishaDay = afishaMonth.filter((e) => e.d === selDay);

  const shift = (id: string, mins: number) =>
    setEvents((list) =>
      list.map((e) => {
        if (e.id !== id) return e;
        const bump = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          const tot = (h * 60 + m + mins + 1440) % 1440;
          return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
        };
        return { ...e, start: bump(e.start), end: bump(e.end) };
      }),
    );

  const addEvent = (title: string, evRoom: string, start: string, end: string) =>
    setEvents((list) => [
      ...list,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        venueId: vid,
        day: selDay,
        month,
        year,
        title,
        room: evRoom,
        start,
        end,
        status: "hold" as const,
      },
    ]);

  const dropOnDay = (n: number) => {
    if (!dragId) return;
    setEvents((list) => list.map((e) => (e.id === dragId ? { ...e, day: n, month, year } : e)));
    setDragId(null);
    setSelDay(n);
  };

  const prevMonth = () => (month === 0 ? (setMonth(11), setYear(year - 1)) : setMonth(month - 1));
  const nextMonth = () => (month === 11 ? (setMonth(0), setYear(year + 1)) : setMonth(month + 1));

  const loadCounts = Array.from(
    { length: daysInMonth },
    (_, i) =>
      allEvents.filter((e) => e.day === i + 1).length +
      oursMonth.filter((e) => e.d === i + 1).length +
      afishaMonth.filter((e) => e.d === i + 1).length,
  );
  const dSel = new Date(year, month, selDay);
  const statusBg = (e: CalEvent) =>
    e.status === "confirmed"
      ? "rgba(255,255,255,.08)"
      : e.status === "hold"
        ? "rgba(245,166,35,.16)"
        : "rgba(229,35,27,.16)";

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {user.role === "gtr" ? (
          // Селектор области: «наши события» или календарь любой из 97 площадок
          <div style={{ position: "relative" }}>
            <button
              className="gtr-oswald gtr-h1"
              onClick={() => {
                setPickOpen((v) => !v);
                setPickQ("");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: 0,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  flex: "none",
                  borderRadius: 0,
                  background: scope === "ours" ? "#E5231B" : "#2ECC71",
                }}
              />
              {scope === "ours" ? t("Наши события") : (V(scope)?.name ?? scope)}
              <span
                className="gtr-mono"
                style={{
                  font: "600 11px/1 'JetBrains Mono',monospace",
                  color: "rgba(255,255,255,.45)",
                }}
              >
                {pickOpen ? "▲" : "▼"}
              </span>
            </button>
            {pickOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: 0,
                  zIndex: 40,
                  width: 310,
                  maxHeight: 380,
                  overflowY: "auto",
                  background: "var(--gtr-card)",
                  border: "1px solid rgba(255,255,255,.16)",
                  boxShadow: "0 18px 44px rgba(0,0,0,.6)",
                }}
              >
                <input
                  autoFocus
                  value={pickQ}
                  onChange={(e) => setPickQ(e.target.value)}
                  placeholder={t("Поиск по 97 площадкам…")}
                  style={{
                    width: "100%",
                    padding: "11px 13px",
                    background: "rgba(255,255,255,.03)",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,.1)",
                    color: "#fff",
                    font: "500 12px/1 'Golos Text',sans-serif",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => {
                    setScope("ours");
                    setRoom("all");
                    setPickOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: "10px 13px",
                    background: scope === "ours" ? "rgba(229,35,27,.14)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,.06)",
                    color: "#fff",
                    cursor: "pointer",
                    font: "600 12px/1.2 'Golos Text',sans-serif",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 7, height: 7, flex: "none", background: "#E5231B" }} />
                  <span style={{ flex: 1 }}>{t("Наши события")}</span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 8.5px/1 'JetBrains Mono',monospace",
                      color: "rgba(255,255,255,.4)",
                    }}
                  >
                    GTR
                  </span>
                </button>
                {PH.venues
                  .filter((v) => v.name.toLowerCase().includes(pickQ.trim().toLowerCase()))
                  .map((v) => {
                    const hasFeed = afishaVids.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        onClick={() => {
                          setScope(v.id);
                          setRoom("all");
                          setPickOpen(false);
                        }}
                        title={hasFeed ? "Афиши подключены" : undefined}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          width: "100%",
                          padding: "9px 13px",
                          background: scope === v.id ? "rgba(255,255,255,.06)" : "transparent",
                          border: "none",
                          borderBottom: "1px solid rgba(255,255,255,.04)",
                          color: "rgba(255,255,255,.85)",
                          cursor: "pointer",
                          font: "500 11.5px/1.25 'Golos Text',sans-serif",
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            flex: "none",
                            background: hasFeed ? "#2ECC71" : "rgba(255,255,255,.18)",
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>{v.name}</span>
                        {hasFeed ? (
                          <span
                            className="gtr-mono"
                            style={{
                              font: "600 8.5px/1 'JetBrains Mono',monospace",
                              color: "#2ECC71",
                            }}
                          >
                            {t("АФИШИ")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            ) : null}
          </div>
        ) : (
          <h1 className="gtr-oswald gtr-h1">
            {t("Календарь и программа")}
          </h1>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button className="gtr-btn" onClick={prevMonth}>
            ‹
          </button>
          <span
            className="gtr-mono"
            style={{
              font: "600 13px/1 'JetBrains Mono',monospace",
              minWidth: 130,
              textAlign: "center",
            }}
          >
            {t(MONTHS[month])} {year}
          </span>
          <button className="gtr-btn" onClick={nextMonth}>
            ›
          </button>
        </div>
        {vid ? (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginLeft: "auto" }}>
          {[["all", t("Все залы"), "#fff"] as [string, string, string], ...rooms].map(
            ([k, label, color]) => (
              <button
                key={k}
                onClick={() => setRoom(k)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  borderRadius: 0,
                  padding: "7px 11px",
                  cursor: "pointer",
                  font: `${room === k ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
                  border: `1px solid ${room === k ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                  background: room === k ? "rgba(229,35,27,.14)" : "transparent",
                  color: room === k ? "#fff" : "rgba(255,255,255,.6)",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 0, background: color }} />
                {label}
              </button>
            ),
          )}
        </div>
        ) : (
          // Легенда слоёв в режиме «наши события»
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: "auto" }}>
            {[["#E5231B", t("События команды GTR")]].map(([c, label]) => (
              <span
                key={label}
                className="gtr-mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  font: "600 9.5px/1 'JetBrains Mono',monospace",
                  color: "rgba(255,255,255,.55)",
                }}
              >
                <span style={{ width: 7, height: 7, background: c as string }} />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1fr minmax(280px,330px)", gap: 18 }}
      >
        <div>
          <Card className="gtr-cal-scroll" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,1fr)",
                borderBottom: "1px solid rgba(255,255,255,.07)",
              }}
            >
              {WD.map((w) => (
                <div key={w} className="gtr-eyebrow" style={{ padding: "10px 9px" }}>
                  {t(w)}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
              {Array.from({ length: offset }).map((_, i) => (
                <div
                  key={`o${i}`}
                  style={{
                    minHeight: 104,
                    borderRight: "1px solid rgba(255,255,255,.05)",
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                    background: "rgba(255,255,255,.012)",
                  }}
                />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const n = i + 1;
                const items = allEvents.filter((e) => e.day === n);
                // Три слоя одного дня: наши (красные), программа площадки
                // (по статусу), афиши с сайтов (зелёные)
                const cellChips = [
                  ...oursMonth
                    .filter((e) => e.d === n)
                    .map((e) => ({
                      key: `ours-${e.id}`,
                      title: e.title,
                      dot: "#E5231B",
                      bg: "rgba(229,35,27,.2)",
                      dragId: null as string | null,
                    })),
                  ...items.map((e) => ({
                    key: e.id,
                    title: e.title,
                    dot: roomColor(e.room),
                    bg: statusBg(e),
                    dragId: e.id as string | null,
                  })),
                  ...afishaMonth
                    .filter((e) => e.d === n)
                    .map((e) => ({
                      key: `af-${e.id}`,
                      title: e.title,
                      dot: "#2ECC71",
                      bg: "rgba(46,204,113,.13)",
                      dragId: null as string | null,
                    })),
                ];
                const on = selDay === n;
                return (
                  <div
                    key={n}
                    onClick={() => setSelDay(n)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOnDay(n)}
                    style={{
                      minHeight: 104,
                      padding: 9,
                      borderRight: "1px solid rgba(255,255,255,.05)",
                      borderBottom: "1px solid rgba(255,255,255,.05)",
                      cursor: "pointer",
                      transition: "background .15s",
                      background: on ? "rgba(229,35,27,.1)" : "transparent",
                      boxShadow: on ? "inset 0 0 0 1px rgba(229,35,27,.55)" : "none",
                    }}
                  >
                    <div
                      style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}
                    >
                      <span
                        className="gtr-mono"
                        style={{
                          font: `${n === todayD ? 700 : 600} 12.5px/1 'JetBrains Mono',monospace`,
                          color: n === todayD ? "#E5231B" : on ? "#fff" : "rgba(255,255,255,.6)",
                        }}
                      >
                        {n}
                      </span>
                      {cellChips.length ? (
                        <span
                          className="gtr-mono"
                          style={{
                            font: "600 8.5px/1 'JetBrains Mono',monospace",
                            color: "rgba(255,255,255,.45)",
                            background: "rgba(255,255,255,.08)",
                            borderRadius: 0,
                            padding: "3px 5px",
                          }}
                        >
                          {cellChips.length}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      {cellChips.slice(0, 3).map((c) => (
                        <div
                          key={c.key}
                          draggable={!!c.dragId}
                          onDragStart={c.dragId ? () => setDragId(c.dragId as string) : undefined}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 5px",
                            borderRadius: 0,
                            cursor: c.dragId ? "grab" : "pointer",
                            font: "500 9.5px/1.2 'Golos Text',sans-serif",
                            background: c.bg,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              flex: "none",
                              borderRadius: 0,
                              background: c.dot,
                            }}
                          />
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.title}
                          </span>
                        </div>
                      ))}
                      {cellChips.length > 3 ? (
                        <div
                          className="gtr-mono"
                          style={{
                            font: "500 8.5px/1 'JetBrains Mono',monospace",
                            color: "rgba(255,255,255,.35)",
                          }}
                        >
                          +{cellChips.length - 3} ещё
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card style={{ marginTop: 14, padding: "12px 16px" }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t("ЗАГРУЗКА МЕСЯЦА")}</Eyebrow>
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 34 }}>
              {loadCounts.map((c, i) => (
                <div
                  key={i}
                  title={`${i + 1} ${t(MONTHS[month])}: ${c}`}
                  style={{
                    flex: 1,
                    borderRadius: 0,
                    background: c ? "#E5231B" : "rgba(255,255,255,.1)",
                    height: `${c ? Math.min(100, 30 + c * 35) : 12}%`,
                    transition: "height .3s",
                  }}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* панель дня */}
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card style={{ padding: "16px 18px" }}>
            <Eyebrow>
              {selDay} {t(MONTHS[month]).toUpperCase()} · {t(WD_FULL[dSel.getDay()]).toUpperCase()}
            </Eyebrow>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {oursDay.map((e) => (
                <div
                  key={`ours-${e.id}`}
                  style={{
                    background: "rgba(229,35,27,.1)",
                    border: "1px solid rgba(229,35,27,.45)",
                    borderRadius: 0,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ flex: 1, font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                      {e.title}
                    </span>
                    <Chip color="#E5231B">{t("НАШЕ")}</Chip>
                  </div>
                  <div
                    className="gtr-mono"
                    style={{
                      margin: "7px 0 8px",
                      font: "500 10.5px/1 'JetBrains Mono',monospace",
                      color: "var(--gtr-t2)",
                    }}
                  >
                    {V(e.venueId)?.name ?? "Площадка не выбрана"}
                  </div>
                  <button
                    className="gtr-btn"
                    style={{ padding: "5px 9px", fontSize: 10 }}
                    onClick={() =>
                      navigate({
                        to: "/gtr/$screen",
                        params: { screen: "constructor" },
                        search: { draft: e.id },
                      })
                    }
                  >
                    {t("Открыть в конструкторе ↗")}
                  </button>
                </div>
              ))}
              {dayList.length === 0 && oursDay.length === 0 && afishaDay.length === 0 ? (
                <div
                  style={{ font: "500 11.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}
                >
                  {vid
                    ? t("Свободный день — добавьте формат из палитры ниже.")
                    : t("На этот день наших событий нет — создайте в конструкторе.")}
                </div>
              ) : (
                dayList.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      background: "var(--gtr-card2)",
                      border: "1px solid rgba(255,255,255,.07)",
                      borderRadius: 0,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 0,
                          background: roomColor(e.room),
                          flex: "none",
                        }}
                      />
                      <span style={{ flex: 1, font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                        {e.title}
                      </span>
                      <Chip
                        color={
                          e.status === "confirmed"
                            ? "#2ECC71"
                            : e.status === "hold"
                              ? "#F5A623"
                              : "#E5231B"
                        }
                      >
                        {e.status === "confirmed"
                          ? t("ПОДТВЕРЖДЕНО")
                          : e.status === "hold"
                            ? "HOLD"
                            : t("ЗАЯВКА")}
                      </Chip>
                    </div>
                    <div
                      className="gtr-mono"
                      style={{
                        margin: "7px 0 8px",
                        font: "500 10.5px/1 'JetBrains Mono',monospace",
                        color: "var(--gtr-t2)",
                      }}
                    >
                      {e.start}–{e.end} · {roomName(e.room)}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="gtr-btn"
                        style={{ padding: "5px 9px", fontSize: 10 }}
                        onClick={() => shift(e.id, -30)}
                      >
                        −30 мин
                      </button>
                      <button
                        className="gtr-btn"
                        style={{ padding: "5px 9px", fontSize: 10 }}
                        onClick={() => shift(e.id, 30)}
                      >
                        +30 мин
                      </button>
                      <button
                        className="gtr-btn"
                        style={{
                          padding: "5px 9px",
                          fontSize: 10,
                          marginLeft: "auto",
                          color: "#E5231B",
                          borderColor: "rgba(229,35,27,.4)",
                        }}
                        onClick={() => setEvents((list) => list.filter((x) => x.id !== e.id))}
                      >
                        {t("Удалить")}
                      </button>
                    </div>
                  </div>
                ))
              )}
              {afishaDay.map((e) => (
                <div
                  key={`af-${e.id}`}
                  style={{
                    background: "rgba(46,204,113,.07)",
                    border: "1px solid rgba(46,204,113,.4)",
                    borderRadius: 0,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ flex: 1, font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                      {e.title}
                    </span>
                    <Chip color="#2ECC71">{t("АФИША")}</Chip>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    {e.artistIds.length ? (
                      <button
                        className="gtr-btn"
                        style={{
                          padding: "5px 9px",
                          fontSize: 10,
                          color: "#2ECC71",
                          borderColor: "rgba(46,204,113,.5)",
                        }}
                        onClick={() =>
                          navigate({
                            to: "/gtr/$screen",
                            params: { screen: "artists" },
                            search: { artist: e.artistIds[0] },
                          })
                        }
                      >
                        {t("НАШ АРТИСТ ↗")}
                      </button>
                    ) : null}
                    <a
                      className="gtr-mono"
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        font: "600 10px/1 'JetBrains Mono',monospace",
                        color: "rgba(255,255,255,.55)",
                        textDecoration: "none",
                        marginLeft: "auto",
                      }}
                    >
                      {t("Источник ↗")}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {vid ? (
          <Card style={{ padding: "16px 18px" }}>
            <Eyebrow style={{ marginBottom: 10 }}>{t("ПАЛИТРА ФОРМАТОВ · В ДЕНЬ")} {selDay}</Eyebrow>
            <div style={{ display: "grid", gap: 7 }}>
              {calPaletteOf(vid).map(
                ([title, evRoom, start, end, meta]) => (
                  <button
                    key={title}
                    className="gtr-pal-btn"
                    onClick={() => addEvent(title, evRoom, start, end)}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        flex: "none",
                        borderRadius: 0,
                        background: roomColor(evRoom),
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600 }}>{title}</span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 3,
                          font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                          color: "rgba(255,255,255,.4)",
                        }}
                      >
                        {start}–{end} · {meta}
                      </span>
                    </span>
                  <span style={{ color: "rgba(255,255,255,.4)", fontWeight: 700 }}>+</span>
                  </button>
                ),
              )}
              {lineupArtists.map((a) => (
                <button
                  key={a.id}
                  className="gtr-pal-btn"
                  onClick={() => addEvent(a.name, rooms[0][0], "22:00", "02:00")}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      flex: "none",
                      borderRadius: 0,
                      background: "#7B4DFF",
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600 }}>{a.name}</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                        color: "rgba(255,255,255,.4)",
                      }}
                    >
                      {(a.styles || []).slice(0, 2).join(" · ")} · из лайнапа
                    </span>
                  </span>
                  <span
                    role="link"
                    title="Открыть страницу артиста"
                    style={{ color: "#7B4DFF", fontWeight: 700, padding: "0 4px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate({
                        to: "/gtr/$screen",
                        params: { screen: "artists" },
                        search: { artist: a.id },
                      });
                    }}
                  >
                    ↗
                  </span>
                  <span style={{ color: "rgba(255,255,255,.4)", fontWeight: 700 }}>+</span>
                </button>
              ))}
            </div>
          </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
