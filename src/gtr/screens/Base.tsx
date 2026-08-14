import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  AMBER,
  CONTACT,
  fmtThb,
  GREEN,
  PH,
  RATE_COLOR,
  RATE_LABEL,
  nightOf,
  rateOf,
  RED,
  richOf,
  SPACES,
  V,
} from "../data/app-data";
import { EditableImage } from "../EditableImage";
import { Card, Chip, Eyebrow, Field, tint, TrashTitle } from "../ui";
import { GtrLightbox } from "../lightbox";
import {
  createVenueLinkFn,
  listAfishaFn,
  styleProfileFn,
  syncAfishaNowFn,
  venueConfirmsFn,
  venuePhotosFn,
  type StyleProfile,
  type VenueConfirm,
} from "../kv-api";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";

const confColor = (c: string) => (c === "High" ? GREEN : c === "Medium" ? AMBER : RED);
const isQuar = (x: { confidence: string; status?: string }) =>
  x.confidence === "Low" || /verify|Closed/i.test(x.status || "");

export function BaseScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cluster, setCluster] = useState(t("Все"));
  const [tag, setTag] = useState(t("Все"));
  const [q, setQ] = useState("");
  const [confirms, setConfirms] = useState<Record<string, VenueConfirm>>({});
  useEffect(() => {
    venueConfirmsFn().then((r) => setConfirms(r.confirms)).catch(() => {});
  }, []);

  const { clusters, tags } = useMemo(() => {
    const c: Record<string, number> = {};
    const t: Record<string, number> = {};
    for (const x of PH.venues) {
      c[x.cluster] = (c[x.cluster] || 0) + 1;
      t[x.tag] = (t[x.tag] || 0) + 1;
    }
    return {
      clusters: Object.entries(c).sort((a, b) => b[1] - a[1]),
      tags: Object.entries(t).sort((a, b) => b[1] - a[1]),
    };
  }, []);

  const rows = PH.venues
    .filter(
      (x) =>
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
      {[[t("Все"), PH.venues.length] as [string, number], ...items].map(([label, n]) => (
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
          {t("База · Пхукет")}
        </h1>
        <span
          className="gtr-mono"
          style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {rows.length} / {PH.meta.total} · {t("обновлено")} {PH.meta.updated}
        </span>
      </div>
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
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        {rows.map((x) => {
          const hero = richOf(x.id).hero;
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
                или не загрузилось, карточка остаётся фирменной, не «битой» */}
            <div style={{ position: "relative", aspectRatio: "16/7", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "repeating-linear-gradient(135deg, rgba(255,255,255,.028) 0 2px, transparent 2px 9px), linear-gradient(160deg, #17181C 0%, #0C0D10 100%)",
                }}
              >
                <span
                  className="gtr-oswald"
                  style={{
                    position: "absolute",
                    right: 14,
                    bottom: 2,
                    font: "700 52px/1 Oswald,sans-serif",
                    color: "rgba(255,255,255,.07)",
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
                <span
                  className="gtr-mono"
                  style={{
                    position: "absolute",
                    left: 14,
                    bottom: 10,
                    font: "600 8.5px/1 'JetBrains Mono',monospace",
                    color: "rgba(255,255,255,.3)",
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                  }}
                >
                  {x.tag}
                </span>
              </div>
              {hero ? (
                <>
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
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, rgba(10,11,13,.05) 45%, rgba(10,11,13,.9) 100%)",
                      pointerEvents: "none",
                    }}
                  />
                </>
              ) : null}
              {x.readiness ? (
                <span
                  className="gtr-mono"
                  style={{
                    position: "absolute",
                    top: 9,
                    right: 9,
                    font: "700 11px/1 'JetBrains Mono',monospace",
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
            <div style={{ padding: "11px 15px 14px" }}>
              <div
                style={{ font: "600 13.5px/1.3 'Golos Text',sans-serif" }}
              >
                {x.name}
              </div>
              <div
                style={{
                  margin: "5px 0 8px",
                  font: "500 10.5px/1.45 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                {x.type} · {x.area}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Chip color={confColor(x.confidence)}>{x.confidence.toUpperCase()}</Chip>
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
        Площадка не найдена.{" "}
        <button
          className="gtr-btn"
          onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
        >
          К базе
        </button>
      </div>
    );

  const rich = richOf(v.id);
  const night = nightOf(v.id);
  const sp = SPACES(v.id);
  const rate = rateOf(v.id);
  const ct = CONTACT(v.id);
  const R = v.readiness;
  // Публичной аудитории (артисты, посетители) — витрина без коммерции:
  // прайсы, контакты площадки и внутренние статусы видит только команда
  const commercial = !["artist", "visitor"].includes(user.role);
  // Подтверждённые площадкой значения важнее наших оценок
  const cRate = confirm?.status === "confirmed" ? (confirm.rate ?? null) : null;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <button
        className="gtr-btn"
        style={{ marginBottom: 14 }}
        onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
      >
        {t("← К базе Пхукета")}
      </button>

      <Card
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 26px",
          marginBottom: 16,
          minHeight: 140,
        }}
      >
        <EditableImage
          vid={v.id}
          fallback={rich.hero}
          alt={v.name}
          overlay="linear-gradient(90deg,#0A0B0Df2,#0A0B0D66)"
        />
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>
            {v.id} · {v.cluster.toUpperCase()}
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
            <TrashTitle text={v.name} size={29} />
            <Chip color={confColor(v.confidence)}>ДОСТОВЕРНОСТЬ: {v.confidence.toUpperCase()}</Chip>
            {R ? (
              <Chip color={R.state === "Бронируемая" ? GREEN : AMBER}>{R.state.toUpperCase()}</Chip>
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
                  navigate({ to: "/gtr/$screen", params: { screen: "promo" } })
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
                аренда {fmtThb(cRate.amount)} / {cRate.unit} · подтверждено площадкой
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
                font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              фото: {rich.credit}
            </div>
          ) : null}
        </div>
      </Card>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}
      >
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card style={{ padding: 18 }}>
            <Eyebrow style={{ marginBottom: 10 }}>{t("ПРОФИЛЬ ПЛОЩАДКИ")}</Eyebrow>
            {[
              ["КОНЦЕПЦИЯ", v.concept],
              ["ФОРМАТЫ СОБЫТИЙ", v.events],
              ["ИНФРАСТРУКТУРА", v.facilities],
              [
                "ВМЕСТИМОСТЬ",
                confirm?.status === "confirmed" && confirm.capacity
                  ? `${confirm.capacity} · подтверждено площадкой`
                  : v.capacity,
              ],
              ["МУЗЫКА", v.music],
              ["КЕЙТЕРИНГ", v.catering],
              ["ЗАМЕТКИ", v.notes],
            ]
              .filter(([, val]) => val)
              .map(([k, val]) => (
                <Field key={k} k={k} v={String(val)} />
              ))}
          </Card>

          {night.hours || night.entry || night.best || night.fact ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("НОЧНАЯ ЖИЗНЬ")}</Eyebrow>
              {(
                [
                  ["ЧАСЫ", night.hours],
                  ["ВХОД", night.entry],
                  ["ЛУЧШИЕ ВЕЧЕРА", night.best],
                  ["МУЗЫКА ПО ГАЙДАМ", night.music],
                ] as [string, string | undefined][]
              )
                .filter(([, val]) => val)
                .map(([k, val]) => (
                  <Field key={k} k={t(k)} v={String(val)} />
                ))}
              {night.fact ? (
                <div
                  style={{
                    marginTop: 8,
                    font: "500 11.5px/1.6 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {night.fact}
                </div>
              ) : null}
              {night.src ? (
                <div
                  className="gtr-mono"
                  style={{
                    marginTop: 7,
                    font: "500 9px/1.4 'JetBrains Mono',monospace",
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
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>НОРМАЛИЗОВАННЫЕ ЗАЛЫ · {sp.length}</Eyebrow>
              {sp.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "7px 0",
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                  }}
                >
                  <span style={{ flex: 1, font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                    {s.name}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "500 10px/1.3 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {[
                      s.sqm && `${s.sqm} м²`,
                      s.capTheatre && `${s.capTheatre} театр`,
                      s.capCocktail && `${s.capCocktail} коктейль`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
              ))}
            </Card>
          ) : null}

          {rich.gallery?.length ? (
            <Card style={{ padding: 18 }}>
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
            <Card style={{ padding: 18 }}>
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
          <Card style={{ padding: 18 }}>
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
                    font: "600 9px/1.4 'JetBrains Mono',monospace",
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
                      font: "500 10.5px/1.5 'Golos Text',sans-serif",
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
                      font: "500 10px/1.5 'JetBrains Mono',monospace",
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
            {commercial ? (<>
            <Eyebrow style={{ marginBottom: 10 }}>ИСТОЧНИКИ И КОНТАКТ</Eyebrow>
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

          {commercial && R ? (
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>
                ГОТОВНОСТЬ К БРОНИРОВАНИЮ · {R.score}/100
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
                  <span style={{ flex: 1, font: "500 11.5px/1.4 'Golos Text',sans-serif" }}>
                    {k}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "600 10px/1.4 'JetBrains Mono',monospace",
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
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ АФИША</Eyebrow>
              <div style={{ display: "grid", gap: 8 }}>
                {rich.afisha.map(([date, title, meta]) => (
                  <div
                    key={title + date}
                    style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                  >
                    <span
                      className="gtr-mono"
                      style={{
                        font: "700 10px/1.3 'JetBrains Mono',monospace",
                        color: "#E5231B",
                        width: 46,
                        flex: "none",
                      }}
                    >
                      {date}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span
                        style={{ display: "block", font: "600 11.5px/1.3 'Golos Text',sans-serif" }}
                      >
                        {title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "500 9.5px/1.4 'JetBrains Mono',monospace",
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
  const { user } = useGtr();
  const navigate = useNavigate();
  const [data, setData] = useState<{ events: AfishaEvent[]; syncedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<StyleProfile | null>(null);
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
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Eyebrow>АФИША</Eyebrow>
        {data?.syncedAt ? (
          <span
            className="gtr-mono"
            style={{ font: "500 8.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
          >
            обновлено {new Date(data.syncedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
      {upcoming.length ? (
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}
        >
          {upcoming.map((e) => (
            <a
              key={e.id}
              href={e.url}
              target="_blank"
              rel="noreferrer"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid rgba(255,255,255,.09)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {e.poster ? (
                <img
                  src={e.poster}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover" }}
                />
              ) : null}
              <span style={{ padding: "8px 10px", display: "grid", gap: 3 }}>
                <span
                  className="gtr-mono"
                  style={{ font: "700 9.5px/1 'JetBrains Mono',monospace", color: "#FF3427" }}
                >
                  {e.dateIso.slice(5).split("-").reverse().join(".")}
                  {e.room ? ` · ${e.room.toUpperCase()}` : ""}
                </span>
                <span style={{ font: "600 11.5px/1.35 'Golos Text',sans-serif", color: "#fff" }}>
                  {e.title}
                </span>
                {e.artistIds.length ? (
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {e.artistIds.map((id) => (
                      <button
                        key={id}
                        className="gtr-mono"
                        style={{
                          font: "600 8.5px/1 'JetBrains Mono',monospace",
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
                        НАШ АРТИСТ ↗
                      </button>
                    ))}
                  </span>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <span style={{ font: "500 11px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          Источник этой площадки ещё не подключён — собираем Café del Mar и Illuzion, дальше расширяем.
        </span>
      )}
    </Card>
  );
}

// Ссылка подтверждения для менеджера площадки: команда создаёт, копирует
// и шлёт в WhatsApp/Telegram. Статус показывает путь: отправлено → открыто
// → подтверждено.
function VenueLinkBlock({ vid, confirm }: { vid: string; confirm: VenueConfirm | null }) {
  const { user } = useGtr();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const waText = encodeURIComponent(
    `Hi! GTR Event brings events and organizers to Phuket venues. Please confirm your venue details (2 min): ${link}`,
  );
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Eyebrow>ПОДТВЕРЖДЕНИЕ ПЛОЩАДКОЙ</Eyebrow>
        {st ? (
          <Chip
            color={st === "confirmed" ? GREEN : st === "opened" ? AMBER : "rgba(255,255,255,.5)"}
          >
            {st === "confirmed" ? "✓ ПОДТВЕРЖДЕНО" : st === "opened" ? "ОТКРЫТО" : "ОТПРАВЛЕНО"}
          </Chip>
        ) : null}
      </div>
      <div
        style={{
          font: "500 11px/1.55 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          marginBottom: 10,
        }}
      >
        Персональная ссылка для менеджера площадки: без регистрации проверит
        вместимость и прайс, оставит контакт и подтвердит. EN / TH / RU.
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
              font: "500 10px/1.5 'JetBrains Mono',monospace",
              color: copied ? GREEN : "var(--gtr-t2)",
              wordBreak: "break-all",
            }}
          >
            {copied ? "Скопировано · " : ""}
            {link}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
              href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
                "GTR Event — please confirm your venue details (2 min)",
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Telegram ↗
            </a>
          </div>
        </>
      ) : null}
    </Card>
  );
}
