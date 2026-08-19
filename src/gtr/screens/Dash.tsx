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
import { useVenueContacts } from "../work-contacts";
import { useGtr } from "../store";
import { FAMILY_LABEL } from "../match";
import { useTranslation } from "react-i18next";
import { ArtistStudio } from "./ArtistStudio";
import "../i18n";
import { Card, Chip, Dot, Eyebrow, Icon, Ring, Stk, TrashTitle } from "../ui";
import { ImpulseArt } from "../impulse";
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
import { genreLabel, OFFER_COLOR, OFFER_LABEL } from "../data/app-data";

type Action = [string, string, string, ScreenId, string, string];
type Kpi = [string, string | number, string, string, string];
type SideRow = { title: string; desc: string; meta: string; color: string };
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
  capacity: string;
  state: string;
  stateColor: string;
  verified: string;
  heroImg?: string;
  heroCredit?: string;
  heroBadge?: string;
  ringLabel: string;
  ringValue: number;
  ringNote: string;
  ringCta: string;
  ringGo: ScreenId;
  ringItems: [string, string][];
  kpis: Kpi[];
  actions: Action[];
  mainTitle: string;
  mainCta: string;
  mainGo: ScreenId;
  mainRows: MainRow[];
  sideTitle: string;
  sideRows: SideRow[];
};

export function DashScreen() {
  const { t } = useTranslation();
  const { user, shared } = useGtr();
  // Контакты приходят с сервера и только команде — в бандле их больше нет.
  const venueContact = useVenueContacts();
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
      capacity: t("Обновлено 06.08.2026"),
      state: t("ОПЕРАЦИОННАЯ БАЗА v3"),
      stateColor: GREEN,
      verified: t("ИСТОЧНИКИ: ОФИЦИАЛЬНЫЕ САЙТЫ"),
      ringLabel: t("ПОКРЫТИЕ БАЗЫ"),
      ringValue: pct,
      ringNote: `${high} ${t("площадок с высокой достоверностью источника из")} ${PH.venues.length}`,
      ringCta: t("Открыть реестр"),
      ringGo: "base",
      ringItems: [
        [t("Кабинеты активированы: 2"), GREEN],
        [t("Приглашения отправлены: 2"), AMBER],
        [`${t("Карантин источников")}: ${quar.length}`, RED],
        [`${t("Контакты P0/P1")}: ${PH.meta.contacts}`, AMBER],
      ],
      kpis: [
        [t("ПЛОЩАДОК В БАЗЕ"), PH.meta.total, "", "#fff", t("97 сущностей, включая группы")],
        [t("НОРМАЛИЗОВАННЫХ ЗАЛОВ"), PH.meta.spaces, "", "#fff", t("Отдельно бронируемые зоны")],
        [t("ГОТОВЫ К КАТАЛОГУ"), "1", "/10", GREEN, t("Place Coworking · готовность 85")],
        [t("КАРАНТИН"), quar.length, "", RED, t("Скрыты из каталога организаторов")],
      ],
      actions: [
        [
          t("Illuzion Group — коммерческое партнёрство"),
          t("Нет презентации приватной аренды, комиссии, правил промоутеров и тех-райдера"),
          t("Открыть карточку"),
          "venueCard",
          "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
          RED,
        ],
        [
          t("Отельные площадки — импорт всех залов"),
          t("Нужны названия комнат, м², сетапы, пакеты и AV от команд продаж"),
          t("Залы и прайс"),
          "spaces",
          "M3 21V8l9-5 9 5v13",
          RED,
        ],
        [
          t("Марины — выездные обследования"),
          t("Зоны, электричество, парковка, разрешения, шум, морские ограничения"),
          t("База Пхукета"),
          "base",
          "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z",
          AMBER,
        ],
        [
          t("Place Coworking — быстрый пилот bookable"),
          t("Живой календарь, депозит, отмена, комиссия"),
          t("Доступы"),
          "access",
          "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z",
          AMBER,
        ],
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
          desc: `${x.type} · ${x.area}`,
          value: String(x.readiness?.score ?? "—"),
          status: (x.readiness?.state ?? "").toUpperCase(),
          color:
            x.readiness?.state === "Бронируемая"
              ? GREEN
              : (x.readiness?.score ?? 0) >= 55
                ? AMBER
                : "rgba(255,255,255,.45)",
          vid: x.id,
        })),
      sideTitle: t("ОЧЕРЕДЬ ИССЛЕДОВАНИЙ · P0 / P1"),
      sideRows: PH.research.slice(0, 6).map((r) => ({
        title: `${r.cluster} — ${r.task}`,
        desc: r.missing,
        meta: r.priority,
        color: r.priority === "P0" ? RED : AMBER,
      })),
    };
  } else if (user.role === "owner") {
    d = {
      kicker: t("КАБИНЕТ ВЛАДЕЛЬЦА"),
      name: v.name,
      type: v.type,
      area: `${v.area} · ${v.district}`,
      capacity: t("1 645 м² · 3 event-пространства"),
      state: t("БРОНИРУЕМАЯ"),
      stateColor: GREEN,
      verified: `${t("ПРОВЕРЕНО")} ${v.verified || ""}`,
      heroImg: rich.hero,
      heroCredit: rich.credit,
      ringLabel: t("ГОТОВНОСТЬ К КАТАЛОГУ"),
      ringValue: R?.score ?? 85,
      ringNote: t("Единственная площадка базы со статусом «Бронируемая»"),
      ringCta: t("Открыть паспорт"),
      ringGo: "venue",
      ringItems: [
        [t("Опубликован прайс THB/час"), GREEN],
        [t("Контакт подтверждён"), GREEN],
        [t("Живой календарь — подключить"), AMBER],
        [t("Комиссия и депозит — согласовать"), AMBER],
      ],
      kpis: [
        [t("EVENT-ПРОСТРАНСТВ"), sp.length || 3, "", "#fff", t("1-й, 4-й и 6-й этажи")],
        [
          t("ЗАНЯТО В АВГУСТЕ"),
          shared.events.filter((e) => e.venueId === vid).length,
          "/31",
          "#fff",
          t("По текущей программе"),
        ],
        [t("ОТКРЫТЫХ ЗАЯВОК"), "3", "", AMBER, t("2 требуют ответа сегодня")],
        [t("ГОТОВНОСТЬ"), R?.score ?? 85, "/100", GREEN, t("Бронируемая")],
      ],
      actions: [
        [
          t("Подключить живой календарь"),
          t("Сейчас доступность подтверждается вручную — организаторы ждут ответ"),
          t("Календарь"),
          "calendar",
          "M3 6h18v15H3z M8 3v5 M16 3v5",
          AMBER,
        ],
        [
          t("Согласовать комиссию и депозит"),
          t("В «Готовности к бронированию» договор и условия оплаты — нет"),
          t("Финансы"),
          "finance",
          "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
          RED,
        ],
        [
          t("Загрузить фото с правами"),
          t("Права на фото: только официальная галерея — нужны материалы с разрешением"),
          t("Паспорт"),
          "venue",
          "M4 7h4l2-2h4l2 2h4v13H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
          AMBER,
        ],
        [
          t("Ответить на 3 заявки"),
          t("Средний ответ по площадке влияет на позицию в каталоге"),
          t("Заявки"),
          "inquiries",
          "M4 4h16v12H9l-5 4z",
          RED,
        ],
      ],
      mainTitle: t("Event-пространства"),
      mainCta: t("Прайс и сетапы"),
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [x.type, x.notes].filter(Boolean).join(" · "),
        value: (x.currency as string) || t("THB / час"),
        status: String(x.bookable || "").toUpperCase(),
        color: GREEN,
      })),
      sideTitle: t("ЧЕК-ЛИСТ ГОТОВНОСТИ"),
      sideRows: [
        [t("Прайс-лист"), t("Опубликованная ставка THB/час, пакеты — уточнить"), t("ЕСТЬ"), GREEN],
        [t("Доступность"), t("Метод: ручной запрос → перевести на календарь"), t("СДЕЛАТЬ"), AMBER],
        [t("Договор и комиссия"), t("Нет в «Готовности к бронированию»"), t("СДЕЛАТЬ"), RED],
        [t("Права на фото"), t("Только официальная галерея"), t("СДЕЛАТЬ"), AMBER],
        [t("Тех-райдер"), t("Не опубликован"), t("СДЕЛАТЬ"), AMBER],
      ].map(([title, desc, meta, color]) => ({ title, desc, meta, color })),
    };
  } else {
    const vEvCount = shared.events.filter((e) => e.venueId === vid).length;
    d = {
      kicker: t("КАБИНЕТ PR-ДИРЕКТОРА"),
      name: v.name,
      type: v.type,
      area: v.area,
      capacity: v.capacity,
      state: t("БРОНЬ ПО ЗАПРОСУ"),
      stateColor: AMBER,
      verified: `${t("ПРОВЕРЕНО")} ${v.verified || ""}`,
      heroImg: rich.hero,
      heroCredit: rich.credit,
      heroBadge: rich.badge,
      ringLabel: t("ГОТОВНОСТЬ К КАТАЛОГУ"),
      ringValue: R?.score ?? 58,
      ringNote: [v.type, v.area, v.capacity ? `${t("до")} ${v.capacity} ${t("гостей")}`.replace(`${t("до")} ${t("до")}`, t("до")) : ""]
        .filter(Boolean)
        .join(" · "),
      ringCta: t("Открыть паспорт"),
      ringGo: "venue",
      ringItems: [
        [t("Площадка и контакт верифицированы"), v.verified ? GREEN : AMBER],
        [t("Залы нормализованы частично"), sp.length ? AMBER : RED],
        [t("Прайс-лист отсутствует"), RED],
        [t("Договор и комиссия отсутствуют"), RED],
      ],
      kpis: [
        [
          t("ЗАЛОВ В БАЗЕ"),
          sp.length || "—",
          "",
          "#fff",
          sp.length
            ? sp
                .map((x) => x.name)
                .slice(0, 3)
                .join(" · ")
            : t("Залы не нормализованы"),
        ],
        [
          t("СОБЫТИЙ В КАЛЕНДАРЕ"),
          vEvCount || "—",
          "",
          "#fff",
          vEvCount ? t("По программе площадки") : t("Пока не запланировано"),
        ],
        [t("ЗАЯВОК ОТ ОРГАНИЗАТОРОВ"), "5", "", AMBER, t("3 в статусе SLA")],
        [t("ГОТОВНОСТЬ"), R?.score ?? 58, "/100", AMBER, t("Бронь по запросу")],
      ],
      actions: [
        [
          t("Прислать матрицу вместимости и net-ставки"),
          t("Прайс-листа в «Готовности к бронированию» нет; без него нет расчёта для организатора"),
          t("Залы и прайс"),
          "spaces",
          "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
          RED,
        ],
        [
          t("Загрузить презентацию приватной аренды и комиссию"),
          t("Нет презентации, комиссии, правил промоутеров и тех-райдера в очереди исследований"),
          t("Финансы"),
          "finance",
          "M13 3H7v18h11V8z M13 3v5h5",
          RED,
        ],
        [
          t("Нормализовать залы и вместимость"),
          t("Данные по залам не подтверждены публично — нужны цифры от площадки"),
          t("Залы и прайс"),
          "spaces",
          "M3 21V8l9-5 9 5v13",
          AMBER,
        ],
        [
          t("Собрать программу в конструкторе"),
          t("Начните с площадки и добавьте артистов, подрядчиков и промо"),
          t("Конструктор"),
          "constructor",
          "M5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M7 8h6a3 3 0 0 1 3 3v3",
          AMBER,
        ],
      ],
      mainTitle: t("Залы и техника площадки"),
      mainCta: t("Открыть залы"),
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [
          x.type,
          x.sqm && `${x.sqm} ${t("м²")}`,
          x.capTheatre && `${x.capTheatre} ${t("театр")}`,
          x.capCocktail && `${x.capCocktail} ${t("коктейль")}`,
        ]
          .filter(Boolean)
          .join(" · "),
        value: x.sqm ? `${x.sqm} ${t("м²")}` : "—",
        status: String(x.bookable || "").toUpperCase(),
        color: AMBER,
      })),
      sideTitle: t("ЧТО ЗАПРОШЕНО GTR"),
      sideRows: [
        [t("Матрица вместимости"), t("Полная матрица сетапов по каждому залу"), "P0", RED],
        [t("Net-ставки"), t("Нетто-ставки и партнёрские пакеты"), "P0", RED],
        [t("Права на фото"), t("Official gallery only — нужны материалы с разрешением"), "P1", AMBER],
        [t("AV и тех-райдер"), t("Свет, звук, экраны, схема подключения"), "P1", AMBER],
      ].map(([title, desc, meta, color]) => ({ title, desc, meta, color })),
    };
  }

  const contact = venueContact(vid);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      {/* ---------- hero ---------- */}
      <div
        className="gtr-card"
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "26px 28px",
          marginBottom: 18,
          minHeight: 148,
        }}
      >
        {d.heroImg ? (
          <>
            <img
              src={d.heroImg}
              alt={d.name}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.34,
              }}
              loading="lazy"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(90deg,#0A0B0Dee,#0A0B0D66)",
              }}
            />
          </>
        ) : null}
        <div className="gtr-beam" />
        <div className="gtr-glowbar" style={{ left: "62%" }} />
        <div className="gtr-glowbar" style={{ left: "84%", animationDelay: "1.2s" }} />
        {/* сканирующие лазеры поверх шапки */}
        <div className="gtr-laser" style={{ top: 0, ["--gtr-run" as string]: "210px" }} />
        <div
          className="gtr-laser"
          style={{ top: 0, animationDelay: "2.6s", opacity: 0.6, ["--gtr-run" as string]: "210px" }}
        />
        <div style={{ position: "relative" }}>
          <Eyebrow>{d.kicker}</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              marginTop: 10,
            }}
          >
            <h1
              className="gtr-oswald"
              style={{ font: "700 30px/1.05 Oswald,sans-serif", letterSpacing: ".02em", margin: 0 }}
            >
              {d.name}
            </h1>
            <Chip color={d.stateColor}>{d.state}</Chip>
            <Chip color="rgba(255,255,255,.5)">{d.verified}</Chip>
            {d.heroBadge ? <Chip color="#FFD166">{d.heroBadge}</Chip> : null}
          </div>
          <div
            style={{
              marginTop: 10,
              font: "500 12.5px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {d.type} · {d.area}
          </div>
          <div
            className="gtr-mono"
            style={{
              marginTop: 6,
              font: "500 10.5px/1.4 'JetBrains Mono',monospace",
              color: "var(--gtr-t3)",
            }}
          >
            {d.capacity}
            {contact?.phone ? ` · ${contact.phone}` : ""}
            {d.heroCredit ? ` · ${t("фото")}: ${d.heroCredit}` : ""}
          </div>
        </div>
      </div>

      {/* ---------- кольцо + KPI ---------- */}
      <div
        className="gtr-md-stack"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(300px,380px) 1fr",
          gap: 18,
          marginBottom: 18,
        }}
      >
        <Card style={{ padding: 22, display: "flex", gap: 18, alignItems: "center" }}>
          <Ring value={d.ringValue} />
          <div style={{ minWidth: 0 }}>
            <Eyebrow>{d.ringLabel}</Eyebrow>
            <div
              style={{
                margin: "8px 0 10px",
                font: "500 11.5px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {d.ringNote}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {d.ringItems.map(([t, c]) => (
                <div
                  key={t}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    font: "500 11px/1.4 'Golos Text',sans-serif",
                  }}
                >
                  <Dot color={c} /> <span style={{ color: "var(--gtr-t2)" }}>{t}</span>
                </div>
              ))}
            </div>
            <button className="gtr-btn" style={{ marginTop: 12 }} onClick={() => go(d.ringGo)}>
              {d.ringCta}
            </button>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          {d.kpis.map(([label, value, suffix, color, note]) => (
            <Card key={t(label)} hover style={{ padding: "16px 18px" }}>
              <Eyebrow>{label}</Eyebrow>
              <div style={{ marginTop: 10 }}>
                <span
                  className="gtr-mono"
                  style={{ font: "700 26px/1 'JetBrains Mono',monospace", color }}
                >
                  {value}
                </span>
                {suffix ? (
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 13px/1 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {suffix}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 8,
                  font: "500 10.5px/1.4 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                }}
              >
                {t(note)}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ---------- действия + сайд ---------- */}
      <div
        className="gtr-md-stack"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr minmax(280px,330px)",
          gap: 18,
          marginBottom: 18,
        }}
      >
        <Card>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "16px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            {t("Приоритетные действия")}
          </div>
          {d.actions.map(([title, desc, cta, goTo, icon, c], i) => (
            <div
              key={title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                borderLeft: `2px solid ${c}`,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  flex: "none",
                  borderRadius: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: c,
                  background: c === RED ? "rgba(229,35,27,.14)" : "rgba(245,166,35,.13)",
                }}
              >
                <Icon d={icon} size={16} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>
                  {title}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 4,
                    font: "500 11px/1.4 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {desc}
                </span>
              </span>
              <button
                className={`gtr-btn ${i === 0 ? "gtr-btn-red" : ""}`}
                onClick={() => go(goTo, goTo === "venueCard" ? "VEN-0013" : undefined)}
              >
                {cta}
              </button>
            </div>
          ))}
        </Card>

        <Card style={{ alignSelf: "start" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
            <Eyebrow>{d.sideTitle}</Eyebrow>
          </div>
          <div style={{ padding: "8px 18px 14px" }}>
            {d.sideRows.map((r) => (
              <div
                key={r.title}
                style={{
                  display: "flex",
                  gap: 9,
                  padding: "9px 0",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                }}
              >
                <Dot color={r.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>{r.title}</div>
                  <div
                    style={{
                      marginTop: 3,
                      font: "500 10.5px/1.4 'Golos Text',sans-serif",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {r.desc}
                  </div>
                </div>
                <span
                  className="gtr-mono"
                  style={{ font: "600 9.5px/1 'JetBrains Mono',monospace", color: r.color }}
                >
                  {r.meta}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------- основная секция ---------- */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,.05)",
          }}
        >
          <div className="gtr-oswald" style={{ font: "600 14px/1 Oswald,sans-serif" }}>
            {d.mainTitle}
          </div>
          <button className="gtr-btn" onClick={() => go(d.mainGo)}>
            {d.mainCta}
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
            gap: 12,
            padding: 18,
          }}
        >
          {(d.mainRows.length
            ? d.mainRows
            : [
                {
                  title: t("Залы не нормализованы"),
                  desc: t("Импорт залов в очереди исследований"),
                  value: "—",
                  status: t("ТРЕБУЕТ ДАННЫХ"),
                  color: RED,
                },
              ]
          ).map((r) => (
            <Card
              key={r.title}
              hover
              style={{ background: "var(--gtr-card2)", padding: "14px 16px" }}
              onClick={r.vid ? () => go("venueCard", r.vid) : () => go(d.mainGo)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ font: "600 13px/1.3 'Golos Text',sans-serif" }}>{r.title}</div>
                <div
                  className="gtr-mono"
                  style={{
                    font: "700 13px/1.2 'JetBrains Mono',monospace",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {r.value}
                </div>
              </div>
              <div
                style={{
                  margin: "6px 0 9px",
                  font: "500 10.5px/1.4 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                }}
              >
                {r.desc}
              </div>
              {r.status ? <Chip color={r.color}>{t(r.status)}</Chip> : null}
            </Card>
          ))}
        </div>
      </Card>
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

  const stages = (["draft", "sent", "approved"] as const).map((st) => {
    const list = rows.filter((r) => r.stage === st);
    return { st, count: list.length, sum: list.reduce((s, r) => s + r.quote.total, 0) };
  });
  const maxStage = Math.max(1, ...stages.map((x) => x.count));

  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((r) => r.d.dateIso && r.d.dateIso >= todayIso)
    .sort((a, b) => (a.d.dateIso! < b.d.dateIso! ? -1 : 1))
    .slice(0, 4);

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

  const kpis: [string, string, string, string][] = [
    [t("В РАБОТЕ"), String(inWork), inWork ? t("черновики и отправленные") : t("создайте первое событие"), "#fff"],
    [t("СОГЛАСОВАНО"), String(approved), approved ? t("подтверждённые события") : t("пока нет"), approved ? GREEN : "#fff"],
    [t("ПАЙПЛАЙН"), pipeline ? fmtThb(pipeline) : "—", t("сумма смет кабинета"), "#fff"],
    [t("КОМИССИЯ GTR"), commission ? fmtThb(commission) : "—", t("с текущего пайплайна"), commission ? GREEN : "#fff"],
  ];

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      {/* ---------- профиль менеджера ---------- */}
      <div
        className="gtr-card"
        style={{ position: "relative", overflow: "hidden", padding: "24px 26px", marginBottom: 18 }}
      >
        <div
          aria-hidden="true"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "34%", opacity: 0.5 }}
        >
          <ImpulseArt seed={user.email} density={0.8} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, var(--gtr-graphite, #17171A), transparent 55%)",
            }}
          />
        </div>
        <div className="gtr-laser" style={{ top: 0, ["--gtr-run" as string]: "170px" }} />
        <div
          className="gtr-md-stack"
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 20,
            alignItems: "center",
          }}
        >
          <span className="gtr-lettermark" style={{ width: 74, height: 74, fontSize: 34 }}>
            {user.initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <Eyebrow>{user.role === "organizer" ? t("КАБИНЕТ ОРГАНИЗАТОРА") : t("КАБИНЕТ EVENT SALES")}</Eyebrow>
            <h1
              className="gtr-oswald"
              style={{ font: "700 28px/1.05 Oswald,sans-serif", letterSpacing: ".02em", margin: "8px 0 0" }}
            >
              {user.name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 9 }}>
              <Chip color={AMBER}>{user.roleLabel.toUpperCase()}</Chip>
              {v.name ? <Chip color="rgba(255,255,255,.5)">{v.name.toUpperCase()}</Chip> : null}
              <span
                className="gtr-mono"
                style={{ font: "500 10.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
              >
                {user.email} {t("· событий:")} {rows.length}
              </span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, alignContent: "center" }}>
            <button
              className="gtr-btn gtr-btn-red"
              style={{ padding: "10px 16px" }}
              onClick={() => go("events", { vid: user.venueId || "new" })}
            >
              {t("+ Новое событие")}
            </button>
            <button className="gtr-btn" style={{ padding: "9px 16px" }} onClick={() => go("events")}>
              {t("Мои события →")}
            </button>
            <InviteLinkButton />
          </div>
        </div>
      </div>

      {/* ---------- настройки: push, Telegram, язык предложений ---------- */}
      <Card style={{ padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Eyebrow>{t("НАСТРОЙКИ")}</Eyebrow>
        <TgChip />
        <PushPanel />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, marginLeft: "auto" }}>
          <span className="gtr-mono" style={{ font: "600 9px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)", letterSpacing: ".1em" }}>
            {t("ЯЗЫК ПРЕДЛОЖЕНИЙ")}
          </span>
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
        </span>
        {/* язык приложения переехал в шапку (LangSwitch в shell) */}
      </Card>

      {/* ---------- KPI кабинета ---------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {kpis.map(([label, value, note, color]) => (
          <Card key={label} style={{ padding: "16px 18px", display: "grid", gap: 7 }}>
            <Eyebrow style={{ fontSize: 8.5 }}>{label}</Eyebrow>
            <span
              className="gtr-mono"
              style={{
                font: "700 24px/1 'JetBrains Mono',monospace",
                color,
                fontVariantNumeric: "tabular-nums",
                overflowWrap: "anywhere",
              }}
            >
              {value}
            </span>
            <span style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {note}
            </span>
          </Card>
        ))}
      </div>

      {/* ---------- воронка + пайплайн по месяцам ---------- */}
      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) 1.4fr", gap: 18, marginBottom: 18 }}
      >
        <Card style={{ padding: "18px 20px", display: "grid", gap: 12, alignContent: "start" }}>
          <Eyebrow>{t("ВОРОНКА СОБЫТИЙ")}</Eyebrow>
          {stages.map(({ st, count, sum }) => (
            <div key={st} style={{ display: "grid", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <Dot color={STAGE_COLOR[st]} />
                <span style={{ font: "600 11.5px/1 'Golos Text',sans-serif" }}>{STAGE_LABEL[st]}</span>
                <span
                  className="gtr-mono"
                  style={{ font: "700 12px/1 'JetBrains Mono',monospace", color: "#fff" }}
                >
                  {count}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    marginLeft: "auto",
                    font: "500 10px/1 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {sum ? fmtThb(sum) : "—"}
                </span>
              </div>
              <div style={{ height: 8, background: "rgba(255,255,255,.06)" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(count / maxStage) * 100}%`,
                    background: STAGE_COLOR[st],
                    clipPath: "polygon(0 0, calc(100% - 4px) 0, 100% 100%, 0 100%)",
                    transition: "width .4s",
                  }}
                />
              </div>
            </div>
          ))}
          <span style={{ font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
            {t("Стадию события меняет конструктор: черновик → отправлено → согласовано.")}
          </span>
        </Card>

        <Card style={{ padding: "18px 20px", display: "grid", gap: 12, alignContent: "start" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <Eyebrow>{t("ПАЙПЛАЙН ПО МЕСЯЦАМ")}</Eyebrow>
            <span
              className="gtr-mono"
              style={{ marginLeft: "auto", font: "500 9.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              {t("суммы смет с датой события")}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${months.length},1fr)`,
              gap: 10,
              alignItems: "end",
              height: 130,
            }}
          >
            {months.map((m) => (
              <div key={m.key} style={{ display: "grid", gap: 6, alignContent: "end", height: "100%" }}>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 8.5px/1 'JetBrains Mono',monospace",
                    color: m.sum ? "#fff" : "var(--gtr-t3)",
                    textAlign: "center",
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.sum ? `฿${Math.round(m.sum / 1000).toLocaleString("ru-RU")}k` : ""}
                </span>
                <div
                  style={{
                    height: Math.max(3, (m.sum / maxMonth) * 88),
                    background: m.sum
                      ? "linear-gradient(180deg, var(--gtr-red-hot,#FF3427), var(--gtr-red,#E5231B))"
                      : "rgba(255,255,255,.07)",
                    clipPath: "polygon(0 4px, calc(100% - 4px) 0, 100% 100%, 0 100%)",
                  }}
                  title={m.count ? `${m.count} ${t("соб.")} · ${fmtThb(m.sum)}` : t("нет событий")}
                />
                <span
                  className="gtr-mono"
                  style={{
                    font: "500 9px/1 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                    textAlign: "center",
                    textTransform: "uppercase",
                  }}
                >
                  {m.label}
                  {m.count ? ` · ${m.count}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------- календарь кабинета + заявки на мне ---------- */}
      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "minmax(300px,380px) 1fr", gap: 18, marginBottom: 18 }}
      >
        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <Eyebrow>{t("КАЛЕНДАРЬ КАБИНЕТА")}</Eyebrow>
          <CabinetMonth
            rows={rows}
            onOpen={(id) =>
              navigate({ to: "/gtr/$screen", params: { screen: "constructor" }, search: { draft: id } })
            }
          />
        </Card>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>{user.role === "organizer" ? t("МОИ ЗАЯВКИ ПЛОЩАДКАМ") : t("ЗАЯВКИ НА МНЕ")}</Eyebrow>
            <button
              className="gtr-btn"
              style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 10 }}
              onClick={() => go("inquiries")}
            >
              {t("Все заявки →")}
            </button>
          </div>
          {myRequests.length ? (
            myRequests.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 11px",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderLeft: `2px solid ${r.status === "accepted" ? GREEN : AMBER}`,
                  background: "var(--gtr-card2)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ flex: 1, minWidth: 160 }}>
                  <span style={{ display: "block", font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>
                    {r.title || t("Заявка")}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", marginTop: 2, font: "500 9px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {r.venueName} · {r.date || t("дата не указана")} · {r.guests || "—"} {t("гостей ·")}{" "}
                    {r.organizerName || t("организатор")}
                  </span>
                </span>
                <span
                  className="gtr-mono"
                  style={{ font: "700 11px/1 'JetBrains Mono',monospace", color: "#2ECC71" }}
                >
                  {fmtThb(r.quoteTotal)}
                </span>
                <Chip color={r.status === "accepted" ? GREEN : AMBER}>
                  {r.status === "accepted" ? t("ПРИНЯТА") : t("В РАБОТЕ")}
                </Chip>
              </div>
            ))
          ) : (
            <span style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {user.role === "organizer"
                ? t("Заявок пока нет. Соберите событие в конструкторе и отправьте запрос площадке — статус будет виден здесь.")
                : t("Назначенных заявок нет. Возьмите заявку на себя в разделе «Заявки организаторов» — она появится здесь, а в Telegram-канал GTR уйдёт уведомление.")}
            </span>
          )}
        </Card>
      </div>

      {/* ---------- ближайшие + мои события ---------- */}
      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) 1.4fr", gap: 18 }}
      >
        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <Eyebrow>{t("БЛИЖАЙШИЕ СОБЫТИЯ")}</Eyebrow>
          {upcoming.length ? (
            upcoming.map(({ d }) => (
              <button
                key={d.id}
                className="gtr-pal-btn"
                style={{ padding: "9px 11px" }}
                onClick={() =>
                  navigate({
                    to: "/gtr/$screen",
                    params: { screen: "constructor" },
                    search: { draft: d.id },
                  })
                }
              >
                <span
                  className="gtr-mono"
                  style={{
                    flex: "none",
                    font: "700 10px/1.3 'JetBrains Mono',monospace",
                    color: "var(--gtr-red)",
                    border: "1px solid rgba(229,35,27,.45)",
                    padding: "5px 7px",
                    textAlign: "center",
                    minWidth: 46,
                  }}
                >
                  {d.date ? d.date.split(" · ")[0] : d.dateIso}
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 11.5 }}>
                    {draftTitle(d)}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      font: "500 9px/1.3 'JetBrains Mono',monospace",
                      color: "rgba(255,255,255,.4)",
                    }}
                  >
                    {V(d.venueId).name ?? d.venueId}
                    {d.date?.includes("·") ? ` · ${d.date.split(" · ")[1]}` : ""}
                    {d.guests ? ` · ${d.guests} ${t("гостей")}` : ""}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <span style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Дат впереди нет. Укажите дату в мастере события или в слоте конструктора — событие появится здесь и в пайплайне по месяцам.")}
            </span>
          )}
        </Card>

        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>{t("МОИ СОБЫТИЯ")}</Eyebrow>
            <button
              className="gtr-btn"
              style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 10 }}
              onClick={() => go("events")}
            >
              {t("Все →")}
            </button>
          </div>
          {latest.length ? (
            latest.map(({ d, quote, stage }) => (
              <button
                key={d.id}
                className="gtr-pal-btn"
                style={{ padding: "10px 12px", position: "relative", overflow: "hidden" }}
                onClick={() =>
                  navigate({
                    to: "/gtr/$screen",
                    params: { screen: "constructor" },
                    search: { draft: d.id },
                  })
                }
              >
                <span
                  aria-hidden="true"
                  style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8 }}
                >
                  <ImpulseArt seed={d.id} density={0.35} />
                </span>
                <span style={{ flex: 1, minWidth: 0, textAlign: "left", paddingLeft: 10 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 12 }}>
                    {draftTitle(d)}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 3,
                      font: "500 9px/1.3 'JetBrains Mono',monospace",
                      color: "rgba(255,255,255,.4)",
                    }}
                  >
                    {V(d.venueId).name ?? d.venueId}
                    {d.date ? ` · ${d.date}` : ""}
                  </span>
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    flex: "none",
                    font: "600 8.5px/1 'JetBrains Mono',monospace",
                    color: STAGE_COLOR[stage],
                    border: `1px solid ${STAGE_COLOR[stage]}55`,
                    padding: "4px 7px",
                  }}
                >
                  {STAGE_LABEL[stage].toUpperCase()}
                </span>
                <span
                  className="gtr-mono"
                  style={{ flex: "none", font: "700 11px/1 'JetBrains Mono',monospace", color: quote.total ? "#fff" : "var(--gtr-t3)" }}
                >
                  {quote.total ? fmtThb(quote.total) : "—"}
                </span>
              </button>
            ))
          ) : (
            <span style={{ font: "500 11px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("В кабинете пока пусто. Нажмите «")}{t("+ Новое событие")}{t("» — мастер проведёт по шагам: сценарий, дата, вместимость, площадка.")}
            </span>
          )}
        </Card>
      </div>
    </div>
  );
}


// Месяц кабинета: дни с событиями менеджера подсвечены, клик открывает событие
function CabinetMonth({
  rows,
  onOpen,
}: {
  rows: { d: import("../data/app-data").EventDraft }[];
  onOpen: (draftId: string) => void;
}) {
  const { t } = useTranslation();
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const [y, m] = ym;
  const monthNames = [
    t("Январь"), t("Февраль"), t("Март"), t("Апрель"), t("Май"), t("Июнь"),
    t("Июль"), t("Август"), t("Сентябрь"), t("Октябрь"), t("Ноябрь"), t("Декабрь"),
  ];
  const shift = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const byDay = new Map<number, { id: string; title: string }[]>();
  for (const { d } of rows) {
    if (!d.dateIso) continue;
    const [yy, mm, dd] = d.dateIso.split("-").map(Number);
    if (yy === y && mm === m + 1)
      byDay.set(dd, [...(byDay.get(dd) ?? []), { id: d.id, title: draftTitle(d) }]);
  }
  const todayKey =
    now.getFullYear() === y && now.getMonth() === m ? now.getDate() : -1;

  return (
    <div className="gtr-cal" style={{ maxWidth: "none", border: "none", padding: 0, clipPath: "none", background: "transparent" }}>
      <div className="gtr-cal-head">
        <button type="button" className="gtr-cal-nav" onClick={() => {
          const p = new Date(y, m - 1, 1);
          setYm([p.getFullYear(), p.getMonth()]);
        }}>
          ‹
        </button>
        <span className="gtr-cal-title">
          {monthNames[m]} <b>{y}</b>
        </span>
        <button type="button" className="gtr-cal-nav" onClick={() => {
          const n = new Date(y, m + 1, 1);
          setYm([n.getFullYear(), n.getMonth()]);
        }}>
          ›
        </button>
      </div>
      <div className="gtr-cal-grid gtr-cal-week">
        {[t("ПН"), t("ВТ"), t("СР"), t("ЧТ"), t("ПТ"), t("СБ"), t("ВС")].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="gtr-cal-grid">
        {Array.from({ length: shift }, (_, i) => (
          <span key={`x${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1;
          const evs = byDay.get(d);
          return (
            <button
              key={d}
              type="button"
              className={`gtr-cal-day${evs ? " on" : ""}${d === todayKey ? " today" : ""}`}
              title={evs?.map((e) => e.title).join("\n")}
              style={evs ? undefined : { cursor: "default" }}
              onClick={() => evs && onOpen(evs[0].id)}
            >
              {d}
              {evs && evs.length > 1 ? (
                <span style={{ position: "absolute", fontSize: 7, marginLeft: 2 }}>{evs.length}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <span style={{ font: "500 10px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
        {t("Красные дни — ваши события; клик открывает конструктор.")}
      </span>
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

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {/* профиль */}
      <div
        className="gtr-card"
        style={{ position: "relative", overflow: "hidden", padding: "24px 26px", marginBottom: 18 }}
      >
        <div
          aria-hidden="true"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "34%", opacity: 0.5 }}
        >
          <ImpulseArt seed={user.artistId || user.email} density={0.8} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, var(--gtr-graphite, #17171A), transparent 55%)",
            }}
          />
        </div>
        <div className="gtr-laser" style={{ top: 0, ["--gtr-run" as string]: "170px" }} />
        <div style={{ position: "relative", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <span className="gtr-lettermark" style={{ width: 74, height: 74, fontSize: 34 }}>
            {user.initials}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Eyebrow>{t("КАБИНЕТ АРТИСТА")}</Eyebrow>
            <h1
              className="gtr-oswald"
              style={{ font: "700 28px/1.05 Oswald,sans-serif", letterSpacing: ".02em", margin: "8px 0 0" }}
            >
              {user.name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 9 }}>
              <Chip color="#7B4DFF">{user.roleLabel.toUpperCase()}</Chip>
              {user.artistId ? <Chip color="rgba(255,255,255,.5)">{user.artistId}</Chip> : null}
              <span
                className="gtr-mono"
                style={{ font: "500 10.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
              >
                {user.email}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Эфир: зелёная кнопка в каталоге артистов */}
      <Card style={{ padding: "16px 20px", marginBottom: 18, display: "grid", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Eyebrow>{t("ПРЯМОЙ ЭФИР")}</Eyebrow>
          {onAir ? (
            <span className="gtr-live-chip">
              <span className="gtr-live-dot" /> {t("В ЭФИРЕ")}
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
        <span style={{ font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          {t("Кнопка в каталоге станет зелёной, зрители перейдут прямо в эфир. Автоотключение через 4 часа. Из Telegram: «Я в эфире» на клавиатуре бота.")}
        </span>
      </Card>

      {/* Telegram */}
      <Card style={{ padding: "16px 20px", marginBottom: 18, display: "grid", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Eyebrow>TELEGRAM</Eyebrow>
          {tg?.linked ? (
            <Chip color={GREEN}>{t("ПРИВЯЗАН — ПРЕДЛОЖЕНИЯ ПРИХОДЯТ В ЧАТ")}</Chip>
          ) : tg?.bot ? (
            <>
              <span style={{ font: "500 11.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                {t("Привяжите чат — предложения будут приходить с кнопками «Принять / Отклонить».")}
              </span>
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
            </>
          ) : (
            <span style={{ font: "500 11px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Бот GTR ещё не активирован администратором.")}
            </span>
          )}
          {tgMsg ? (
            <span style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "#FF5B4D" }}>{tgMsg}</span>
          ) : null}
        </div>
      </Card>

      {/* предложения */}
      {user.artistId ? <ArtistStudio artistId={user.artistId} /> : null}

      <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}>
        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <Eyebrow>{t("ПРЕДЛОЖЕНИЯ ·")} {open.length}</Eyebrow>
          {open.length ? (
            open.map((o) => (
              <div
                key={o.id}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "12px 13px",
                  background: "var(--gtr-card2)",
                  border: "1px solid rgba(255,255,255,.09)",
                  borderLeft: `2px solid ${OFFER_COLOR[o.status]}`,
                }}
              >
                <div style={{ font: "600 13px/1.35 'Golos Text',sans-serif" }}>
                  {o.venueName}
                  {o.date ? ` · ${o.date}` : ""}
                </div>
                <div
                  className="gtr-mono"
                  style={{ font: "500 9.5px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                >
                  {o.fee ? `${t("условия")}: ${o.fee}` : t("условия обсуждаются")}
                  {o.note ? ` · ${o.note}` : ""} {t("· от")} {o.fromName}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="gtr-btn gtr-btn-red" style={{ padding: "8px 14px" }} onClick={() => decide(o.id, true)}>
                    {t("✓ Принять")}
                  </button>
                  <button className="gtr-btn" style={{ padding: "8px 14px" }} onClick={() => decide(o.id, false)}>
                    {t("Отклонить")}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <span style={{ font: "500 11.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Новых предложений нет. Когда площадка позовёт вас в событие, оно появится здесь")}
              {tg?.linked ? t(" и в Telegram") : ""}.
            </span>
          )}
        </Card>

        <Card style={{ padding: "18px 20px", display: "grid", gap: 10, alignContent: "start" }}>
          <Eyebrow>{t("МОИ ВЫСТУПЛЕНИЯ ·")} {accepted.length}</Eyebrow>
          {accepted.length ? (
            accepted.map((o) => (
              <div
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--gtr-card2)",
                  border: "1px solid rgba(255,255,255,.09)",
                  borderLeft: `2px solid ${GREEN}`,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                    {o.venueName}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", marginTop: 2, font: "500 9px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {o.date || t("дата уточняется")}
                    {o.fee ? ` · ${o.fee}` : ""}
                  </span>
                </span>
                <Chip color={GREEN}>{OFFER_LABEL.accepted.toUpperCase()}</Chip>
              </div>
            ))
          ) : (
            <span style={{ font: "500 11.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Подтверждённых выступлений пока нет.")}
            </span>
          )}
          {mine.some((o) => o.status === "declined") ? (
            <span
              className="gtr-mono"
              style={{ font: "500 9px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              {t("отклонённых:")} {mine.filter((o) => o.status === "declined").length}
            </span>
          ) : null}
        </Card>
      </div>
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
          style={{ padding: "6px 8px", fontSize: 9.5, width: 220 }}
        />
      ) : null}
      {msg ? (
        <span style={{ font: "500 9.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)", maxWidth: 220 }}>
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
  const [heads, setHeads] = useState<{ id: string; name: string; styles: string[]; photo?: string; music?: string }[]>([]);
  const [community, setCommunity] = useState<{ channelUrl: string; chatUrl: string }>({ channelUrl: "", chatUrl: "" });
  useEffect(() => {
    musicProfileFn().then((r) => setMp(r.profile)).catch(() => {});
    communityCfgFn().then((r) => setCommunity({ channelUrl: r.channelUrl, chatUrl: r.chatUrl })).catch(() => {});
    allAfishaFn()
      .then((r) => {
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
    // хедлайнеры: приоритетные артисты с фото — витрина, не список
    Promise.all([loadArtists(), import("../data/artist-photos.json"), import("../data/artist-players.json")]).then(
      ([base, ph, pl]) => {
        const photos = (ph as { default: { photos: Record<string, { photo: string }> } }).default.photos;
        const players = (pl as { default: Record<string, { kind: string; ref: string }> }).default;
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
        setHeads(
          base.artists
            .filter((a) => a.prio === "A" && photos[a.id] && (a.styles ?? []).length)
            .slice(0, 6)
            .map((a) => ({
              id: a.id,
              name: a.name,
              styles: (a.styles ?? []).slice(0, 2),
              photo: photos[a.id]?.photo,
              music: linkOf(a.id, a.sp as string | undefined),
            })),
        );
      },
    ).catch(() => {});
  }, []);

  const openEvent = (e: { vid: string; artistIds: string[] }) =>
    e.artistIds.length
      ? navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: e.artistIds[0] } })
      : navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: e.vid } });

  const todayIso = new Date().toISOString().slice(0, 10);
  const tonightCount = feed.filter((e) => e.dateIso === todayIso).length;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {/* ---- HERO: вайб вечера — живое видео площадки.
           Без карточки и рамки: кадр выходит за отступы колонки до граней
           экрана, а по краям свет заваливается, как на изогнутом стекле —
           видео читается уходящим за грань, а не вырезанным в окошке. ---- */}
      <div className="gtr-hero-edge">
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
        <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(180deg, rgba(10,11,13,0) 18%, rgba(10,11,13,.45) 58%, rgba(10,11,13,.8) 100%)" }} />
        <div className="gtr-laser" style={{ ["--gtr-run" as string]: "340px", zIndex: 1 }} />
        <div className="gtr-hero-edge-in gtr-hero-tall">
            <div className="gtr-mono" style={{ font: "600 10px/1 'JetBrains Mono',monospace", color: "rgba(255,255,255,.75)", letterSpacing: ".16em", marginBottom: 10 }}>
              {user.name.toUpperCase()} · PHUKET
            </div>
            <TrashTitle text={t("Сегодня вечером")} size={40} />
            <div style={{ margin: "10px 0 16px", font: "500 13px/1.5 'Golos Text',sans-serif", color: "rgba(255,255,255,.82)", maxWidth: 420 }}>
              {tonightCount
                ? `${t("В афише")}: ${tonightCount} · ${t("Весь остров открыт — собери свой вечер")}`
                : t("Остров открыт — собери свой вечер: клубы, пляжные вечеринки, живая музыка")}
            </div>
            <div>
              <button className="gtr-btn-wow" onClick={() => go("tonight")}>
                {t("Выбрать вечер")} →
              </button>
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
                  {e.poster ? (
                    <img src={e.poster} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : null}
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(10,11,13,.95))" }} />
                  {e.artistIds.length ? (
                    <span className="gtr-mono" style={{ position: "absolute", top: 7, left: 7, font: "700 8px/1 'JetBrains Mono',monospace", padding: "4px 6px", background: "rgba(229,35,27,.9)", letterSpacing: ".08em" }}>
                      {t("НАШ АРТИСТ")}
                    </span>
                  ) : null}
                  <div style={{ position: "absolute", left: 9, right: 9, bottom: 8 }}>
                    <div style={{ font: "600 12.5px/1.25 Oswald,sans-serif", textTransform: "uppercase", letterSpacing: ".04em" }}>{e.title.slice(0, 44)}</div>
                    <div className="gtr-mono" style={{ marginTop: 3, font: "500 8.5px/1.3 'JetBrains Mono',monospace", color: "rgba(255,255,255,.65)" }}>
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
          <Eyebrow style={{ marginBottom: 10 }}>{t("ХЕДЛАЙНЕРЫ СЦЕНЫ")}</Eyebrow>
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
                  <div style={{ position: "absolute", left: 9, right: 9, bottom: 8 }}>
                    <div style={{ font: "700 12px/1.2 Oswald,sans-serif", textTransform: "uppercase", letterSpacing: ".03em" }}>{a.name}</div>
                    <div className="gtr-mono" style={{ marginTop: 3, font: "500 8px/1.3 'JetBrains Mono',monospace", color: "rgba(255,255,255,.6)", textTransform: "uppercase" }}>
                      {a.styles.map((g) => genreLabel(g, i18n.language)).join(" · ")}
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
            <span style={{ font: "700 13px/1.2 Oswald,sans-serif", textTransform: "uppercase" }}>{t("Мой вкус")}</span>
            {mp ? <Chip color="#2ECC71">{t("СОБРАН")}</Chip> : null}
          </div>
          <div style={{ marginTop: 7, font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>
            {mp
              ? mp.genres.slice(0, 3).map(([f]) => FAMILY_LABEL[f] ?? f).join(" · ")
              : t("Выбери жанры — получи свои места")}
          </div>
        </Card>
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("map")}>
          <img src="/brand/stickers/map.png" alt="" aria-hidden style={{ position: "absolute", right: -8, bottom: -10, width: 74, opacity: 0.85, transform: "rotate(6deg)" }} />
          <div style={{ font: "700 13px/1.2 Oswald,sans-serif", textTransform: "uppercase" }}>{t("Карта")}</div>
          <div style={{ marginTop: 7, font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>{t("Весь остров точками")}</div>
        </Card>
        <Card hover style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }} onClick={() => go("promo")}>
          <img src="/brand/stickers/champagne.png" alt="" aria-hidden style={{ position: "absolute", right: -8, bottom: -10, width: 74, opacity: 0.85, transform: "rotate(-6deg)" }} />
          <div style={{ font: "700 13px/1.2 Oswald,sans-serif", textTransform: "uppercase" }}>{t("Стол на вечер")}</div>
          <div style={{ marginTop: 7, font: "500 10.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", paddingRight: 62 }}>{t("Бронь в пару касаний")}</div>
        </Card>
      </div>

      {community.channelUrl || community.chatUrl ? (
        <Card style={{ padding: "16px 18px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
          <div className="gtr-laser" aria-hidden />
          <Eyebrow style={{ marginBottom: 8 }}>{t("КОМЬЮНИТИ GTR")}</Eyebrow>
          <div style={{ font: "500 11.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)", marginBottom: 10 }}>
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

      {/* язык приложения переехал в шапку (LangSwitch в shell) */}
      <Card style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <PushPanel />
      </Card>
    </div>
  );
}
