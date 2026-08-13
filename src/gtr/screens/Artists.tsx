import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  AMBER,
  ENTITY_KIND_LABEL,
  entityColor,
  GREEN,
  isPerformer,
  loadArtists,
  RIDERS,
  type Artist,
  type ArtistBase,
} from "../data/app-data";
import photosRaw from "../data/artist-photos.json";
import mediaRaw from "../data/artist-media.json";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow, Field, LetterMark, Li, SubHead, tint, TrashTitle } from "../ui";

// Фото артистов: точное совпадение имени в открытом каталоге, заглушки убраны.
// Дашь Spotify-ключи — база пересоберётся тем же пайплайном.
type ArtistPhoto = { photo: string; photoMed: string; source: string };
const PHOTOS = (photosRaw as { photos: Record<string, ArtistPhoto> }).photos;

// Hero-видео: официальные Instagram-рилы артистов через официальный embed —
// контент остаётся у автора, мы не перезаливаем видео
type ArtistMedia = { igReel: string; igUser: string; heroVideo?: string; heroPoster?: string };
const MEDIA = (mediaRaw as unknown as { media: Record<string, ArtistMedia> }).media;

const KIND_LABEL: Record<string, string> = {
  all: "Все записи",
  artist: "Артисты и DJ",
  live: "Лайв-составы",
  agency: "Агентства и промо",
  team: "Лейблы и менеджмент",
  venue: "Маршруты площадок",
  community: "Комьюнити",
};

const POOL_LABEL: Record<string, string> = {
  all: "Все пулы",
  "Phuket Priority": "Пхукет · приоритет",
  "Phuket Community": "Локальная сцена",
  "Phuket Venue Acts": "Гости площадок",
  "Thailand Artists": "Таиланд",
  "CIS Bookable": "СНГ",
  "Producers & Managers": "Продюсеры и менеджмент",
};

const LINKS: [keyof Artist, string][] = [
  ["sp", "Spotify"],
  ["sc", "SoundCloud"],
  ["yt", "YouTube"],
  ["bp", "Beatport"],
  ["ig", "Instagram"],
  ["web", "Сайт"],
];

export function ArtistsScreen({ artistId }: { artistId?: string }) {
  const [base, setBase] = useState<ArtistBase | null>(null);
  const [q, setQ] = useState("");
  // Исполнители и контрагенты — разные сущности и разные задачи, поэтому
  // разведены на верхнем уровне, а не спрятаны в общий фильтр по типу
  const [scope, setScope] = useState<"performers" | "counterparties">(
    "performers",
  );
  const [kind, setKind] = useState("all");
  const [pool, setPool] = useState("all");
  const [style, setStyle] = useState("all");
  const navigate = useNavigate();
  const { shared, setLineup } = useGtr();

  useEffect(() => {
    loadArtists().then(setBase);
  }, []);

  const openArtist = (id?: string) =>
    navigate({
      to: "/gtr/$screen",
      params: { screen: "artists" },
      search: id ? { artist: id } : {},
    });

  const filtered = useMemo(() => {
    if (!base) return [];
    const qq = q.toLowerCase().trim();
    const rank = (p: string) => (p === "A" ? 0 : p === "B" ? 1 : 2);
    return base.artists
      .filter((a) => {
        if (scope === "performers" ? !isPerformer(a) : isPerformer(a))
          return false;
        if (kind !== "all" && a.kind !== kind) return false;
        if (pool !== "all" && a.group !== pool) return false;
        if (style !== "all" && !(a.styles || []).includes(style)) return false;
        if (
          qq &&
          !`${a.name} ${a.role} ${(a.styles || []).join(" ")}`
            .toLowerCase()
            .includes(qq)
        )
          return false;
        return true;
      })
      .sort(
        (a, b) =>
          rank(a.prio) - rank(b.prio) || a.name.localeCompare(b.name, "ru"),
      );
  }, [base, q, scope, kind, pool, style]);

  if (!base)
    return (
      <div
        className="gtr-mono"
        style={{
          padding: 60,
          textAlign: "center",
          color: "rgba(255,255,255,.4)",
        }}
      >
        Загрузка базы артистов…
      </div>
    );

  const selected = artistId
    ? base.artists.find((a) => a.id === artistId)
    : null;
  if (selected) return <ArtistCard a={selected} onBack={() => openArtist()} />;

  const topStyles = base.meta.styles.slice(0, 14);
  const performerCount = base.artists.filter(isPerformer).length;
  const counterpartyCount = base.artists.length - performerCount;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <h1 className="gtr-oswald gtr-h1">
          {scope === "performers" ? "Артисты и диджеи" : "Контрагенты"}
        </h1>
        <span
          className="gtr-mono"
          style={{
            font: "600 12px/1 'JetBrains Mono',monospace",
            color: "var(--gtr-t3)",
          }}
        >
          {filtered.length} / {base.meta.total}
        </span>
        {shared.lineup.length ? (
          <Chip color="#7B4DFF">В ЛАЙНАПЕ: {shared.lineup.length}</Chip>
        ) : null}
      </div>

      {/* Исполнители и контрагенты разведены: в событие добавляются только
          первые, вторые — канал букинга и контакт */}
      <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
        {(
          [
            ["performers", "Исполнители", performerCount, "#7B4DFF"],
            ["counterparties", "Контрагенты", counterpartyCount, "#F5A623"],
          ] as const
        ).map(([key, label, n, color]) => {
          const on = scope === key;
          return (
            <button
              key={key}
              onClick={() => {
                setScope(key);
                setKind("all");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 0,
                padding: "8px 14px",
                cursor: "pointer",
                font: `${on ? 600 : 500} 12px/1 'Golos Text',sans-serif`,
                border: `1px solid ${on ? color : "rgba(255,255,255,.12)"}`,
                background: on ? tint(color, 0.12) : "transparent",
                color: on ? "#fff" : "rgba(255,255,255,.6)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 0,
                  background: color,
                }}
              />
              {label}
              <span
                className="gtr-mono"
                style={{ fontSize: 10, opacity: 0.65 }}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}
      >
        <input
          className="gtr-input"
          style={{ maxWidth: 260 }}
          placeholder={
            scope === "performers"
              ? "Поиск по имени и стилю…"
              : "Поиск по названию и роли…"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="gtr-input"
          style={{ maxWidth: 190 }}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {/* типы только текущего раздела: в контрагентах нет «артистов» */}
          {Object.entries(KIND_LABEL)
            .filter(
              ([k]) =>
                k === "all" ||
                (scope === "performers"
                  ? isPerformer({ kind: k })
                  : !isPerformer({ kind: k })),
            )
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </select>
        <select
          className="gtr-input"
          style={{ maxWidth: 210 }}
          value={pool}
          onChange={(e) => setPool(e.target.value)}
        >
          {Object.entries(POOL_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}{" "}
              {k !== "all" && base.meta.byGroup[k]
                ? `· ${base.meta.byGroup[k]}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* стили — характеристика исполнителя, у лейбла или агентства их нет */}
      <div
        style={{
          display: scope === "performers" ? "flex" : "none",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {[["all", filtered.length] as [string, number], ...topStyles].map(
          ([s, n]) => (
            <button
              key={s}
              onClick={() => setStyle(String(s))}
              style={{
                border: `1px solid ${style === s ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                background: style === s ? "rgba(229,35,27,.14)" : "transparent",
                color: style === s ? "#fff" : "rgba(255,255,255,.55)",
                borderRadius: 0,
                padding: "6px 10px",
                cursor: "pointer",
                font: "500 10.5px/1 'Golos Text',sans-serif",
              }}
            >
              {s === "all" ? "Все стили" : `${s} · ${n}`}
            </button>
          ),
        )}
      </div>

      <div
        className="gtr-seq"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))",
          gap: 11,
        }}
      >
        {filtered.slice(0, 90).map((a) => (
          <Card
            key={a.id}
            hover
            style={{ padding: "14px 16px" }}
            onClick={() => openArtist(a.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* цветная метка типа: артист, лейбл, агентство, площадка */}
              <span
                title={ENTITY_KIND_LABEL[a.kind] ?? a.kind}
                style={{
                  width: 8,
                  height: 8,
                  flex: "none",
                  borderRadius: 0,
                  background: entityColor(a.kind),
                }}
              />
              {PHOTOS[a.id] ? (
                <img
                  src={PHOTOS[a.id].photoMed}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 34,
                    height: 34,
                    flex: "none",
                    objectFit: "cover",
                    filter: "grayscale(.25) contrast(1.06)",
                    clipPath:
                      "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
                  }}
                />
              ) : (
                <LetterMark name={a.name} />
              )}
              <span
                style={{
                  font: "600 13px/1.25 'Golos Text',sans-serif",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {a.name}
              </span>
              {MEDIA[a.id] ? <Chip color="#FF3427">▶</Chip> : null}
              <Chip
                color={
                  a.prio === "A"
                    ? GREEN
                    : a.prio === "B"
                      ? AMBER
                      : "rgba(255,255,255,.4)"
                }
              >
                {a.prio || "—"}
              </Chip>
            </div>
            <div
              style={{
                margin: "6px 0",
                font: "500 10.5px/1.4 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {(a.styles || []).slice(0, 3).join(" · ") || a.role}
            </div>
            <div
              className="gtr-mono"
              style={{
                font: "500 9.5px/1.4 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              {a.tier || a.cat} · {a.base || "—"}
            </div>
          </Card>
        ))}
      </div>
      {filtered.length > 90 ? (
        <div
          className="gtr-mono"
          style={{
            marginTop: 14,
            textAlign: "center",
            color: "var(--gtr-t3)",
            fontSize: 11,
          }}
        >
          Показаны первые 90 — уточните фильтры
        </div>
      ) : null}
    </div>
  );
}

function ArtistCard({ a, onBack }: { a: Artist; onBack: () => void }) {
  const { shared, setLineup } = useGtr();
  const inLineup = shared.lineup.includes(a.id);
  const rider = a.rider ? RIDERS[a.rider] : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button className="gtr-btn" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Ко всем артистам
      </button>

      <Card
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 26px",
          marginBottom: 16,
        }}
      >
        <div className="gtr-beam" />
        {MEDIA[a.id]?.heroVideo ? (
          <>
            {/* фрагмент официального рила — живой фон шапки, как видео площадки */}
            <video
              src={MEDIA[a.id].heroVideo}
              poster={MEDIA[a.id].heroPoster}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: "52%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center 30%",
                opacity: 0.55,
                filter: "contrast(1.08) saturate(1.05)",
                maskImage: "linear-gradient(90deg, transparent, #000 55%)",
                WebkitMaskImage: "linear-gradient(90deg, transparent, #000 55%)",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, transparent 55%, rgba(229,35,27,.12)), linear-gradient(0deg, rgba(10,11,13,.6), transparent 45%)",
              }}
            />
          </>
        ) : null}
        {!MEDIA[a.id]?.heroVideo && PHOTOS[a.id] ? (
          <>
            {/* фото как атмосферная подложка справа, гаснет к тексту */}
            <img
              src={PHOTOS[a.id].photo}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: "52%",
                objectFit: "cover",
                objectPosition: "center 20%",
                opacity: 0.5,
                filter: "grayscale(.45) contrast(1.1)",
                maskImage: "linear-gradient(90deg, transparent, #000 55%)",
                WebkitMaskImage:
                  "linear-gradient(90deg, transparent, #000 55%)",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, transparent 55%, rgba(229,35,27,.14)), linear-gradient(0deg, rgba(10,11,13,.55), transparent 45%)",
              }}
            />
          </>
        ) : null}
        <div
          style={{
            position: "relative",
            display: "flex",
            gap: 18,
            alignItems: "flex-start",
          }}
        >
          {PHOTOS[a.id] ? (
            <img
              src={PHOTOS[a.id].photo}
              alt={`Фото: ${a.name}`}
              style={{
                width: 124,
                height: 124,
                flex: "none",
                objectFit: "cover",
                border: "1px solid var(--gtr-border2)",
                boxShadow: "0 10px 30px rgba(0,0,0,.5)",
                clipPath:
                  "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)",
              }}
            />
          ) : (
            <LetterMark name={a.name} size={124} cut={12} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <Eyebrow>{a.catRu ? String(a.catRu) : a.cat}</Eyebrow>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
              <TrashTitle text={a.name} size={30} />
              <Chip
                color={
                  a.prio === "A"
                    ? GREEN
                    : a.prio === "B"
                      ? AMBER
                      : "rgba(255,255,255,.4)"
                }
              >
                ПРИОРИТЕТ {a.prio || "—"}
              </Chip>
              {a.tier ? (
                <Chip color="#7B4DFF">{a.tier.toUpperCase()}</Chip>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 9,
                font: "500 12px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {a.role}
            </div>
            {a.rel ? (
              <div
                className="gtr-mono"
                style={{
                  marginTop: 6,
                  font: "500 10.5px/1.4 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {String(a.relRu || a.rel)}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                gap: 7,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              {(a.styles || []).map((s) => (
                <Chip key={s} color="rgba(255,255,255,.55)">
                  {s}
                </Chip>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                flexWrap: "wrap",
              }}
            >
              <button
                className={`gtr-btn ${inLineup ? "" : "gtr-btn-red"}`}
                onClick={() =>
                  setLineup((ids) =>
                    inLineup ? ids.filter((x) => x !== a.id) : [...ids, a.id],
                  )
                }
              >
                {inLineup ? "Убрать из лайнапа" : "+ В лайнап события"}
              </button>
              {LINKS.filter(([k]) => a[k]).map(([k, label]) => (
                <a
                  key={String(k)}
                  className="gtr-btn"
                  style={{ textDecoration: "none" }}
                  href={String(a[k])}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label} ↗
                </a>
              ))}
            </div>
            {MEDIA[a.id]?.heroVideo || PHOTOS[a.id] ? (
              <div
                className="gtr-mono"
                style={{
                  marginTop: 10,
                  font: "500 8.5px/1 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {MEDIA[a.id]?.heroVideo ? (
                  <>
                    видео:{" "}
                    <a
                      href={`https://www.instagram.com/reel/${MEDIA[a.id].igReel}/`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit" }}
                    >
                      IG @{MEDIA[a.id].igUser} ↗
                    </a>
                    {PHOTOS[a.id] ? " · " : ""}
                  </>
                ) : null}
                {PHOTOS[a.id] ? <>фото: {PHOTOS[a.id].source}</> : null}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
      >
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>КОНТАКТ И БУКИНГ</Eyebrow>
          {(
            [
              ["Статус", String(a.statusRu || a.status || "—"), false],
              ["Менеджмент", String(a.mgmtRu || a.mgmt || "—"), false],
              ["База", String(a.baseRu || a.base || "—"), false],
              ["Телефон", a.phone || "—", true],
              ["Email", a.email || "—", true],
              ["Верифицировано", a.verified || "—", true],
            ] as [string, string, boolean][]
          ).map(([k, v, mono]) => (
            <Field key={k} k={k} v={v} mono={mono} />
          ))}
          {a.evidence ? (
            <div
              style={{
                marginTop: 10,
                font: "500 10.5px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              {String(a.evidenceRu || a.evidence)}
            </div>
          ) : null}
        </Card>

        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>
            РАЙДЕР · {rider ? rider.label.toUpperCase() : "НЕ ПРИМЕНЯЕТСЯ"}
          </Eyebrow>
          {rider ? (
            <>
              <SubHead color="#22D3C7" style={{ margin: "8px 0 7px" }}>
                Технический
              </SubHead>
              {rider.tech.map((t) => (
                <Li key={t} color="#22D3C7">
                  {t}
                </Li>
              ))}
              <SubHead color="#FFD166" style={{ margin: "14px 0 7px" }}>
                Гостеприимство
              </SubHead>
              {rider.hosp.map((t) => (
                <Li key={t} color="#FFD166">
                  {t}
                </Li>
              ))}
            </>
          ) : (
            <div
              style={{
                font: "500 11px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              Для этой записи шаблон райдера GTR не назначен.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
