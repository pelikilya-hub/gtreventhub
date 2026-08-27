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
  V,
  type Artist,
  type ArtistBase,
} from "../data/app-data";
import photosRaw from "../data/artist-photos.json";
import mediaRaw from "../data/artist-media.json";
import playersRaw from "../data/artist-players.json";
import labelLogosRaw from "../data/label-logos.json";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";
import { Card, Chip, Eyebrow, Field, LetterMark, Li, SubHead, tint, TrashTitle } from "../ui";
import { GtrLightbox } from "../lightbox";
import { openAppLink } from "../applink";
import {
  allAfishaFn,
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

// Лейблы: значок рисуем только там, где нашёлся настоящий логотип
// с прозрачным фоном на официальном сайте лейбла — угадывать нельзя.
type LabelLogo = { name: string; file: string; w: number; h: number; onDark: boolean; site: string };
const LABEL_LOGOS = labelLogosRaw as Record<string, LabelLogo>;

// Встроенные плееры сняты (виджеты сервисов разнобойные) — вместо них
// прямая ссылка на музыку. Spotify — основной инструмент: прямой профиль,
// если известен; SoundCloud — для локальной сцены; остальным — Spotify-поиск.
const playerLink = (p: ArtistPlayer, spFallback?: string): { url: string; label: string } => {
  // Spotify-фолбэк годится, только если это прямой профиль артиста.
  // Поисковая выдача — не музыка: жмёшь «Музыка», а попадаешь в список.
  // Прямая ссылка Deezer или Mixcloud честнее любого поиска.
  const spDirect = spFallback && /open\.spotify\.com\/artist\//.test(spFallback) ? spFallback : undefined;
  if (p.kind === "spotify") return { url: `https://open.spotify.com/artist/${p.ref}`, label: "Музыка · Spotify" };
  if (p.kind === "sc") return { url: p.ref, label: "Музыка · SoundCloud" };
  if (p.kind === "mixcloud") return { url: `https://www.mixcloud.com${p.ref}`, label: "Музыка · Mixcloud" };
  if (p.kind === "deezer") return { url: `https://www.deezer.com/artist/${p.ref}`, label: "Музыка · Deezer" };
  return spDirect ? { url: spDirect, label: "Музыка · Spotify" } : { url: `https://www.deezer.com/artist/${p.ref}`, label: "Музыка" };
};

// Группы базы — служебные английские метки; посетителю показываем
// человеческое название сцены (ключи RU — под естественную i18n-схему)
const GROUP_FAN: Record<string, string> = {
  "Phuket Priority": "Приоритет сцены Пхукета",
  "Phuket Community": "Комьюнити Пхукета",
  "Phuket Venue Acts": "Резидент площадок Пхукета",
  "Thailand Artists": "Сцена Таиланда",
  "CIS Bookable": "Международный ростер",
  "Producers & Managers": "Продюсер / менеджмент",
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
  const { t } = useTranslation();
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
        {t("Загрузка базы артистов…")}
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
          {scope === "performers" ? t("Артисты и диджеи") : t("Контрагенты")}
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
          <Chip color="#7B4DFF">{t("В ЛАЙНАПЕ")}: {shared.lineup.length}</Chip>
        ) : null}
      </div>

      {/* Исполнители и контрагенты разведены: в событие добавляются только
          первые, вторые — канал букинга и контакт */}
      <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
        {(
          [
            ["performers", t("Исполнители"), performerCount, "#7B4DFF"],
            ["counterparties", t("Контрагенты"), counterpartyCount, "#F5A623"],
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
                style={{ fontSize: 12, opacity: 0.65 }}
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
              ? t("Поиск по имени и стилю…")
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
                font: "500 12px/1 'Golos Text',sans-serif",
              }}
            >
              {s === "all" ? t("Все стили") : `${s} · ${n}`}
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
                      font: "600 10px/1 'JetBrains Mono',monospace",
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
                    font: "700 13px/1 'JetBrains Mono',monospace",
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
                      font: "600 13.5px/1.45 'Golos Text',sans-serif",
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
                    font: "500 12px/1.45 'Golos Text',sans-serif",
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
                    font: "500 11px/1.5 'JetBrains Mono',monospace",
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
            fontSize: 13,
          }}
        >
          {t("Показаны первые 90 — уточните фильтры")}
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
  const { t } = useTranslation();
  const { user, shared, setLineup } = useGtr();
  const navigate = useNavigate();
  // Режим посетителя: страница артиста как для фаната — без букинга,
  // райдера и служебных статусов; вместо них стили, статус сцены,
  // площадки и ИИ-подбор похожих исполнителей
  const fanView = user.role === "visitor";
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
  // Фан-режим: площадки из живой афиши + похожие исполнители по стилям
  const [fanAfisha, setFanAfisha] = useState<{ vid: string; artistIds: string[]; title: string; dateIso: string }[]>([]);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  useEffect(() => {
    if (!fanView) return;
    allAfishaFn().then((r) => setFanAfisha(r.items)).catch(() => {});
    loadArtists().then((b) => setAllArtists(b.artists)).catch(() => {});
  }, [fanView, a.id]);
  // Площадки, где играл / играет: домашняя площадка из базы + события афиши
  const playedVenues = useMemo(() => {
    const vids: string[] = [];
    if (a.venue && V(a.venue)?.name) vids.push(a.venue);
    for (const e of fanAfisha)
      if (e.artistIds?.includes(a.id) && !vids.includes(e.vid) && V(e.vid)?.name) vids.push(e.vid);
    return vids.slice(0, 8);
  }, [a.id, a.venue, fanAfisha]);
  // ИИ-подбор: Ружичка по стилям (пересечение/объединение) + бонус своей
  // сцены и фото — тот же принцип, что в движке вкуса
  const similar = useMemo(() => {
    if (!fanView || !allArtists.length || !(a.styles || []).length) return [];
    const mine = new Set((a.styles || []).map((s) => s.toLowerCase()));
    return allArtists
      .filter((x) => x.id !== a.id && isPerformer(x) && (x.styles || []).length)
      .map((x) => {
        const theirs = new Set((x.styles || []).map((s) => s.toLowerCase()));
        let inter = 0;
        for (const s of mine) if (theirs.has(s)) inter++;
        const union = mine.size + theirs.size - inter;
        let score = union ? inter / union : 0;
        if (x.group === a.group) score += 0.12;
        if (PHOTOS[x.id]) score += 0.08;
        return { x, score };
      })
      .filter((r) => r.score > 0.14)
      .sort((p, q) => q.score - p.score)
      .slice(0, 6)
      .map((r) => r.x);
  }, [fanView, allArtists, a.id, a.styles, a.group]);
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
        {t("← Ко всем артистам")}
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
              {/* посетителю — только фанатские метки; служебные статусы
                  (приоритет, work permit) остаются командам */}
              {!fanView ? (
                <Chip
                  color={
                    a.prio === "A"
                      ? GREEN
                      : a.prio === "B"
                        ? AMBER
                        : "rgba(255,255,255,.4)"
                  }
                >
                  {t("ПРИОРИТЕТ")} {a.prio || "—"}
                </Chip>
              ) : null}
              {a.tier && a.tier !== "—" ? (
                <Chip color="#7B4DFF">{t(a.tier).toUpperCase()}</Chip>
              ) : null}
              {!fanView || flags.verified ? (
                <span
                  title={user.role === "gtr" ? "Нажмите, чтобы переключить" : undefined}
                  onClick={user.role === "gtr" ? () => toggleFlag("verified") : undefined}
                  style={{ cursor: user.role === "gtr" ? "pointer" : "default", display: "inline-flex" }}
                >
                  <Chip color={flags.verified ? GREEN : "rgba(255,255,255,.35)"}>
                    {flags.verified ? t("ВЕРИФИЦИРОВАН ✓") : t("БЕЗ ВЕРИФИКАЦИИ")}
                  </Chip>
                </span>
              ) : null}
              {!fanView ? (
                <span
                  title={user.role === "gtr" ? "Нажмите, чтобы переключить" : undefined}
                  onClick={user.role === "gtr" ? () => toggleFlag("workPermit") : undefined}
                  style={{ cursor: user.role === "gtr" ? "pointer" : "default", display: "inline-flex" }}
                >
                  <Chip color={flags.workPermit ? GREEN : AMBER}>
                    {flags.workPermit ? t("WORK PERMIT ✓") : t("WORK PERMIT — НЕТ ДАННЫХ")}
                  </Chip>
                </span>
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
            {a.rel && !fanView ? (
              <div
                className="gtr-mono"
                style={{
                  marginTop: 6,
                  font: "500 12px/1.5 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {String(a.relRu || a.rel)}
              </div>
            ) : null}
            {a.labels?.length ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                {a.labels.map((lid) => {
                  const logo = LABEL_LOGOS[lid];
                  if (!logo) return null;
                  return (
                    <a
                      key={lid}
                      href={logo.site}
                      target="_blank"
                      rel="noreferrer"
                      title={logo.name}
                      style={{ display: "inline-flex", alignItems: "center", opacity: 0.85 }}
                    >
                      <img
                        src={logo.file}
                        alt={logo.name}
                        style={{
                          height: 16,
                          width: "auto",
                          maxWidth: 96,
                          objectFit: "contain",
                          filter: logo.onDark ? "none" : "invert(1)",
                        }}
                      />
                    </a>
                  );
                })}
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
              {!fanView ? (
                <button
                  className={`gtr-btn ${inLineup ? "" : "gtr-btn-red"}`}
                  onClick={() =>
                    setLineup((ids) =>
                      inLineup ? ids.filter((x) => x !== a.id) : [...ids, a.id],
                    )
                  }
                >
                  {inLineup ? t("Убрать из лайнапа") : t("+ В лайнап события")}
                </button>
              ) : null}
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
                  <span className="gtr-live-dot" /> {t("В ЭФИРЕ — смотреть")}
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
              {PLAYERS[a.id]
                ? (() => {
                    const pl = playerLink(PLAYERS[a.id], String(a.sp || "") || undefined);
                    return (
                      <a
                        className="gtr-btn"
                        style={{ textDecoration: "none" }}
                        href={pl.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          openAppLink(pl.url);
                        }}
                      >
                        ♪ {pl.label} ↗
                      </a>
                    );
                  })()
                : null}
              {LINKS.filter(([k]) => {
                if (!linkOf(k)) return false;
                // резолвнутая прямая ссылка заменяет поисковую того же сервиса
                const pk = PLAYERS[a.id]?.kind;
                if (pk === "spotify" && k === "sp") return false;
                if (pk === "sc" && k === "sc") return false;
                return true;
              }).map(([k, label]) => {
                // Часть ссылок в базе — поисковые выдачи: прямой записи у
                // артиста пока нет. Прятать их нельзя (иначе у человека не
                // останется ничего), но и выдавать за музыку — обман.
                const url = String(linkOf(k));
                const search = /\/results\?|\/search(\?|\/|$)|open\.spotify\.com\/search/.test(url);
                return (
                  <a
                    key={String(k)}
                    className="gtr-btn"
                    style={{ textDecoration: "none", opacity: search ? 0.72 : 1 }}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={search ? "Поиск по сервису — прямой записи пока нет" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      openAppLink(url);
                    }}
                  >
                    {label}{search ? " · поиск" : ""} ↗
                  </a>
                );
              })}
            </div>
            {!fanView && (MEDIA[a.id]?.heroVideo || PHOTOS[a.id]) ? (
              <div
                className="gtr-mono"
                style={{
                  marginTop: 10,
                  font: "500 10px/1 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {MEDIA[a.id]?.heroVideo ? (
                  <>
                    {t("видео:")}{" "}
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
                {PHOTOS[a.id] ? <>{t("фото:")} {PHOTOS[a.id].source}</> : null}
              </div>
            ) : null}
        </div>
      </Card>

      {/* Сеты артиста — добавляет сам через кабинет */}
      {P?.sets?.length ? (
        <Card style={{ padding: "16px 20px", margin: "14px 0", display: "grid", gap: 7 }}>
          <Eyebrow>{t("СЕТЫ")} · {P.sets.length}</Eyebrow>
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
                  font: "500 10px/1 'JetBrains Mono',monospace",
                  color: "var(--gtr-t3)",
                }}
              >
                {sSet.url.includes("soundcloud") ? "SOUNDCLOUD" : sSet.url.includes("mixcloud") ? "MIXCLOUD" : sSet.url.includes("youtu") ? "YOUTUBE" : sSet.url.includes("spotify") ? "SPOTIFY" : t("ССЫЛКА")} ↗
              </span>
            </a>
          ))}
        </Card>
      ) : null}

      {/* Фото от артиста — с лайтбоксом */}
      {extras.photos.length ? (
        <Card style={{ padding: "16px 20px", margin: "14px 0" }}>
          <Eyebrow style={{ marginBottom: 10 }}>{t("ФОТО")} · {extras.photos.length}</Eyebrow>
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

      {!fanView ? (
      <div
        className="gtr-md-stack"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
      >
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>{t("КОНТАКТ И БУКИНГ")}</Eyebrow>
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
                font: "500 12px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              {String(a.evidenceRu || a.evidence)}
            </div>
          ) : null}
        </Card>

        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>
            {t("РАЙДЕР")} · {rider ? rider.label.toUpperCase() : t("НЕ ПРИМЕНЯЕТСЯ")}
          </Eyebrow>
          {rider ? (
            <>
              <SubHead color="#22D3C7" style={{ margin: "8px 0 7px" }}>
                {t("Технический")}
              </SubHead>
              {rider.tech.map((t) => (
                <Li key={t} color="#22D3C7">
                  {t}
                </Li>
              ))}
              <SubHead color="#FFD166" style={{ margin: "14px 0 7px" }}>
                {t("Гостеприимство")}
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
                font: "500 13px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              {t("Для этой записи шаблон райдера GTR не назначен.")}
            </div>
          )}
        </Card>
      </div>
      ) : (
        <>
          {/* ---- фан-режим: площадки, стили, статус, похожие ---- */}
          {playedVenues.length ? (
            <Card style={{ padding: "16px 20px", marginBottom: 14 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("ИГРАЛ НА ПЛОЩАДКАХ")}</Eyebrow>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {playedVenues.map((vid) => (
                  <button
                    key={vid}
                    className="gtr-btn"
                    onClick={() =>
                      navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid } })
                    }
                  >
                    {V(vid).name}
                    {V(vid).area ? (
                      <span
                        className="gtr-mono"
                        style={{ marginLeft: 8, font: "500 10px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                      >
                        {t(String(V(vid).area))}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          <div
            className="gtr-md-stack"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}
          >
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 12 }}>{t("МУЗЫКАЛЬНЫЕ СТИЛИ")}</Eyebrow>
              {(a.styles || []).length ? (
                (a.styles || []).map((s, i, arr) => (
                  <div key={s} style={{ marginBottom: 10 }}>
                    <div style={{ font: "600 12px/1.2 'Golos Text',sans-serif", marginBottom: 5 }}>{t(s)}</div>
                    <div style={{ height: 5, background: "rgba(255,255,255,.07)" }}>
                      <span
                        className="gtr-genrebar"
                        style={{
                          display: "block",
                          width: `${arr.length > 1 ? 100 - i * (55 / (arr.length - 1)) : 100}%`,
                          height: "100%",
                          background: "linear-gradient(90deg,#E5231B,#F5A623)",
                          ["--gtr-d" as string]: `${i * 0.09}s`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ font: "500 13px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
                  {t("Стили уточняются")}
                </div>
              )}
            </Card>
            <Card style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>{t("СТАТУС И ДОСТИЖЕНИЯ")}</Eyebrow>
              {a.tier && a.tier !== "—" ? <Field k={t("Статус сцены")} v={t(a.tier)} /> : null}
              {a.group ? <Field k={t("Сцена")} v={t(GROUP_FAN[a.group] ?? a.group)} /> : null}
              {String(a.baseRu || a.base || "") ? <Field k={t("База")} v={String(a.baseRu || a.base)} /> : null}
              {flags.verified ? <Field k={t("Верификация")} v={t("Подтверждён командой GTR ✓")} /> : null}
              {P?.sets?.length ? <Field k={t("Сеты в профиле")} v={String(P.sets.length)} mono /> : null}
              {playedVenues.length ? <Field k={t("Площадки")} v={String(playedVenues.length)} mono /> : null}
            </Card>
          </div>

          {similar.length ? (
            <Card style={{ padding: "16px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span className="gtr-eq" aria-hidden><span /><span /><span /><span /></span>
                <Eyebrow>{t("ИИ-ПОДБОР: ПОХОЖИЕ ИСПОЛНИТЕЛИ")}</Eyebrow>
              </div>
              <div className="gtr-hscroll">
                {similar.map((x) => (
                  <Card
                    key={x.id}
                    hover
                    style={{ padding: 0, overflow: "hidden", width: 132, flex: "none" }}
                    onClick={() =>
                      navigate({ to: "/gtr/$screen", params: { screen: "artists" }, search: { artist: x.id } })
                    }
                  >
                    <div style={{ position: "relative", aspectRatio: "1/1", background: "#101116" }}>
                      {PHOTOS[x.id] ? (
                        <img
                          src={PHOTOS[x.id].photo}
                          alt=""
                          loading="lazy"
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : null}
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(10,11,13,.94))" }} />
                      <div style={{ position: "absolute", left: 8, right: 8, bottom: 7 }}>
                        <div style={{ font: "700 13px/1.2 Oswald,sans-serif", textTransform: "uppercase", letterSpacing: ".03em" }}>
                          {x.name}
                        </div>
                        <div className="gtr-mono" style={{ marginTop: 2, font: "500 7.5px/1.45 'JetBrains Mono',monospace", color: "rgba(255,255,255,.6)", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {(x.styles || []).slice(0, 2).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
