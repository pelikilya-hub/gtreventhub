// Студия артиста (2.0): сам ведёт профиль — био, ссылки, сеты, фото,
// hero-видео — и пишет команде из приложения. Всё сразу видно в публичной
// карточке каталога.
import { useEffect, useState } from "react";

import {
  artistExtrasFn,
  contactTeamFn,
  setAprofileFn,
  type ArtistProfile,
} from "../kv-api";
import { Card, Chip, Eyebrow } from "../ui";

const GREEN = "#2ECC71";

const LINK_FIELDS: [keyof NonNullable<ArtistProfile["links"]>, string, string][] = [
  ["ig", "Instagram", "https://www.instagram.com/…"],
  ["sp", "Spotify", "https://open.spotify.com/artist/…"],
  ["yt", "YouTube", "https://youtube.com/@…"],
  ["sc", "SoundCloud", "https://soundcloud.com/…"],
  ["twitch", "Twitch", "логин канала или ссылка"],
  ["wa", "WhatsApp", "+66 …"],
];

const compressImg = (f: File, max = 1600, q = 0.82) =>
  new Promise<Blob | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc);
      cv.height = Math.round(img.height * sc);
      cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      cv.toBlob((b) => resolve(b), "image/jpeg", q);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(f);
  });

const squareAvatar = (f: File) =>
  new Promise<Blob | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const cv = document.createElement("canvas");
      cv.width = 600;
      cv.height = 600;
      cv.getContext("2d")?.drawImage(
        img,
        (img.width - s) / 2,
        (img.height - s) / 2,
        s,
        s,
        0,
        0,
        600,
        600,
      );
      URL.revokeObjectURL(img.src);
      cv.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(f);
  });

const posterFromVideo = (f: File) =>
  new Promise<Blob | null>((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = URL.createObjectURL(f);
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.6, (v.duration || 1) / 2);
    };
    v.onseeked = () => {
      const sc = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(v.videoWidth * sc);
      cv.height = Math.round(v.videoHeight * sc);
      cv.getContext("2d")?.drawImage(v, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(v.src);
      cv.toBlob((b) => resolve(b), "image/jpeg", 0.82);
    };
    v.onerror = () => resolve(null);
  });

export function ArtistStudio({ artistId }: { artistId: string }) {
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [sets, setSets] = useState<{ title: string; url: string }[]>([]);
  const [setTitle, setSetTitle] = useState("");
  const [setUrl, setSetUrl] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [heroVideo, setHeroVideo] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const [teamMsg, setTeamMsg] = useState("");
  const [teamState, setTeamState] = useState("");

  const load = () =>
    artistExtrasFn({ data: { artistId } })
      .then((r) => {
        setBio(r.profile?.bio ?? "");
        setLinks((r.profile?.links as Record<string, string>) ?? {});
        setSets(r.profile?.sets ?? []);
        setPhotos(r.photos);
        setAvatar(r.avatar);
        setHeroVideo(r.heroVideo);
      })
      .catch(() => {});
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const saveProfile = async (patch: ArtistProfile) => {
    setBusy("profile");
    try {
      const r = await setAprofileFn({ data: { artistId, patch } });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setBusy("");
    }
  };

  const upload = async (path: string, blob: Blob, ct: string) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": ct }, body: blob });
    return (await res.json()) as { ok?: boolean; reason?: string; path?: string };
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setBusy("photos");
    try {
      for (const f of [...files].slice(0, 8 - photos.length)) {
        const blob = await compressImg(f);
        if (blob) await upload(`/api/aphoto?a=${artistId}`, blob, "image/jpeg");
      }
      await load();
    } finally {
      setBusy("");
    }
  };

  const setAvatarFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy("avatar");
    try {
      const blob = await squareAvatar(f);
      if (blob) await upload(`/api/aphoto?a=${artistId}&role=avatar`, blob, "image/jpeg");
      await load();
    } finally {
      setBusy("");
    }
  };

  const setVideoFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 16_000_000) {
      setBusy("");
      alert("Видео больше 16 МБ — сожмите (рекомендация: 10–15 секунд, 720p).");
      return;
    }
    setBusy("video");
    try {
      const r = await upload(`/api/avideo?a=${artistId}`, f, f.type || "video/mp4");
      if (r.ok) {
        const poster = await posterFromVideo(f);
        if (poster)
          await upload(`/api/aphoto?a=${artistId}&role=heroposter`, poster, "image/jpeg");
      }
      await load();
    } finally {
      setBusy("");
    }
  };

  const delPhoto = async (src: string) => {
    const k = new URL(src, "https://x").searchParams.get("k");
    if (!k) return;
    await fetch(`/api/aphoto?k=${encodeURIComponent(k)}`, { method: "DELETE" });
    await load();
  };

  const sendTeam = async () => {
    if (!teamMsg.trim()) return;
    setTeamState("…");
    try {
      const r = await contactTeamFn({ data: { text: teamMsg } });
      if (r.ok) {
        setTeamMsg("");
        setTeamState(`Доставлено команде (${r.delivered})`);
      } else setTeamState(r.reason ?? "не отправилось");
    } catch {
      setTeamState("сервер недоступен");
    }
    setTimeout(() => setTeamState(""), 4000);
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
      }}
    >
      {s}
    </span>
  );

  return (
    <div
      className="gtr-md-stack"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}
    >
      {/* ---------- мой профиль ---------- */}
      <Card style={{ padding: "16px 20px", display: "grid", gap: 10, alignContent: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Eyebrow>МОЙ ПРОФИЛЬ</Eyebrow>
          {saved ? <Chip color={GREEN}>СОХРАНЕНО</Chip> : null}
        </div>
        <div>
          {label("О СЕБЕ · ВИДНО В КАТАЛОГЕ")}
          <textarea
            className="gtr-input"
            rows={4}
            style={{ resize: "vertical", height: "auto" }}
            placeholder="Стиль, опыт, чем цепляют ваши сеты…"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        {LINK_FIELDS.map(([k, lbl, ph]) => (
          <div key={k}>
            {label(lbl.toUpperCase())}
            <input
              className="gtr-input"
              placeholder={ph}
              value={links[k] ?? ""}
              onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))}
            />
          </div>
        ))}
        <button
          className="gtr-btn gtr-btn-red"
          disabled={busy === "profile"}
          onClick={() => saveProfile({ bio, links })}
        >
          {busy === "profile" ? "Сохраняю…" : "Сохранить профиль"}
        </button>
      </Card>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {/* ---------- медиа ---------- */}
        <Card style={{ padding: "16px 20px", display: "grid", gap: 10 }}>
          <Eyebrow>МЕДИА</Eyebrow>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {avatar ? (
              <img
                src={avatar}
                alt=""
                style={{ width: 64, height: 64, objectFit: "cover", border: "1px solid rgba(255,255,255,.15)" }}
              />
            ) : null}
            <label className="gtr-btn" style={{ cursor: "pointer" }}>
              {busy === "avatar" ? "…" : avatar ? "Заменить аватар" : "Загрузить аватар"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  void setAvatarFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="gtr-btn" style={{ cursor: "pointer" }}>
              {busy === "video" ? "Загружаю видео…" : heroVideo ? "Заменить hero-видео" : "Hero-видео (mp4, до 16 МБ)"}
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                style={{ display: "none" }}
                onChange={(e) => {
                  void setVideoFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {heroVideo ? <Chip color={GREEN}>ВИДЕО В ПРОФИЛЕ</Chip> : null}
          </div>
          <div>
            {label(`ФОТО · ${photos.length}/8`)}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {photos.map((src) => (
                <span key={src} style={{ position: "relative" }}>
                  <img
                    src={src}
                    alt=""
                    style={{ width: 70, height: 70, objectFit: "cover", border: "1px solid rgba(255,255,255,.12)" }}
                  />
                  <button
                    onClick={() => void delPhoto(src)}
                    aria-label="Удалить фото"
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      border: "none",
                      background: "#E5231B",
                      color: "#fff",
                      font: "700 10px/1 monospace",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {photos.length < 8 ? (
                <label
                  className="gtr-btn"
                  style={{ cursor: "pointer", width: 70, height: 70, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {busy === "photos" ? "…" : "+"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </Card>

        {/* ---------- сеты ---------- */}
        <Card style={{ padding: "16px 20px", display: "grid", gap: 8 }}>
          <Eyebrow>МОИ СЕТЫ · {sets.length}/12</Eyebrow>
          {sets.map((sSet, i) => (
            <div key={`${sSet.url}-${i}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, minWidth: 0, font: "500 11.5px/1.3 'Golos Text',sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ▶ {sSet.title}
              </span>
              <button
                className="gtr-btn"
                style={{ padding: "3px 8px", fontSize: 10, color: "#E5231B" }}
                onClick={() => {
                  const next = sets.filter((_, j) => j !== i);
                  setSets(next);
                  void saveProfile({ sets: next });
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input
              className="gtr-input"
              placeholder="Название сета"
              value={setTitle}
              onChange={(e) => setSetTitle(e.target.value)}
            />
            <input
              className="gtr-input"
              placeholder="Ссылка (SoundCloud / YouTube…)"
              value={setUrl}
              onChange={(e) => setSetUrl(e.target.value)}
            />
          </div>
          <button
            className="gtr-btn"
            disabled={!setTitle.trim() || !/^https?:\/\//.test(setUrl.trim())}
            onClick={() => {
              const next = [...sets, { title: setTitle.trim(), url: setUrl.trim() }];
              setSets(next);
              setSetTitle("");
              setSetUrl("");
              void saveProfile({ sets: next });
            }}
          >
            + Добавить сет
          </button>
        </Card>

        {/* ---------- связь с командой ---------- */}
        <Card style={{ padding: "16px 20px", display: "grid", gap: 8 }}>
          <Eyebrow>СВЯЗЬ С КОМАНДОЙ GTR</Eyebrow>
          <textarea
            className="gtr-input"
            rows={3}
            style={{ resize: "vertical", height: "auto" }}
            placeholder="Вопрос по выступлению, гонорару, датам — команда ответит в Telegram…"
            value={teamMsg}
            onChange={(e) => setTeamMsg(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="gtr-btn gtr-btn-red" onClick={() => void sendTeam()} disabled={!teamMsg.trim()}>
              Отправить команде
            </button>
            {teamState ? (
              <span className="gtr-mono" style={{ font: "500 9.5px/1.3 'JetBrains Mono',monospace", color: teamState.startsWith("Доставлено") ? GREEN : "var(--gtr-t3)" }}>
                {teamState}
              </span>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
