import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  AMBER,
  computeQuote,
  draftTitle,
  fmtThb,
  GREEN,
  loadArtists,
  PH,
  RED,
  richOf,
  SPACES,
  STAGE_COLOR,
  STAGE_LABEL,
  V,
  type EventStage,
  type ScreenId,
} from "../data/app-data";
import { useGtr } from "../store";
import { FAMILY_LABEL } from "../match";
import { useTranslation } from "react-i18next";
import { ArtistStudio } from "./ArtistStudio";
import "../i18n";
import { Card, Chip, Eyebrow, Stk, TrashTitle, type StkName } from "../ui";
import {
  allAfishaFn,
  communityCfgFn,
  createInviteFn,
  decideOfferFn,
  getPrefsFn,
  musicProfileFn,
  setLiveFn,
  setPrefsFn,
  tgLinkFn,
  tgStatusFn,
} from "../kv-api";
import { BossCabinet, PushPanel, TgChip } from "./Boss";
import { openAppLink } from "../applink";
import { posterUrl } from "../poster";
import { genreLabel, OFFER_COLOR, OFFER_LABEL, readinessLabel } from "../data/app-data";
import { pickHeadliner, islandDigest, loudness } from "../guest-digest";
import appUpdates from "../data/app-updates.json";

// Кабинет площадки — медийная сцена, а не панель приборов: снимок места,
// одна строка крупных цифр, три действия и список залов. Пояснения под
// цифрами, второй чек-лист, лазеры поверх шапки и служебные строки
// («проверено», «фото: web», источники базы) из кабинета ушли — их
// место в паспорте площадки, а не на первом экране.
type Action = { title: string; cta: string; go: ScreenId; vid?: string };
type Kpi = [label: string, value: string | number, suffix: string, color: string];
type MainRow = {
  title: string;
  desc: string;
  value: string;
  status: string;
  color: string;
  vid?: string;
};

type DashData = {
  kicker: string;
  name: string;
  type: string;
  area: string;
  state: string;
  stateColor: string;
  heroImg: string;
  kpis: Kpi[];
  actions: Action[];
  mainTitle: string;
  mainCta: string;
  mainGo: ScreenId;
  mainRows: MainRow[];
};

export function DashScreen() {
  const { t } = useTranslation();
  const { user, shared } = useGtr();
  const navigate = useNavigate();
  const go = (s: ScreenId, vid?: string) =>
    navigate({ to: "/gtr/$screen", params: { screen: s }, search: vid ? { vid } : undefined });

  const vid = user.venueId;
  const v = V(vid);
  const R = v.readiness;
  const sp = SPACES(vid);
  const rich = richOf(vid);

  // Кабинет Event-продаж — отдельный экран: профиль менеджера, свои события,
  // воронка и пайплайн. Живые цифры вместо макетных.
  if (user.role === "sales" || user.role === "organizer") return <SalesCabinet />;
  // Кабинет артиста: предложения, подтверждённые выступления, Telegram
  if (user.role === "artist") return <ArtistCabinet />;
  // Посетитель: витрина, музыкальный профиль (фаза B), настройки
  if (user.role === "visitor") return <VisitorCabinet />;
  // BOSS: дашборд контроля всей операции
  if (user.boss) return <BossCabinet />;

  let d: DashData;
  if (user.role === "gtr") {
    const quar = PH.venues.filter(
      (x) => x.confidence === "Low" || /verify|Closed/i.test(x.status || ""),
    );
    const high = PH.venues.filter((x) => x.confidence === "High").length;
    const pct = Math.round((high / Math.max(1, PH.venues.length)) * 100);
    d = {
      kicker: t("СЕТЬ GTR · ПХУКЕТ"),
      name: t("Сеть площадок Пхукета"),
      type: t("97 объектов · 30 залов"),
      area: t("Патонг · Банг Тао · Камала · Карон · Май Кхао · Старый город"),
      state: t("ОПЕРАЦИОННАЯ БАЗА v3"),
      stateColor: GREEN,
      heroImg: "/venues/VEN-0002-hero.jpg",
      kpis: [
        [t("ПЛОЩАДОК В БАЗЕ"), PH.meta.total, "", "#fff"],
        [t("НОРМАЛИЗОВАННЫХ ЗАЛОВ"), PH.meta.spaces, "", "#fff"],
        [t("ПОКРЫТИЕ БАЗЫ"), pct, "%", GREEN],
        [t("КАРАНТИН"), quar.length, "", RED],
      ],
      actions: [
        { title: t("Illuzion Group — коммерческое партнёрство"), cta: t("Открыть карточку"), go: "venueCard", vid: "VEN-0013" },
        { title: t("Отельные площадки — импорт всех залов"), cta: t("Залы и прайс"), go: "spaces" },
        { title: t("Марины — выездные обследования"), cta: t("Площадки Таиланд"), go: "base" },
      ],
      mainTitle: t("Готовность площадок"),
      mainCta: t("Весь реестр"),
      mainGo: "base",
      mainRows: PH.venues
        .filter((x) => x.readiness)
        .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0))
        .slice(0, 5)
        .map((x) => ({
          title: x.name,
          desc: x.area,
          value: String(x.readiness?.score ?? "—"),
          status: t(readinessLabel(x.readiness?.state)).toUpperCase(),
          color:
            x.readiness?.state === "Bookable"
              ? GREEN
              : (x.readiness?.score ?? 0) >= 55
                ? AMBER
                : "rgba(255,255,255,.45)",
          vid: x.id,
        })),
    };
  } else if (user.role === "owner") {
    d = {
      kicker: t("КАБИНЕТ ВЛАДЕЛЬЦА"),
      name: v.name,
      type: v.type,
      area: `${v.area} · ${v.district}`,
      state: t("БРОНИРУЕМАЯ"),
      stateColor: GREEN,
      heroImg: rich.hero || `/venues/${vid}-hero.jpg`,
      kpis: [
        [t("EVENT-ПРОСТРАНСТВ"), sp.length || 3, "", "#fff"],
        [t("ЗАНЯТО В АВГУСТЕ"), shared.events.filter((e) => e.venueId === vid).length, "/31", "#fff"],
        [t("ОТКРЫТЫХ ЗАЯВОК"), "3", "", AMBER],
        [t("ГОТОВНОСТЬ"), R?.score ?? 85, "/100", GREEN],
      ],
      actions: [
        { title: t("Ответить на 3 заявки"), cta: t("Заявки"), go: "inquiries" },
        { title: t("Подключить живой календарь"), cta: t("Календарь"), go: "calendar" },
        { title: t("Согласовать комиссию и депозит"), cta: t("Финансы"), go: "finance" },
      ],
      mainTitle: t("Event-пространства"),
      mainCta: t("Прайс и сетапы"),
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: x.type || "",
        value: (x.currency as string) || t("THB / час"),
        status: String(x.bookable || "").toUpperCase(),
        color: GREEN,
      })),
    };
  } else {
    const vEvCount = shared.events.filter((e) => e.venueId === vid).length;
    d = {
      kicker: t("КАБИНЕТ PR-ДИРЕКТОРА"),
      name: v.name,
      type: v.type,
      area: v.area,
      state: t("БРОНЬ ПО ЗАПРОСУ"),
      stateColor: AMBER,
      heroImg: rich.hero || `/venues/${vid}-hero.jpg`,
      kpis: [
        [t("ЗАЛОВ В БАЗЕ"), sp.length || "—", "", "#fff"],
        [t("СОБЫТИЙ В КАЛЕНДАРЕ"), vEvCount || "—", "", "#fff"],
        [t("ЗАЯВОК ОТ ОРГАНИЗАТОРОВ"), "5", "", AMBER],
        [t("ГОТОВНОСТЬ"), R?.score ?? 58, "/100", AMBER],
      ],
      actions: [
        { title: t("Собрать программу в конструкторе"), cta: t("Конструктор"), go: "constructor" },
        { title: t("Прислать вместимость залов и нетто-ставки"), cta: t("Залы и прайс"), go: "spaces" },
        { title: t("Загрузить презентацию приватной аренды и комиссию"), cta: t("Финансы"), go: "finance" },
      ],
      mainTitle: t("Залы и техника площадки"),
      mainCta: t("Открыть залы"),
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [x.sqm && `${x.sqm} ${t("м²")}`, x.capCocktail && `${x.capCocktail} ${t("коктейль")}`]
          .filter(Boolean)
          .join(" · "),
        value: x.sqm ? `${x.sqm} ${t("м²")}` : "—",
        status: String(x.bookable || "").toUpperCase(),
        color: AMBER,
      })),
    };
  }

  return (
    <div className="gtr-dash">
      {/* ---------- сцена: снимок места от края до края ---------- */}
      <section className="gtr-dash-hero">
        <img src={d.heroImg} alt="" className="gtr-dash-hero-img" />
        <div className="gtr-dash-hero-in">
          <Eyebrow>{d.kicker}</Eyebrow>
          <h1 className="gtr-dash-name">{d.name}</h1>
          <div className="gtr-dash-sub">
            <Chip color={d.stateColor}>{d.state}</Chip>
            <span>
              {d.type} · {d.area}
            </span>
          </div>
        </div>
      </section>

      {/* ---------- одна строка крупных цифр ---------- */}
      <div className="gtr-stats">
        {d.kpis.map(([label, value, suffix, color]) => (
          <div key={label} className="gtr-stat">
            <b style={{ color }}>
              {value}
              {suffix ? <small>{suffix}</small> : null}
            </b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* ---------- три действия ---------- */}
      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("Приоритетные действия")}</h2>
        {d.actions.map((a, i) => (
          <div key={a.title} className="gtr-dash-row">
            <span className="gtr-dash-row-t">{a.title}</span>
            <button
              className={`gtr-btn${i === 0 ? " gtr-btn-red" : ""}`}
              onClick={() => go(a.go, a.vid)}
            >
              {a.cta}
            </button>
          </div>
        ))}
      </section>

      {/* ---------- залы / площадки ---------- */}
      <section className="gtr-dash-sec">
        <div className="gtr-dash-sec-head">
          <h2 className="gtr-dash-h">{d.mainTitle}</h2>
          <button className="gtr-btn gtr-btn-ghost" onClick={() => go(d.mainGo)}>
            {d.mainCta}
          </button>
        </div>
        {d.mainRows.length ? (
          d.mainRows.map((r) => (
            <button
              key={r.title}
              type="button"
              className="gtr-dash-row gtr-dash-link"
              onClick={r.vid ? () => go("venueCard", r.vid) : () => go(d.mainGo)}
            >
              <span className="gtr-dash-row-t">
                {r.title}
                {r.desc ? <small>{r.desc}</small> : null}
              </span>
              {/* статус — короткая метка; адреса и длинные пометки из базы
                  («ILLUZIONPHUKET.COM/VIP-…») на первом экране не показываем */}
              {r.status && r.status.length <= 24 && !/[./]/.test(r.status) ? (
                <Chip color={r.color}>{t(r.status)}</Chip>
              ) : null}
              <span className="gtr-dash-row-v">{r.value}</span>
            </button>
          ))
        ) : (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Залы ещё не заведены")}</span>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Кабинет Event-продаж ----------
// Личный кабинет менеджера: профиль, только свои события, воронка по
// стадиям и пайплайн по месяцам. Все цифры считаются из событий кабинета.
const MONTHS_S = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function SalesCabinet() {
  const { t } = useTranslation();
  const { user, myDrafts, shared } = useGtr();
  // Организатор — платящий клиент, а не сотрудник GTR: ему не показываем
  // внутреннюю выручку (комиссию GTR) и приглашение в команду.
  const isTeam = ["gtr", "sales", "owner", "pr"].includes(user.role);
  const navigate = useNavigate();
  const go = (s: ScreenId, search?: Record<string, string>) =>
    navigate({ to: "/gtr/$screen", params: { screen: s }, search });
  const v = V(user.venueId);
  // Язык, на котором уходят предложения артистам (Telegram)
  const [prefLang, setPrefLang] = useState<"ru" | "en" | "th">("ru");
  useEffect(() => {
    getPrefsFn().then((r) => setPrefLang(r.prefLang)).catch(() => {});
  }, []);

  const rows = useMemo(
    () =>
      myDrafts.map((d) => ({
        d,
        quote: computeQuote(d.graph, d.venueId),
        stage: (d.graph.stage ?? "draft") as EventStage,
      })),
    [myDrafts],
  );

  const pipeline = rows.reduce((s, r) => s + r.quote.total, 0);
  const commission = rows.reduce((s, r) => s + r.quote.commission, 0);
  const inWork = rows.filter((r) => r.stage !== "approved").length;
  const approved = rows.filter((r) => r.stage === "approved").length;

  // Пайплайн по месяцам: полгода вперёд от текущего
  const months = useMemo(() => {
    const now = new Date();
    const out: { key: string; label: string; sum: number; count: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      out.push({ key, label: t(MONTHS_S[dt.getMonth()]), sum: 0, count: 0 });
    }
    for (const r of rows) {
      const key = (r.d.dateIso || "").slice(0, 7);
      const b = out.find((x) => x.key === key);
      if (b) {
        b.sum += r.quote.total;
        b.count += 1;
      }
    }
    return out;
  }, [rows]);
  const maxMonth = Math.max(1, ...months.map((m) => m.sum));

  const latest = [...rows].sort((a, b) => b.d.updated - a.d.updated).slice(0, 5);

  // Менеджеру — назначенные на него; организатору — отправленные им
  const myRequests = shared.requests
    .filter((r) =>
      user.role === "organizer"
        ? r.organizerEmail === user.email
        : r.assignee === user.email && r.status !== "declined",
    )
    .slice(0, 4);

  const kpis: [string, string, string][] = [
    [t("В РАБОТЕ"), String(inWork), "#fff"],
    [t("СОГЛАСОВАНО"), String(approved), approved ? GREEN : "#fff"],
    [t("ПАЙПЛАЙН"), pipeline ? fmtThb(pipeline) : "—", "#fff"],
    // Комиссия GTR — внутренняя выручка; клиенту-организатору не показываем
    ...(isTeam
      ? ([[t("КОМИССИЯ GTR"), commission ? fmtThb(commission) : "—", commission ? GREEN : "#fff"]] as [string, string, string][])
      : []),
  ];

  const openDraft = (id: string) =>
    navigate({ to: "/gtr/$screen", params: { screen: "constructor" }, search: { draft: id } });

  // Кабинет продаж и организатора — та же сцена, что у площадки: имя и
  // два главных действия, строка цифр, события и заявки строками, пайплайн.
  // Пульс рынка (он на «Сегодня»), воронка (дублировала цифры), мини-
  // календарь (есть экран календаря) и служебные пояснения ушли; настройки
  // свернуты вниз — к ним возвращаются раз в жизни.
  return (
    <div className="gtr-dash">
      <section className="gtr-dash-head">
        <Eyebrow>{user.role === "organizer" ? t("КАБИНЕТ ОРГАНИЗАТОРА") : t("КАБИНЕТ EVENT SALES")}</Eyebrow>
        <h1 className="gtr-dash-name">{user.name}</h1>
        <div className="gtr-dash-sub">
          <Chip color={AMBER}>{t(user.roleLabel).toUpperCase()}</Chip>
          {v.name ? <span>{v.name}</span> : null}
        </div>
        <div className="gtr-dash-cta">
          <button className="gtr-btn gtr-btn-red" onClick={() => go("events", { vid: user.venueId || "new" })}>
            {t("+ Новое событие")}
          </button>
          <button className="gtr-btn" onClick={() => go("events")}>
            {t("Мои события →")}
          </button>
          {isTeam ? <InviteLinkButton /> : null}
        </div>
      </section>

      <div className="gtr-stats">
        {kpis.map(([label, value, color]) => (
          <div key={label} className="gtr-stat">
            <b className={value.length > 5 ? "long" : undefined} style={{ color }}>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <section className="gtr-dash-sec">
        <div className="gtr-dash-sec-head">
          <h2 className="gtr-dash-h">{t("Мои события")}</h2>
          <button className="gtr-btn gtr-btn-ghost" onClick={() => go("events")}>
            {t("Все →")}
          </button>
        </div>
        {latest.length ? (
          latest.map(({ d, quote, stage }) => (
            <button key={d.id} type="button" className="gtr-dash-row gtr-dash-link" onClick={() => openDraft(d.id)}>
              <span className="gtr-dash-row-t">
                {t(draftTitle(d))}
                <small>
                  {V(d.venueId).name ?? d.venueId}
                  {d.date ? ` · ${d.date}` : ""}
                </small>
              </span>
              <Chip color={STAGE_COLOR[stage]}>{t(STAGE_LABEL[stage]).toUpperCase()}</Chip>
              <span className="gtr-dash-row-v">{quote.total ? fmtThb(quote.total) : "—"}</span>
            </button>
          ))
        ) : (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Событий пока нет")}</span>
          </div>
        )}
      </section>

      <section className="gtr-dash-sec">
        <div className="gtr-dash-sec-head">
          <h2 className="gtr-dash-h">{user.role === "organizer" ? t("Мои заявки площадкам") : t("Заявки на мне")}</h2>
          <button className="gtr-btn gtr-btn-ghost" onClick={() => go("inquiries")}>
            {t("Все заявки →")}
          </button>
        </div>
        {myRequests.length ? (
          myRequests.map((r) => (
            <div key={r.id} className="gtr-dash-row">
              <span className="gtr-dash-row-t">
                {r.title || t("Заявка")}
                <small>
                  {r.venueName} · {r.date || t("дата не указана")}
                  {r.guests ? ` · ${r.guests} ${t("гостей")}` : ""}
                </small>
              </span>
              <Chip color={r.status === "accepted" ? GREEN : AMBER}>
                {r.status === "accepted" ? t("ПРИНЯТА") : t("В РАБОТЕ")}
              </Chip>
              <span className="gtr-dash-row-v">{fmtThb(r.quoteTotal)}</span>
            </div>
          ))
        ) : (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Заявок пока нет")}</span>
          </div>
        )}
      </section>

      {/* столбики только когда у событий есть даты — пустой график не нужен */}
      {months.some((m) => m.sum) ? (
        <section className="gtr-dash-sec">
          <h2 className="gtr-dash-h">{t("Пайплайн по месяцам")}</h2>
          <div className="gtr-dash-bars">
            {months.map((m) => (
              <div key={m.key} className="gtr-dash-bar" title={m.count ? `${m.count} · ${fmtThb(m.sum)}` : undefined}>
                <b>{m.sum ? `฿${Math.round(m.sum / 1000).toLocaleString("ru-RU")}k` : ""}</b>
                <i style={{ height: `${Math.max(3, (m.sum / maxMonth) * 100)}%`, opacity: m.sum ? 1 : 0.25 }} />
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* настройки — свернуты: Telegram, push и язык предложений артистам */}
      <details className="gtr-dash-sec gtr-dash-more">
        <summary className="gtr-dash-h">{t("Настройки")}</summary>
        <div className="gtr-dash-settings">
          <TgChip />
          <PushPanel />
          <label className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Язык предложений")}</span>
            <select
              className="gtr-input"
              style={{ padding: "7px 10px", width: "auto" }}
              value={prefLang}
              onChange={(e) => {
                const v2 = e.target.value as "ru" | "en" | "th";
                setPrefLang(v2);
                setPrefsFn({ data: { prefLang: v2 } }).catch(() => {});
              }}
            >
              <option value="ru">{t("Русский")}</option>
              <option value="en">English</option>
              <option value="th">ไทย</option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

// ---------- Кабинет артиста ----------
// Предложения выступить (принять/отклонить здесь или в Telegram),
// подтверждённые выступления и привязка Telegram.
function ArtistCabinet() {
  const { t } = useTranslation();
  const { user, shared, applyOffer } = useGtr();
  const [tg, setTg] = useState<{ configured: boolean; linked: boolean; bot: string } | null>(null);
  const [tgLink, setTgLink] = useState("");
  const [tgMsg, setTgMsg] = useState("");
  // «Я в эфире»: зелёная кнопка в каталоге, ведёт зрителей на ваш стрим
  const [onAir, setOnAir] = useState(false);
  const [airUrl, setAirUrl] = useState("");

  useEffect(() => {
    tgStatusFn().then(setTg).catch(() => {});
  }, []);

  const toggleAir = async () => {
    const next = !onAir;
    setOnAir(next);
    try {
      await setLiveFn({ data: { on: next, url: airUrl } });
    } catch {
      setOnAir(!next);
    }
  };

  const mine = shared.offers.filter((o) => o.to === user.email);
  const open = mine.filter((o) => o.status === "sent");
  const accepted = mine.filter((o) => o.status === "accepted");

  const decide = async (id: string, accept: boolean) => {
    try {
      const r = await decideOfferFn({ data: { id, accept } });
      if (r.ok) applyOffer(r.offer);
    } catch {
      /* локальный режим */
    }
  };

  const linkTg = async () => {
    setTgMsg("");
    try {
      const r = await tgLinkFn();
      if (r.ok) setTgLink(r.link);
      else setTgMsg(r.error ?? t("Не получилось"));
    } catch {
      setTgMsg(t("Сервер недоступен"));
    }
  };

  const declined = mine.filter((o) => o.status === "declined").length;
  // фото для шапки берём из общей базы артистов; файл грузится отдельно,
  // чтобы не утяжелять бандл кабинета
  const [heroImg, setHeroImg] = useState("");
  useEffect(() => {
    const id = user.artistId;
    if (!id) return;
    let alive = true;
    import("../data/artist-photos.json")
      .then((m) => {
        const rec = (m.default as { photos?: Record<string, { photo?: string; photoMed?: string }> }).photos?.[id];
        if (alive && rec) setHeroImg(rec.photoMed || rec.photo || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user.artistId]);

  // Кабинет артиста: сначала то, ради чего заходят, — предложения и
  // выступления; эфир одной строкой; анкета (о себе, ссылки, медиа, сеты)
  // свёрнута ниже. Пояснения «как работает кнопка эфира» и служебные
  // строки (email, код карточки) из шапки ушли.
  return (
    <div className="gtr-dash">
      <section className={heroImg ? "gtr-dash-hero" : "gtr-dash-head"}>
        {heroImg ? <img src={heroImg} alt="" className="gtr-dash-hero-img" /> : null}
        <div className={heroImg ? "gtr-dash-hero-in" : undefined}>
          <Eyebrow>{t("КАБИНЕТ АРТИСТА")}</Eyebrow>
          <h1 className="gtr-dash-name">{user.name}</h1>
          <div className="gtr-dash-sub">
            {onAir ? (
              <span className="gtr-live-chip">
                <span className="gtr-live-dot" /> {t("В ЭФИРЕ")}
              </span>
            ) : (
              <Chip color="#7B4DFF">{t(user.roleLabel).toUpperCase()}</Chip>
            )}
          </div>
        </div>
      </section>

      <div className="gtr-stats">
        <div className="gtr-stat">
          <b style={{ color: open.length ? AMBER : "#fff" }}>{open.length}</b>
          <span>{t("Предложения")}</span>
        </div>
        <div className="gtr-stat">
          <b style={{ color: accepted.length ? GREEN : "#fff" }}>{accepted.length}</b>
          <span>{t("Мои выступления")}</span>
        </div>
        <div className="gtr-stat">
          <b>{declined}</b>
          <span>{t("Отклонено")}</span>
        </div>
      </div>

      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("Предложения")}</h2>
        {open.length ? (
          open.map((o) => (
            <div key={o.id} className="gtr-dash-row">
              <span className="gtr-dash-row-t">
                {o.venueName}
                {o.date ? ` · ${o.date}` : ""}
                <small>
                  {o.fee ? o.fee : t("условия обсуждаются")} {t("· от")} {o.fromName}
                </small>
              </span>
              <button className="gtr-btn gtr-btn-red" onClick={() => decide(o.id, true)}>
                {t("✓ Принять")}
              </button>
              <button className="gtr-btn gtr-btn-ghost" onClick={() => decide(o.id, false)}>
                {t("Отклонить")}
              </button>
            </div>
          ))
        ) : (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Новых предложений нет")}</span>
          </div>
        )}
      </section>

      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("Мои выступления")}</h2>
        {accepted.length ? (
          accepted.map((o) => (
            <div key={o.id} className="gtr-dash-row">
              <span className="gtr-dash-row-t">
                {o.venueName}
                <small>{o.date || t("дата уточняется")}</small>
              </span>
              {o.fee ? <span className="gtr-dash-row-v">{o.fee}</span> : null}
            </div>
          ))
        ) : (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">{t("Подтверждённых выступлений пока нет.")}</span>
          </div>
        )}
      </section>

      {/* эфир — одна строка: ссылка и кнопка */}
      <section className="gtr-dash-sec">
        <h2 className="gtr-dash-h">{t("Прямой эфир")}</h2>
        <div className="gtr-dash-row">
          <input
            className="gtr-input"
            style={{ flex: "1 1 220px", minWidth: 0 }}
            placeholder={t("Ссылка на эфир (Instagram Live, Twitch…) — можно пустую")}
            value={airUrl}
            onChange={(e) => setAirUrl(e.target.value)}
          />
          <button className={`gtr-btn ${onAir ? "" : "gtr-btn-red"}`} onClick={toggleAir}>
            {onAir ? t("Завершить эфир") : t("Я в эфире")}
          </button>
        </div>
      </section>

      {/* анкета, медиа и Telegram — свёрнуты */}
      <details className="gtr-dash-sec gtr-dash-more">
        <summary className="gtr-dash-h">{t("Профиль и медиа")}</summary>
        {tg?.bot && !tg.linked ? (
          <div className="gtr-dash-row">
            <span className="gtr-dash-row-t">Telegram</span>
            {tgLink ? (
              <a
                className="gtr-btn gtr-btn-red"
                style={{ textDecoration: "none" }}
                href={tgLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openAppLink(tgLink);
                }}
              >
                {t("Открыть @")}{tg.bot} {t("и привязать ↗")}
              </a>
            ) : (
              <button className="gtr-btn" onClick={linkTg}>
                {t("Привязать Telegram")}
              </button>
            )}
            {tgMsg ? <small style={{ color: "#FF5B4D" }}>{tgMsg}</small> : null}
          </div>
        ) : null}
        {user.artistId ? <ArtistStudio artistId={user.artistId} /> : null}
      </details>
    </div>
  );
}

// Ссылка-приглашение в приложение: генерируется сервером, копируется в буфер.
// Организатор зовёт в свою команду, менеджер и админ — в состав GTR.
function InviteLinkButton() {
  const { t } = useTranslation();
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await createInviteFn({ data: {} });
      if (r.ok) {
        const full = `${location.origin}${r.link}`;
        setLink(full);
        try {
          await navigator.clipboard.writeText(full);
          setMsg(t("Ссылка скопирована — отправьте её человеку"));
        } catch {
          setMsg(t("Скопируйте ссылку ниже"));
        }
      } else setMsg(r.ok === false ? (r.error ?? t("Не получилось")) : t("Не получилось"));
    } catch {
      setMsg(t("Сервер недоступен (локальный режим)"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button className="gtr-btn" style={{ padding: "9px 16px", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={make}>
        {t("+ Пригласить в команду")}
      </button>
      {link ? (
        <input
          className="gtr-input"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          style={{ padding: "6px 8px", fontSize: 11, width: 220 }}
        />
      ) : null}
      {msg ? (
        <span style={{ font: "500 11px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)", maxWidth: 220 }}>
          {msg}
        </span>
      ) : null}
    </div>
  );
}

// ---------- кабинет посетителя (фаза A) ----------
function VisitorCabinet() {
  const { t, i18n } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const go = (s: ScreenId) => navigate({ to: "/gtr/$screen", params: { screen: s } });
  const [mp, setMp] = useState<import("../spotify").MusicProfile | null>(null);
  const [feed, setFeed] = useState<{ id: string; vid: string; title: string; dateIso: string; poster?: string; artistIds: string[] }[]>([]);
  // Вся афиша, а не только карусель: хедлайнеры считаются по ней, и
  // косметический дедуп ленты не должен решать, кого показать на сцене.
  const [afisha, setAfisha] = useState<{ id: string; vid: string; title: string; dateIso: string; poster?: string; artistIds: string[] }[]>([]);
  // База артистов с фото и плеерами — сырьё для витрины хедлайнеров.
  const [artIdx, setArtIdx] = useState<{
    artists: { id: string; name: string; styles?: string[]; prio?: string; sp?: unknown }[];
    photos: Record<string, { photo: string }>;
    players: Record<string, { kind: string; ref: string }>;
  } | null>(null);
  const [community, setCommunity] = useState<{ channelUrl: string; chatUrl: string }>({ channelUrl: "", chatUrl: "" });
  useEffect(() => {
    musicProfileFn().then((r) => setMp(r.profile)).catch(() => {});
    communityCfgFn().then((r) => setCommunity({ channelUrl: r.channelUrl, chatUrl: r.chatUrl })).catch(() => {});
    allAfishaFn()
      .then((r) => {
        setAfisha(r.items);
        // лента без повторов: один постер один раз, максимум 2 события
        // с одной площадки — иначе весь ряд забивает одна афиша
        const seenPoster = new Set<string>();
        const perVenue = new Map<string, number>();
        const picked: typeof r.items = [];
        for (const e of r.items) {
          const pk = e.poster || "";
          if (pk && seenPoster.has(pk)) continue;
          if ((perVenue.get(e.vid) ?? 0) >= 2) continue;
          if (pk) seenPoster.add(pk);
          perVenue.set(e.vid, (perVenue.get(e.vid) ?? 0) + 1);
          picked.push(e);
          if (picked.length >= 10) break;
        }
        setFeed(picked);
      })
      .catch(() => {});
    Promise.all([loadArtists(), import("../data/artist-photos.json"), import("../data/artist-players.json")])
      .then(([base, ph, pl]) => {
        setArtIdx({
          artists: base.artists,
          photos: (ph as { default: { photos: Record<string, { photo: string }> } }).default.photos,
          players: (pl as { default: Record<string, { kind: string; ref: string }> }).default,
        });
      })
      .catch(() => {});
  }, []);

  const openEvent = (e: { vid: string; artistIds: string[] }) =>
    e.artistIds.length
      ? navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: e.artistIds[0] } })
      : navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: e.vid } });

  const todayIso = new Date().toISOString().slice(0, 10);
  const tonightCount = feed.filter((e) => e.dateIso === todayIso).length;
  // Геро больше не прибит к одному видео: берём самое шумное событие
  // сегодня и показываем его промо. Если на сегодня афиши нет — откат к
  // дежурному видео вайба.
  const headliner = useMemo(() => pickHeadliner(feed, todayIso), [feed, todayIso]);
  const island = useMemo(() => islandDigest(feed, todayIso), [feed, todayIso]);

  // ---------- хедлайнеры сцены ----------
  // Раньше здесь стоял статичный список приоритетных артистов — из-за него
  // в блоке месяцами висели одни и те же лица. Теперь витрина идёт от
  // афиши: сначала те, кто играет СЕГОДНЯ (громкие события выше), затем
  // ближайшие дни. Общая витрина остаётся только как добор, если афиша
  // пуста, — блок не должен схлопываться в ничто.
  const heads = useMemo(() => {
    if (!artIdx) return [];
    const { artists, photos, players } = artIdx;
    const byId = new Map(artists.map((a) => [a.id, a]));
    // Кнопка у хедлайнера обязана заиграть, а не открыть поиск:
    // прямой профиль всегда выигрывает у поисковой выдачи Spotify.
    const linkOf = (id: string, sp?: string) => {
      const p = players[id];
      const spDirect = sp && /open\.spotify\.com\/artist\//.test(sp) ? sp : undefined;
      if (!p) return spDirect ?? sp;
      if (p.kind === "spotify") return `https://open.spotify.com/artist/${p.ref}`;
      if (p.kind === "sc") return p.ref;
      if (p.kind === "deezer") return spDirect ?? `https://www.deezer.com/artist/${p.ref}`;
      if (p.kind === "mixcloud") return spDirect ?? `https://www.mixcloud.com${p.ref}`;
      return spDirect ?? sp;
    };
    const LIMIT = 6;
    const seen = new Set<string>();
    const out: {
      id: string;
      name: string;
      styles: string[];
      photo?: string;
      music?: string;
      /** где и когда играет — подпись под именем; пусто у витринного добора */
      where?: string;
      tonight?: boolean;
    }[] = [];
    const push = (id: string, ev?: { vid: string; dateIso: string }) => {
      if (seen.has(id) || out.length >= LIMIT) return;
      const a = byId.get(id);
      // Без фото карточка хедлайнера — пустой прямоугольник, такого не ставим
      if (!a || !photos[id]) return;
      seen.add(id);
      out.push({
        id,
        name: a.name,
        styles: (a.styles ?? []).slice(0, 2),
        photo: photos[id]?.photo,
        music: linkOf(id, a.sp as string | undefined),
        where: ev ? (V(ev.vid)?.name ?? "") : undefined,
        tonight: ev?.dateIso === todayIso,
      });
    };

    // 1) сегодня: громкие события первыми
    for (const e of afisha.filter((e) => e.dateIso === todayIso).sort((a, b) => loudness(b) - loudness(a)))
      for (const id of e.artistIds) push(id, e);
    // 2) ближайшие дни по возрастанию даты
    for (const e of afisha
      .filter((e) => e.dateIso > todayIso)
      .sort((a, b) => (a.dateIso < b.dateIso ? -1 : 1)))
      for (const id of e.artistIds) push(id, e);
    // 3) добор витриной, если афиша ещё не собралась
    for (const a of artists) {
      if (out.length >= LIMIT) break;
      if (a.prio === "A" && (a.styles ?? []).length) push(a.id);
    }
    return out;
  }, [artIdx, afisha, todayIso]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {/* ---- HERO: вайб вечера — живое видео площадки.
           Без карточки и рамки: кадр выходит за отступы колонки до граней
           экрана, а по краям свет заваливается, как на изогнутом стекле —
           видео читается уходящим за грань, а не вырезанным в окошке. ---- */}
      <div className="gtr-hero-edge">
        {headliner?.poster ? (
          // Промо самого шумного события сегодня: его постер как задник геро
          <img
            src={posterUrl(headliner.vid, headliner.id)}
            alt=""
            aria-hidden
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.08) contrast(1.03)" }}
            onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <video
            src="https://cwsdn.b-cdn.net/Illuzion/illuzion-intro-2025.mp4"
            poster="/venues/VEN-0013-hero.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.08) contrast(1.05)" }}
          />
        )}
        <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(180deg, rgba(10,11,13,0) 18%, rgba(10,11,13,.45) 58%, rgba(10,11,13,.8) 100%)" }} />
        <div className="gtr-hero-edge-in gtr-hero-tall">
            <div className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "rgba(255,255,255,.75)", letterSpacing: ".16em", marginBottom: 10 }}>
              {headliner
                ? `${t("ГРОМЧЕ ВСЕХ СЕГОДНЯ")} · ${(V(headliner.vid)?.name ?? "PHUKET").toUpperCase()}`
                : `${user.name.toUpperCase()} · PHUKET`}
            </div>
            <TrashTitle text={headliner ? headliner.title.slice(0, 46) : t("Сегодня вечером")} size={headliner ? 34 : 40} />
            <div style={{ margin: "10px 0 16px", font: "500 13px/1.5 'Golos Text',sans-serif", color: "rgba(255,255,255,.82)", maxWidth: 420 }}>
              {headliner
                ? (headliner.artistIds.length
                    ? `${t("Наш артист на сцене")} · ${island.events} ${t("событий на острове сегодня")}`
                    : `${island.events} ${t("событий в")} ${island.venues} ${t("заведениях сегодня")}`)
                : tonightCount
                  ? `${t("В афише")}: ${tonightCount} · ${t("Весь остров открыт — собери свой вечер")}`
                  : t("Остров открыт — собери свой вечер: клубы, пляжные вечеринки, живая музыка")}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="gtr-btn gtr-btn-red gtr-btn-wow" onClick={() => (headliner ? openEvent(headliner) : go("tonight"))}>
                {headliner ? t("Смотреть событие") : t("Выбрать вечер")} →
              </button>
              {headliner ? (
                <button className="gtr-btn" style={{ padding: "12px 18px" }} onClick={() => go("tonight")}>
                  {t("Вся афиша")}
                </button>
              ) : null}
            </div>
        </div>
      </div>

      {/* ---- афиша: ближайшие события, клик — в артиста ---- */}
      {feed.length ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <span className="gtr-eq" aria-hidden><span /><span /><span /><span /></span>
            <Eyebrow>{t("БЛИЖАЙШИЕ СОБЫТИЯ")}</Eyebrow>
          </div>
          <div className="gtr-hscroll" style={{ marginBottom: 18 }}>
            {feed.map((e) => (
              <Card key={e.vid + e.id} hover style={{ padding: 0, overflow: "hidden", width: 168 }} onClick={() => openEvent(e)}>
                <div style={{ position: "relative", aspectRatio: "4/5", background: "#101116" }}>
                  <img src={posterUrl(e.vid, e.id)} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(10,11,13,.95))" }} />
                  {e.artistIds.length ? (
                    <span className="gtr-mono" style={{ position: "absolute", top: 7, left: 7, font: "700 10px/1 'JetBrains Mono',monospace", padding: "4px 6px", background: "rgba(229,35,27,.9)", letterSpacing: ".08em" }}>
                      {t("НАШ АРТИСТ")}
                    </span>
                  ) : null}
                  <div style={{ position: "absolute", left: 9, right: 9, bottom: 8 }}>
                    <div style={{ font: "600 12.5px/1.25 var(--cond)", textTransform: "uppercase", letterSpacing: ".04em" }}>{e.title.slice(0, 44)}</div>
                    <div className="gtr-mono" style={{ marginTop: 3, font: "500 10px/1.45 'JetBrains Mono',monospace", color: "rgba(255,255,255,.65)" }}>
                      {e.dateIso.slice(8, 10)}.{e.dateIso.slice(5, 7)} · {V(e.vid)?.name?.slice(0, 20)}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* ---- хедлайнеры: артисты, в которых проваливаешься ---- */}
      {heads.length ? (
        <>
          {/* Заголовок честно говорит, откуда список: сегодняшняя афиша
              или общая витрина сцены, когда на сегодня играть некому. */}
          <Eyebrow style={{ marginBottom: 10 }}>
            {heads.some((a) => a.tonight) ? t("КТО ИГРАЕТ СЕГОДНЯ") : t("ХЕДЛАЙНЕРЫ СЦЕНЫ")}
          </Eyebrow>
          <div className="gtr-hscroll" style={{ marginBottom: 18 }}>
            {heads.map((a) => (
              <Card key={a.id} hover style={{ padding: 0, overflow: "hidden", width: 148 }}
                onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: a.id } })}>
                <div style={{ position: "relative", aspectRatio: "1/1", background: "#101116" }}>
                  {a.photo ? (
                    <img src={a.photo} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "saturate(.95)" }}
                      onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : null}
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(10,11,13,.94))" }} />
                  {a.music ? (
                    <button
                      aria-label={t("Слушать превью")}
                      onClick={(ev) => { ev.stopPropagation(); window.open(a.music, "_blank"); }}
                      style={{ position: "absolute", top: 8, right: 8, width: 30, height: 30, cursor: "pointer",
                        border: "1px solid rgba(255,255,255,.4)", background: "rgba(10,11,13,.55)", color: "#fff",
                        display: "grid", placeItems: "center", padding: 0,
                        clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}>
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
                        <polyline points="9 5 16 12 9 19" fill="none" stroke="currentColor"
                          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                  {/* Кто играет сегодня — видно сразу, без захода в афишу */}
                  {a.tonight ? (
                    <span className="gtr-mono" style={{ position: "absolute", top: 8, left: 8, font: "700 9px/1 'JetBrains Mono',monospace", padding: "4px 6px", background: "rgba(229,35,27,.92)", letterSpacing: ".08em" }}>
                      {t("СЕГОДНЯ")}
                    </span>
                  ) : null}
                  <div style={{ position: "absolute", left: 9, right: 9, bottom: 8 }}>
                    <div style={{ font: "600 12px/1.2 var(--cond)", textTransform: "uppercase", letterSpacing: ".03em" }}>{a.name}</div>
                    <div className="gtr-mono" style={{ marginTop: 3, font: "500 10px/1.45 'JetBrains Mono',monospace", color: "rgba(255,255,255,.6)", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.where || a.styles.map((g) => genreLabel(g, i18n.language)).join(" · ")}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {/* ---- мой вкус + быстрые ходы: фирменные значки-стикеры ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("aimatch")}>
          <img src="/brand/stickers/headphones.png" alt="" aria-hidden style={{ position: "absolute", right: -8, bottom: -10, width: 74, opacity: 0.85, transform: "rotate(-8deg)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="gtr-eq" aria-hidden><span /><span /><span /><span /></span>
            <span style={{ font: "600 13px/1.2 var(--cond)", textTransform: "uppercase" }}>{t("Мой вкус")}</span>
            {mp ? <Chip color="#2ECC71">{t("СОБРАН")}</Chip> : null}
          </div>
          <div style={{ marginTop: 7, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>
            {mp
              ? mp.genres.slice(0, 3).map(([f]) => FAMILY_LABEL[f] ?? f).join(" · ")
              : t("Выбери жанры — получи свои места")}
          </div>
        </Card>
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("map")}>
          <img src="/brand/stickers/map.png" alt="" aria-hidden style={{ position: "absolute", right: -8, bottom: -10, width: 74, opacity: 0.85, transform: "rotate(6deg)" }} />
          <div style={{ font: "600 13px/1.2 var(--cond)", textTransform: "uppercase" }}>{t("Карта")}</div>
          <div style={{ marginTop: 7, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>{t("Весь остров точками")}</div>
        </Card>
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("promo")}>
          <img src="/brand/stickers/champagne.png" alt="" aria-hidden style={{ position: "absolute", right: -8, bottom: -10, width: 74, opacity: 0.85, transform: "rotate(-6deg)" }} />
          <div style={{ font: "600 13px/1.2 var(--cond)", textTransform: "uppercase" }}>{t("Стол на вечер")}</div>
          <div style={{ marginTop: 7, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>{t("Бронь в пару касаний")}</div>
        </Card>
      </div>

      {/* ---- сегодня на острове: живая сводка + что нового + чем поможет BRO ---- */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span className="gtr-eq" aria-hidden><span /><span /><span /><span /></span>
        <Eyebrow>{t("СЕГОДНЯ НА ОСТРОВЕ")}</Eyebrow>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 16 }}>
        {/* сводка дня — из реальной афиши, без выдумок */}
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("tonight")}>
          <Eyebrow style={{ fontSize: 10, marginBottom: 8 }}>{t("НОВОСТИ ВЕЧЕРА")}</Eyebrow>
          {island.events ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span className="gtr-mono" style={{ font: "700 26px/1 'JetBrains Mono',monospace", color: "#fff" }}>{island.events}</span>
                <span style={{ font: "600 13px/1.2 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                  {t("событий в")} {island.venues} {t("заведениях")}
                </span>
              </div>
              {island.withArtist ? (
                <div style={{ marginTop: 7, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                  {t("Из них с нашими артистами на сцене:")} {island.withArtist}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ font: "500 12.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
              {t("На сегодня афиша ещё собирается — загляни в раздел «Сегодня», остров не спит.")}
            </div>
          )}
        </Card>

        {/* чем поможет BRO сегодня — открывает голосового помощника */}
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }}
          onClick={() => window.dispatchEvent(new CustomEvent("gtr:bro-open"))}>
          <img src="/raw-pulse/handle-logo.webp" alt="" aria-hidden style={{ position: "absolute", right: -6, bottom: -8, width: 66, opacity: 0.8 }} />
          <Eyebrow style={{ fontSize: 10, marginBottom: 8 }}>{t("BRO СЕГОДНЯ")}</Eyebrow>
          <div style={{ font: "600 13px/1.2 var(--cond)", textTransform: "uppercase", paddingRight: 54 }}>{t("Спроси, куда пойти")}</div>
          <div style={{ marginTop: 7, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 54 }}>
            {t("Подберёт вечер под твой вкус, забронирует стол, переведёт официанту — просто спроси.")}
          </div>
        </Card>
      </div>

      {community.channelUrl || community.chatUrl ? (
        <Card style={{ padding: "16px 18px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
          <Eyebrow style={{ marginBottom: 8 }}>{t("КОМЬЮНИТИ GTR")}</Eyebrow>
          <div style={{ font: "500 13px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", marginBottom: 10 }}>
            {t("Новости острова и живой чат — вся тусовка в одном месте")}
          </div>
          {/* Навигация комьюнити: кнопкой служит сам знак, заливок и рамок
              нет — он висит в пустоте, вокруг ходит лазерная обводка.
              Строка рассчитана на пять пунктов и делит ширину поровну. */}
          <div className="gtr-comm-nav">
            {community.channelUrl ? (
              <button className="gtr-comm-btn" onClick={() => openAppLink(community.channelUrl)}>
                <Stk name="speaker" />
                <span className="gtr-comm-label">{t("Канал")}</span>
              </button>
            ) : null}
            {community.chatUrl ? (
              <button className="gtr-comm-btn" onClick={() => openAppLink(community.chatUrl)}>
                <Stk name="handshake" />
                <span className="gtr-comm-label">{t("Чат")}</span>
              </button>
            ) : null}
            <button className="gtr-comm-btn" onClick={() => go("tonight")}>
              <Stk name="ticket" />
              <span className="gtr-comm-label">{t("Афиша")}</span>
            </button>
            <button className="gtr-comm-btn" onClick={() => go("artists")}>
              <Stk name="mic" />
              <span className="gtr-comm-label">{t("Артисты")}</span>
            </button>
            <button className="gtr-comm-btn" onClick={() => openAppLink("https://t.me/bangtaostyle")}>
              <Stk name="door" />
              <span className="gtr-comm-label">{t("Связь")}</span>
            </button>
          </div>
        </Card>
      ) : null}

      {/* Новое в приложении и уведомления — свёрнуто внизу: это не то,
          ради чего гость открывает кабинет вечером. */}
      <details className="gtr-dash-sec gtr-dash-more">
        <summary className="gtr-dash-h">{t("Что нового и уведомления")}</summary>
        {appUpdates.updates.map((u) => (
          <button key={u.id} type="button" className="gtr-dash-row gtr-dash-link" onClick={() => go(u.screen as ScreenId)}>
            <Stk name={u.icon as StkName} size={26} />
            <span className="gtr-dash-row-t">
              {t(u.title)}
              <small>{t(u.text)}</small>
            </span>
          </button>
        ))}
        <div className="gtr-dash-settings" style={{ marginTop: 14 }}>
          <PushPanel />
        </div>
      </details>
    </div>
  );
}
