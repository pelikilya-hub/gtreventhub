import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  fmtThb,
  PH,
  RATE_COLOR,
  RATE_LABEL,
  rateOf,
  richOf,
  V,
  type Venue,
} from "../data/app-data";
import { GtrProvider, useGtr } from "../store";
import type { SessionUser } from "../auth";
import { ConstructorScreen, type EventIntake } from "./Constructor";
import { Card, Chip, Eyebrow, Icon } from "../ui";

// Гость-организатор: не залогинен, работает через общий стор (запросы падают
// в кабинеты площадок). Отдельная витрина + полный конструктор.
// Роль именно "organizer", а не "gtr". Раньше гость-организатор носил роль
// команды GTR — и это было миной: любой блок, который где-либо проверит
// role === "gtr" (а таких проверок в дереве всё больше: коды площадок,
// ops-метрики, комиссия), молча открылся бы анонимному клиенту. Клиент —
// это клиент, и роль у него клиентская.
const GUEST: SessionUser = {
  email: "organizer@guest",
  name: "Организатор",
  role: "organizer",
  roleLabel: "Организатор",
  venueId: "",
  initials: "ОРГ",
};

type Step =
  | { view: "pick" }
  | { view: "intake"; vid: string }
  | { view: "build"; vid: string; intake: EventIntake }
  | { view: "done"; vid: string; reqId: string };

export function OrganizerScreen() {
  return (
    <GtrProvider user={GUEST}>
      <OrganizerInner />
    </GtrProvider>
  );
}

function OrganizerInner() {
  const [step, setStep] = useState<Step>({ view: "pick" });

  if (step.view === "intake")
    return (
      <IntakeWizard
        vid={step.vid}
        onBack={() => setStep({ view: "pick" })}
        onDone={(intake) => setStep({ view: "build", vid: step.vid, intake })}
      />
    );

  if (step.view === "build")
    return (
      <BuildFrame vid={step.vid} onBack={() => setStep({ view: "intake", vid: step.vid })}>
        <ConstructorScreen
          venueId={step.vid}
          organizer
          intake={step.intake}
          onSubmitted={(reqId) => setStep({ view: "done", vid: step.vid, reqId })}
        />
      </BuildFrame>
    );

  if (step.view === "done")
    return (
      <DoneScreen vid={step.vid} reqId={step.reqId} onAgain={() => setStep({ view: "pick" })} />
    );

  return <PickVenue onPick={(vid) => setStep({ view: "intake", vid })} />;
}

// Форматы событий с подсказкой-предупреждением (умные вопросы без казусов)
const FORMATS: [string, string][] = [
  ["Клубная ночь", "Не забудьте звук и поздний слот — проверьте лимит по шуму."],
  ["Концерт / шоу", "Артисту нужен райдер, сцена и свет."],
  ["Свадьба", "Декор, кейтеринг и договор площадки — обязательны."],
  ["Корпоратив", "AV-пакет, тайминг и договор с юрлицом."],
  ["Конференция", "Зал по вместимости, звук и контент-съёмка."],
  ["Частная вечеринка", "Уточните вместимость зала и депозит."],
];

function IntakeWizard({
  vid,
  onBack,
  onDone,
}: {
  vid: string;
  onBack: () => void;
  onDone: (intake: EventIntake) => void;
}) {
  const { t } = useTranslation();
  const v = V(vid);
  const [format, setFormat] = useState("");
  const [date, setDate] = useState("");
  const [guests, setGuests] = useState("");
  const [budget, setBudget] = useState("");

  const hint = FORMATS.find((f) => f[0] === format)?.[1];
  const cap = String(v.capacity || "");

  return (
    <div>
      <TopBar>
        <span
          className="gtr-mono"
          style={{ font: "500 13px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
        >
          {v.name}
        </span>
        <button className="gtr-btn" onClick={onBack}>
          {t("← Другая площадка")}
        </button>
      </TopBar>

      <div className="gtr-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "36px 30px" }}>
        <Eyebrow>{t("ШАГ 1 · ПАРАМЕТРЫ СОБЫТИЯ")}</Eyebrow>
        <h1
          className="gtr-oswald"
          style={{ font: "700 26px/1.1 Oswald,sans-serif", margin: "10px 0 6px" }}
        >
          {t("Расскажите о событии")}
        </h1>
        <div
          style={{
            font: "500 12px/1.6 'Golos Text',sans-serif",
            color: "var(--gtr-t2)",
            marginBottom: 20,
          }}
        >
          {t("Несколько вопросов, чтобы собрать событие без казусов — площадка")} {v.name}
          {cap ? ` · вместимость ${cap}` : ""}.
        </div>

        <Card style={{ padding: 22 }}>
          <Eyebrow style={{ marginBottom: 9 }}>{t("ФОРМАТ СОБЫТИЯ")}</Eyebrow>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: hint ? 10 : 18 }}>
            {FORMATS.map(([f]) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                style={{
                  border: `1px solid ${format === f ? "#E5231B" : "rgba(255,255,255,.14)"}`,
                  background: format === f ? "rgba(229,35,27,.14)" : "transparent",
                  color: format === f ? "#fff" : "rgba(255,255,255,.65)",
                  borderRadius: 0,
                  padding: "9px 13px",
                  cursor: "pointer",
                  font: `${format === f ? 600 : 500} 12px/1 'Golos Text',sans-serif`,
                }}
              >
                {f}
              </button>
            ))}
          </div>
          {hint ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "9px 12px",
                borderRadius: 0,
                background: "rgba(245,166,35,.1)",
                border: "1px solid rgba(245,166,35,.3)",
                marginBottom: 18,
              }}
            >
              <span style={{ color: "#F5A623", flex: "none", fontWeight: 700 }}>!</span>
              <span
                style={{ font: "500 13px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
              >
                {hint}
              </span>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 5 }}>
              <Eyebrow>{t("ДАТА / ВРЕМЯ")}</Eyebrow>
              <input
                className="gtr-input"
                placeholder={t("напр. 15 авг, 22:00")}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 5 }}>
              <Eyebrow>{t("ГОСТЕЙ")}</Eyebrow>
              <input
                className="gtr-input"
                placeholder={t("напр. 300")}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 5, gridColumn: "1 / -1" }}>
              <Eyebrow>{t("БЮДЖЕТ, ฿ (необязательно)")}</Eyebrow>
              <input
                className="gtr-input"
                placeholder={t("напр. 500000")}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
          </div>

          <button
            className="gtr-btn gtr-btn-red"
            style={{ width: "100%", marginTop: 20, padding: "12px 13px" }}
            disabled={!format}
            onClick={() => onDone({ title: format, date, guests, budget })}
          >
            {t("Собрать событие в конструкторе →")}
          </button>
          {!format ? (
            <div
              style={{
                marginTop: 8,
                textAlign: "center",
                font: "500 12px/1.5 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
              }}
            >
              {t("Выберите формат события, чтобы продолжить")}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function TopBar({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 30px",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        background: "var(--gtr-side)",
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <img
        className="gtr-neon"
        src="/brand/GTR_primary_dark_clean.svg"
        alt="GTR"
        style={{ height: 34, width: "auto" }}
      />
      <Chip color="rgba(255,255,255,.5)">{t("ВИТРИНА ОРГАНИЗАТОРА")}</Chip>
      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

function PickVenue({ onPick }: { onPick: (vid: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [cluster, setCluster] = useState("Все");

  const clusters = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of PH.venues) c[x.cluster] = (c[x.cluster] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, []);

  // Приоритет площадкам с готовностью и фото; карантин скрыт
  const rows = PH.venues
    .filter(
      (x) =>
        x.confidence !== "Low" &&
        !/verify|Closed/i.test(x.status || "") &&
        (cluster === "Все" || x.cluster === cluster) &&
        (!q.trim() ||
          `${x.name} ${x.area} ${x.type}`.toLowerCase().includes(q.toLowerCase().trim())),
    )
    .sort((a, b) => (b.readiness?.score ?? 0) - (a.readiness?.score ?? 0));

  return (
    <div>
      <TopBar />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 30px 40px" }}>
        <div className="gtr-fade">
          <Eyebrow>{t("СОБЕРИТЕ СОБЫТИЕ НА ПХУКЕТЕ")}</Eyebrow>
          <h1
            className="gtr-oswald"
            style={{ font: "700 30px/1.05 Oswald,sans-serif", margin: "10px 0 8px" }}
          >
            {t("Выберите площадку")}
          </h1>
          <div
            style={{
              font: "500 12.5px/1.6 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
              maxWidth: 640,
            }}
          >
            {t("Соберите событие из площадки, залов, артистов и подрядчиков в конструкторе, получите смету с комиссией GTR и отправьте запрос напрямую в кабинет площадки.")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "18px 0 10px" }}>
          {[["Все", PH.venues.length] as [string, number], ...clusters].map(([label, n]) => (
            <button
              key={label}
              onClick={() => setCluster(label)}
              style={{
                border: `1px solid ${cluster === label ? "#E5231B" : "rgba(255,255,255,.12)"}`,
                background: cluster === label ? "#E5231B" : "transparent",
                color: cluster === label ? "#fff" : "rgba(255,255,255,.6)",
                borderRadius: 0,
                padding: "7px 11px",
                cursor: "pointer",
                font: `${cluster === label ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
              }}
            >
              {label} · {n}
            </button>
          ))}
        </div>
        <input
          className="gtr-input"
          style={{ maxWidth: 320, marginBottom: 18 }}
          placeholder={t("Поиск площадки…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
            gap: 14,
          }}
        >
          {rows.slice(0, 48).map((x) => (
            <VenueTile key={x.id} v={x} onPick={() => onPick(x.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VenueTile({ v, onPick }: { v: Venue; onPick: () => void }) {
  const { t } = useTranslation();
  const rich = richOf(v.id);
  const rate = rateOf(v.id);
  // Зелёный чип только у подтверждённых ставок: ориентир GTR — это не цена.
  const firm = rate?.kind === "published" || rate?.kind === "quoted";
  return (
    <Card hover style={{ overflow: "hidden", padding: 0 }} onClick={onPick}>
      <div style={{ position: "relative", aspectRatio: "16/10", background: "var(--gtr-card2)" }}>
        {rich.hero ? (
          <img
            src={rich.hero}
            alt={v.name}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,.15)",
            }}
          >
            <Icon d="M3 21V8l9-5 9 5v13 M9 21v-7h6v7" size={40} />
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg,transparent 40%,#0A0B0Dee)",
          }}
        />
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip color="rgba(255,255,255,.6)">{(v.tag ?? "").toUpperCase()}</Chip>
            {rate ? (
              <Chip color={RATE_COLOR[rate.kind]}>{RATE_LABEL[rate.kind].toUpperCase()}</Chip>
            ) : null}
          </div>
        </div>
      </div>
      <div style={{ padding: "13px 15px" }}>
        <div style={{ font: "600 13.5px/1.45 'Golos Text',sans-serif" }}>{v.name}</div>
        <div
          style={{
            margin: "5px 0 9px",
            font: "500 12px/1.45 'Golos Text',sans-serif",
            color: "var(--gtr-t2)",
          }}
        >
          {v.type} · {v.area}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            className="gtr-mono"
            style={{ font: "600 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
          >
            {rate
              ? `${firm ? "аренда от" : "ориентир"} ${fmtThb(rate.amount)}`
              : "аренда по запросу"}
          </span>
          <span className="gtr-btn gtr-btn-red" style={{ padding: "6px 11px", fontSize: 12 }}>
            {t("Собрать →")}
          </span>
        </div>
      </div>
    </Card>
  );
}

function BuildFrame({
  vid,
  onBack,
  children,
}: {
  vid: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const v = V(vid);
  return (
    <div>
      <TopBar>
        <span
          className="gtr-mono"
          style={{ font: "500 13px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}
        >
          {v.name}
        </span>
        <button className="gtr-btn" onClick={onBack}>
          {t("← Другая площадка")}
        </button>
      </TopBar>
      <div className="gtr-fade" style={{ padding: "22px 30px 40px" }}>
        {children}
      </div>
    </div>
  );
}

function DoneScreen({ vid, reqId, onAgain }: { vid: string; reqId: string; onAgain: () => void }) {
  const { t } = useTranslation();
  const { shared } = useGtr();
  const v = V(vid);
  const req = shared.requests.find((r) => r.id === reqId);

  return (
    <div>
      <TopBar />
      <div className="gtr-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "48px 30px" }}>
        <Card
          style={{ position: "relative", overflow: "hidden", padding: 30, textAlign: "center" }}
        >
          <div className="gtr-beam" />
          <div style={{ position: "relative" }}>
            <div
              className="gtr-presence"
              style={{
                width: 56,
                height: 56,
                borderRadius: 0,
                margin: "0 auto 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(46,204,113,.16)",
                border: "1px solid rgba(46,204,113,.5)",
                color: "#2ECC71",
              }}
            >
              <Icon d="M20 6L9 17l-5-5" size={26} />
            </div>
            <h1
              className="gtr-oswald"
              style={{ font: "700 24px/1.1 Oswald,sans-serif", margin: "0 0 10px" }}
            >
              {t("Запрос отправлен площадке")}
            </h1>
            <div style={{ font: "500 12.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
              <b style={{ color: "#fff" }}>{v.name}</b> {t("получит ваш собранный event и смету")}
              {req ? (
                <>
                  {" "}
                  {t("на")} <b style={{ color: "#2ECC71" }}>{fmtThb(req.quoteTotal)}</b> {t("в кабинете «Заявки организаторов».")}
                </>
              ) : (
                "."
              )}
            </div>
            <div
              className="gtr-mono"
              style={{
                marginTop: 12,
                font: "500 12px/1 'JetBrains Mono',monospace",
                color: "var(--gtr-t3)",
              }}
            >
              № {reqId}
            </div>
            <button className="gtr-btn gtr-btn-red" style={{ marginTop: 20 }} onClick={onAgain}>
              {t("Собрать ещё событие")}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
