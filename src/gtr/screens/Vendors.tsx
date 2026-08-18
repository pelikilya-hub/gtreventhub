import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EQUIPMENT,
  equipOf,
  equipPrice,
  fmtThb,
  KINDS,
  RATE_COLOR,
  RATE_LABEL,
  VENDOR_CAT_LABEL,
  VENDORS_FLAT,
  type CatalogVendor,
  type EquipItem,
} from "../data/app-data";
import { Card, Chip, Eyebrow, Icon } from "../ui";

type Cat = "all" | "sound" | "light" | "decor" | "content" | "gear" | "interactive";

const CATS: [Cat, string][] = [
  ["all", "Все категории"],
  ["sound", VENDOR_CAT_LABEL.sound],
  ["light", VENDOR_CAT_LABEL.light],
  ["decor", VENDOR_CAT_LABEL.decor],
  ["content", VENDOR_CAT_LABEL.content],
  ["gear", "Оборудование"],
  ["interactive", "Интерактив"],
];

export function VendorsScreen() {
  const { t } = useTranslation();
  const [cat, setCat] = useState<Cat>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = VENDORS_FLAT.filter(
    (v) =>
      (cat === "all" || v.category === cat) &&
      (!q.trim() || `${v.name} ${v.meta}`.toLowerCase().includes(q.toLowerCase().trim())),
  );

  // Оборудование и интерактив — не подрядчики, а позиции каталога:
  // у них своя карточка со статусом провенанса цены
  const isEquip = cat === "gear" || cat === "interactive";
  const equipRows = isEquip
    ? equipOf(cat === "gear" ? "equipment" : "interactive").filter(
        (e) =>
          !q.trim() ||
          `${e.name} ${e.spec} ${e.group}`.toLowerCase().includes(q.toLowerCase().trim()),
      )
    : [];

  const open = openId ? VENDORS_FLAT.find((v) => v.id === openId) : null;
  if (open) return <VendorCard v={open} onBack={() => setOpenId(null)} />;

  const totalPackages = VENDORS_FLAT.reduce((s, v) => s + v.packages.length, 0);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h1 className="gtr-oswald gtr-h1">
          {cat === "gear"
            ? "Каталог оборудования"
            : cat === "interactive"
              ? "Каталог интерактива"
              : "Каталог подрядчиков"}
        </h1>
        <span
          className="gtr-mono"
          style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
        >
          {isEquip
            ? `${equipRows.length} позиций · цену уточняем запросом`
            : `${rows.length} подрядчиков · ${totalPackages} позиций с ценой · ${EQUIPMENT.length} в каталоге оборудования`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 10px" }}>
        {CATS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setCat(k)}
            style={{
              border: `1px solid ${cat === k ? "#E5231B" : "rgba(255,255,255,.12)"}`,
              background: cat === k ? "#E5231B" : "transparent",
              color: cat === k ? "#fff" : "rgba(255,255,255,.6)",
              borderRadius: 0,
              padding: "7px 11px",
              cursor: "pointer",
              font: `${cat === k ? 600 : 500} 11px/1 'Golos Text',sans-serif`,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="gtr-input"
        style={{ maxWidth: 300, marginBottom: 16 }}
        placeholder={t("Поиск по названию и специализации…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {isEquip
          ? equipRows.map((e) => <EquipCard key={e.id} e={e} kind={cat as "gear" | "interactive"} />)
          : null}
        {(isEquip ? [] : rows).map((v) => {
          const K = KINDS[v.category];
          return (
            <Card key={v.id} hover style={{ padding: "16px 18px" }} onClick={() => setOpenId(v.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    flex: "none",
                    borderRadius: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: K[2],
                    color: K[1],
                  }}
                >
                  <Icon d={K[3]} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{ display: "block", font: "600 13.5px/1.3 'Golos Text',sans-serif" }}
                  >
                    {v.name}
                  </span>
                  <Chip color={K[1]} style={{ marginTop: 4 }}>
                    {VENDOR_CAT_LABEL[v.category].toUpperCase()}
                  </Chip>
                </span>
              </div>
              <div
                style={{
                  font: "500 11px/1.5 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                  minHeight: 33,
                }}
              >
                {v.meta}
              </div>
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 9,
                  borderTop: "1px solid rgba(255,255,255,.06)",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <span
                  className="gtr-mono"
                  style={{ font: "600 9.5px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                >
                  {v.packages.length ? `${v.packages.length} позиций` : "прайс по запросу"}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    font: "700 12px/1 'JetBrains Mono',monospace",
                    color: v.priceFrom ? "#fff" : "var(--gtr-t3)",
                  }}
                >
                  {v.priceFrom ? `от ${fmtThb(v.priceFrom)}` : v.price}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function EquipCard({ e, kind }: { e: EquipItem; kind: "gear" | "interactive" }) {
  const K = KINDS[kind];
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span
          style={{
            width: 30,
            height: 30,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: K[2],
            color: K[1],
          }}
        >
          <Icon d={K[3]} size={15} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", font: "600 13.5px/1.3 'Golos Text',sans-serif" }}>
            {e.name}
          </span>
          <Chip color={K[1]} style={{ marginTop: 4 }}>
            {e.group.toUpperCase()}
          </Chip>
        </span>
      </div>
      <div
        style={{
          font: "500 11px/1.5 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          minHeight: 33,
        }}
      >
        {e.spec}
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 9,
          borderTop: "1px solid rgba(255,255,255,.06)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          className="gtr-mono"
          style={{ font: "600 9px/1.3 'JetBrains Mono',monospace", color: RATE_COLOR[e.kind] }}
        >
          {RATE_LABEL[e.kind].toUpperCase()}
        </span>
        <span
          className="gtr-mono"
          style={{
            font: "700 11.5px/1 'JetBrains Mono',monospace",
            color: e.price ? "#fff" : "var(--gtr-t3)",
            textAlign: "right",
          }}
        >
          {equipPrice(e)}
        </span>
      </div>
      <div
        className="gtr-mono"
        style={{ marginTop: 7, font: "500 9px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
      >
        {e.vendor ? `${e.vendor} · ${e.contact}` : "подрядчик не назначен"}
      </div>
    </Card>
  );
}

function VendorCard({ v, onBack }: { v: CatalogVendor; onBack: () => void }) {
  const { t } = useTranslation();
  const K = KINDS[v.category];
  const site = v.source ? (v.source.startsWith("http") ? v.source : `https://${v.source}`) : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button className="gtr-btn" style={{ marginBottom: 14 }} onClick={onBack}>
        {t("← Ко всем подрядчикам")}
      </button>

      <Card
        style={{ position: "relative", overflow: "hidden", padding: "24px 26px", marginBottom: 16 }}
      >
        <div className="gtr-beam" />
        <div style={{ position: "relative" }}>
          <Eyebrow>{VENDOR_CAT_LABEL[v.category].toUpperCase()}</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                flex: "none",
                borderRadius: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: K[2],
                color: K[1],
              }}
            >
              <Icon d={K[3]} size={18} />
            </span>
            <h1
              className="gtr-oswald"
              style={{ font: "700 26px/1.05 Oswald,sans-serif", margin: 0 }}
            >
              {v.name}
            </h1>
          </div>
          <div
            style={{
              marginTop: 10,
              font: "500 12px/1.5 'Golos Text',sans-serif",
              color: "var(--gtr-t2)",
            }}
          >
            {v.meta}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {v.contact ? <Chip color="rgba(255,255,255,.55)">{v.contact}</Chip> : null}
            {site ? (
              <a
                className="gtr-btn"
                style={{ textDecoration: "none" }}
                href={site}
                target="_blank"
                rel="noreferrer"
              >
                {v.source} ↗
              </a>
            ) : null}
          </div>
        </div>
      </Card>

      {v.packages.length ? (
        <Card>
          <div
            className="gtr-oswald"
            style={{
              font: "600 14px/1 Oswald,sans-serif",
              padding: "15px 20px",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}
          >
            {t("Прайс-лист ·")} {v.packages.length} {t("позиций")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: "0 14px",
              padding: "6px 20px 14px",
            }}
          >
            {v.packages.map((p, i) => (
              <div key={i} style={{ display: "contents" }}>
                <span
                  className="gtr-mono"
                  style={{
                    font: "600 9px/1 'JetBrains Mono',monospace",
                    color: K[1],
                    padding: "11px 0",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                    alignSelf: "center",
                  }}
                >
                  {p.system.toUpperCase()}
                </span>
                <span
                  style={{
                    font: "500 11.5px/1.4 'Golos Text',sans-serif",
                    padding: "11px 0",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                    alignSelf: "center",
                  }}
                >
                  {p.package}
                </span>
                <span
                  className="gtr-mono"
                  style={{
                    font: "700 11.5px/1 'JetBrains Mono',monospace",
                    padding: "11px 0",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                    alignSelf: "center",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtThb(p.price)}{" "}
                  <span style={{ color: "var(--gtr-t3)", fontWeight: 500 }}>/ {p.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 20 }}>
          <Eyebrow style={{ marginBottom: 8 }}>{t("ПРАЙС")}</Eyebrow>
          <div style={{ font: "500 12px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {t("Стоимость — по запросу (")}{v.price}{t("). Свяжитесь напрямую:")} {v.contact || "см. источник"}.
          </div>
        </Card>
      )}

      <div
        className="gtr-mono"
        style={{
          marginTop: 12,
          font: "500 10px/1.5 'JetBrains Mono',monospace",
          color: "var(--gtr-t3)",
        }}
      >
        {t("Данные из вендор-пакета GTR (официальные источники подрядчиков). Подрядчик доступен в конструкторе события — категория «")}{VENDOR_CAT_LABEL[v.category]}».
      </div>
    </div>
  );
}
