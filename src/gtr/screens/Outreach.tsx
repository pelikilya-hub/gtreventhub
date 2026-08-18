// Кабинет менеджера по площадкам.
//
// Одна доска на весь цикл: кого ещё не трогали, кому написали, кто дал
// согласие, что уже собрали. Тексты и скрипт звонка лежат тут же и уже
// подставлены под имя менеджера — переключаться между заметками,
// мессенджером и таблицей не нужно.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PH, V } from "../data/app-data";
import {
  callScript,
  msgChecklist,
  msgFirst,
  msgFollowUp,
  msgInstagram,
  NEEDS,
  STAGES,
  type Manager,
} from "../data/outreach";
import { outreachAllFn, outreachSaveFn, type OutreachRow } from "../kv-api";
import { useGtr } from "../store";
import { Card, Chip, Eyebrow } from "../ui";

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

export function OutreachScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [rows, setRows] = useState<Record<string, OutreachRow>>({});
  const [openVid, setOpenVid] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [copied, setCopied] = useState("");

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
                font: "700 11px/1 'JetBrains Mono',monospace",
                padding: "9px 12px",
              }}
            >
              {label} · {stats[key] ?? 0}
            </button>
          ))}
        </div>
        <div
          className="gtr-mono"
          style={{ marginTop: 12, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
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
                  <span style={{ font: "700 14px/1.3 'Golos Text',sans-serif" }}>{v.name}</span>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", font: "500 10.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {v.area} · {v.type}
                    {r?.owner ? ` · ${r.owner}` : ""}
                  </span>
                </span>
                <span
                  className="gtr-mono"
                  style={{ font: "700 10px/1 'JetBrains Mono',monospace", color: STAGE_COLOR[st] }}
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
                          font: "600 11px/1 'Golos Text',sans-serif",
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
                              <span style={{ font: "600 12.5px/1.4 'Golos Text',sans-serif" }}>{n.title}</span>
                              <span
                                style={{
                                  display: "block",
                                  font: "500 11px/1.45 'Golos Text',sans-serif",
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

                  {/* Готовые тексты — уже с именем менеджера */}
                  <div>
                    <Eyebrow style={{ marginBottom: 8 }}>{t("ТЕКСТЫ В ОДИН ТАП")}</Eyebrow>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button className="gtr-btn" onClick={() => void hit(msgFirst(manager, v.name), "Первое сообщение скопировано")}>
                        {t("Первое сообщение")}
                      </button>
                      <button className="gtr-btn" onClick={() => void hit(msgInstagram(manager, v.name), "Директ скопирован")}>
                        {t("Директ в Instagram")}
                      </button>
                      <button className="gtr-btn" onClick={() => void hit(msgFollowUp(manager, v.name), "Напоминание скопировано")}>
                        {t("Напоминание")}
                      </button>
                      <button className="gtr-btn" onClick={() => void hit(msgChecklist(manager, v.name), "Чек-лист скопирован")}>
                        {t("Что прислать")}
                      </button>
                      <button
                        className="gtr-btn"
                        onClick={() =>
                          void hit(
                            callScript(manager, v.name)
                              .map((s) => `${s.step}\n${s.text}`)
                              .join("\n\n"),
                            "Скрипт звонка скопирован",
                          )
                        }
                      >
                        {t("Скрипт звонка")}
                      </button>
                    </div>
                  </div>

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
