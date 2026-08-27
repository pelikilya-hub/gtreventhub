// Центр связи: все участники сети в один тап — команда, артисты, площадки,
// организаторы. Кнопки ведут сразу в нативные приложения (Telegram, звонок,
// WhatsApp, почта, Instagram). Рассылка всем — в дашборде BOSS.
import { useEffect, useMemo, useState } from "react";

import {
  AMBER,
  GREEN,
  isPerformer,
  loadArtists,
  PH,
  RED,
  type Artist,
} from "../data/app-data";
import { useGtr } from "../store";
import { useTranslation } from "react-i18next";
import { Card, Chip, Eyebrow, tint } from "../ui";
import { openAppLink } from "../applink";
import { contactsUsersFn, type ContactUser } from "../kv-api";

type Tab = "team" | "artists" | "venues" | "organizers";

type Row = {
  id: string;
  name: string;
  sub: string;
  color: string;
  tg?: string; // ник или ссылка t.me
  phone?: string;
  wa?: string;
  email?: string;
  ig?: string;
};

const mono = (s: number, w = 500) => `${w} ${s}px/1.3 'JetBrains Mono',monospace`;

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="gtr-btn gtr-btn-sm" style={{ flex: "none" }} onClick={onClick}>
      {label}
    </button>
  );
}

function ContactRow({ r }: { r: Row }) {
  const { t } = useTranslation();
  const tgUrl = r.tg
    ? r.tg.startsWith("http")
      ? r.tg
      : `https://t.me/${r.tg.replace(/^@/, "")}`
    : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        border: "1px solid rgba(255,255,255,.08)",
        borderLeft: `3px solid ${r.color}`,
        flexWrap: "wrap",
      }}
    >
      <span style={{ flex: "1 1 200px", minWidth: 0 }}>
        <span style={{ display: "block", font: "600 12.5px/1.45 'Golos Text',sans-serif", color: "#fff" }}>
          {r.name}
        </span>
        <span style={{ font: mono(9), color: "rgba(255,255,255,.45)" }}>{r.sub}</span>
      </span>
      <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {tgUrl ? <ActionBtn label="Telegram" onClick={() => openAppLink(tgUrl)} /> : null}
        {r.phone ? (
          <ActionBtn label={t("Позвонить")} onClick={() => (window.location.href = `tel:${r.phone!.replace(/[^+\d]/g, "")}`)} />
        ) : null}
        {r.wa ? (
          <ActionBtn
            label="WhatsApp"
            onClick={() => window.open(`https://wa.me/${r.wa!.replace(/[^\d]/g, "")}`, "_blank", "noopener")}
          />
        ) : null}
        {r.email ? (
          <ActionBtn label={t("Написать")} onClick={() => (window.location.href = `mailto:${r.email}`)} />
        ) : null}
        {r.ig ? <ActionBtn label="Instagram" onClick={() => openAppLink(r.ig!)} /> : null}
      </span>
    </div>
  );
}

export function ContactsScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [users, setUsers] = useState<ContactUser[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tab, setTab] = useState<Tab>(user.role === "artist" ? "artists" : "team");
  const [q, setQ] = useState("");

  useEffect(() => {
    contactsUsersFn().then((r) => setUsers(r.users));
    loadArtists().then((b) => setArtists(b.artists.filter(isPerformer)));
  }, []);

  const rows = useMemo<Row[]>(() => {
    const qq = q.toLowerCase().trim();
    let list: Row[] = [];
    if (tab === "team")
      list = users
        .filter((u) => u.role !== "artist" && u.role !== "organizer")
        .map((u) => ({
          id: u.email,
          name: u.name,
          sub: `${u.roleLabel} · ${u.email}`,
          color: RED,
          tg: (u as { tgNick?: string }).tgNick,
          email: u.email,
        }));
    if (tab === "organizers")
      list = users
        .filter((u) => u.role === "organizer")
        .map((u) => ({
          id: u.email,
          name: u.name,
          sub: `Организатор${u.teamOf ? ` · команда ${u.teamOf}` : ""} · ${u.email}`,
          color: "#7B4DFF",
          tg: (u as { tgNick?: string }).tgNick,
          email: u.email,
        }));
    if (tab === "artists")
      list = artists.map((a) => ({
        id: a.id,
        name: a.name,
        sub: `${(a.styles || []).slice(0, 2).join(" · ") || a.role} · ${a.prio || "—"}`,
        color: a.prio === "A" ? GREEN : a.prio === "B" ? AMBER : "rgba(255,255,255,.35)",
        phone: a.phone,
        wa: a.wa,
        email: a.email,
        ig: a.ig,
      }));
    if (tab === "venues")
      list = PH.venues.map((v) => ({
        id: v.id,
        name: v.name,
        sub: `${v.tag || v.type} · ${v.area}`,
        color: "#4DA3FF",
        phone: v.phone,
        email: v.email,
        ig: /instagram\.com/i.test(v.social || "") ? v.social : undefined,
      }));
    if (qq) list = list.filter((r) => `${r.name} ${r.sub}`.toLowerCase().includes(qq));
    return list.slice(0, 120);
  }, [tab, users, artists, q]);

  const TABS: [Tab, string, number][] = [
    ["team", t("Команда"), users.filter((u) => u.role !== "artist" && u.role !== "organizer").length],
    ["organizers", t("Организаторы"), users.filter((u) => u.role === "organizer").length],
    ["artists", t("Артисты"), artists.length],
    ["venues", t("Площадки"), PH.venues.length],
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h1 className="gtr-oswald gtr-h1">{t("Центр связи")}</h1>
        <span style={{ font: mono(10), color: "var(--gtr-t3)" }}>{rows.length} {t("контактов")}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {TABS.filter(([k, , n]) => n > 0 || k === tab).map(([k, label, n]) => (
          <button
            key={k}
            className="gtr-pal-btn"
            style={{
              flex: "0 0 auto",
              width: "auto",
              padding: "7px 13px",
              font: "600 13px/1 'Golos Text',sans-serif",
              background: tab === k ? tint(RED, 0.14) : "transparent",
              color: tab === k ? "#fff" : "rgba(255,255,255,.55)",
            }}
            onClick={() => setTab(k)}
          >
            {label} <span style={{ font: mono(8.5), opacity: 0.6, marginLeft: 5 }}>{n}</span>
          </button>
        ))}
      </div>
      <input
        className="gtr-input"
        style={{ width: "100%", marginBottom: 10 }}
        placeholder={t("Поиск по имени…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Card style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.length ? (
          rows.map((r) => <ContactRow key={r.id} r={r} />)
        ) : (
          <span style={{ padding: 20, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
            {t("Никого не найдено.")}
          </span>
        )}
      </Card>
      {user.role === "gtr" ? (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <Eyebrow>{t("РАССЫЛКА ВСЕМ")}</Eyebrow>
          <Chip color={AMBER}>{t("В ДАШБОРДЕ BOSS — «СВЯЗЬ И УВЕДОМЛЕНИЯ»")}</Chip>
        </div>
      ) : null}
    </div>
  );
}
