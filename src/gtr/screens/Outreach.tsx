// Кабинет менеджера по площадкам.
//
// Одна доска на весь цикл: кого ещё не трогали, кому написали, кто дал
// согласие, что уже собрали. Тексты и скрипт звонка лежат тут же и уже
// подставлены под имя менеджера — переключаться между заметками,
// мессенджером и таблицей не нужно.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadArtists, PH, REGIONS, regionName, V } from "../data/app-data";
import {
  callScript,
  msgChecklist,
  msgFirstEn,
  msgFirstRu,
  msgFollowUp,
  msgInstagram,
  NEEDS,
  STAGES,
  type Manager,
  type Pitch,
} from "../data/outreach";
import { createVenueLinkFn, outreachAllFn, outreachSaveFn, venueQueueFn, type OutreachRow } from "../kv-api";
import { FILL_FIELDS, FILL_LEVELS, fillQueue, stepGaps } from "../venue-fill";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

/** Черновик письма: шаблон открывается в поле, правится под площадку и
 *  копируется уже правленым.
 *
 *  Раньше кнопка копировала шаблон в буфер молча — менеджер вставлял его
 *  в мессенджер и там же правил, каждый раз заново. Правка не сохранялась
 *  нигде, а увидеть письмо целиком до отправки было негде.
 *
 *  Правки живут на устройстве менеджера и привязаны к площадке: у каждой
 *  свой разговор, и общий на всех текст затирал бы личные добавления. */
function Drafter({
  manager,
  venue,
  pitch,
  onCopy,
  vid,
  onLink,
}: {
  manager: Manager;
  venue: string;
  pitch: Pitch;
  onCopy: (text: string, label: string) => void | Promise<void>;
  vid: string;
  onLink: (url: string) => void;
}) {
  const { t } = useTranslation();
  const kinds = useMemo(
    () =>
      [
        ["first-en", t("Первое · EN"), () => msgFirstEn(manager, venue, pitch)],
        ["first-ru", t("Первое · RU"), () => msgFirstRu(manager, venue, pitch)],
        ["ig", t("Директ в Instagram"), () => msgInstagram(manager, venue, pitch)],
        ["follow", t("Напоминание"), () => msgFollowUp(manager, venue, pitch)],
        ["check", t("Что прислать"), () => msgChecklist(manager, venue, pitch)],
        [
          "call",
          t("Скрипт звонка"),
          () =>
            callScript(manager, venue, pitch)
              .map((s) => `${s.step}\n${s.text}`)
              .join("\n\n"),
        ],
      ] as [string, string, () => string][],
    [manager, venue, pitch, t],
  );
  const [linkBusy, setLinkBusy] = useState(false);
  const makeLink = async () => {
    setLinkBusy(true);
    try {
      const r = await createVenueLinkFn({ data: { vid } });
      if (r.ok) onLink(`${window.location.origin}/gtr/v?t=${r.token}`);
    } finally {
      setLinkBusy(false);
    }
  };
  const [kind, setKind] = useState(kinds[0][0]);
  const [text, setText] = useState("");
  const storeKey = `gtr-outreach-draft:${venue}:${kind}`;

  // Шаблон — заготовка: если менеджер уже правил это письмо для этой
  // площадки, показываем его правку, а не начинаем с нуля.
  useEffect(() => {
    const base = kinds.find((k) => k[0] === kind)?.[2]() ?? "";
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storeKey);
    } catch {
      /* приватный режим — работаем без памяти */
    }
    setText(saved ?? base);
  }, [kind, storeKey, kinds]);

  const remember = (v: string) => {
    setText(v);
    try {
      window.localStorage.setItem(storeKey, v);
    } catch {
      /* квота */
    }
  };

  const reset = () => {
    try {
      window.localStorage.removeItem(storeKey);
    } catch {
      /* нечего забывать */
    }
    setText(kinds.find((k) => k[0] === kind)?.[2]() ?? "");
  };

  return (
    <div>
      <Eyebrow style={{ marginBottom: 8 }}>{t("ТЕКСТ ПЕРЕД ОТПРАВКОЙ")}</Eyebrow>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {kinds.map(([k, label]) => (
          <button
            key={k}
            className={`gtr-btn${kind === k ? " gtr-btn-red" : ""}`}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Ссылка-приглашение делается здесь же: раньше за ней надо было
          уходить в паспорт площадки, и письма уходили без неё — то есть
          просили поверить на слово. */}
      {!pitch.link ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ font: "500 12px/1.5 'Golos Text',sans-serif", color: "#F5A623" }}>
            {t("В письме нет ссылки на карточку")}
          </span>
          <button className="gtr-btn" onClick={() => void makeLink()} disabled={linkBusy}>
            {linkBusy ? t("Делаю…") : t("Сделать приглашение")}
          </button>
        </div>
      ) : null}
      <textarea
        className="gtr-input"
        rows={12}
        value={text}
        onChange={(e) => remember(e.target.value)}
        style={{ width: "100%", font: "500 13px/1.6 'Golos Text',sans-serif" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          className="gtr-btn gtr-btn-red"
          onClick={() => void onCopy(text, t("Текст скопирован"))}
        >
          {t("Скопировать")}
        </button>
        <button className="gtr-btn" onClick={reset}>
          {t("Вернуть шаблон")}
        </button>
      </div>
    </div>
  );
}

const STAGE_COLOR: Record<string, string> = {
  new: "rgba(255,255,255,.35)",
  written: "#F5A623",
  talking: "#00C2FF",
  agreed: "#2ECC71",
  collecting: "#7B4DFF",
  live: "#2ECC71",
  refused: "#E5231B",
};

/** Копирование без библиотек: буфер обмена в вебе капризен, поэтому
 *  сначала пробуем современный путь, иначе — старый через textarea. */
const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

// ---------- конвейер наполнения ----------
//
// Замер по базе: из 354 площадок 56 гость не увидит вовсе, ещё 143 стоят
// на карте точкой без фото. Реклама на такую базу оплачивает показ
// половины пустых карточек — поэтому наполнение идёт первым блоком, до
// писем: писать площадке, чью карточку нельзя показать, рано.
//
// Очередь не алфавитная. Площадка, которой не хватает одного поля,
// стоит пятнадцати минут; площадка с шестью дырами — целого дня. Сверху
// стоят дешёвые шаги: закрыть одно поле у двадцати выгоднее, чем шесть
// полей у трёх.
const GREEN = "#2ECC71";
const LEVEL_COLOR: Record<string, string> = {
  "невидима": "#E5231B",
  "на карте": "#F5A623",
  "в списке": "#E8C07D",
  "в витрине": "#A8E06B",
  "в продаже": GREEN,
};

function FillPipeline() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof venueQueueFn>> | null>(null);
  const [region, setRegion] = useState("all");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    venueQueueFn()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const queue = useMemo(() => {
    if (!data?.ok) return [];
    return fillQueue(data.rows).filter((r) => region === "all" || r.region === region);
  }, [data, region]);

  if (!data?.ok) return null;
  const total = data.rows.length;
  const ready = (data.summary["в витрине"] ?? 0) + (data.summary["в продаже"] ?? 0);

  return (
    <Card style={{ padding: 18, marginBottom: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow>{t("КОНВЕЙЕР НАПОЛНЕНИЯ")}</Eyebrow>
        <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: GREEN }}>
          {ready} / {total} {t("готовы к показу")}
        </span>
        <span className="gtr-mono" style={{ font: "500 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
          {t("в очереди")} {fillQueue(data.rows).length}
        </span>
      </div>

      {/* Лесенка: где именно застревает база */}
      <div style={{ display: "flex", gap: 2, height: 10 }}>
        {FILL_LEVELS.map((lvl) => {
          const n = data.summary[lvl] ?? 0;
          return n ? (
            <span
              key={lvl}
              title={`${t(lvl)} · ${n}`}
              style={{ flex: n, background: LEVEL_COLOR[lvl], display: "block" }}
            />
          ) : null;
        })}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {FILL_LEVELS.map((lvl) =>
          data.summary[lvl] ? (
            <span key={lvl} style={{ font: "500 11.5px/1 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, background: LEVEL_COLOR[lvl], marginRight: 5 }} />
              {t(lvl)} · {data.summary[lvl]}
            </span>
          ) : null,
        )}
      </div>

      {/* Строка регионов прокручивается, а не переносится: на телефоне
          перенос съедал три ряда, а последний чип всё равно вылезал на
          пиксель за край и давал горизонтальный скролл всей странице. */}
      <div className="gtr-map-row" style={{ marginTop: 0 }}>
        <button
          className={`gtr-map-chip${region === "all" ? " on" : ""}`}
          onClick={() => setRegion("all")}
        >
          {t("Все регионы")}
        </button>
        {Object.entries(data.byRegion)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([code, b]) => (
            <button
              key={code}
              className={`gtr-map-chip${region === code ? " on" : ""}`}
              onClick={() => setRegion(region === code ? "all" : code)}
            >
              {regionName(code, i18n.language)} · {b.ready}/{b.total}
            </button>
          ))}
      </div>

      {/* Смена на сегодня: двадцать штук. Не потому что круглое число, а
          потому что столько успевает один человек за рабочий день. */}
      <div style={{ display: "grid", gap: 4 }}>
        {queue.slice(0, open ? 60 : 20).map((r) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "7px 10px",
              background: "var(--gtr-card2)",
              borderLeft: `2px solid ${LEVEL_COLOR[r.level]}`,
            }}
          >
            <button
              onClick={() =>
                navigate({ to: "/gtr/$screen", params: { screen: "venueCard" }, search: { vid: r.id } })
              }
              style={{
                flex: 1,
                minWidth: 160,
                textAlign: "left",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                font: "600 12.5px/1.45 'Golos Text',sans-serif",
                padding: 0,
              }}
            >
              {r.name}
              <span className="gtr-mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--gtr-t3)" }}>
                {r.area}
              </span>
            </button>
            <span
              className="gtr-mono"
              style={{ font: "600 10px/1 'JetBrains Mono',monospace", color: LEVEL_COLOR[r.level], letterSpacing: ".06em", textTransform: "uppercase" }}
            >
              {t(r.level)}
            </span>
            {/* Сегодняшний шаг горит, остальные пробелы приглушены. Иначе
                менеджер каждый раз соображает, что из списка нужно сейчас,
                а что подождёт до следующей ступени. */}
            <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {r.gaps.map((g) => {
                const f = FILL_FIELDS.find((x) => x.key === g)!;
                const now = stepGaps(r.gaps).includes(g);
                return (
                  <span
                    key={g}
                    title={t(f.why)}
                    className="gtr-chip"
                    style={{
                      border: `1px solid ${now ? "rgba(229,35,27,.55)" : "rgba(255,255,255,.12)"}`,
                      color: now ? "#FF8B84" : "var(--gtr-t3)",
                      fontSize: 10.5,
                      padding: "3px 6px",
                    }}
                  >
                    {t(f.label)}
                  </span>
                );
              })}
            </span>
          </div>
        ))}
        {!queue.length ? (
          <div style={{ padding: "14px 4px", font: "500 12.5px/1.5 'Golos Text',sans-serif", color: GREEN }}>
            {t("В этом регионе всё доведено до витрины.")}
          </div>
        ) : null}
      </div>

      {queue.length > 20 ? (
        <button className="gtr-btn" style={{ justifySelf: "start", padding: "6px 11px", fontSize: 12 }} onClick={() => setOpen(!open)}>
          {open ? t("Свернуть до смены") : `${t("Показать ещё")} · ${Math.min(40, queue.length - 20)}`}
        </button>
      ) : null}
    </Card>
  );
}

export function OutreachScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [rows, setRows] = useState<Record<string, OutreachRow>>({});
  const [openVid, setOpenVid] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copied, setCopied] = useState("");

  // Масштаб базы берём из самой базы. В шаблонах раньше стояли «110
  // площадок» и «312 артистов» строкой: база выросла до 354 в шести
  // регионах, а письма продолжали называть старое число — и занижали нас
  // же втрое по географии.
  const [artistCount, setArtistCount] = useState(0);
  useEffect(() => {
    void loadArtists().then((b) => setArtistCount(b.artists.length));
  }, []);
  const scale = useMemo(
    () => ({
      venues: PH.venues.length,
      artists: artistCount,
      regions: Object.keys(REGIONS).length,
    }),
    [artistCount],
  );

  const manager: Manager = useMemo(
    // Телефон и ник берём из профиля аккаунта, если менеджер их указал:
    // подпись без контактов бесполезна, а придумывать их нельзя.
    () => ({ name: user.name, phone: (user as { phone?: string }).phone, tg: (user as { tgNick?: string }).tgNick }),
    [user],
  );

  useEffect(() => {
    void outreachAllFn().then((r) => {
      const map: Record<string, OutreachRow> = {};
      for (const row of r.rows) map[row.vid] = row;
      setRows(map);
    });
  }, []);

  const save = async (vid: string, patch: Partial<OutreachRow>) => {
    setRows((p) => ({
      ...p,
      [vid]: { ...(p[vid] ?? { vid, stage: "new", updatedAt: 0 }), ...patch, updatedAt: Date.now() },
    }));
    await outreachSaveFn({ data: { vid, ...patch } }).catch(() => {});
  };

  const stageOf = (vid: string) => rows[vid]?.stage ?? "new";

  // Порядок работы: сначала те, кого не трогали, потом начатые. Готовые
  // уезжают вниз — они уже не требуют внимания.
  const list = useMemo(() => {
    const order = ["new", "written", "talking", "collecting", "agreed", "live", "refused"];
    return PH.venues
      .filter((v) => filter === "all" || stageOf(v.id) === filter)
      .sort((a, b) => order.indexOf(stageOf(a.id)) - order.indexOf(stageOf(b.id)));
  }, [rows, filter]);

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of PH.venues) c[stageOf(v.id)] = (c[stageOf(v.id)] ?? 0) + 1;
    return c;
  }, [rows]);

  const hit = async (text: string, label: string) => {
    const ok = await copy(text);
    setCopied(ok ? label : "не скопировалось — выдели вручную");
    window.setTimeout(() => setCopied(""), 2200);
  };

  const row = openVid ? rows[openVid] : undefined;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <Eyebrow style={{ marginBottom: 12 }}>{t("РАБОТА С ПЛОЩАДКАМИ")}</Eyebrow>

      <FillPipeline />

      {/* Личный счёт: сколько пройдено и где сейчас узкое место */}
      <Card style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {STAGES.map(([key, label]) => (
            <button
              key={key}
              className="gtr-chip"
              onClick={() => setFilter(filter === key ? "all" : key)}
              style={{
                border: 0,
                cursor: "pointer",
                background: filter === key ? "rgba(123,77,255,.28)" : "rgba(255,255,255,.06)",
                color: STAGE_COLOR[key],
                font: "700 13px/1 'JetBrains Mono',monospace",
                padding: "9px 12px",
              }}
            >
              {label} · {stats[key] ?? 0}
            </button>
          ))}
        </div>
        <div
          className="gtr-mono"
          style={{ marginTop: 12, font: "500 13px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {t("Всего площадок:")} {PH.venues.length}{t(". Твоя цель — довести каждую до «Карточка готова».")}
        </div>
      </Card>

      {copied ? (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 300,
            padding: "10px 16px",
            background: "rgba(46,204,113,.92)",
            color: "#04121a",
            font: "700 12px/1 'Golos Text',sans-serif",
          }}
        >
          {copied}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {list.map((v) => {
          const st = stageOf(v.id);
          const r = rows[v.id];
          const isOpen = openVid === v.id;
          return (
            <Card key={v.id} style={{ padding: 0 }}>
              <button
                onClick={() => setOpenVid(isOpen ? null : v.id)}
                style={{
                  width: "100%",
                  border: 0,
                  background: "none",
                  color: "inherit",
                  textAlign: "left",
                  padding: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{ width: 8, height: 8, flex: "none", background: STAGE_COLOR[st] }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ font: "700 14px/1.45 'Golos Text',sans-serif" }}>{v.name}</span>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", font: "500 12px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {v.area} · {v.type}
                    {r?.owner ? ` · ${r.owner}` : ""}
                  </span>
                </span>
                <span
                  className="gtr-mono"
                  style={{ font: "700 12px/1 'JetBrains Mono',monospace", color: STAGE_COLOR[st] }}
                >
                  {STAGES.find(([k]) => k === st)?.[1]}
                </span>
              </button>

              {isOpen ? (
                <div style={{ padding: "0 14px 16px", display: "grid", gap: 14 }}>
                  {/* Куда идти за контентом: значки ведут прямо в источники */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {v.social ? (
                      <a className="gtr-btn" href={v.social} target="_blank" rel="noreferrer">
                        Instagram ↗
                      </a>
                    ) : null}
                    {v.website ? (
                      <a className="gtr-btn" href={v.website} target="_blank" rel="noreferrer">
                        {t("Сайт ↗")}
                      </a>
                    ) : null}
                    <a
                      className="gtr-btn"
                      href={`https://www.google.com/maps/search/${encodeURIComponent(`${v.name} Phuket`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps ↗
                    </a>
                    <a
                      className="gtr-btn"
                      href={`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(v.name)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Поиск в IG ↗")}
                    </a>
                  </div>

                  {/* Стадия работы */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {STAGES.map(([key, label]) => (
                      <button
                        key={key}
                        className="gtr-chip"
                        onClick={() => void save(v.id, { stage: key })}
                        style={{
                          border: 0,
                          cursor: "pointer",
                          padding: "8px 11px",
                          font: "600 13px/1 'Golos Text',sans-serif",
                          background: st === key ? "rgba(123,77,255,.3)" : "rgba(255,255,255,.06)",
                          color: st === key ? "#fff" : "var(--gtr-t2)",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Что собрано: галочки по требованиям */}
                  <div>
                    <Eyebrow style={{ marginBottom: 8 }}>{t("ЧТО НУЖНО СОБРАТЬ")}</Eyebrow>
                    <div style={{ display: "grid", gap: 6 }}>
                      {NEEDS.map((n) => {
                        const done = (r?.done ?? []).includes(n.key);
                        return (
                          <button
                            key={n.key}
                            onClick={() =>
                              void save(v.id, {
                                done: done
                                  ? (r?.done ?? []).filter((x) => x !== n.key)
                                  : [...(r?.done ?? []), n.key],
                              })
                            }
                            style={{
                              border: 0,
                              cursor: "pointer",
                              textAlign: "left",
                              padding: "9px 11px",
                              background: done ? "rgba(46,204,113,.14)" : "rgba(255,255,255,.05)",
                              color: "inherit",
                              display: "flex",
                              gap: 10,
                            }}
                          >
                            <span style={{ color: done ? "#2ECC71" : "var(--gtr-t3)" }}>{done ? "✓" : "○"}</span>
                            <span style={{ flex: 1 }}>
                              <span style={{ font: "600 12.5px/1.5 'Golos Text',sans-serif" }}>{n.title}</span>
                              <span
                                style={{
                                  display: "block",
                                  font: "500 13px/1.45 'Golos Text',sans-serif",
                                  color: "var(--gtr-t3)",
                                }}
                              >
                                {n.why}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ссылки на найденный контент */}
                  <div>
                    <Eyebrow style={{ marginBottom: 8 }}>{t("ССЫЛКИ НА МАТЕРИАЛЫ")}</Eyebrow>
                    <div style={{ display: "grid", gap: 6 }}>
                      {(["фото", "меню", "прайс", "афиша", "контакт"] as const).map((k) => (
                        <input
                          key={k}
                          className="gtr-input"
                          placeholder={`${k}: ссылка или заметка`}
                          defaultValue={r?.links?.[k] ?? ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (r?.links?.[k] ?? "")) void save(v.id, { links: { [k]: val } });
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Готовые тексты. Шаблон — заготовка, а не приговор:
                      он открывается в поле, где его правят под площадку,
                      и правку видно до отправки, а не после. */}
                  <Drafter
                    manager={manager}
                    venue={v.name}
                    vid={v.id}
                    pitch={{ scale, link: r?.links?.invite || undefined }}
                    onCopy={hit}
                    onLink={(url) => void save(v.id, { links: { invite: url } })}
                  />

                  <textarea
                    className="gtr-input"
                    rows={2}
                    placeholder={t("Заметка: что сказали, когда перезвонить")}
                    defaultValue={r?.note ?? ""}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== (r?.note ?? "")) void save(v.id, { note: e.target.value.trim() });
                    }}
                  />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div style={{ height: 40 }} />
      <Chip color="rgba(123,77,255,.7)">{t("Тексты и скрипт подставляют твоё имя из профиля")}</Chip>
    </div>
  );
}
