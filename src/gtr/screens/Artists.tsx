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
import playersRaw from "../data/artist-players.json";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow, Field, LetterMark, Li, SubHead, tint, TrashTitle } from "../ui";
import { GtrLightbox } from "../lightbox";
import { openAppLink } from "../applink";
import {
  artistExtrasFn,
  artistFlagsFn,
  liveStatusFn,
  setArtistFlagFn,
  type ArtistProfile,
} from "../kv-api";

// Фото артистов: точное совпадение имени в открытом каталоге, заглушки убраны.
// Дашь Spotify-ключи — база пересоберётся тем же пайплайном.
type ArtistPhoto = { photo: string; photoMed: string; source: string };
const PHOTOS = (photosRaw as { photos: Record<string, ArtistPhoto> }).photos;

// Hero-видео: официальные Instagram-рилы артистов через официальный embed —
// контент остаётся у автора, мы не перезаливаем видео
type ArtistMedia = { igReel: string; igUser: string; heroVideo?: string; heroPoster?: string };
const MEDIA = (mediaRaw as unknown as { media: Record<string, ArtistMedia> }).media;

// Плееры: Deezer top-tracks / Spotify artist / SoundCloud / Mixcloud —
// подобраны офлайн-пайплайном по точному совпадению имени, ключей не требуют
type ArtistPlayer = { kind: "deezer" | "spotify" | "sc" | "mixcloud"; ref: string };
const PLAYERS = playersRaw as Record<string, ArtistPlayer>;

const playerEmbed = (p: ArtistPlayer): { src: string; h: number; label: string } =>
  p.kind === "deezer"
    ? { src: `https://widget.deezer.com/widget/dark/artist/${p.ref}/top_tracks`, h: 300, label: "Deezer · топ-треки" }
    : p.kind === "spotify"
      ? { src: `https://open.spotify.com/embed/artist/${p.ref}`, h: 352, label: "Spotify" }
      : p.kind === "sc"
        ? {
            src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(p.ref)}&color=%23e5231b&auto_play=false&show_teaser=false`,
            h: 400,
            label: "SoundCloud",
          }
        : {
            src: `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(p.ref)}&light=0`,
            h: 180,
            label: "Mixcloud",
          };

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
  // Кто в эфире: Twitch-автодетект + ручные флаги артистов (Instagram Live)
  const [liveMap, setLiveMap] = useState<Record<string, { live: boolean; kind: string; url?: string }>>({});

  useEffect(() => {
    loadArtists().then(setBase);
  }, []);

  useEffect(() => {
    if (!base) return;
    const poll = () => {
      const items = base.artists
        .filter((a) => a.twitch)
        .slice(0, 50)
        .map((a) => ({ id: a.id, tw: a.twitch }));
      liveStatusFn({ data: { items } })
        .then((r) => setLiveMap(r.live))
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 60000);
    return () => clearInterval(t);
  }, [base]);

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
  if (selected)
    return <ArtistCard a={selected} live={liveMap[selected.id]} onBack={() => openArtist()} />;

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
          gap: 12,
        }}
      >
        {filtered.slice(0, 90).map((a) => {
          const photo = PHOTOS[a.id]?.photo;
          const initials = a.name
            .split(/\s+/)
            .filter((w) => /^[A-Za-zА-Яа-я]/.test(w))
            .slice(0, 2)
            .map((w) => w[0])
            .join("")
            .toUpperCase();
          return (
            <Card
              key={a.id}
              hover
              style={{ padding: 0, overflow: "hidden" }}
              onClick={() => openArtist(a.id)}
            >
              {/* фото артиста в стиле карточек базы площадок; фолбэк-плашка
                  всегда под ним — карточка остаётся фирменной, не «битой» */}
              <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden" }}>
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
                      background: `linear-gradient(180deg,${entityColor(a.kind)},transparent 80%)`,
                      opacity: 0.75,
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
                    {ENTITY_KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                </div>
                {photo ? (
                  <>
                    <img
                      src={photo}
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
                        objectPosition: "center 22%",
                        display: "block",
                        filter: "saturate(.92) contrast(1.04)",
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
                      a.prio === "A"
                        ? GREEN
                        : a.prio === "B"
                          ? AMBER
                          : "rgba(255,255,255,.5)",
                  }}
                >
                  {a.prio || "—"}
                </span>
                {liveMap[a.id]?.live ? (
                  <span
                    className="gtr-live-chip"
                    style={{ position: "absolute", top: 9, left: 9 }}
                  >
                    <span className="gtr-live-dot" />
                    LIVE
                  </span>
                ) : null}
              </div>
              <div style={{ padding: "11px 15px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      font: "600 13.5px/1.3 'Golos Text',sans-serif",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {a.name}
                  </span>
                  {PLAYERS[a.id] || MEDIA[a.id] ? <Chip color="#FF3427">▶</Chip> : null}
                </div>
                <div
                  style={{
                    margin: "5px 0 8px",
                    font: "500 10.5px/1.45 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
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
              </div>
            </Card>
          );
        })}
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

function ArtistCard({
  a,
  live,
  onBack,
}: {
  a: Artist;
  live?: { live: boolean; kind: string; url?: string };
  onBack: () => void;
}) {
  const { user, shared, setLineup } = useGtr();
  const inLineup = shared.lineup.includes(a.id);
  const rider = a.rider ? RIDERS[a.rider] : null;
  // Статусы допуска: верификация GTR и разрешение на работу (KV, правит GTR)
  const [flags, setFlags] = useState<{ verified?: boolean; workPermit?: boolean }>({});
  useEffect(() => {
    artistFlagsFn().then((r) => setFlags(r.flags[a.id] ?? {})).catch(() => {});
  }, [a.id]);
  // Слой 2.0: то, что артист добавил сам — профиль, сеты, медиа
  const [extras, setExtras] = useState<{
    profile: ArtistProfile | null;
    photos: string[];
    avatar: string | null;
    heroVideo: string | null;
    heroPoster: string | null;
  }>({ profile: null, photos: [], avatar: null, heroVideo: null, heroPoster: null });
  const [galleryLb, setGalleryLb] = useState<number | null>(null);
  useEffect(() => {
    artistExtrasFn({ data: { artistId: a.id } }).then(setExtras).catch(() => {});
  }, [a.id]);
  const P = extras.profile;
  const heroVideo = extras.heroVideo ?? MEDIA[a.id]?.heroVideo;
  const heroPoster = extras.heroPoster ?? MEDIA[a.id]?.heroPoster;
  const heroPhoto = extras.avatar ?? PHOTOS[a.id]?.photo;
  const bio = P?.bio || a.bio;
  const linkOf = (k: keyof Artist) =>
    (P?.links as Record<string, string> | undefined)?.[k as string] || (a[k] as string | undefined);

  const toggleFlag = async (key: "verified" | "workPermit") => {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    await setArtistFlagFn({ data: { artistId: a.id, patch: { [key]: next[key] } } }).catch(() => {});
  };

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
        {heroVideo ? (
          <>
            {/* живой фон шапки: видео артиста (кабинет) или фрагмент рила */}
            <video
              className="gtr-heromedia"
              src={heroVideo}
              poster={heroPoster}
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
              className="gtr-heromedia-shade"
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
        {!heroVideo && heroPhoto ? (
          <>
            {/* фото как атмосферная подложка справа, гаснет к тексту */}
            <img
              className="gtr-heromedia"
              src={heroPhoto}
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
              className="gtr-heromedia-shade"
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
              <span
                title={user.role === "gtr" ? "Нажмите, чтобы переключить" : undefined}
                onClick={user.role === "gtr" ? () => toggleFlag("verified") : undefined}
                style={{ cursor: user.role === "gtr" ? "pointer" : "default", display: "inline-flex" }}
              >
                <Chip color={flags.verified ? GREEN : "rgba(255,255,255,.35)"}>
                  {flags.verified ? "ВЕРИФИЦИРОВАН ✓" : "БЕЗ ВЕРИФИКАЦИИ"}
                </Chip>
              </span>
              <span
                title={user.role === "gtr" ? "Нажмите, чтобы переключить" : undefined}
                onClick={user.role === "gtr" ? () => toggleFlag("workPermit") : undefined}
                style={{ cursor: user.role === "gtr" ? "pointer" : "default", display: "inline-flex" }}
              >
                <Chip color={flags.workPermit ? GREEN : AMBER}>
                  {flags.workPermit ? "WORK PERMIT ✓" : "WORK PERMIT — НЕТ ДАННЫХ"}
                </Chip>
              </span>
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
            {bio ? (
              <div
                style={{
                  marginTop: 8,
                  maxWidth: 560,
                  font: "400 12.5px/1.6 'Golos Text',sans-serif",
                  color: "rgba(255,255,255,.68)",
                  borderLeft: "2px solid rgba(229,35,27,.55)",
                  paddingLeft: 12,
                }}
              >
                {bio}
              </div>
            ) : null}
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
          </div>
        </div>
        <div style={{ position: "relative", marginTop: 4 }}>
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
              {live?.live ? (
                <a
                  className="gtr-btn gtr-live-btn"
                  style={{ textDecoration: "none" }}
                  href={live.url || (a.twitch ? `https://www.twitch.tv/${a.twitch}` : String(a.ig))}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    openAppLink(live.url || (a.twitch ? `https://www.twitch.tv/${a.twitch}` : String(a.ig)));
                  }}
                >
                  <span className="gtr-live-dot" /> В ЭФИРЕ — смотреть
                </a>
              ) : a.twitch ? (
                <a
                  className="gtr-btn"
                  style={{ textDecoration: "none" }}
                  href={`https://www.twitch.tv/${a.twitch}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    openAppLink(`https://www.twitch.tv/${a.twitch}`);
                  }}
                >
                  Twitch ↗
                </a>
              ) : null}
              {LINKS.filter(([k]) => linkOf(k)).map(([k, label]) => (
                <a
                  key={String(k)}
                  className="gtr-btn"
                  style={{ textDecoration: "none" }}
                  href={String(linkOf(k))}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    openAppLink(String(linkOf(k)));
                  }}
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
      </Card>

      {/* Плеер: музыка артиста прямо в профиле — Deezer/Spotify/SC/Mixcloud */}
      {PLAYERS[a.id]
        ? (() => {
            const emb = playerEmbed(PLAYERS[a.id]);
            return (
              <Card style={{ padding: "16px 20px", margin: "14px 0" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <Eyebrow>СЛУШАТЬ</Eyebrow>
                  <span
                    className="gtr-mono"
                    style={{
                      font: "500 9px/1 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                      textTransform: "uppercase",
                      letterSpacing: ".1em",
                    }}
                  >
                    {emb.label}
                  </span>
                </div>
                <iframe
                  title={`Плеер: ${a.name}`}
                  src={emb.src}
                  width="100%"
                  height={emb.h}
                  frameBorder="0"
                  allow="encrypted-media; clipboard-write"
                  loading="lazy"
                  style={{ display: "block", border: "1px solid var(--gtr-border2)", background: "#0C0D10" }}
                />
              </Card>
            );
          })()
        : null}

      {/* Сеты артиста — добавляет сам через кабинет */}
      {P?.sets?.length ? (
        <Card style={{ padding: "16px 20px", margin: "14px 0", display: "grid", gap: 7 }}>
          <Eyebrow>СЕТЫ · {P.sets.length}</Eyebrow>
          {P.sets.map((sSet) => (
            <a
              key={sSet.url}
              className="gtr-btn"
              style={{ textDecoration: "none", justifyContent: "flex-start", textAlign: "left" }}
              href={sSet.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openAppLink(sSet.url);
              }}
            >
              ▶ {sSet.title}
              <span
                className="gtr-mono"
                style={{
                  marginLeft: "auto",
                  font: "500 8.5px/1 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {sSet.url.includes("soundcloud") ? "SOUNDCLOUD" : sSet.url.includes("mixcloud") ? "MIXCLOUD" : sSet.url.includes("youtu") ? "YOUTUBE" : sSet.url.includes("spotify") ? "SPOTIFY" : "ССЫЛКА"} ↗
              </span>
            </a>
          ))}
        </Card>
      ) : null}

      {/* Фото от артиста — с лайтбоксом */}
      {extras.photos.length ? (
        <Card style={{ padding: "16px 20px", margin: "14px 0" }}>
          <Eyebrow style={{ marginBottom: 10 }}>ФОТО · {extras.photos.length}</Eyebrow>
          <div
            className="gtr-gallery"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}
          >
            {extras.photos.map((src, gi) => (
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                onClick={() => setGalleryLb(gi)}
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
          {galleryLb !== null ? (
            <GtrLightbox
              images={extras.photos}
              index={galleryLb}
              credit={`Фото: ${a.name}`}
              onClose={() => setGalleryLb(null)}
            />
          ) : null}
        </Card>
      ) : null}

      {/* Spotify-плеер: живое превью треков прямо в профиле (нужна
          настоящая artist-ссылка, поисковые /search не встраиваются) */}
      {(() => {
        const m = String(a.sp || "").match(
          /open\.spotify\.com\/(artist|album|playlist|track)\/([A-Za-z0-9]+)/,
        );
        if (!m) return null;
        return (
          <Card style={{ padding: 0, margin: "14px 0", overflow: "hidden" }}>
            <iframe
              title={`Spotify · ${a.name}`}
              src={`https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=gtr&theme=0`}
              width="100%"
              height="152"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              style={{ display: "block", background: "#0A0B0D" }}
            />
          </Card>
        );
      })()}

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
