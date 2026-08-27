import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  AMBER,
  fmtThb,
  GREEN,
  PH,
  REGIONS,
  regionName,
  regionOf,
  RATE_COLOR,
  RATE_LABEL,
  nightOf,
  rateOf,
  RED,
  richOf,
  SPACES,
  V,
} from "../data/app-data";
import { CdmReserve, zonesOfSpace, hasReserve } from "../cdm-booking";
import { Card, Chip, Eyebrow, Field, tint, TrashTitle, VenueLogo } from "../ui";
import { VenueHero } from "../venue-hero";
import { useReveal } from "../reveal";
import { GtrLightbox } from "../lightbox";
import {
  createVenueLinkFn,
  afishaAddFn,
  afishaPosterFn,
  listAfishaFn,
  styleProfileFn,
  syncAfishaNowFn,
  venueConfirmsFn,
  venuePhotosFn,
  type StyleProfile,
  type VenueConfirm,
} from "../kv-api";
import { catOf, stickerUrl } from "../map-style";
import { posterUrl } from "../poster";
import { useVenueContacts } from "../work-contacts";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";

const confColor = (c: string) => (c === "High" ? GREEN : c === "Medium" ? AMBER : RED);
const isQuar = (x: { confidence: string; status?: string }) =>
  x.confidence === "Low" || /verify|Closed/i.test(x.status || "");

export function BaseScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useGtr();
  // Балл готовности и достоверность источника — внутренние ops-метрики
  // КОМАНДЫ GTR. Организатор — платящий клиент, а не команда: коды площадок
  // и наши оценки ему не показываем. Поэтому гейт по isTeam, а не по
  // «не гость»: разница ровно в организаторе.
  const isTeam = ["gtr", "sales", "owner", "pr"].includes(user.role);
  // География: продукт больше не равен Пхукету. Регион — верхний фильтр,
  // при его смене кластеры и теги сбрасываются: районы соседнего региона
  // здесь бессмысленны.
  const [region, setRegion] = useState("phuket");
  const pickRegion = (code: string) => {
    setRegion(code);
    setCluster(t("Все"));
    setTag(t("Все"));
  };
  const [cluster, setCluster] = useState(t("Все"));
  const [tag, setTag] = useState(t("Все"));
  const [q, setQ] = useState("");
  const [confirms, setConfirms] = useState<Record<string, VenueConfirm>>({});
  useEffect(() => {
    venueConfirmsFn().then((r) => setConfirms(r.confirms)).catch(() => {});
  }, []);

  const regionRow = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of PH.venues) c[regionOf(x)] = (c[regionOf(x)] || 0) + 1;
    // порядок реестра, не алфавит: Пхукет первым как домашний регион
    return Object.keys(REGIONS)
      .filter((code) => c[code])
      .map((code) => [code, c[code]] as [string, number]);
  }, []);
  const regionTotal = regionRow.find(([c]) => c === region)?.[1] ?? 0;

  const { clusters, tags } = useMemo(() => {
    const c: Record<string, number> = {};
    const t: Record<string, number> = {};
    for (const x of PH.venues) {
      if (regionOf(x) !== region) continue;
      c[x.cluster] = (c[x.cluster] || 0) + 1;
      t[x.tag] = (t[x.tag] || 0) + 1;
    }
    return {
      clusters: Object.entries(c).sort((a, b) => b[1] - a[1]),
      tags: Object.entries(t).sort((a, b) => b[1] - a[1]),
    };
  }, [region]);

  const rows = PH.venues
    .filter(
      (x) =>
        regionOf(x) === region &&
        !isQuar(x) &&
        (cluster === t("Все") || x.cluster === cluster) &&
        (tag === t("Все") || x.tag === tag) &&
        (!q.trim() ||
          `${x.name} ${x.area} ${x.type}`.toLowerCase().includes(q.toLowerCase().trim())),
    )
    .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));

  const FilterRow = ({
    items,
    value,
    onPick,
  }: {
    items: [string, number][];
    value: string;
    onPick: (v: string) => void;
  }) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[[t("Все"), regionTotal] as [string, number], ...items].map(([label, n]) => (
        <button
          key={label}
          onClick={() => onPick(label)}
          style={{
            border: `1px solid ${value === label ? "#E5231B" : "rgba(255,255,255,.12)"}`,
            background: value === label ? "#E5231B" : "transparent",
            color: value === label ? "#fff" : "rgba(255,255,255,.6)",
            borderRadius: 0,
            padding: "7px 11px",
            cursor: "pointer",
            font: `${value === label ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
          }}
        >
          {label} · {n}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h1 className="gtr-oswald gtr-h1">
          {t("Площадки")} · {regionName(region, i18n.language)}
        </h1>
        <span
          className="gtr-mono"
          style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {rows.length} / {regionTotal} · {t("обновлено")} {PH.meta.updated}
        </span>
      </div>
      {regionRow.length > 1 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 2px" }}>
          {regionRow.map(([code, n]) => (
            <button
              key={code}
              onClick={() => pickRegion(code)}
              style={{
                border: `1px solid ${region === code ? "#E5231B" : "rgba(255,255,255,.2)"}`,
                background: region === code ? "rgba(229,35,27,.14)" : "transparent",
                color: region === code ? "#fff" : "rgba(255,255,255,.72)",
                borderRadius: 0,
                padding: "8px 13px",
                cursor: "pointer",
                font: `${region === code ? 700 : 600} 12px/1 'Golos Text',sans-serif`,
                letterSpacing: ".02em",
              }}
            >
              {regionName(code, i18n.language)} · {n}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ margin: "12px 0 8px" }}>
        <FilterRow items={clusters} value={cluster} onPick={setCluster} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <FilterRow items={tags} value={tag} onPick={setTag} />
      </div>
      <input
        className="gtr-input"
        style={{ maxWidth: 300, marginBottom: 16 }}
        placeholder={t("Поиск по названию и району…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 14,
        }}
      >
        {rows.map((x) => {
          const hero = richOf(x.id).hero;
          const cat = catOf(x.tag);
          const initials = x.name
            .split(/\s+/)
            .filter((w) => /^[A-Za-zА-Яа-я]/.test(w))
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase();
          return (
          <Card
            key={x.id}
            hover
            style={{ padding: 0, overflow: "hidden" }}
            onClick={() =>
              navigate({
                to: "/gtr/$screen",
                params: { screen: "venueCard" },
                search: { vid: x.id },
              })
            }
          >
            {/* фото заведения; фолбэк-плашка всегда под ним — если фото нет
                или не загрузилось, карточка остаётся фирменной, не «битой».
                Плашка не нейтральная, а в цвете категории со знаком с карты:
                когда фото нет у целого региона, список должен читаться как
                живой каталог — пляжные клубы, крыши, клубы, — а не как
                колонка одинаковых серых прямоугольников. */}
            <div className="gtr-venue-shot">
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `repeating-linear-gradient(135deg, rgba(255,255,255,.028) 0 2px, transparent 2px 9px), radial-gradient(120% 90% at 18% 12%, ${tint(cat.color, 0.17)} 0%, transparent 62%), linear-gradient(160deg, #17181C 0%, #0C0D10 100%)`,
                }}
              >
                {!hero ? (
                  <img
                    src={stickerUrl(cat.sticker)}
                    alt=""
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 16,
                      top: "50%",
                      width: 78,
                      height: 78,
                      transform: "translateY(-58%)",
                      opacity: 0.5,
                      filter: "saturate(.85)",
                      pointerEvents: "none",
                    }}
                  />
                ) : null}
                {/* Инициалы — водяной знак кадра, а не подпись: на высокой
                    карточке они держат центр, где у соседей стоит фото. */}
                <span
                  className="gtr-oswald"
                  style={{
                    position: "absolute",
                    right: 16,
                    top: "50%",
                    transform: "translateY(-62%)",
                    font: "700 76px/1 Oswald,sans-serif",
                    color: "rgba(255,255,255,.06)",
                    letterSpacing: ".04em",
                    userSelect: "none",
                  }}
                >
                  {initials}
                </span>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 3,
                    height: "100%",
                    background: "linear-gradient(180deg,#E5231B,transparent 80%)",
                    opacity: 0.7,
                  }}
                />
              </div>
              {hero ? (
                <img
                  src={hero}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    filter: "saturate(.9) contrast(1.02)",
                  }}
                />
              ) : null}
              {/* Затемнение и подпись — общие для снимка и фолбэка: имя
                  площадки на кадре читается одинаково в обоих случаях. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(10,11,13,.5) 0%, rgba(10,11,13,.1) 20%, rgba(10,11,13,0) 42%, rgba(10,11,13,.6) 72%, rgba(10,11,13,.95) 100%)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  bottom: 12,
                  zIndex: 2,
                  pointerEvents: "none",
                }}
              >
                <span
                  className="gtr-mono"
                  style={{
                    display: "block",
                    marginBottom: 5,
                    font: "600 10px/1 'JetBrains Mono',monospace",
                    color: "rgba(255,255,255,.6)",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                  }}
                >
                  {x.tag}
                </span>
                <span
                  className="gtr-oswald"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    font: "700 19px/1.08 Oswald,sans-serif",
                    letterSpacing: ".005em",
                    textTransform: "uppercase",
                    color: "#fff",
                    textShadow: "0 1px 12px rgba(0,0,0,.55)",
                  }}
                >
                  {x.name}
                </span>
              </div>
              {/* Настоящий знак заведения поверх снимка — карточка сразу
                  читается как его карточка, а не как наша плашка. */}
              <VenueLogo
                vid={x.id}
                h={22}
                style={{ position: "absolute", left: 12, top: 10, zIndex: 2 }}
              />
              {isTeam && x.readiness ? (
                <span
                  className="gtr-mono"
                  style={{
                    position: "absolute",
                    top: 9,
                    right: 9,
                    font: "700 13px/1 'JetBrains Mono',monospace",
                    padding: "4px 7px",
                    background: "rgba(10,11,13,.72)",
                    backdropFilter: "blur(3px)",
                    color:
                      x.readiness.score >= 70
                        ? GREEN
                        : x.readiness.score >= 55
                          ? AMBER
                          : "rgba(255,255,255,.5)",
                  }}
                >
                  {x.readiness.score}
                </span>
              ) : null}
            </div>
            <div style={{ padding: "12px 15px 14px" }}>
              <div
                style={{
                  marginBottom: 10,
                  font: "500 12.5px/1.45 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                {x.type} · {x.area}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* Достоверность источника — только команде GTR. Клиенту
                    (организатор) и гостю на карточке остаётся «бронируемая»
                    и «прайс подтверждён» — это про них, а не про нашу
                    кухню оценки площадок. */}
                {isTeam ? (
                  <Chip color={confColor(x.confidence)}>{(x.confidence ?? "—").toUpperCase()}</Chip>
                ) : null}
                {x.readiness?.state === "Бронируемая" ? (
                  <Chip color={GREEN}>{t("БРОНИРУЕМАЯ")}</Chip>
                ) : null}
                {confirms[x.id]?.status === "confirmed" ? (
                  <Chip color={GREEN}>{t("✓ ПРАЙС ПОДТВЕРЖДЁН")}</Chip>
                ) : null}
              </div>
            </div>
          </Card>
          );
        })}
      </div>
    </div>
  );
}

export function VenueCardScreen({ vid }: { vid?: string }) {
  const { t } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const v = vid ? V(vid) : undefined;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<VenueConfirm | null>(null);
  const [vphotos, setVphotos] = useState<string[]>([]);
  const [vpLightbox, setVpLightbox] = useState<number | null>(null);
  useEffect(() => {
    if (!vid) return;
    venueConfirmsFn()
      .then((r) => setConfirm(r.confirms[vid] ?? null))
      .catch(() => {});
    venuePhotosFn({ data: { vid } })
      .then((r) => setVphotos(r.photos))
      .catch(() => {});
  }, [vid]);
  if (!v?.id)
    return (
      <div
        className="gtr-mono"
        style={{ padding: 60, textAlign: "center", color: "var(--gtr-t3)" }}
      >
        {t("Площадка не найдена.")}{" "}
        <button
          className="gtr-btn"
          onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
        >
          {t("К базе")}
        </button>
      </div>
    );

  const venueContact = useVenueContacts();
  const rich = richOf(v.id);
  const night = nightOf(v.id);
  const sp = SPACES(v.id);
  const rate = rateOf(v.id);
  const ct = venueContact(v.id);
  const R = v.readiness;
  // Публичной аудитории (артисты, посетители) — витрина без коммерции:
  // прайсы и «собрать событие здесь» им не нужны. Организатор — клиент:
  // цену аренды и конструктор события видит, а вот наши ops-метрики,
  // коды площадок и провенанс исследования — нет. Для этого два уровня:
  // commercial (не гость) и isTeam (только команда GTR).
  const commercial = !["artist", "visitor"].includes(user.role);
  const isTeam = ["gtr", "sales", "owner", "pr"].includes(user.role);
  // Подтверждённые площадкой значения важнее наших оценок
  const cRate = confirm?.status === "confirmed" ? (confirm.rate ?? null) : null;

  // Блоки паспорта проявляются по мере прокрутки. Пересобираем наблюдение,
  // когда доезжают данные: карточки афиши и фото приходят асинхронно и
  // появляются в дереве уже после первого прохода.
  const revealRef = useReveal<HTMLDivElement>([v.id, vphotos.length]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }} ref={revealRef}>
      <button
        className="gtr-btn"
        style={{ marginBottom: 14 }}
        onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
      >
        {t("← К базе Пхукета")}
      </button>

      <VenueHero
        vid={v.id}
        name={v.name}
        video={rich.video}
        poster={rich.hero}
        // Наплыв идёт по кадрам самой площадки: сначала загруженные ею,
        // потом наша галерея — паспорт дышит даже без видео.
        shots={[...vphotos, ...(rich.gallery ?? [])]}
      >
        <div style={{ position: "relative" }}>
          <Eyebrow>
            {/* Внутренний id площадки — только команде. Гостю показываем
                район, а не «VEN-0061»: это наш служебный код, не его дело. */}
            {isTeam ? `${v.id} · ` : ""}
            {(v.cluster ?? v.area ?? "").toUpperCase()}
          </Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            {/* Знак идёт перед именем: в паспорте это первое, по чему
                площадку узнают, а набранное имя — уже подпись под ним. */}
            <VenueLogo vid={v.id} h={34} />
            <TrashTitle text={v.name} size={29} />
            {/* «Достоверность источника» и «готовность к бронированию» —
                наши внутренние ops-метрики: по ним видно, что мы скрейпим
                и оцениваем площадки. Ни гостю, ни клиенту-организатору это
                знать незачем. Им остаётся «подтверждено площадкой» — знак
                доверия, а не кухня. Только команде GTR. */}
            {isTeam ? (
              <>
                <Chip color={confColor(v.confidence)}>{t("ДОСТОВЕРНОСТЬ:")} {(v.confidence ?? "—").toUpperCase()}</Chip>
                {R ? (
                  <Chip color={R.state === "Бронируемая" ? GREEN : AMBER}>{R.state.toUpperCase()}</Chip>
                ) : null}
              </>
            ) : null}
            {confirm?.status === "confirmed" ? (
              <Chip color={GREEN}>{t("✓ ПОДТВЕРЖДЕНО ПЛОЩАДКОЙ")}</Chip>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 9,
              font: "500 12px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {v.type} · {v.area} · {v.district}
          </div>
          <div
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}
          >
            {commercial ? (
              <button
                className="gtr-btn gtr-btn-red"
                onClick={() =>
                  navigate({
                    to: "/gtr/$screen",
                    params: { screen: "events" },
                    search: { vid: v.id },
                  })
                }
              >
                {t("Собрать событие здесь →")}
              </button>
            ) : (
              <button
                className="gtr-btn gtr-btn-red"
                onClick={() =>
                  navigate({
                    to: "/gtr/$screen",
                    params: { screen: "promo" },
                    search: { vid: v.id },
                  })
                }
              >
                {t("Забронировать стол →")}
              </button>
            )}
            {commercial && cRate?.amount ? (
              <span
                className="gtr-mono"
                style={{ font: "700 12px/1 'JetBrains Mono',monospace", color: GREEN }}
              >
                {t("аренда")} {fmtThb(cRate.amount)} / {cRate.unit} {t("· подтверждено площадкой")}
              </span>
            ) : commercial && rate ? (
              <span
                className="gtr-mono"
                style={{
                  font: "700 12px/1 'JetBrains Mono',monospace",
                  color: RATE_COLOR[rate.kind],
                }}
              >
                {rate.amount
                  ? `аренда ${fmtThb(rate.amount)} / ${rate.unit}`
                  : "аренда по запросу"}
              </span>
            ) : null}
          </div>
          {rich.credit ? (
            <div
              className="gtr-mono"
              style={{
                marginTop: 6,
                font: "500 11px/1.45 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              {t("фото:")} {rich.credit}
            </div>
          ) : null}
        </div>
      </VenueHero>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}
      >
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {/* Гостю первым делом нужно не «нормализованные залы», а ответ
              на вопрос «что я тут буду делать». Витрина отдыха идёт до
              паспорта и говорит человеческим языком. */}
          {!commercial ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("ЧЕМ ЗАНЯТЬСЯ ЗДЕСЬ")}</Eyebrow>
              <div style={{ font: "500 12.5px/1.65 'Golos Text',sans-serif", color: "var(--gtr-t1)" }}>
                {v.concept || v.events || v.facilities}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                {(
                  [
                    [t("ЧАСЫ"), night.hours || t("уточняем")],
                    [t("ВХОД"), night.entry || t("по ситуации")],
                    [t("ЛУЧШИЕ ВЕЧЕРА"), night.best || t("смотри афишу")],
                    [t("ЗВУК"), v.music],
                  ] as [string, string | undefined][]
                )
                  .filter(([, val]) => val)
                  .map(([k, val]) => (
                    <div key={k} style={{ border: "1px solid rgba(255,255,255,.08)", padding: "9px 11px" }}>
                      <div
                        className="gtr-mono"
                        style={{
                          font: "600 10px/1 'JetBrains Mono',monospace",
                          letterSpacing: ".12em",
                          color: "var(--gtr-t3)",
                        }}
                      >
                        {t(k)}
                      </div>
                      <div style={{ marginTop: 5, font: "600 13px/1.45 'Golos Text',sans-serif" }}>
                        {t(String(val))}
                      </div>
                    </div>
                  ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  className="gtr-btn gtr-btn-red"
                  onClick={() =>
                    hasReserve(v.id)
                      ? document
                          .getElementById("gtr-reserve")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      : // Площадку передаём с собой: без vid форма брони
                        // открывалась на своей стартовой, а не на той, из
                        // которой гость нажал «Забронировать стол».
                        navigate({
                          to: "/gtr/$screen",
                          params: { screen: "promo" },
                          search: { vid: v.id },
                        })
                  }
                >
                  {t("Забронировать стол")}
                </button>
                {hasReserve(v.id) ? (
                  <button
                    className="gtr-btn"
                    onClick={() =>
                      document
                        .getElementById("gtr-reserve")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    {t("Посмотреть меню")}
                  </button>
                ) : null}
                <button
                  className="gtr-btn"
                  onClick={() =>
                    navigate({
                      to: "/gtr/$screen",
                      params: { screen: "tonight" },
                      search: { vid: v.id },
                    })
                  }
                >
                  {t("Что здесь сегодня")}
                </button>
              </div>
              <div
                className="gtr-mono"
                style={{
                  marginTop: 10,
                  font: "500 11px/1.5 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {t("Не решил — спроси GTR BRO кнопкой снизу: подберёт стол, расскажет про артистов и вызовет такси.")}
              </div>
            </Card>
          ) : null}

          <Card reveal style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 10 }}>{t("ПРОФИЛЬ ПЛОЩАДКИ")}</Eyebrow>
            {[
              [t("КОНЦЕПЦИЯ"), v.concept],
              [t("ФОРМАТЫ СОБЫТИЙ"), v.events],
              [t("ИНФРАСТРУКТУРА"), v.facilities],
              [
                t("ВМЕСТИМОСТЬ"),
                confirm?.status === "confirmed" && confirm.capacity
                  ? `${confirm.capacity} · подтверждено площадкой`
                  : v.capacity,
              ],
              [t("МУЗЫКА"), v.music],
              [t("КЕЙТЕРИНГ"), v.catering],
              [t("ЗАМЕТКИ"), v.notes],
            ]
              .filter(([, val]) => val)
              .map(([k, val]) => (
                <Field key={k} k={k} v={String(val)} />
              ))}
          </Card>

          {night.hours || night.entry || night.best || night.fact ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("НОЧНАЯ ЖИЗНЬ")}</Eyebrow>
              {(
                [
                  [t("ЧАСЫ"), night.hours],
                  [t("ВХОД"), night.entry],
                  [t("ЛУЧШИЕ ВЕЧЕРА"), night.best],
                  [t("МУЗЫКА ПО ГАЙДАМ"), night.music],
                ] as [string, string | undefined][]
              )
                .filter(([, val]) => val)
                .map(([k, val]) => (
                  <Field key={k} k={t(k)} v={t(String(val))} />
                ))}
              {night.fact ? (
                <div
                  style={{
                    marginTop: 8,
                    font: "500 13px/1.6 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {t(night.fact)}
                </div>
              ) : null}
              {night.src ? (
                <div
                  className="gtr-mono"
                  style={{
                    marginTop: 7,
                    font: "500 11px/1.5 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                    textTransform: "uppercase",
                  }}
                >
                  {t("ИСТОЧНИК")}: {night.src}
                </div>
              ) : null}
            </Card>
          ) : null}

          {sp.length ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("НОРМАЛИЗОВАННЫЕ ЗАЛЫ ·")} {sp.length}</Eyebrow>
              {sp.map((s) => {
                const zs = zonesOfSpace(v.id, s.id);
                return (
                  <div
                    key={s.id}
                    style={{ padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ flex: 1, font: "600 12px/1.45 'Golos Text',sans-serif" }}>
                        {s.name}
                      </span>
                      <span
                        className="gtr-mono"
                        style={{
                          font: "500 12px/1.45 'JetBrains Mono',monospace",
                          color: "var(--gtr-t3)",
                        }}
                      >
                        {[
                          s.sqm && `${s.sqm} м²`,
                          s.capTheatre && `${s.capTheatre} театр`,
                          s.capCocktail && `${s.capCocktail} коктейль`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || (zs.length ? zs.map((z) => z.hours).join(" · ") : "—")}
                      </span>
                    </div>
                    {zs.length ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                        {zs.map((z) => (
                          <figure key={z.id} style={{ margin: 0, width: 132 }}>
                            <img
                              src={z.photo}
                              alt={z.name}
                              loading="lazy"
                              style={{
                                width: "100%",
                                aspectRatio: "16/10",
                                objectFit: "cover",
                                display: "block",
                                border: "1px solid rgba(255,255,255,.1)",
                              }}
                            />
                            <figcaption
                              className="gtr-mono"
                              style={{
                                marginTop: 3,
                                font: "500 10px/1.45 'JetBrains Mono',monospace",
                                color: "var(--gtr-t3)",
                                textTransform: "uppercase",
                                letterSpacing: ".08em",
                              }}
                            >
                              {z.name}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          ) : null}

          {hasReserve(v.id) ? (
            <Card id="gtr-reserve" style={{ padding: 18 }}>
              {/* «SEVENROOMS-паритет» — наша внутренняя формулировка про то,
                  что схема брони не хуже, чем у сервиса рассадки. Гостю это
                  ничего не говорит; ему — «Рассадка и бронь». Как именно
                  заявка доходит до площадки (наш Telegram-контур) — тоже
                  кухня, гостю важно «площадка свяжется и подтвердит». */}
              <Eyebrow style={{ marginBottom: 4 }}>{t("РАССАДКА И БРОНЬ")}</Eyebrow>
              <div
                style={{
                  margin: "0 0 12px",
                  font: "500 13px/1.6 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                {isTeam
                  ? t("Живая схема зон и столов площадки: депозиты, кредит на еду и напитки, предзаказ по официальному меню. Заявка уходит менеджеру в Telegram, подтверждение — одной кнопкой.")
                  : t("Выберите зону и стол, дату и гостей, при желании — предзаказ по меню. Площадка свяжется с вами и подтвердит бронь.")}
              </div>
              <CdmReserve vid={v.id} />
            </Card>
          ) : null}

          {rich.gallery?.length ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("ОФИЦИАЛЬНАЯ ГАЛЕРЕЯ")}</Eyebrow>
              <div
                className="gtr-gallery"
                style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}
              >
                {rich.gallery.slice(0, 8).map((src, gi) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    onClick={() => setLightbox(gi)}
                    style={{
                      width: "100%",
                      aspectRatio: "3/2",
                      objectFit: "cover",
                      borderRadius: 0,
                      border: "1px solid rgba(255,255,255,.08)",
                      cursor: "zoom-in",
                    }}
                  />
                ))}
              </div>
              {lightbox !== null ? (
                <GtrLightbox
                  images={rich.gallery}
                  index={lightbox}
                  credit={rich.credit}
                  onClose={() => setLightbox(null)}
                />
              ) : null}
            </Card>
          ) : null}

          {vphotos.length ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>
                {t("ФОТО ОТ ПЛОЩАДКИ")} · {vphotos.length}
              </Eyebrow>
              <div
                className="gtr-gallery"
                style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}
              >
                {vphotos.map((src, gi) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    onClick={() => setVpLightbox(gi)}
                    style={{
                      width: "100%",
                      aspectRatio: "3/2",
                      objectFit: "cover",
                      borderRadius: 0,
                      border: "1px solid rgba(46,204,113,.25)",
                      cursor: "zoom-in",
                    }}
                  />
                ))}
              </div>
              {vpLightbox !== null ? (
                <GtrLightbox
                  images={vphotos}
                  index={vpLightbox}
                  credit="Фото загружены площадкой"
                  onClose={() => setVpLightbox(null)}
                />
              ) : null}
            </Card>
          ) : null}

          <AfishaBlock vid={v.id} />
        </div>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <VenueLinkBlock vid={v.id} confirm={confirm} />
          <Card reveal style={{ padding: 18 }}>
            {commercial && (cRate || rate) ? (
              <div
                style={{
                  marginBottom: 14,
                  padding: "10px 12px",
                  border: `1px solid ${tint(cRate ? GREEN : RATE_COLOR[rate!.kind], 0.4)}`,
                  borderLeft: `3px solid ${cRate ? GREEN : RATE_COLOR[rate!.kind]}`,
                  background: tint(cRate ? GREEN : RATE_COLOR[rate!.kind], 0.07),
                }}
              >
                <Eyebrow style={{ marginBottom: 6 }}>{t("АРЕНДА")}</Eyebrow>
                <div
                  className="gtr-mono"
                  style={{ font: "700 16px/1 'JetBrains Mono',monospace", color: "#fff" }}
                >
                  {cRate
                    ? `${fmtThb(cRate.amount)} / ${cRate.unit}`
                    : rate!.amount
                      ? `${fmtThb(rate!.amount)} / ${rate!.unit}`
                      : "по запросу"}
                </div>
                <div
                  className="gtr-mono"
                  style={{
                    marginTop: 6,
                    font: "600 11px/1.5 'JetBrains Mono',monospace",
                    color: cRate ? GREEN : RATE_COLOR[rate!.kind],
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                  }}
                >
                  {cRate
                    ? `Подтверждено площадкой${
                        confirm?.confirmedAt
                          ? " · " + new Date(confirm.confirmedAt).toLocaleDateString("ru-RU")
                          : ""
                      }`
                    : RATE_LABEL[rate!.kind]}
                </div>
                {(cRate ? cRate.covers : rate!.covers) ? (
                  <div
                    style={{
                      marginTop: 5,
                      font: "500 12px/1.5 'Golos Text',sans-serif",
                      color: "var(--gtr-t2)",
                    }}
                  >
                    {cRate ? cRate.covers : rate!.covers}
                  </div>
                ) : null}
                {confirm?.status === "confirmed" && confirm.contact ? (
                  <div
                    className="gtr-mono"
                    style={{
                      marginTop: 7,
                      font: "500 12px/1.5 'JetBrains Mono',monospace",
                      color: "var(--gtr-t2)",
                    }}
                  >
                    {confirm.contact.name}
                    {confirm.contact.role ? ` · ${confirm.contact.role}` : ""} ·{" "}
                    {confirm.contact.phone}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Источники, провенанс и рабочие контакты площадки — только
                команде GTR. Организатору эта карточка ни к чему: сырой
                URL исследования, тип источника и «верифицировано» — наша
                кухня. Официальный сайт площадки он видит в блоке ссылок выше. */}
            {isTeam ? (<>
            <Eyebrow style={{ marginBottom: 10 }}>{t("ИСТОЧНИКИ И КОНТАКТ")}</Eyebrow>
            {[
              [
                "Официальный сайт",
                (() => {
                  const u = v.website || v.source;
                  return u ? (
                    <a
                      href={u.startsWith("http") ? u : `https://${u}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit" }}
                    >
                      {u}
                    </a>
                  ) : (
                    "—"
                  );
                })(),
                v.website || v.source ? GREEN : RED,
              ],
              ["Instagram", v.social || "не указан", v.social ? AMBER : "rgba(255,255,255,.3)"],
              [
                "Telegram",
                v.telegram ? (
                  <a href={v.telegram} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                    {v.telegram.replace(/^https:\/\/t\.me\//, "@")}
                  </a>
                ) : (
                  "не указан"
                ),
                v.telegram ? GREEN : "rgba(255,255,255,.3)",
              ],
              [
                "Телефон",
                (() => {
                  const t = v.phone || ct?.phone;
                  return t ? (
                    <a href={`tel:${String(t).replace(/[^+\d]/g, "")}`} style={{ color: "inherit" }}>
                      {t}
                    </a>
                  ) : (
                    "—"
                  );
                })(),
                v.phone || ct?.phone ? GREEN : RED,
              ],
              [
                "Email",
                v.email || ct?.email || "—",
                v.email || ct?.email ? GREEN : "rgba(255,255,255,.3)",
              ],
              ["Тип источника", v.sourceType, GREEN],
              ["Верифицировано", v.verified || "—", v.verified ? GREEN : RED],
            ].map(([k, val, c]) => (
              <Field
                key={String(k)}
                mono
                k={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 8, height: 8, flex: "none", background: String(c) }} />
                    {k}
                  </span>
                }
                v={val}
              />
            ))}
            </>) : null}
          </Card>

          {isTeam && R ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>
                {t("ГОТОВНОСТЬ К БРОНИРОВАНИЮ ·")} {R.score}/100
              </Eyebrow>
              {[
                ["Прайс-лист", R.rate, /Missing/i.test(R.rate) ? RED : GREEN],
                ["Доступность", R.avail, /Manual|enquiry|Proposal/i.test(R.avail) ? AMBER : GREEN],
                ["Договор", R.contract, /Missing/i.test(R.contract) ? RED : GREEN],
                ["Оплата", R.payment, /Missing/i.test(R.payment) ? RED : GREEN],
                ["Права на фото", R.photo, AMBER],
                ["Райдер", R.rider, /Published/i.test(R.rider) ? GREEN : AMBER],
                [
                  "Контакт подтверждён",
                  R.contactVerified,
                  R.contactVerified === "Yes" ? GREEN : AMBER,
                ],
              ].map(([k, val, c]) => (
                <div
                  key={String(k)}
                  style={{
                    display: "flex",
                    gap: 9,
                    padding: "7px 0",
                    alignItems: "baseline",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      flex: "none",
                      background: String(c),
                      boxShadow: `0 0 6px -1px ${String(c)}`,
                    }}
                  />
                  <span style={{ flex: 1, font: "500 13px/1.5 'Golos Text',sans-serif" }}>
                    {k}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 12px/1.5 'JetBrains Mono',monospace",
                      color: String(c),
                      textAlign: "right",
                      maxWidth: "46%",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {String(val)}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}

          {rich.afisha?.length ? (
            <Card reveal style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("ОФИЦИАЛЬНАЯ АФИША")}</Eyebrow>
              <div style={{ display: "grid", gap: 8 }}>
                {rich.afisha.map(([date, title, meta]) => (
                  <div
                    key={title + date}
                    style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                  >
                    <span
                      className="gtr-mono"
                      style={{
                        font: "700 12px/1.45 'JetBrains Mono',monospace",
                        color: "#E5231B",
                        width: 46,
                        flex: "none",
                      }}
                    >
                      {date}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span
                        style={{ display: "block", font: "600 13px/1.45 'Golos Text',sans-serif" }}
                      >
                        {title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "500 11px/1.5 'JetBrains Mono',monospace",
                          color: "var(--gtr-t3)",
                        }}
                      >
                        {meta}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Афиша площадки: события с официальных источников ----------
type AfishaEvent = {
  id: string;
  title: string;
  dateIso: string;
  poster?: string;
  url: string;
  room?: string;
  artistIds: string[];
  source: string;
};

function AfishaBlock({ vid }: { vid: string }) {
  const { t } = useTranslation();
  const { user } = useGtr();
  const navigate = useNavigate();
  const [data, setData] = useState<{ events: AfishaEvent[]; syncedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<StyleProfile | null>(null);
  // ручное добавление события командой (площадки без RA/FB/сайта)
  const [mTitle, setMTitle] = useState("");
  const [mDate, setMDate] = useState("");
  const [mNote, setMNote] = useState("");
  // Постер руками: команда — по любой площадке, кабинет площадки — по своей.
  // Ключ картинки один и тот же, поэтому загруженная афиша встаёт на место
  // добытой разведкой без отдельной ветки в интерфейсе.
  const canPoster = user.role === "gtr" || (user.role === "venue" && user.venueId === vid);
  const [pBusy, setPBusy] = useState("");
  // счётчик обновлений постера — ломает кэш <img> после загрузки
  const [pRev, setPRev] = useState<Record<string, number>>({});
  const uploadPoster = async (id: string, file: File | null) => {
    if (!file) return;
    setPBusy(id);
    try {
      const { shrinkPoster } = await import("../poster-upload");
      const dataUrl = await shrinkPoster(file);
      const r = await afishaPosterFn({ data: { vid, id, dataUrl } });
      if (r.ok) setPRev((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
      else setMNote(String(r.reason));
    } catch {
      setMNote(t("Не получилось прочитать картинку"));
    } finally {
      setPBusy("");
      setTimeout(() => setMNote(""), 3000);
    }
  };
  useEffect(() => {
    styleProfileFn({ data: { vid } })
      .then((r) => setStyle(r.profile))
      .catch(() => {});
  }, [vid]);
  const load = () =>
    listAfishaFn({ data: { vid } })
      .then((r) => setData(r as { events: AfishaEvent[]; syncedAt: number }))
      .catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (data?.events ?? []).filter((e) => e.dateIso >= today).slice(0, 8);
  if (!upcoming.length && user.role !== "gtr") return null;

  return (
    <Card reveal style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Eyebrow>{t("АФИША")}</Eyebrow>
        {data?.syncedAt ? (
          <span
            className="gtr-mono"
            style={{ font: "500 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
          >
            {t("обновлено")} {new Date(data.syncedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
        {style?.colors.length ? (
          <span
            title={`Стиль площадки · корпус ${style.posters} афиш`}
            style={{ display: "flex", gap: 3, alignItems: "center" }}
          >
            {style.colors.slice(0, 6).map((c) => (
              <span key={c} style={{ width: 9, height: 9, background: c }} />
            ))}
          </span>
        ) : null}
        {user.role === "gtr" ? (
          <button
            className="gtr-btn gtr-btn-sm"
            style={{ marginLeft: "auto", opacity: busy ? 0.5 : 1 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await syncAfishaNowFn();
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Собираю…" : "⟳ Обновить"}
          </button>
        ) : null}
      </div>
      {user.role === "gtr" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            className="gtr-input"
            style={{ flex: "1 1 180px" }}
            placeholder={t("Название события")}
            value={mTitle}
            onChange={(e) => setMTitle(e.target.value)}
          />
          <input
            className="gtr-input"
            type="date"
            style={{ width: 150 }}
            value={mDate}
            onChange={(e) => setMDate(e.target.value)}
          />
          <button
            className="gtr-btn gtr-btn-sm"
            onClick={async () => {
              const r = await afishaAddFn({ data: { vid, title: mTitle, dateIso: mDate } }).catch(() => null);
              if (r?.ok) {
                setMTitle("");
                setMNote("✓ добавлено");
                await load();
              } else setMNote(r && "reason" in r ? String(r.reason) : "ошибка");
              setTimeout(() => setMNote(""), 3000);
            }}
          >
            {t("+ Добавить")}
          </button>
          {mNote ? (
            <span className="gtr-mono" style={{ font: "500 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
              {mNote}
            </span>
          ) : null}
        </div>
      ) : null}
      {upcoming.length ? (
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}
        >
          {upcoming.map((e) => (
            // Кнопка загрузки афиши лежит СНАРУЖИ ссылки: внутри неё тап по
            // «выбрать файл» открывал бы заодно сайт площадки в новой вкладке.
            <div key={e.id} style={{ position: "relative", display: "flex" }}>
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid rgba(255,255,255,.09)",
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
              }}
            >
              <img
                src={`${posterUrl(vid, e.id)}${pRev[e.id] ? `&r=${pRev[e.id]}` : ""}`}
                alt=""
                loading="lazy"
                style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", background: "#101116" }}
              />
              <span style={{ padding: "8px 10px", display: "grid", gap: 3 }}>
                <span
                  className="gtr-mono"
                  style={{ font: "700 11px/1 'JetBrains Mono',monospace", color: "#FF3427" }}
                >
                  {e.dateIso.slice(5).split("-").reverse().join(".")}
                  {e.room ? ` · ${e.room.toUpperCase()}` : ""}
                </span>
                <span style={{ font: "600 13px/1.45 'Golos Text',sans-serif", color: "#fff" }}>
                  {e.title}
                </span>
                {e.artistIds.length ? (
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {e.artistIds.map((id) => (
                      <button
                        key={id}
                        className="gtr-mono"
                        style={{
                          font: "600 10px/1 'JetBrains Mono',monospace",
                          color: "#2ECC71",
                          border: "1px solid rgba(46,204,113,.4)",
                          background: "transparent",
                          padding: "3px 6px",
                          cursor: "pointer",
                        }}
                        onClick={(ev) => {
                          ev.preventDefault();
                          navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: id } });
                        }}
                      >
                        {t("НАШ АРТИСТ ↗")}
                      </button>
                    ))}
                  </span>
                ) : null}
              </span>
            </a>
            {canPoster ? (
              <label
                className="gtr-mono"
                title={t("Загрузить афишу события")}
                style={{
                  position: "absolute",
                  right: 6,
                  top: 6,
                  font: "700 10px/1 'JetBrains Mono',monospace",
                  letterSpacing: ".08em",
                  padding: "5px 7px",
                  background: "rgba(10,11,13,.82)",
                  border: "1px solid rgba(255,255,255,.22)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {pBusy === e.id ? "…" : t("АФИША")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(ev) => uploadPoster(e.id, ev.target.files?.[0] ?? null)}
                />
              </label>
            ) : null}
            </div>
          ))}
        </div>
      ) : (
        <span style={{ font: "500 13px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          {t("Источник этой площадки ещё не подключён — собираем Café del Mar и Illuzion, дальше расширяем.")}
        </span>
      )}
    </Card>
  );
}

// Ссылка подтверждения для менеджера площадки: команда создаёт, копирует
// и шлёт в WhatsApp/Telegram. Статус показывает путь: отправлено → открыто
// → подтверждено.
function VenueLinkBlock({ vid, confirm }: { vid: string; confirm: VenueConfirm | null }) {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pitchLang, setPitchLang] = useState("ru");
  if (user.role !== "gtr" && user.role !== "sales") return null;
  const st = confirm?.status;
  const make = async () => {
    setBusy(true);
    try {
      const r = await createVenueLinkFn({ data: { vid } });
      if (r.ok) {
        const url = `${window.location.origin}/gtr/v?t=${r.token}`;
        setLink(url);
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // буфер недоступен (http/старый браузер) — ссылка видна текстом
        }
      }
    } finally {
      setBusy(false);
    }
  };
  // Текст приглашения — не «подтвердите данные», а ответ на вопрос
  // «зачем мне это». Площадка получает поток гостей и заявок, анкета —
  // цена входа, и она две минуты. Три языка: тайский менеджер и
  // европейский управляющий читают разные письма.
  const venueName = V(vid)?.name ?? "";
  const PITCH: Record<string, string> = {
    ru: `Здравствуйте! GTR Event — приложение о ночной жизни Таиланда: афиша, бронь столов и подбор вечеринок под вкус гостя. ${venueName} уже в нашей базе — гости видят вас на карте и в афише.\n\nЧтобы карточка была живой и к вам шли брони, подтвердите данные (2 минуты): вместимость, условия и контакт. После этого откроем вам кабинет площадки — своя афиша, заявки и брони в одном месте.\n\n${link}`,
    en: `Hello! GTR Event is a Thailand nightlife app: what's on tonight, table booking and taste-based party matching. ${venueName} is already in our database — guests see you on the map and in the lineup.\n\nTo keep your card live and start receiving bookings, please confirm your details (2 minutes): capacity, terms and a contact. After that we open your venue cabinet — your own lineup, requests and bookings in one place.\n\n${link}`,
    th: `สวัสดีครับ/ค่ะ! GTR Event คือแอปไนต์ไลฟ์ประเทศไทย — อีเวนต์คืนนี้ จองโต๊ะ และจับคู่ปาร์ตี้ตามรสนิยม ${venueName} อยู่ในฐานข้อมูลของเราแล้ว ลูกค้าเห็นคุณบนแผนที่และในโปรแกรม\n\nกรุณายืนยันข้อมูล (2 นาที): ความจุ เงื่อนไข และผู้ติดต่อ จากนั้นเราจะเปิดระบบจัดการสถานที่ให้คุณ — โปรแกรมของคุณเอง คำขอ และการจอง ในที่เดียว\n\n${link}`,
  };
  const pitch = PITCH[pitchLang] ?? PITCH.ru;
  const waText = encodeURIComponent(pitch);
  return (
    <Card reveal style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Eyebrow>{t("ПОДТВЕРЖДЕНИЕ ПЛОЩАДКОЙ")}</Eyebrow>
        {st ? (
          <Chip
            color={st === "confirmed" ? GREEN : st === "opened" ? AMBER : "rgba(255,255,255,.5)"}
          >
            {st === "confirmed" ? "✓ ПОДТВЕРЖДЕНО" : st === "opened" ? t("ОТКРЫТО") : t("ОТПРАВЛЕНО")}
          </Chip>
        ) : null}
      </div>
      <div
        style={{
          font: "500 13px/1.55 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          marginBottom: 10,
        }}
      >
        {t("Персональная ссылка для менеджера площадки: без регистрации проверит вместимость и прайс, оставит контакт и подтвердит. EN / TH / RU.")}
      </div>
      <button className="gtr-btn" disabled={busy} onClick={make}>
        {busy ? "…" : link ? "Новая ссылка" : "Создать ссылку"}
      </button>
      {link ? (
        <>
          <div
            className="gtr-mono"
            style={{
              margin: "10px 0 8px",
              font: "500 12px/1.5 'JetBrains Mono',monospace",
              color: copied ? GREEN : "var(--gtr-t2)",
              wordBreak: "break-all",
            }}
          >
            {copied ? "Скопировано · " : ""}
            {link}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(["ru", "en", "th"] as const).map((lg) => (
              <button
                key={lg}
                onClick={() => setPitchLang(lg)}
                style={{
                  border: `1px solid ${pitchLang === lg ? "#E5231B" : "rgba(255,255,255,.16)"}`,
                  background: pitchLang === lg ? "rgba(229,35,27,.14)" : "transparent",
                  color: pitchLang === lg ? "#fff" : "var(--gtr-t2)",
                  padding: "6px 12px",
                  cursor: "pointer",
                  font: "600 11px/1 'JetBrains Mono',monospace",
                  letterSpacing: ".08em",
                }}
              >
                {lg.toUpperCase()}
              </button>
            ))}
          </div>
          <div
            style={{
              font: "500 12.5px/1.6 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
              whiteSpace: "pre-wrap",
              border: "1px solid rgba(255,255,255,.1)",
              padding: 12,
              marginBottom: 8,
              maxHeight: 190,
              overflowY: "auto",
            }}
          >
            {pitch}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="gtr-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(pitch);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}
            >
              {t("Скопировать письмо")}
            </button>
            <a
              className="gtr-btn"
              style={{ textDecoration: "none" }}
              href={`https://wa.me/?text=${waText}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp ↗
            </a>
            <a
              className="gtr-btn"
              style={{ textDecoration: "none" }}
              href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(pitch)}`}
              target="_blank"
              rel="noreferrer"
            >
              Telegram ↗
            </a>
          </div>
        </>
      ) : null}
      {confirm?.cabinetCode ? (
        <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 12 }}>
          <Eyebrow style={{ marginBottom: 6 }}>{t("КАБИНЕТ ПЛОЩАДКИ ГОТОВ")}</Eyebrow>
          <div
            style={{
              font: "500 12.5px/1.55 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
              marginBottom: 8,
            }}
          >
            {t("Ссылка заводит аккаунт заведения: своя афиша, заявки и брони. Пароль менеджер задаёт сам, ссылка рассчитана на трёх человек.")}
          </div>
          <button
            className="gtr-btn"
            onClick={() => {
              const url = `${window.location.origin}/gtr/join?code=${confirm.cabinetCode}`;
              void navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
          >
            {t("Скопировать ссылку на кабинет")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
