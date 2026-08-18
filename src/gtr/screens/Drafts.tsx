// Черновики приёмника афиш: что продукт узнал сам и ждёт решения.
//
// Приёмник разбирает присланные посты и складывает всё незнакомое —
// площадки и имена из лайнапов. Заводить их в базу автоматически нельзя:
// половина «новых площадок» окажется опечаткой, а половина «артистов» —
// названием вечеринки. Здесь человек смотрит на собранное и решает.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { draftDecideFn, draftsFn, type ArtistDraftRow, type VenueDraftRow } from "../kv-api";
import { Card, Chip, Eyebrow } from "../ui";

const GREEN = "#2ECC71";
const AMBER = "#F5A623";

export function DraftsScreen() {
  const { t } = useTranslation();
  const [venues, setVenues] = useState<VenueDraftRow[]>([]);
  const [artists, setArtists] = useState<ArtistDraftRow[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    void draftsFn()
      .then((r) => {
        setVenues(r.venues);
        setArtists(r.artists);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

  useEffect(load, []);

  const decide = async (kind: "venue" | "artist", slug: string, approve: boolean) => {
    setBusy(slug);
    try {
      const r = await draftDecideFn({ data: { kind, slug, approve } });
      setNote(r.note ?? "");
      // Список перечитываем целиком: решение по одной карточке может
      // сдвинуть очередь, а угадывать новое состояние на клиенте — путь
      // к расхождению с сервером.
      load();
    } catch {
      setNote("Сервер недоступен");
    } finally {
      setBusy("");
      window.setTimeout(() => setNote(""), 3000);
    }
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Eyebrow style={{ marginBottom: 12 }}>{t("ЧЕРНОВИКИ ИЗ ПРИЁМНИКА АФИШ")}</Eyebrow>

      {note ? (
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <span style={{ font: "600 12.5px/1.4 'Golos Text',sans-serif", color: GREEN }}>{note}</span>
        </Card>
      ) : null}

      {loaded && !venues.length && !artists.length ? (
        <Card style={{ padding: 20 }}>
          <div style={{ font: "500 13.5px/1.6 'Golos Text',sans-serif" }}>
            {t("Пусто — всё разобрано. Черновики появляются, когда в присланной афише встречается площадка или имя, которых нет в базе.")}
          </div>
          <div
            className="gtr-mono"
            style={{ marginTop: 10, font: "500 10.5px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
          >
            {t("Как прислать: перешли пост с афишей боту @Gtrcom1_bot в личку.")}
          </div>
        </Card>
      ) : null}

      {venues.length ? (
        <>
          <Eyebrow style={{ margin: "18px 0 8px" }}>{t("ПЛОЩАДКИ ·")} {venues.length}</Eyebrow>
          <div style={{ display: "grid", gap: 10 }}>
            {venues.map((v) => (
              <Card key={v.slug} style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ font: "700 15px/1.3 'Golos Text',sans-serif" }}>{v.name}</span>
                  {v.kind ? <Chip color={AMBER}>{v.kind.toUpperCase()}</Chip> : null}
                  {v.waiting.length ? (
                    <Chip color={GREEN}>{t("СОБЫТИЙ ЖДЁТ:")} {v.waiting.length}</Chip>
                  ) : null}
                </div>

                <div
                  className="gtr-mono"
                  style={{ marginTop: 6, font: "500 10.5px/1.6 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
                >
                  {v.address ? <div>{t("адрес:")} {v.address}</div> : null}
                  {v.hours ? <div>{t("часы:")} {v.hours}</div> : null}
                  {v.lat && v.lon ? <div>{t("координаты:")} {v.lat.toFixed(4)}, {v.lon.toFixed(4)}</div> : null}
                  <div>{t("источник:")} {v.seenIn.join(" · ") || "—"}</div>
                </div>

                {v.waiting.length ? (
                  <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
                    {v.waiting.slice(0, 4).map((w) => (
                      <div
                        key={w.dateIso + w.title}
                        style={{ font: "500 12px/1.45 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
                      >
                        {w.dateIso} — {w.title}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {/* Прежде чем заводить карточку, площадку надо увидеть
                      глазами: карта и профиль отвечают на «это вообще
                      существует» быстрее любых полей. */}
                  <a
                    className="gtr-btn"
                    href={
                      v.lat && v.lon
                        ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lon}`
                        : `https://www.google.com/maps/search/${encodeURIComponent(`${v.name} Phuket`)}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("На карте ↗")}
                  </a>
                  <a
                    className="gtr-btn"
                    href={`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(v.name)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Instagram ↗
                  </a>
                  {v.website ? (
                    <a className="gtr-btn" href={v.website} target="_blank" rel="noreferrer">
                      {t("Сайт ↗")}
                    </a>
                  ) : null}
                  <button
                    className="gtr-btn gtr-btn-red"
                    disabled={busy === v.slug}
                    onClick={() => void decide("venue", v.slug, true)}
                  >
                    {t("Завести площадку")}
                  </button>
                  <button
                    className="gtr-btn"
                    disabled={busy === v.slug}
                    onClick={() => void decide("venue", v.slug, false)}
                  >
                    {t("Не наша")}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {artists.length ? (
        <>
          <Eyebrow style={{ margin: "22px 0 8px" }}>{t("ИМЕНА ИЗ ЛАЙНАПОВ ·")} {artists.length}</Eyebrow>
          <div style={{ display: "grid", gap: 8 }}>
            {artists.map((a) => (
              <Card key={a.slug} style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ font: "700 14px/1.3 'Golos Text',sans-serif", flex: "1 1 160px" }}>{a.name}</span>
                  {/* Счётчик встреч — главный признак: имя из одного поста
                      чаще всего название вечеринки, из пяти — артист. */}
                  <Chip color={a.seen > 2 ? GREEN : AMBER}>{t("ВСТРЕЧАЛОСЬ:")} {a.seen}</Chip>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <a
                    className="gtr-btn"
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${a.name} dj set`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Сеты ↗")}
                  </a>
                  <a
                    className="gtr-btn"
                    href={`https://soundcloud.com/search?q=${encodeURIComponent(a.name)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    SoundCloud ↗
                  </a>
                  <button
                    className="gtr-btn gtr-btn-red"
                    disabled={busy === a.slug}
                    onClick={() => void decide("artist", a.slug, true)}
                  >
                    {t("Это артист")}
                  </button>
                  <button
                    className="gtr-btn"
                    disabled={busy === a.slug}
                    onClick={() => void decide("artist", a.slug, false)}
                  >
                    {t("Не артист")}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <div style={{ height: 40 }} />
    </div>
  );
}
