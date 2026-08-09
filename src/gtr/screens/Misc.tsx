import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { can, PERMISSIONS } from "../auth";
import {
  AMBER,
  CONTACT,
  FIN_BLOCKER,
  FIN_KPI,
  fmtThb,
  GREEN,
  INQ,
  PH,
  RED,
  richOf,
  ROLES,
  SPACES,
  SPACES_TECH,
  V,
} from "../data/app-data";
import { useGtr } from "../store";
import { Card, Chip, Dot, Eyebrow } from "../ui";

const Title = ({ children }: { children: string }) => (
  <h1 className="gtr-oswald" style={{ font: "700 22px/1 Oswald,sans-serif", margin: "0 0 16px" }}>
    {children}
  </h1>
);

const NoAccess = ({ what }: { what: string }) => (
  <Card style={{ maxWidth: 520, margin: "60px auto", padding: 28, textAlign: "center" }}>
    <div
      className="gtr-oswald"
      style={{ font: "600 18px/1.2 Oswald,sans-serif", marginBottom: 10 }}
    >
      Доступ ограничен
    </div>
    <div style={{ font: "500 12px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
      Для вашей роли раздел «{what}» закрыт матрицей прав. Запросите доступ у GTR-админа — раздел
      «Доступы и роли».
    </div>
  </Card>
);

// ---------- заявки организаторов ----------
export function InquiriesScreen() {
  const { user, shared, updateRequest, setGraph } = useGtr();
  const vid = user.venueId || "VEN-0013";
  const rows = INQ[vid] ?? INQ["VEN-0013"];
  const [replied, setReplied] = useState<number[]>([]);

  // Входящие запросы организаторов (собраны на витрине, падают со сметой)
  const incoming = shared.requests.filter((r) => r.venueId === vid).sort((a, b) => b.ts - a.ts);

  // Принять запрос: помечаем и переводим событие в стадию «Утверждено»
  const acceptRequest = (id: string, name: string) => {
    updateRequest(id, { status: "accepted" });
    setGraph(vid, (gr) => ({
      ...gr,
      stage: "approved",
      log: [
        { ts: Date.now(), actor: user.roleLabel, action: `Запрос принят: ${name}` },
        ...(gr.log ?? []),
      ].slice(0, 40),
    }));
  };

  const blockers =
    user.role === "owner"
      ? [
          [
            "Живой календарь",
            "Доступность подтверждается вручную — организатор ждёт ответа",
            AMBER,
          ],
          ["Депозит и отмена", "Условия не зафиксированы в кабинете", RED],
          ["Комиссия", "Не согласована с GTR", RED],
        ]
      : user.role === "sales"
        ? [
            ["Матрица вместимости", "Полная матрица сетапов по залам не загружена", RED],
            ["Net-ставки", "Нетто-ставки и пакеты не получены", RED],
            ["AV и тех-райдер", "Свет, звук, экраны — нет структурированных данных", AMBER],
          ]
        : [
            [
              "Прайс-лист",
              "Нет в «Готовности к бронированию» — расчёт для организатора невозможен",
              RED,
            ],
            [
              "Презентация приватной аренды",
              "P0 по Illuzion Group: презентация, комиссия, правила промоутеров",
              RED,
            ],
            [
              "Вместимость Empire и Shelter",
              "Публично не заявлена — нужны цифры от площадки",
              AMBER,
            ],
          ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 className="gtr-oswald" style={{ font: "700 22px/1 Oswald,sans-serif", margin: 0 }}>
          Заявки организаторов
        </h1>
        {incoming.length ? (
          <Chip color="#2ECC71" style={{ animation: "gtrpulse 2s ease-out infinite" }}>
            +{incoming.length} ЧЕРЕЗ GTR
          </Chip>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(270px,320px)", gap: 16 }}>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {incoming.length ? (
            <Card style={{ borderColor: "rgba(46,204,113,.3)" }}>
              <div
                className="gtr-oswald"
                style={{
                  font: "600 13px/1 Oswald,sans-serif",
                  padding: "13px 20px",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  color: "#2ECC71",
                }}
              >
                Входящие через GTR · {incoming.length}
              </div>
              {incoming.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: "14px 20px",
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                    borderLeft: "2px solid #2ECC71",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{ display: "block", font: "600 13px/1.3 'Golos Text',sans-serif" }}
                      >
                        {r.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 4,
                          font: "500 10.5px/1.4 'Golos Text',sans-serif",
                          color: "var(--gtr-t2)",
                        }}
                      >
                        {r.organizerName} · {r.date} · {r.guests} гостей · {r.organizerContact}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", flex: "none" }}>
                      <span
                        className="gtr-mono"
                        style={{
                          display: "block",
                          font: "700 14px/1 'JetBrains Mono',monospace",
                          color: "#2ECC71",
                        }}
                      >
                        {fmtThb(r.quoteTotal)}
                      </span>
                      <span className="gtr-eyebrow" style={{ fontSize: 8 }}>
                        КОМ. GTR {fmtThb(r.quoteCommission)}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 9,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    {r.lines.slice(0, 5).map((l, j) => (
                      <Chip key={j} color="rgba(255,255,255,.5)">
                        {l.label}
                      </Chip>
                    ))}
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <Chip
                        color={
                          r.status === "accepted"
                            ? GREEN
                            : r.status === "declined"
                              ? RED
                              : r.status === "seen"
                                ? AMBER
                                : "#2ECC71"
                        }
                      >
                        {r.status === "accepted"
                          ? "ПРИНЯТО"
                          : r.status === "declined"
                            ? "ОТКЛОНЕНО"
                            : r.status === "seen"
                              ? "ПРОСМОТРЕНО"
                              : "НОВЫЙ"}
                      </Chip>
                      {r.status !== "accepted" && r.status !== "declined" ? (
                        <>
                          <button
                            className="gtr-btn gtr-btn-red"
                            style={{ padding: "5px 10px", fontSize: 10 }}
                            disabled={!can(user.role, "inquiries.reply")}
                            onClick={() => acceptRequest(r.id, r.title)}
                          >
                            Принять
                          </button>
                          <button
                            className="gtr-btn"
                            style={{ padding: "5px 10px", fontSize: 10 }}
                            disabled={!can(user.role, "inquiries.reply")}
                            onClick={() => updateRequest(r.id, { status: "declined" })}
                          >
                            Отклонить
                          </button>
                        </>
                      ) : null}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          ) : null}

          <Card>
            {rows.map(([day, mon, title, meta, budget, sla, status, c, cta], i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "15px 20px",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  borderLeft: `2px solid ${c}`,
                }}
              >
                <span style={{ textAlign: "center", flex: "none", width: 40 }}>
                  <span
                    className="gtr-mono"
                    style={{ display: "block", font: "700 17px/1 'JetBrains Mono',monospace" }}
                  >
                    {day}
                  </span>
                  <span className="gtr-eyebrow" style={{ fontSize: 8.5 }}>
                    {mon}
                  </span>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}
                  >
                    {title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      font: "500 10.5px/1.4 'Golos Text',sans-serif",
                      color: "var(--gtr-t2)",
                    }}
                  >
                    {meta}
                  </span>
                  <span
                    className="gtr-mono"
                    style={{
                      display: "block",
                      marginTop: 4,
                      font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    Бюджет: {budget} · {sla}
                  </span>
                </span>
                <Chip color={c} style={{ width: 108, textAlign: "center" }}>
                  {replied.includes(i) ? "ОТВЕЧЕНО" : status}
                </Chip>
                <button
                  className={`gtr-btn ${cta === "Ответить" && !replied.includes(i) ? "gtr-btn-red" : ""}`}
                  disabled={!can(user.role, "inquiries.reply")}
                  onClick={() => setReplied((r) => (r.includes(i) ? r : [...r, i]))}
                >
                  {replied.includes(i) ? "Открыть" : cta}
                </button>
              </div>
            ))}
          </Card>
        </div>
        <Card style={{ alignSelf: "start", padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ЧТО БЛОКИРУЕТ БЫСТРЫЙ ОТВЕТ</Eyebrow>
          <div style={{ display: "grid", gap: 10 }}>
            {blockers.map(([t, d, c]) => (
              <div key={String(t)} style={{ display: "flex", gap: 9 }}>
                <Dot color={String(c)} />
                <div>
                  <div style={{ font: "600 11.5px/1.3 'Golos Text',sans-serif" }}>{t}</div>
                  <div
                    style={{
                      marginTop: 3,
                      font: "500 10.5px/1.45 'Golos Text',sans-serif",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------- залы и прайс ----------
export function SpacesScreen() {
  const { user } = useGtr();
  const vid = user.venueId || "VEN-0013";
  const sp = SPACES(vid);
  const v = V(vid);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Title>Залы и прайс</Title>
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1.4fr",
            gap: 10,
            padding: "12px 20px",
            borderBottom: "1px solid rgba(255,255,255,.07)",
          }}
        >
          {["ЗАЛ", "ПЛОЩАДЬ", "ВМЕСТИМОСТЬ", "СТАТУС"].map((h) => (
            <span key={h} className="gtr-eyebrow">
              {h}
            </span>
          ))}
        </div>
        {(sp.length
          ? sp
          : [
              {
                id: "none",
                name: "Залы не нормализованы",
                type: "—",
                sqm: "",
                capTheatre: "",
                capCocktail: "",
                notes: "Импорт залов в очереди исследований",
                bookable: "Требует данных",
              },
            ]
        ).map((x) => (
          <div
            key={x.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1.4fr",
              gap: 10,
              padding: "13px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
              alignItems: "center",
            }}
          >
            <span>
              <span style={{ display: "block", font: "600 12.5px/1.3 'Golos Text',sans-serif" }}>
                {x.name}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  font: "500 10px/1.4 'Golos Text',sans-serif",
                  color: "var(--gtr-t3)",
                }}
              >
                {[x.type, x.notes].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace" }}>
              {x.sqm ? `${x.sqm} м²` : "—"}
            </span>
            <span
              className="gtr-mono"
              style={{ font: "500 10.5px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
            >
              {x.capCocktail
                ? `${x.capCocktail} коктейль`
                : x.capTheatre
                  ? `${x.capTheatre} театр`
                  : "—"}
            </span>
            <span>
              <Chip
                color={
                  /Published/i.test(String(x.bookable || ""))
                    ? GREEN
                    : /Inquiry|request/i.test(String(x.bookable || ""))
                      ? AMBER
                      : RED
                }
              >
                {String(x.bookable || "—").toUpperCase()}
              </Chip>
            </span>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20 }}>
        <Eyebrow style={{ marginBottom: 10 }}>ТЕХНИКА И ИНФРАСТРУКТУРА</Eyebrow>
        <div style={{ font: "500 12px/1.7 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {SPACES_TECH[vid] ?? v.facilities ?? "Данные уточняются у площадки."}
        </div>
      </Card>
    </div>
  );
}

// ---------- паспорт площадки ----------
export function VenueScreen() {
  const { user } = useGtr();
  const navigate = useNavigate();
  const vid = user.venueId || "VEN-0013";
  const v = V(vid);
  const ct = CONTACT(vid);
  const rich = richOf(vid);
  const R = v.readiness;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Title>Паспорт площадки</Title>

      <Card
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "24px 26px",
          marginBottom: 16,
          minHeight: 150,
        }}
      >
        {rich.hero ? (
          <>
            <img
              src={rich.hero}
              alt={v.name}
              loading="lazy"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(90deg,#0A0B0Dee,#0A0B0D55)",
              }}
            />
          </>
        ) : null}
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>{v.id}</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <h2
              className="gtr-oswald"
              style={{ font: "700 26px/1.05 Oswald,sans-serif", margin: 0 }}
            >
              {v.name}
            </h2>
            <Chip color={v.verified ? GREEN : AMBER}>
              {v.verified ? `ПРОВЕРЕНО ${v.verified}` : "НЕ ВЕРИФИЦИРОВАНО"}
            </Chip>
            {rich.badge ? <Chip color="#FFD166">{rich.badge}</Chip> : null}
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
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 16 }}>
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ДАННЫЕ ПЛОЩАДКИ</Eyebrow>
          {[
            ["ФОРМАТЫ СОБЫТИЙ", v.events],
            ["ЗОНЫ И ИНФРАСТРУКТУРА", v.facilities],
            ["ВМЕСТИМОСТЬ", v.capacity],
            ["МУЗЫКА / РАЗВЛЕЧЕНИЯ", v.music],
            ["ИНТЕГРАЦИОННЫЕ ЗАМЕТКИ", v.notes],
          ]
            .filter(([, val]) => val)
            .map(([k, val]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                }}
              >
                <span className="gtr-eyebrow" style={{ width: 150, flex: "none", paddingTop: 2 }}>
                  {k}
                </span>
                <span
                  style={{
                    font: "500 11.5px/1.55 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {String(val)}
                </span>
              </div>
            ))}
        </Card>

        <Card style={{ padding: 18, alignSelf: "start" }}>
          <Eyebrow style={{ marginBottom: 10 }}>ИСТОЧНИКИ</Eyebrow>
          {[
            ["Официальный сайт", v.website || v.source || "—", v.website || v.source ? GREEN : RED],
            ["Галерея / фото", "только официальная галерея", AMBER],
            ["Instagram", v.social || "не указан", v.social ? AMBER : "rgba(255,255,255,.3)"],
            ["Телефон", v.phone || ct?.phone || "—", v.phone || ct?.phone ? GREEN : RED],
          ].map(([k, val, c]) => (
            <div
              key={String(k)}
              style={{
                display: "flex",
                gap: 9,
                padding: "7px 0",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  flex: "none",
                  borderRadius: "50%",
                  background: String(c),
                  position: "relative",
                  top: 1,
                }}
              />
              <span className="gtr-eyebrow" style={{ width: 110, flex: "none" }}>
                {k}
              </span>
              <span
                style={{
                  font: "500 10.5px/1.5 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                  wordBreak: "break-all",
                }}
              >
                {String(val)}
              </span>
            </div>
          ))}
          {R ? (
            <>
              <Eyebrow style={{ margin: "14px 0 8px" }}>ЧЕК-ЛИСТ · {R.score}/100</Eyebrow>
              {[
                ["Контакт подтверждён", R.contactVerified === "Yes" ? GREEN : AMBER],
                ["Прайс-лист", /Missing/i.test(R.rate) ? RED : GREEN],
                ["Договор / комиссия", /Missing/i.test(R.contract) ? RED : GREEN],
                ["Права на фото", AMBER],
              ].map(([k, c]) => (
                <div
                  key={String(k)}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0" }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", background: String(c) }}
                  />
                  <span
                    style={{ font: "500 11px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
                  >
                    {k}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </Card>
      </div>

      {rich.gallery?.length ? (
        <Card style={{ padding: 18, marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ ГАЛЕРЕЯ · {rich.credit}</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {rich.gallery.slice(0, 8).map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                style={{
                  width: "100%",
                  aspectRatio: "3/2",
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.08)",
                }}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {rich.afisha?.length ? (
        <Card style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>ОФИЦИАЛЬНАЯ АФИША · {rich.src}</Eyebrow>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
              gap: 10,
            }}
          >
            {rich.afisha.map(([date, title, meta, img, badge]) => (
              <Card
                key={title + date}
                hover
                style={{ background: "var(--gtr-card2)", overflow: "hidden" }}
              >
                {img ? (
                  <img
                    src={img}
                    alt={title}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover" }}
                  />
                ) : null}
                <div style={{ padding: "10px 12px" }}>
                  <div
                    className="gtr-mono"
                    style={{
                      font: "700 9.5px/1 'JetBrains Mono',monospace",
                      color: "#E5231B",
                      marginBottom: 5,
                    }}
                  >
                    {date}
                  </div>
                  <div style={{ font: "600 12px/1.3 'Golos Text',sans-serif" }}>{title}</div>
                  <div
                    style={{
                      margin: "4px 0 6px",
                      font: "500 9.5px/1.4 'JetBrains Mono',monospace",
                      color: "var(--gtr-t3)",
                    }}
                  >
                    {meta}
                  </div>
                  {badge ? <Chip color={GREEN}>{badge}</Chip> : null}
                </div>
              </Card>
            ))}
          </div>
          {rich.artistsNote ? (
            <div
              style={{
                marginTop: 12,
                font: "500 11px/1.6 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {rich.artistsNote}
            </div>
          ) : null}
        </Card>
      ) : null}

      {user.role === "gtr" ? (
        <button
          className="gtr-btn"
          style={{ marginTop: 14 }}
          onClick={() => navigate({ to: "/gtr/$screen", params: { screen: "base" } })}
        >
          ← К базе Пхукета
        </button>
      ) : null}
    </div>
  );
}

// ---------- финансы ----------
export function FinanceScreen() {
  const { user } = useGtr();
  if (!can(user.role, "finance.view")) return <NoAccess what="Финансы" />;

  const vid = user.venueId || "VEN-0013";
  const v = V(vid);
  const R = v.readiness;
  const rateMissing = !R || /Missing/i.test(R.rate || "Missing");

  const terms: [string, string, string, string][] = [
    [
      "Прайс-лист",
      rateMissing
        ? "Не опубликован — организатор не видит расчёт"
        : "Опубликован в источнике площадки",
      rateMissing ? "НЕТ" : "OK",
      rateMissing ? RED : GREEN,
    ],
    [
      "Договор с платформой",
      R && !/Missing/i.test(R.contract) ? "Согласован" : "Не согласован — блокирует «подтверждено»",
      R && !/Missing/i.test(R.contract) ? "ОК" : "НЕТ",
      R && !/Missing/i.test(R.contract) ? GREEN : RED,
    ],
    [
      "Условия оплаты",
      R && !/Missing/i.test(R.payment) ? "Определены" : "Не определены",
      R && !/Missing/i.test(R.payment) ? "ОК" : "НЕТ",
      R && !/Missing/i.test(R.payment) ? GREEN : RED,
    ],
    [
      "Метод доступности",
      R?.avail || "Ручной запрос",
      /Manual|Proposal|enquiry/i.test(R?.avail || "Вручную") ? "ВРУЧНУЮ" : "ОК",
      /Manual|Proposal|enquiry/i.test(R?.avail || "Вручную") ? AMBER : GREEN,
    ],
    ["Права на фото", R?.photo || "Только официальная галерея", "ОГРАНИЧЕНО", AMBER],
    [
      "Тех-райдер",
      R?.rider || "Не опубликован",
      /Published/i.test(R?.rider || "") ? "ОК" : "ЧАСТИЧНО",
      /Published/i.test(R?.rider || "") ? GREEN : AMBER,
    ],
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Title>Финансы</Title>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}
      >
        {(FIN_KPI[vid] ?? FIN_KPI["VEN-0013"]).map(([label, value, color, note]) => (
          <Card
            key={label}
            style={{
              padding: "18px 20px",
              borderColor: color === RED ? "rgba(229,35,27,.35)" : undefined,
            }}
          >
            <Eyebrow>{label}</Eyebrow>
            <div
              className="gtr-mono"
              style={{
                margin: "10px 0 8px",
                font: "700 17px/1.1 'JetBrains Mono',monospace",
                color,
              }}
            >
              {value}
            </div>
            <div style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {note}
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div
          className="gtr-oswald"
          style={{
            font: "600 14px/1 Oswald,sans-serif",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,.05)",
          }}
        >
          Коммерческие условия
        </div>
        {terms.map(([label, desc, status, c]) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            <Dot color={c} top={0} />
            <span
              style={{ flex: "none", width: 190, font: "600 12px/1.3 'Golos Text',sans-serif" }}
            >
              {label}
            </span>
            <span
              style={{
                flex: 1,
                font: "500 11px/1.4 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {desc}
            </span>
            <Chip color={c}>{status}</Chip>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20, borderColor: "rgba(229,35,27,.3)" }}>
        <Eyebrow style={{ marginBottom: 8, color: "#E5231B" }}>ГЛАВНЫЙ БЛОКЕР</Eyebrow>
        <div style={{ font: "500 12px/1.7 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {FIN_BLOCKER[vid] ?? FIN_BLOCKER["VEN-0013"]}
        </div>
      </Card>
    </div>
  );
}

// ---------- доступы и роли ----------
export function AccessScreen() {
  const { user } = useGtr();
  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <Title>Доступы и роли</Title>
      <Card style={{ overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr repeat(4, minmax(96px,1fr))",
            gap: 8,
            padding: "13px 20px",
            borderBottom: "1px solid rgba(255,255,255,.08)",
            minWidth: 640,
          }}
        >
          <span className="gtr-eyebrow">ПРАВО</span>
          {ROLES.map(([id, label]) => (
            <span
              key={id}
              className="gtr-eyebrow"
              style={{ textAlign: "center", color: id === user.role ? "#E5231B" : undefined }}
            >
              {label}
            </span>
          ))}
        </div>
        {PERMISSIONS.map((p) => (
          <div
            key={p.key}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr repeat(4, minmax(96px,1fr))",
              gap: 8,
              padding: "11px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
              alignItems: "center",
              minWidth: 640,
            }}
          >
            <span style={{ font: "500 11.5px/1.4 'Golos Text',sans-serif" }}>{p.label}</span>
            {ROLES.map(([id]) => (
              <span key={id} style={{ textAlign: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    alignItems: "center",
                    justifyContent: "center",
                    font: "700 10px/1 'JetBrains Mono',monospace",
                    background: p.roles[id] ? "rgba(46,204,113,.14)" : "rgba(255,255,255,.05)",
                    color: p.roles[id] ? GREEN : "rgba(255,255,255,.25)",
                    border: `1px solid ${p.roles[id] ? "rgba(46,204,113,.4)" : "rgba(255,255,255,.08)"}`,
                  }}
                >
                  {p.roles[id] ? "✓" : "—"}
                </span>
              </span>
            ))}
          </div>
        ))}
      </Card>
      <div
        className="gtr-mono"
        style={{
          marginTop: 12,
          font: "500 10.5px/1.6 'JetBrains Mono',monospace",
          color: "var(--gtr-t3)",
        }}
      >
        Права применяются на сервере при входе и в интерфейсе (кнопки/разделы). Ваша роль:{" "}
        {user.roleLabel}.
      </div>
    </div>
  );
}

// ---------- GTR-админ ----------
export function AdminScreen() {
  const { user } = useGtr();
  const navigate = useNavigate();
  if (!can(user.role, "network.manage")) return <NoAccess what="GTR-админ" />;

  const quar = PH.venues.filter(
    (x) => x.confidence === "Low" || /verify|Closed/i.test(x.status || ""),
  );
  const ready = PH.venues
    .filter((x) => x.readiness)
    .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Title>GTR-админ · консоль сети</Title>

      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}
      >
        {[
          ["ПЛОЩАДОК", PH.meta.total, "#fff"],
          ["ЗАЛОВ", PH.meta.spaces, "#fff"],
          ["КОНТАКТОВ P0/P1", PH.meta.contacts, AMBER],
          ["КАРАНТИН", quar.length, RED],
        ].map(([l, v2, c]) => (
          <Card key={String(l)} style={{ padding: "16px 18px" }}>
            <Eyebrow>{l}</Eyebrow>
            <div
              className="gtr-mono"
              style={{
                marginTop: 10,
                font: "700 26px/1 'JetBrains Mono',monospace",
                color: String(c),
              }}
            >
              {v2}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "15px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            Пайплайн онбординга
          </div>
          {ready.slice(0, 8).map((x) => (
            <div
              key={x.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 20px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                cursor: "pointer",
              }}
              onClick={() =>
                navigate({
                  to: "/gtr/$screen",
                  params: { screen: "venueCard" },
                  search: { vid: x.id },
                })
              }
            >
              <span
                className="gtr-mono"
                style={{
                  font: "700 14px/1 'JetBrains Mono',monospace",
                  width: 30,
                  color: (x.readiness?.score ?? 0) >= 70 ? GREEN : AMBER,
                }}
              >
                {x.readiness?.score}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                  {x.name}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {x.readiness?.state} · {x.area}
                </span>
              </span>
              <Chip color={x.readiness?.state === "Бронируемая" ? GREEN : AMBER}>
                {(x.readiness?.state ?? "").toUpperCase()}
              </Chip>
            </div>
          ))}
        </Card>

        <Card style={{ alignSelf: "start" }}>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "15px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            Карантин источников · {quar.length}
          </div>
          {quar.slice(0, 8).map((x) => (
            <div
              key={x.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 20px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
              }}
            >
              <Dot color={RED} top={0} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", font: "600 12px/1.3 'Golos Text',sans-serif" }}>
                  {x.name}
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    font: "500 9.5px/1.3 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {x.status} · confidence {x.confidence}
                </span>
              </span>
            </div>
          ))}
          <div style={{ padding: "13px 20px" }}>
            <Eyebrow style={{ marginBottom: 8 }}>ОЧЕРЕДЬ ИССЛЕДОВАНИЙ</Eyebrow>
            {PH.research.map((r) => (
              <div key={r.task} style={{ display: "flex", gap: 9, padding: "6px 0" }}>
                <Dot color={r.priority === "P0" ? RED : AMBER} />
                <span
                  style={{
                    flex: 1,
                    font: "500 10.5px/1.5 'Golos Text',sans-serif",
                    color: "var(--gtr-t2)",
                  }}
                >
                  {r.cluster} — {r.task}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 9.5px/1 'JetBrains Mono',monospace",
                    color: r.priority === "P0" ? RED : AMBER,
                  }}
                >
                  {r.priority}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
