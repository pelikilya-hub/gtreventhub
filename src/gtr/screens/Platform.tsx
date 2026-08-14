// Экраны платформы (фаза A): лента событий, ИИ-подбор, комьюнити, визы,
// бронь столов, мои выступления. Все контуры замкнуты: каждая кнопка либо
// делает дело, либо честно ставит в очередь и уведомляет команду.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadArtists, PH, V, type Artist } from "../data/app-data";
import {
  aiMatchFn,
  allAfishaFn,
  bookTableFn,
  contactTeamFn,
  artistFlagsFn,
  musicProfileFn,
  myBookingsFn,
  type MatchArtist,
  type MatchEvent,
  type MatchVenue,
  type TableBooking,
} from "../kv-api";
import { FAMILY_LABEL } from "../match";
import type { MusicProfile } from "../spotify";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

const GREEN = "#2ECC71";
const AMBER = "#F5A623";

type FeedItem = {
  id: string;
  vid: string;
  title: string;
  dateIso: string;
  poster?: string;
  url: string;
  artistIds: string[];
};

const label = (s: string) => (
  <span
    className="gtr-mono"
    style={{
      display: "block",
      margin: "0 0 4px",
      font: "600 8.5px/1 'JetBrains Mono',monospace",
      color: "rgba(255,255,255,.45)",
      letterSpacing: ".1em",
      textTransform: "uppercase",
    }}
  >
    {s}
  </span>
);

// ---------- ЛЕНТА СОБЫТИЙ ----------
export function FeedScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    allAfishaFn()
      .then((r) => setItems(r.items as FeedItem[]))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, FeedItem[]>();
    for (const e of items) {
      const list = m.get(e.dateIso) ?? [];
      list.push(e);
      m.set(e.dateIso, list);
    }
    return [...m.entries()];
  }, [items]);

  const dateLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    const wd = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][d.getDay()];
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} · ${t(wd)}`;
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h1 className="gtr-oswald gtr-h1">{t("События Пхукета")}</h1>
        <span className="gtr-mono" style={{ font: "600 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
          {items.length}
        </span>
      </div>
      {!loaded ? (
        <div className="gtr-mono" style={{ padding: 40, color: "var(--gtr-t3)" }}>{t("Загрузка…")}</div>
      ) : !items.length ? (
        <Card style={{ padding: 24 }}>
          <div style={{ font: "500 12px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {t("Афиши обновляются каждые 6 часов — загляните позже.")}
          </div>
        </Card>
      ) : (
        byDate.map(([iso, list]) => (
          <div key={iso} style={{ marginBottom: 22 }}>
            <Eyebrow style={{ marginBottom: 10 }}>{dateLabel(iso)}</Eyebrow>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
                gap: 12,
              }}
            >
              {list.map((e) => (
                <Card
                  key={`${e.vid}-${e.id}`}
                  hover
                  style={{ padding: 0, overflow: "hidden" }}
                  onClick={() =>
                    navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: e.vid } })
                  }
                >
                  <div style={{ position: "relative", aspectRatio: "4/5", background: "#101116" }}>
                    {e.poster ? (
                      <img
                        src={e.poster}
                        alt=""
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={(ev) => {
                          (ev.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(180deg, transparent 55%, rgba(10,11,13,.94))",
                      }}
                    />
                    {e.artistIds.length ? (
                      <span style={{ position: "absolute", top: 8, left: 8 }}>
                        <Chip color={GREEN}>{t("НАШ АРТИСТ")}</Chip>
                      </span>
                    ) : null}
                    <div style={{ position: "absolute", left: 10, right: 10, bottom: 10 }}>
                      <div style={{ font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>{e.title}</div>
                      <div
                        className="gtr-mono"
                        style={{ marginTop: 4, font: "500 9px/1.3 'JetBrains Mono',monospace", color: "rgba(255,255,255,.6)" }}
                      >
                        {V(e.vid)?.name ?? e.vid}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------- ИИ ПОДБОР ----------
export function AiMatchScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const [vid, setVid] = useState("VEN-0002");
  const [res, setRes] = useState<{
    mode: "none" | "listener" | "team";
    profileReady: boolean;
    venues: MatchVenue[];
    events: MatchEvent[];
    artists: MatchArtist[];
  } | null>(null);
  const [profile, setProfile] = useState<MusicProfile | null>(null);
  const [state, setState] = useState("");
  const notReady =
    typeof window !== "undefined" && window.location.search.includes("spotify=notready");
  const spotifyOk =
    typeof window !== "undefined" && window.location.search.includes("spotify=ok");

  useEffect(() => {
    aiMatchFn({ data: { vid } }).then(setRes).catch(() => {});
  }, [vid]);
  useEffect(() => {
    musicProfileFn().then((r) => setProfile(r.profile)).catch(() => {});
  }, []);

  const join = async () => {
    setState("…");
    try {
      const r = await contactTeamFn({
        data: { text: `[ИИ-подбор · лист ожидания Spotify] ${user.email} · роль ${user.role}` },
      });
      setState(r.ok ? t("Вы в списке раннего доступа") : (r.reason ?? "…"));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };

  const scoreChip = (score: number) => (
    <span
      className="gtr-mono"
      style={{ font: "700 11px/1 'JetBrains Mono',monospace", color: GREEN }}
    >
      {Math.min(99, Math.max(5, Math.round(score * 100)))}%
    </span>
  );

  // -------- команда: подбор артистов под площадку --------
  if (res?.mode === "team") {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <h1 className="gtr-oswald gtr-h1">{t("ИИ подбор артистов")}</h1>
          <select
            className="gtr-input"
            style={{ width: "auto", marginLeft: "auto" }}
            value={vid}
            onChange={(e) => setVid(e.target.value)}
          >
            {[...PH.venues].sort((a, b) => a.name.localeCompare(b.name)).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="gtr-mono" style={{ font: "500 10px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginBottom: 12 }}>
          {t("Вектор площадки: музыка, концепция и корпус её афиш. Верифицированные артисты и артисты с медиа — выше.")}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {(res.artists ?? []).map((a, i) => (
            <Card
              key={a.id}
              hover
              style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}
              onClick={() =>
                navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: a.id } })
              }
            >
              <span className="gtr-mono" style={{ font: "700 13px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)", width: 24 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ font: "600 13px/1.3 'Golos Text',sans-serif" }}>{a.name}</span>
                <span style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                  {a.reasons.map((r) => (
                    <Chip key={r} color="rgba(255,255,255,.5)">{FAMILY_LABEL[r] ?? r}</Chip>
                  ))}
                  {a.verified ? <Chip color={GREEN}>✓ GTR</Chip> : null}
                </span>
              </span>
              {scoreChip(a.score)}
            </Card>
          ))}
          {!res.artists?.length ? (
            <Card style={{ padding: 20 }}>
              <div style={{ font: "500 11.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                {t("Для этой площадки пока мало жанровых данных — заполните «музыку» в паспорте или дождитесь афиш.")}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    );
  }

  // -------- слушатель --------
  const maxW = profile?.genres?.[0]?.[1] ?? 1;
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 14 }}>{t("ИИ подбор")}</h1>

      {!profile ? (
        <Card style={{ padding: "24px 26px", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["#E5231B", "#F5A623", "#2ECC71", "#7B4DFF", "#3AA0FF"].map((c) => (
              <span key={c} style={{ width: 22, height: 6, background: c }} />
            ))}
          </div>
          <div style={{ font: "700 16px/1.35 Oswald,sans-serif", textTransform: "uppercase" }}>
            {t("Подбор событий под ваш музыкальный вкус")}
          </div>
          <div style={{ font: "500 12px/1.65 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {t("Подключите музыкальный профиль — движок сопоставит ваши жанры и любимых артистов с афишами 104 заведений и предложит, куда идти сегодня.")}
          </div>
          {notReady ? (
            <Chip color={AMBER}>{t("Ключи Spotify подключаются — попробуйте позже или встаньте в список")}</Chip>
          ) : null}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <a className="gtr-btn gtr-btn-red" style={{ textDecoration: "none" }} href="/api/spotify-login">
              {t("Подключить Spotify")} →
            </a>
            <button className="gtr-btn" onClick={() => void join()} disabled={Boolean(state)}>
              {t("Хочу первым доступ")}
            </button>
            {state ? (
              <span className="gtr-mono" style={{ font: "500 10px/1.3 'JetBrains Mono',monospace", color: GREEN }}>
                {state}
              </span>
            ) : null}
          </div>
        </Card>
      ) : (
        <>
          {spotifyOk ? (
            <div style={{ marginBottom: 10 }}>
              <Chip color={GREEN}>{t("Spotify подключён — профиль обновлён")}</Chip>
            </div>
          ) : null}
          <Card style={{ padding: "20px 24px", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Eyebrow>{t("ВАШ МУЗЫКАЛЬНЫЙ ПРОФИЛЬ")}</Eyebrow>
              {profile.displayName ? (
                <span className="gtr-mono" style={{ font: "600 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
                  Spotify · {profile.displayName}
                </span>
              ) : null}
              <a
                className="gtr-btn"
                style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 10, textDecoration: "none" }}
                href="/api/spotify-login"
              >
                {t("Обновить")}
              </a>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {profile.genres.slice(0, 7).map(([fam, w]) => (
                <div key={fam} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 110, flex: "none", font: "600 10.5px/1 'Golos Text',sans-serif" }}>
                    {FAMILY_LABEL[fam] ?? fam}
                  </span>
                  <span style={{ flex: 1, height: 8, background: "rgba(255,255,255,.07)" }}>
                    <span
                      style={{
                        display: "block",
                        width: `${Math.round((w / maxW) * 100)}%`,
                        height: "100%",
                        background: "linear-gradient(90deg,#E5231B,#F5A623)",
                        transition: "width .8s cubic-bezier(.2,.8,.2,1)",
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
            {profile.topArtists.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {profile.topArtists.slice(0, 10).map((a) => (
                  <span
                    key={a.name}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(255,255,255,.12)", padding: "4px 9px 4px 4px" }}
                  >
                    {a.image ? (
                      <img src={a.image} alt="" style={{ width: 22, height: 22, objectFit: "cover" }} />
                    ) : null}
                    <span style={{ font: "500 10.5px/1 'Golos Text',sans-serif" }}>{a.name}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </Card>

          <Eyebrow style={{ marginBottom: 8 }}>{t("ЗАВЕДЕНИЯ ПОД ВАШ ВКУС")}</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, marginBottom: 18 }}>
            {(res?.venues ?? []).map((m) => {
              const v = V(m.vid);
              return (
                <Card
                  key={m.vid}
                  hover
                  style={{ padding: "14px 16px" }}
                  onClick={() =>
                    navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: m.vid } })
                  }
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ flex: 1, font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>{v?.name ?? m.vid}</span>
                    {scoreChip(m.score)}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                    {m.reasons.map((r) => (
                      <Chip key={r} color="rgba(255,255,255,.5)">{FAMILY_LABEL[r] ?? r}</Chip>
                    ))}
                  </div>
                </Card>
              );
            })}
            {!res?.venues?.length ? (
              <Card style={{ padding: 16 }}>
                <div style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
                  {t("Считаем совпадения…")}
                </div>
              </Card>
            ) : null}
          </div>

          {res?.events?.length ? (
            <>
              <Eyebrow style={{ marginBottom: 8 }}>{t("СОБЫТИЯ ПОД ВАШ ВКУС")}</Eyebrow>
              <div style={{ display: "grid", gap: 8 }}>
                {res.events.map((e) => (
                  <Card
                    key={`${e.vid}-${e.id}`}
                    hover
                    style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}
                    onClick={() =>
                      navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: e.vid } })
                    }
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>{e.title}</span>
                      <span className="gtr-mono" style={{ display: "block", marginTop: 4, font: "500 9.5px/1.3 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                        {V(e.vid)?.name ?? e.vid} · {e.dateIso}
                      </span>
                    </span>
                    {scoreChip(e.score)}
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------- КОМЬЮНИТИ ----------
export function CommunityScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [state, setState] = useState("");
  const apply = async () => {
    setState("…");
    try {
      const r = await contactTeamFn({
        data: { text: `[Комьюнити · заявка на вступление] ${user.name} · ${user.email} · роль ${user.role}` },
      });
      setState(r.ok ? t("Заявка у команды — ответ придёт в Telegram") : (r.reason ?? "…"));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 14 }}>
        {t("Комьюнити")}
        {user.role === "visitor" ? " · PRO" : ""}
      </h1>
      <Card style={{ padding: "24px 26px", display: "grid", gap: 12 }}>
        <div style={{ font: "700 16px/1.35 Oswald,sans-serif", textTransform: "uppercase" }}>
          {user.role === "artist" ? t("Локальная сцена Пхукета") : t("Закрытые афтерпати и своя тусовка")}
        </div>
        <div style={{ font: "500 12px/1.65 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {user.role === "artist"
            ? t("Чат артистов и диджеев острова: замены, б2б-сеты, шеринг аппаратуры, прямые контакты площадок. Вход по заявке — состав курирует команда GTR.")
            : t("Закрытый круг: афтерпати, секретные лайнапы, гостевые списки от резидентов. Доступ — по заявке, для PRO-пользователей.")}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="gtr-btn gtr-btn-red" onClick={() => void apply()} disabled={Boolean(state)}>
            {t("Подать заявку")}
          </button>
          {state ? (
            <span className="gtr-mono" style={{ font: "500 10px/1.3 'JetBrains Mono',monospace", color: GREEN }}>
              {state}
            </span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

// ---------- ВИЗЫ ----------
export function VisasScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [flags, setFlags] = useState<{ verified?: boolean; workPermit?: boolean }>({});
  const [state, setState] = useState("");
  useEffect(() => {
    if (!user.artistId) return;
    artistFlagsFn().then((r) => setFlags(r.flags[user.artistId!] ?? {})).catch(() => {});
  }, [user.artistId]);
  const ask = async () => {
    setState("…");
    try {
      const r = await contactTeamFn({
        data: { text: `[Визы · запрос помощи] ${user.name} · ${user.email} — нужна консультация по визе/work permit` },
      });
      setState(r.ok ? t("Запрос у команды — ответ придёт в Telegram") : (r.reason ?? "…"));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };
  const STEPS: [string, string][] = [
    [t("Виза Non-Immigrant B"), t("Оформляется до въезда в консульстве Таиланда; нужны приглашение от юрлица и контракт.")],
    [t("Work Permit"), t("Разрешение на работу — после въезда, через Департамент занятости Пхукета; без него выступать за гонорар нельзя.")],
    [t("Разовые выступления"), t("Для коротких гастролей возможен разовый пермит через организатора — этим занимается команда GTR.")],
    [t("Документы"), t("Паспорт (6+ мес), фото, контракт с площадкой/GTR, подтверждение квалификации (пресс-кит, ссылки на сеты).")],
  ];
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 14 }}>{t("Визы и work permit")}</h1>
      {user.artistId ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Chip color={flags.verified ? GREEN : "rgba(255,255,255,.4)"}>
            {flags.verified ? `✓ ${t("ВЕРИФИЦИРОВАН GTR")}` : t("ВЕРИФИКАЦИЯ — В ПРОЦЕССЕ")}
          </Chip>
          <Chip color={flags.workPermit ? GREEN : AMBER}>
            {flags.workPermit ? `✓ WORK PERMIT` : t("WORK PERMIT — НЕТ")}
          </Chip>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 10 }}>
        {STEPS.map(([h, d], i) => (
          <Card key={h} style={{ padding: "14px 18px", display: "flex", gap: 12 }}>
            <span
              className="gtr-mono"
              style={{ font: "700 14px/1 'JetBrains Mono',monospace", color: "#E5231B", flex: "none" }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>{h}</span>
              <span style={{ display: "block", marginTop: 4, font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                {d}
              </span>
            </span>
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <button className="gtr-btn gtr-btn-red" onClick={() => void ask()} disabled={Boolean(state)}>
          {t("Запросить помощь команды")}
        </button>
        {state ? (
          <span className="gtr-mono" style={{ font: "500 10px/1.3 'JetBrains Mono',monospace", color: GREEN }}>
            {state}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------- ПРОМО И БРОНЬ ----------
export function PromoScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [vid, setVid] = useState("VEN-0002");
  const [dateIso, setDateIso] = useState("");
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState("");
  const [bookings, setBookings] = useState<TableBooking[]>([]);
  const loadBookings = () => myBookingsFn().then((r) => setBookings(r.bookings)).catch(() => {});
  useEffect(() => {
    void loadBookings();
  }, []);
  const submit = async () => {
    setState("…");
    try {
      const r = await bookTableFn({ data: { vid, dateIso, guests, name, phone, note } });
      if (r.ok) {
        setState(t("Заявка отправлена — подтверждение придёт от команды"));
        setNote("");
        await loadBookings();
      } else setState(r.reason ?? "…");
    } catch {
      setState(t("Сервер недоступен"));
    }
    setTimeout(() => setState(""), 5000);
  };
  const ST: Record<TableBooking["status"], [string, string]> = {
    new: [t("НА РАССМОТРЕНИИ"), AMBER],
    confirmed: [t("ПОДТВЕРЖДЕНА"), GREEN],
    declined: [t("ОТКЛОНЕНА"), "#E5231B"],
  };
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 6 }}>{t("Промо и бронь столов")}</h1>
      <div className="gtr-mono" style={{ font: "500 10px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)", marginBottom: 14 }}>
        {t("Билеты и промоакции площадок — следующая фаза; бронь работает уже сейчас.")}
      </div>
      <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <Eyebrow>{t("НОВАЯ БРОНЬ")}</Eyebrow>
          <div>
            {label(t("Заведение"))}
            <select className="gtr-input" value={vid} onChange={(e) => setVid(e.target.value)}>
              {[...PH.venues]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
            </select>
          </div>
          <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              {label(t("Дата"))}
              <input className="gtr-input" type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} />
            </div>
            <div>
              {label(t("Гостей"))}
              <input
                className="gtr-input"
                type="number"
                min={1}
                max={100}
                value={guests}
                onChange={(e) => setGuests(parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>
          <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              {label(t("Имя"))}
              <input className="gtr-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              {label(t("Телефон / WhatsApp"))}
              <input className="gtr-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            {label(t("Пожелания"))}
            <input className="gtr-input" placeholder={t("У сцены, день рождения…")} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="gtr-btn gtr-btn-red"
              onClick={() => void submit()}
              disabled={!dateIso || !name.trim() || !phone.trim() || state === "…"}
            >
              {t("Отправить заявку")}
            </button>
            {state ? (
              <span className="gtr-mono" style={{ font: "500 9.5px/1.4 'JetBrains Mono',monospace", color: GREEN }}>
                {state}
              </span>
            ) : null}
          </div>
        </Card>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 8, alignContent: "start" }}>
          <Eyebrow>{t("МОИ БРОНИ")} · {bookings.length}</Eyebrow>
          {!bookings.length ? (
            <div style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Пока пусто — первая бронь появится здесь со статусом.")}
            </div>
          ) : (
            bookings.map((b) => (
              <div
                key={b.id}
                style={{ border: "1px solid rgba(255,255,255,.08)", padding: "9px 11px", display: "grid", gap: 4 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1, font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>
                    {V(b.vid)?.name ?? b.vid}
                  </span>
                  <Chip color={ST[b.status][1]}>{ST[b.status][0]}</Chip>
                </div>
                <span className="gtr-mono" style={{ font: "500 9.5px/1.3 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                  {b.dateIso} · {b.guests} {t("чел.")} · {b.id}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- МОИ ВЫСТУПЛЕНИЯ ----------
export function MyShowsScreen() {
  const { t } = useTranslation();
  const { user, shared } = useGtr();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  useEffect(() => {
    allAfishaFn().then((r) => setFeed(r.items as FeedItem[])).catch(() => {});
    loadArtists().then((b) => setArtists(b.artists));
  }, []);
  const accepted = shared.offers.filter((o) => o.to === user.email && o.status === "accepted");
  const spotted = user.artistId ? feed.filter((e) => e.artistIds.includes(user.artistId!)) : [];
  const me = artists.find((a) => a.id === user.artistId);
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 14 }}>{t("Мои выступления")}</h1>
      <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 8, alignContent: "start" }}>
          <Eyebrow>{t("ПОДТВЕРЖДЁННЫЕ ЧЕРЕЗ GTR")} · {accepted.length}</Eyebrow>
          {!accepted.length ? (
            <div style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Когда вы примете предложение площадки, оно появится здесь.")}
            </div>
          ) : (
            accepted.map((o) => (
              <div key={o.id} style={{ border: "1px solid rgba(46,204,113,.35)", padding: "10px 12px" }}>
                <div style={{ font: "600 12px/1.3 'Golos Text',sans-serif" }}>{o.venueName}</div>
                <div className="gtr-mono" style={{ marginTop: 4, font: "500 9.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                  {o.date}{o.fee ? ` · ${o.fee}` : ""}
                </div>
              </div>
            ))
          )}
        </Card>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 8, alignContent: "start" }}>
          <Eyebrow>{t("ЗАМЕЧЕНЫ В АФИШАХ")} · {spotted.length}</Eyebrow>
          {!spotted.length ? (
            <div style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {me
                ? t("Агент афиш сканирует сайты площадок каждые 6 часов — как только ваше имя появится в анонсе, оно отобразится тут.")
                : t("Профиль не привязан к каталогу артистов — напишите команде.")}
            </div>
          ) : (
            spotted.map((e) => (
              <div key={`${e.vid}-${e.id}`} style={{ border: "1px solid rgba(255,255,255,.08)", padding: "10px 12px" }}>
                <div style={{ font: "600 12px/1.3 'Golos Text',sans-serif" }}>{e.title}</div>
                <div className="gtr-mono" style={{ marginTop: 4, font: "500 9.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                  {V(e.vid)?.name ?? e.vid} · {e.dateIso}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
