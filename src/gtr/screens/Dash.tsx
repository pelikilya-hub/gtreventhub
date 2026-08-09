import { useNavigate } from "@tanstack/react-router";

import { AMBER, CONTACT, GREEN, PH, RED, richOf, SPACES, V, type ScreenId } from "../data/app-data";
import { useGtr } from "../store";
import { Card, Chip, Dot, Eyebrow, Icon, Ring } from "../ui";

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
  const { user, shared } = useGtr();
  const navigate = useNavigate();
  const go = (s: ScreenId, vid?: string) =>
    navigate({ to: "/gtr/$screen", params: { screen: s }, search: vid ? { vid } : undefined });

  const vid = user.venueId;
  const v = V(vid);
  const R = v.readiness;
  const sp = SPACES(vid);
  const rich = richOf(vid);

  let d: DashData;
  if (user.role === "gtr") {
    const quar = PH.venues.filter(
      (x) => x.confidence === "Low" || /verify|Closed/i.test(x.status || ""),
    );
    const high = PH.venues.filter((x) => x.confidence === "High").length;
    const pct = Math.round((high / Math.max(1, PH.venues.length)) * 100);
    d = {
      kicker: "СЕТЬ GTR · ПХУКЕТ",
      name: "Сеть площадок Пхукета",
      type: "97 объектов · 30 залов",
      area: "Патонг · Банг Тао · Камала · Карон · Май Кхао · Старый город",
      capacity: "Обновлено 06.08.2026",
      state: "ОПЕРАЦИОННАЯ БАЗА v3",
      stateColor: GREEN,
      verified: "ИСТОЧНИКИ: ОФИЦИАЛЬНЫЕ САЙТЫ",
      ringLabel: "ПОКРЫТИЕ БАЗЫ",
      ringValue: pct,
      ringNote: `${high} площадок с высокой достоверностью источника из ${PH.venues.length}`,
      ringCta: "Открыть реестр",
      ringGo: "base",
      ringItems: [
        ["Кабинеты активированы: 2", GREEN],
        ["Приглашения отправлены: 2", AMBER],
        [`Карантин источников: ${quar.length}`, RED],
        [`Контакты P0/P1: ${PH.meta.contacts}`, AMBER],
      ],
      kpis: [
        ["ПЛОЩАДОК В БАЗЕ", PH.meta.total, "", "#fff", "97 сущностей, включая группы"],
        ["НОРМАЛИЗОВАННЫХ ЗАЛОВ", PH.meta.spaces, "", "#fff", "Отдельно бронируемые зоны"],
        ["ГОТОВЫ К КАТАЛОГУ", "1", "/10", GREEN, "Place Coworking · готовность 85"],
        ["КАРАНТИН", quar.length, "", RED, "Скрыты из каталога организаторов"],
      ],
      actions: [
        [
          "Illuzion Group — коммерческое партнёрство",
          "Нет презентации приватной аренды, комиссии, правил промоутеров и тех-райдера",
          "Открыть карточку",
          "venueCard",
          "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
          RED,
        ],
        [
          "Отельные площадки — импорт всех залов",
          "Нужны названия комнат, м², сетапы, пакеты и AV от команд продаж",
          "Залы и прайс",
          "spaces",
          "M3 21V8l9-5 9 5v13",
          RED,
        ],
        [
          "Марины — выездные обследования",
          "Зоны, электричество, парковка, разрешения, шум, морские ограничения",
          "База Пхукета",
          "base",
          "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z",
          AMBER,
        ],
        [
          "Place Coworking — быстрый пилот bookable",
          "Живой календарь, депозит, отмена, комиссия",
          "Доступы",
          "access",
          "M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5z",
          AMBER,
        ],
      ],
      mainTitle: "Готовность площадок",
      mainCta: "Весь реестр",
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
      sideTitle: "ОЧЕРЕДЬ ИССЛЕДОВАНИЙ · P0 / P1",
      sideRows: PH.research.slice(0, 6).map((r) => ({
        title: `${r.cluster} — ${r.task}`,
        desc: r.missing,
        meta: r.priority,
        color: r.priority === "P0" ? RED : AMBER,
      })),
    };
  } else if (user.role === "owner") {
    d = {
      kicker: "КАБИНЕТ ВЛАДЕЛЬЦА",
      name: v.name,
      type: v.type,
      area: `${v.area} · ${v.district}`,
      capacity: "1 645 м² · 3 event-пространства",
      state: "БРОНИРУЕМАЯ",
      stateColor: GREEN,
      verified: `ПРОВЕРЕНО ${v.verified || ""}`,
      heroImg: rich.hero,
      heroCredit: rich.credit,
      ringLabel: "ГОТОВНОСТЬ К КАТАЛОГУ",
      ringValue: R?.score ?? 85,
      ringNote: "Единственная площадка базы со статусом «Бронируемая»",
      ringCta: "Открыть паспорт",
      ringGo: "venue",
      ringItems: [
        ["Опубликован прайс THB/час", GREEN],
        ["Контакт подтверждён", GREEN],
        ["Живой календарь — подключить", AMBER],
        ["Комиссия и депозит — согласовать", AMBER],
      ],
      kpis: [
        ["EVENT-ПРОСТРАНСТВ", sp.length || 3, "", "#fff", "1-й, 4-й и 6-й этажи"],
        [
          "ЗАНЯТО В АВГУСТЕ",
          shared.events.filter((e) => e.venueId === vid).length,
          "/31",
          "#fff",
          "По текущей программе",
        ],
        ["ОТКРЫТЫХ ЗАЯВОК", "3", "", AMBER, "2 требуют ответа сегодня"],
        ["ГОТОВНОСТЬ", R?.score ?? 85, "/100", GREEN, "Бронируемая"],
      ],
      actions: [
        [
          "Подключить живой календарь",
          "Сейчас доступность подтверждается вручную — организаторы ждут ответ",
          "Календарь",
          "calendar",
          "M3 6h18v15H3z M8 3v5 M16 3v5",
          AMBER,
        ],
        [
          "Согласовать комиссию и депозит",
          "В «Готовности к бронированию» договор и условия оплаты — нет",
          "Финансы",
          "finance",
          "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
          RED,
        ],
        [
          "Загрузить фото с правами",
          "Права на фото: только официальная галерея — нужны материалы с разрешением",
          "Паспорт",
          "venue",
          "M4 7h4l2-2h4l2 2h4v13H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
          AMBER,
        ],
        [
          "Ответить на 3 заявки",
          "Средний ответ по площадке влияет на позицию в каталоге",
          "Заявки",
          "inquiries",
          "M4 4h16v12H9l-5 4z",
          RED,
        ],
      ],
      mainTitle: "Event-пространства",
      mainCta: "Прайс и сетапы",
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [x.type, x.notes].filter(Boolean).join(" · "),
        value: (x.currency as string) || "THB / час",
        status: String(x.bookable || "").toUpperCase(),
        color: GREEN,
      })),
      sideTitle: "ЧЕК-ЛИСТ ГОТОВНОСТИ",
      sideRows: [
        ["Прайс-лист", "Опубликованная ставка THB/час, пакеты — уточнить", "ЕСТЬ", GREEN],
        ["Доступность", "Метод: ручной запрос → перевести на календарь", "СДЕЛАТЬ", AMBER],
        ["Договор и комиссия", "Нет в «Готовности к бронированию»", "СДЕЛАТЬ", RED],
        ["Права на фото", "Только официальная галерея", "СДЕЛАТЬ", AMBER],
        ["Тех-райдер", "Не опубликован", "СДЕЛАТЬ", AMBER],
      ].map(([title, desc, meta, color]) => ({ title, desc, meta, color })),
    };
  } else if (user.role === "sales") {
    d = {
      kicker: "КАБИНЕТ EVENT SALES",
      name: v.name,
      type: v.type,
      area: `${v.area} · ${v.district}`,
      capacity: "Arlang до 300 коктейль · 304 м²",
      state: "БРОНЬ ПО ЗАПРОСУ",
      stateColor: AMBER,
      verified: `ПРОВЕРЕНО ${v.verified || ""}`,
      heroImg: rich.hero,
      heroCredit: rich.credit,
      ringLabel: "ГОТОВНОСТЬ К КАТАЛОГУ",
      ringValue: R?.score ?? 58,
      ringNote: "Залы нормализованы частично: Arlang, Ava, Api",
      ringCta: "Открыть залы",
      ringGo: "spaces",
      ringItems: [
        ["3 зала в базе", GREEN],
        ["Матрица вместимости подтверждена", GREEN],
        ["Net-ставки — запрошены", AMBER],
        ["Договор и комиссия — нет", RED],
      ],
      kpis: [
        ["ЗАЛОВ В БАЗЕ", sp.length || 3, "", "#fff", "Arlang 304 м², Ava 95 м², Api 42 м²"],
        ["ЗАЯВОК В РАБОТЕ", "5", "", AMBER, "Свадьбы, конференции, запуски"],
        ["СРЕДНИЙ ОТВЕТ", "—", "", "#fff", "Норматив ответа не настроен"],
        ["ГОТОВНОСТЬ", R?.score ?? 58, "/100", AMBER, "Бронь по запросу"],
      ],
      actions: [
        [
          "Прислать матрицу вместимости и net-ставки",
          "Прайс-листа в «Готовности к бронированию» нет; без него нет расчёта для организатора",
          "Залы и прайс",
          "spaces",
          "M3 21V8l9-5 9 5v13",
          RED,
        ],
        [
          "Импортировать полную матрицу залов",
          "В базе 3 зала, у курорта их больше — нужны названия, м², сетапы, AV",
          "Залы и прайс",
          "spaces",
          "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
          RED,
        ],
        [
          "Ответить на заявку на гала-ужин",
          "Arlang Ballroom, 5 августа, 19:00–23:00 · ответ ожидается",
          "Заявки",
          "inquiries",
          "M4 4h16v12H9l-5 4z",
          AMBER,
        ],
        [
          "Согласовать метод доступности",
          "Сейчас: proposal request. Нужен hold и SLA ответа",
          "Календарь",
          "calendar",
          "M3 6h18v15H3z M8 3v5 M16 3v5",
          AMBER,
        ],
      ],
      mainTitle: "Залы курорта в базе",
      mainCta: "Все залы",
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [
          x.type,
          x.sqm && `${x.sqm} м²`,
          x.capTheatre && `${x.capTheatre} театр`,
          x.capCocktail && `${x.capCocktail} коктейль`,
        ]
          .filter(Boolean)
          .join(" · "),
        value: x.sqm ? `${x.sqm} м²` : "—",
        status: String(x.bookable || "").toUpperCase(),
        color: AMBER,
      })),
      sideTitle: "ЧТО ЗАПРОШЕНО GTR",
      sideRows: [
        ["Матрица вместимости", "Полная матрица сетапов по каждому залу", "P0", RED],
        ["Net-ставки", "Нетто-ставки и партнёрские пакеты", "P0", RED],
        ["Права на фото", "Official gallery only — нужны материалы с разрешением", "P1", AMBER],
        ["AV и тех-райдер", "Свет, звук, экраны, схема подключения", "P1", AMBER],
      ].map(([title, desc, meta, color]) => ({ title, desc, meta, color })),
    };
  } else {
    const vEvCount = shared.events.filter((e) => e.venueId === vid).length;
    d = {
      kicker: "КАБИНЕТ PR-ДИРЕКТОРА",
      name: v.name,
      type: v.type,
      area: v.area,
      capacity: v.capacity,
      state: "БРОНЬ ПО ЗАПРОСУ",
      stateColor: AMBER,
      verified: `ПРОВЕРЕНО ${v.verified || ""}`,
      heroImg: rich.hero,
      heroCredit: rich.credit,
      heroBadge: rich.badge,
      ringLabel: "ГОТОВНОСТЬ К КАТАЛОГУ",
      ringValue: R?.score ?? 58,
      ringNote: [v.type, v.area, v.capacity ? `до ${v.capacity} гостей`.replace("до до", "до") : ""]
        .filter(Boolean)
        .join(" · "),
      ringCta: "Открыть паспорт",
      ringGo: "venue",
      ringItems: [
        ["Площадка и контакт верифицированы", v.verified ? GREEN : AMBER],
        ["Залы нормализованы частично", sp.length ? AMBER : RED],
        ["Прайс-лист отсутствует", RED],
        ["Договор и комиссия отсутствуют", RED],
      ],
      kpis: [
        [
          "ЗАЛОВ В БАЗЕ",
          sp.length || "—",
          "",
          "#fff",
          sp.length
            ? sp
                .map((x) => x.name)
                .slice(0, 3)
                .join(" · ")
            : "Залы не нормализованы",
        ],
        [
          "СОБЫТИЙ В КАЛЕНДАРЕ",
          vEvCount || "—",
          "",
          "#fff",
          vEvCount ? "По программе площадки" : "Пока не запланировано",
        ],
        ["ЗАЯВОК ОТ ОРГАНИЗАТОРОВ", "5", "", AMBER, "3 в статусе SLA"],
        ["ГОТОВНОСТЬ", R?.score ?? 58, "/100", AMBER, "Бронь по запросу"],
      ],
      actions: [
        [
          "Прислать матрицу вместимости и net-ставки",
          "Прайс-листа в «Готовности к бронированию» нет; без него нет расчёта для организатора",
          "Залы и прайс",
          "spaces",
          "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
          RED,
        ],
        [
          "Загрузить презентацию приватной аренды и комиссию",
          "Нет презентации, комиссии, правил промоутеров и тех-райдера в очереди исследований",
          "Финансы",
          "finance",
          "M13 3H7v18h11V8z M13 3v5h5",
          RED,
        ],
        [
          "Нормализовать залы и вместимость",
          "Данные по залам не подтверждены публично — нужны цифры от площадки",
          "Залы и прайс",
          "spaces",
          "M3 21V8l9-5 9 5v13",
          AMBER,
        ],
        [
          "Собрать программу в конструкторе",
          "Начните с площадки и добавьте артистов, подрядчиков и промо",
          "Конструктор",
          "constructor",
          "M5 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M7 8h6a3 3 0 0 1 3 3v3",
          AMBER,
        ],
      ],
      mainTitle: "Залы и техника площадки",
      mainCta: "Открыть залы",
      mainGo: "spaces",
      mainRows: sp.map((x) => ({
        title: x.name,
        desc: [
          x.type,
          x.sqm && `${x.sqm} м²`,
          x.capTheatre && `${x.capTheatre} театр`,
          x.capCocktail && `${x.capCocktail} коктейль`,
        ]
          .filter(Boolean)
          .join(" · "),
        value: x.sqm ? `${x.sqm} м²` : "—",
        status: String(x.bookable || "").toUpperCase(),
        color: AMBER,
      })),
      sideTitle: "ЧТО ЗАПРОШЕНО GTR",
      sideRows: [
        ["Матрица вместимости", "Полная матрица сетапов по каждому залу", "P0", RED],
        ["Net-ставки", "Нетто-ставки и партнёрские пакеты", "P0", RED],
        ["Права на фото", "Official gallery only — нужны материалы с разрешением", "P1", AMBER],
        ["AV и тех-райдер", "Свет, звук, экраны, схема подключения", "P1", AMBER],
      ].map(([title, desc, meta, color]) => ({ title, desc, meta, color })),
    };
  }

  const contact = vid ? CONTACT(vid) : undefined;

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
            {d.heroCredit ? ` · фото: ${d.heroCredit}` : ""}
          </div>
        </div>
      </div>

      {/* ---------- кольцо + KPI ---------- */}
      <div
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
            <Card key={label} hover style={{ padding: "16px 18px" }}>
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
                {note}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ---------- действия + сайд ---------- */}
      <div
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
            Приоритетные действия
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
                  borderRadius: 9,
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
                  title: "Залы не нормализованы",
                  desc: "Импорт залов в очереди исследований",
                  value: "—",
                  status: "ТРЕБУЕТ ДАННЫХ",
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
              {r.status ? <Chip color={r.color}>{r.status}</Chip> : null}
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}
