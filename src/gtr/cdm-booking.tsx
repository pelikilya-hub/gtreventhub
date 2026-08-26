// Бронь рассадки: зона → стол → дата/время/гости → предзаказ по меню →
// заявка. Данные конкретной площадки берутся из реестра venue-commerce,
// а не импортируются напрямую: форма одна на все заведения с рассадкой.
//
// Депозит стола — это не наша цена, а условия площадки: часть или весь
// депозит возвращается гостю кредитом на еду и напитки. Предзаказ ни к
// чему не обязывает кухню — он уходит менеджеру вместе с заявкой.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { bookTableFn, type PreorderLine } from "./kv-api";
import { useGtr } from "./store";
import { Card, Chip, Eyebrow } from "./ui";
import {
  hasReserve,
  menuOf,
  reserveOf,
  zonesOfSpace,
  type MenuItem,
  type ReserveTable,
  type ReserveZone,
} from "./venue-commerce";

const GREEN = "#2ECC71";
const RED = "#E5231B";
const AMBER = "#F5A623";

// Формы данных живут в реестре: там они общие для всех площадок,
// а не выведены из одного JSON-файла через typeof.
type Zone = ReserveZone;
type CdmTable = ReserveTable;

const thb = (n: number) => `${n.toLocaleString("ru-RU")} THB`;

const label = (s: string) => (
  <span
    className="gtr-mono"
    style={{
      display: "block",
      marginBottom: 5,
      font: "600 11px/1 'JetBrains Mono',monospace",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--gtr-t3)",
    }}
  >
    {s}
  </span>
);

// ---------- всплывающая карточка позиции меню ----------
function DishModal({
  item,
  qty0,
  opt0,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  qty0: number;
  opt0?: string;
  onAdd: (qty: number, opt?: { l: string; p: number }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(Math.max(1, qty0));
  const [opt, setOpt] = useState(
    item.opts?.find((o) => o.l === opt0) ?? item.opts?.[0],
  );
  const price = opt ? opt.p : item.price;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 340,
        background: "rgba(6,7,8,.78)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
    >
      <div
        className="gtr-fade"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(430px, 96vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--gtr-bg2, #101214)",
          border: "1px solid rgba(255,255,255,.14)",
        }}
      >
        {item.photo ? (
          <img
            src={item.photo}
            alt={item.name}
            style={{ width: "100%", aspectRatio: "3/2", objectFit: "cover", display: "block" }}
          />
        ) : null}
        <div style={{ padding: "16px 18px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ flex: 1, font: "700 15px/1.25 'Golos Text',sans-serif" }}>{item.name}</span>
            <span className="gtr-mono" style={{ font: "700 13px/1 'JetBrains Mono',monospace", color: GREEN }}>
              {price ? thb(price) : t("по рынку")}
              {item.unit ? <span style={{ color: "var(--gtr-t3)" }}> / {item.unit}</span> : null}
            </span>
          </div>
          {item.desc ? (
            <div style={{ font: "500 13px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>{item.desc}</div>
          ) : null}
          {item.opts?.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {item.opts.map((o) => (
                <button
                  key={o.l}
                  className="gtr-btn"
                  onClick={() => setOpt(o)}
                  style={
                    opt?.l === o.l
                      ? { borderColor: RED, color: "#fff", background: "rgba(229,35,27,.18)" }
                      : undefined
                  }
                >
                  {o.l} · {o.p.toLocaleString("ru-RU")}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,.16)" }}>
              <button className="gtr-btn" style={{ border: "none" }} onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="gtr-mono" style={{ minWidth: 28, textAlign: "center", font: "700 13px/1 'JetBrains Mono',monospace" }}>
                {qty}
              </span>
              <button className="gtr-btn" style={{ border: "none" }} onClick={() => setQty((q) => Math.min(99, q + 1))}>
                +
              </button>
            </div>
            <button className="gtr-btn gtr-btn-red" style={{ flex: 1 }} onClick={() => onAdd(qty, opt)}>
              {t("В предзаказ")} · {thb(price * qty)}
            </button>
          </div>
          {qty0 > 0 ? (
            <button className="gtr-btn" onClick={() => onAdd(0, opt)}>
              {t("Убрать из предзаказа")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------- сам мастер брони ----------
export function CdmReserve({ vid, compact }: { vid: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useGtr();
  // Рассадка и меню — этой площадки, а не жёстко Café del Mar.
  const reserve = reserveOf(vid);
  const menu = menuOf(vid);
  const zones: Zone[] = reserve?.zones ?? [];
  const tables: CdmTable[] = reserve?.tables ?? [];
  const sections = menu?.sections ?? [];

  const [zoneId, setZoneId] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [dateIso, setDateIso] = useState("");
  const [slot, setSlot] = useState("");
  const [guests, setGuests] = useState(2);
  const [menuOpen, setMenuOpen] = useState(false);
  const [secId, setSecId] = useState(sections[0]?.id ?? "");
  const [cart, setCart] = useState<Record<string, PreorderLine>>({});
  const [dish, setDish] = useState<MenuItem | null>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState("");
  const [sentId, setSentId] = useState("");

  // Смена площадки обязана обнулить всё, что принадлежало прошлой.
  //
  // Данные-то берутся по vid (reserveOf/menuOf выше), но React держит один
  // и тот же экземпляр формы, пока она стоит на том же месте дерева: и на
  // экране «Промо и бронь» селектор заведения, и переход между паспортами
  // площадок меняют только пропс. Без сброса корзина Café del Mar уезжала
  // в заявку соседнего ресторана, а раздел меню оставался с чужим id —
  // менеджеру приходил заказ блюд, которых у него нет.
  //
  // Сброс живёт здесь, а не в key у вызывающих: точек вызова три, и
  // четвёртая ключ забудет. Дату, число гостей и контакты не трогаем —
  // они принадлежат гостю, а не заведению, и стирать их значит заставить
  // человека набирать телефон заново.
  const [prevVid, setPrevVid] = useState(vid);
  if (prevVid !== vid) {
    setPrevVid(vid);
    setZoneId(null);
    setTableId(null);
    setSlot("");
    setCart({});
    setMenuOpen(false);
    setSecId(sections[0]?.id ?? "");
    setDish(null);
    setState("");
    setSentId("");
  }

  const zone = zones.find((z) => z.id === zoneId) ?? null;
  const table = tables.find((tb) => tb.id === tableId) ?? null;
  const zoneTables = useMemo(() => tables.filter((tb) => tb.zone === zoneId), [tables, zoneId]);
  const cartLines = Object.values(cart);
  const cartTotal = cartLines.reduce((s, l) => s + l.price * l.qty, 0);
  const maxPax = table ? table.pax + (table.extraPax ?? 0) : 20;

  // клубные ночи — только ср–сб: не даём выбрать мёртвую дату
  const dateOk = useMemo(() => {
    if (!zone?.days || !dateIso) return true;
    const dow = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
    return zone.days.includes(dow);
  }, [zone, dateIso]);

  const keyOf = (it: MenuItem, opt?: string) => (opt ? `${it.id}::${opt}` : it.id);
  const putLine = (it: MenuItem, qty: number, opt?: { l: string; p: number }) => {
    setCart((c) => {
      const k = keyOf(it, opt?.l);
      const next = { ...c };
      if (qty <= 0) delete next[k];
      else
        next[k] = {
          id: it.id,
          name: it.name,
          opt: opt?.l,
          qty,
          price: opt ? opt.p : it.price,
        };
      return next;
    });
    setDish(null);
  };

  const submit = async () => {
    if (!table || !zone) return;
    setState("…");
    try {
      const r = await bookTableFn({
        data: {
          vid,
          dateIso,
          guests,
          name,
          phone,
          note,
          zone: zone.name,
          tableType: table.name,
          slot,
          deposit: table.perPerson ? table.deposit * guests : table.deposit,
          // Кредит на еду и напитки есть не у каждого стола — без него в
          // заявку уходит ноль, а не NaN в письме менеджеру.
          credit: table.perPerson ? (table.credit ?? 0) * guests : table.credit,
          preorder: cartLines,
        },
      });
      if (r.ok) {
        setSentId(r.id);
        setState("");
        // Причина отказа приходит с сервера по-русски: прогоняем через
        // словарь, иначе гость с английским интерфейсом упирается в
        // русскую строку ровно в тот момент, когда что-то пошло не так.
      } else setState(t(r.reason ?? "…"));
    } catch {
      setState(t("Сервер недоступен"));
    }
  };

  if (sentId)
    return (
      <Card className="gtr-fade" style={{ padding: "22px 24px", display: "grid", gap: 10, justifyItems: "start" }}>
        <Chip color={GREEN}>{t("ЗАЯВКА УЛЕТЕЛА")}</Chip>
        <div style={{ font: "700 15px/1.5 'Golos Text',sans-serif" }}>
          {zone?.name} · {table?.name} · {dateIso} {slot}
        </div>
        <div style={{ font: "500 13px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {t("Менеджер площадки и команда GTR получили бронь в Telegram — подтверждение придёт одной кнопкой. Статус смотрите в «Мои брони».")}
        </div>
        <span className="gtr-mono" style={{ font: "500 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
          {sentId}
          {cartTotal ? ` · предзаказ ${thb(cartTotal)}` : ""}
        </span>
      </Card>
    );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ШАГ 1 · зона */}
      <div>
        <Eyebrow style={{ marginBottom: 8 }}>
          {t("ШАГ 1 · ЗОНА")} {zone ? `· ${zone.name.toUpperCase()}` : ""}
        </Eyebrow>
        <div
          className="gtr-cdm-zones"
          style={{
            display: "grid",
            gridTemplateColumns: compact ? "repeat(auto-fill,minmax(150px,1fr))" : "repeat(auto-fill,minmax(190px,1fr))",
            gap: 10,
          }}
        >
          {zones.map((z) => {
            const on = z.id === zoneId;
            return (
              <div
                key={z.id}
                onClick={() => {
                  setZoneId(z.id);
                  setTableId(null);
                  setSlot("");
                }}
                className="gtr-cdm-zone"
                style={{
                  cursor: "pointer",
                  border: `1px solid ${on ? RED : "rgba(255,255,255,.1)"}`,
                  background: on ? "rgba(229,35,27,.08)" : "rgba(255,255,255,.02)",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "relative" }}>
                  <img
                    src={z.photo}
                    alt={z.name}
                    loading="lazy"
                    style={{
                      width: "100%",
                      aspectRatio: "16/10",
                      objectFit: "cover",
                      display: "block",
                      filter: on ? "none" : "saturate(.85)",
                    }}
                  />
                  {on ? (
                    <span
                      className="gtr-mono"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        background: RED,
                        color: "#fff",
                        padding: "3px 7px",
                        font: "700 11px/1 'JetBrains Mono',monospace",
                        letterSpacing: ".1em",
                      }}
                    >
                      ВЫБРАНО
                    </span>
                  ) : null}
                </div>
                <div style={{ padding: "9px 11px" }}>
                  <div style={{ font: "700 12.5px/1.2 'Golos Text',sans-serif" }}>{z.name}</div>
                  <div
                    className="gtr-mono"
                    style={{ marginTop: 4, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
                  >
                    {z.hours}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {zone ? (
          <div
            className="gtr-fade"
            style={{ marginTop: 8, font: "500 13px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
          >
            {zone.desc} <span style={{ color: "var(--gtr-t3)" }}>{zone.best}.</span>
          </div>
        ) : null}
      </div>

      {/* ШАГ 2 · стол */}
      {zone ? (
        <div className="gtr-fade">
          <Eyebrow style={{ marginBottom: 8 }}>
            {t("ШАГ 2 · СТОЛ")} {table ? `· ${table.name.toUpperCase()}` : `· ${zoneTables.length}`}
          </Eyebrow>
          <div style={{ display: "grid", gap: 8 }}>
            {zoneTables.map((tb) => {
              const on = tb.id === tableId;
              return (
                <div
                  key={tb.id}
                  onClick={() => {
                    setTableId(tb.id);
                    setSlot(tb.slots[0] ?? "");
                    setGuests((g) => Math.min(g, tb.pax + (tb.extraPax ?? 0)));
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "108px 1fr",
                    gap: 12,
                    cursor: "pointer",
                    border: `1px solid ${on ? RED : "rgba(255,255,255,.1)"}`,
                    background: on ? "rgba(229,35,27,.08)" : "rgba(255,255,255,.02)",
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={tb.photo}
                    alt={tb.name}
                    loading="lazy"
                    style={{ width: 108, height: "100%", minHeight: 76, objectFit: "cover", display: "block" }}
                  />
                  <div style={{ padding: "9px 11px 9px 0", minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ font: "700 12.5px/1.2 'Golos Text',sans-serif" }}>{tb.name}</span>
                      <span className="gtr-mono" style={{ font: "500 11px/1 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
                        {t("до")} {tb.pax}
                        {tb.extraPax ? `+${tb.extraPax}` : ""} {t("чел.")}
                      </span>
                    </div>
                    <div className="gtr-mono" style={{ marginTop: 5, font: "700 13px/1.45 'JetBrains Mono',monospace", color: GREEN }}>
                      {t("депозит")} {thb(tb.deposit)}
                      {tb.perPerson ? ` / ${t("чел.")}` : ""}
                      {tb.credit ? (
                        <span style={{ color: "var(--gtr-t3)", fontWeight: 500 }}>
                          {" "}
                          · {t("из них на еду и бар")} {thb(tb.credit)}
                        </span>
                      ) : null}
                    </div>
                    {/* Что входит в стол: у одних площадок список, у других
                        связный текст. Показываем то, что есть. */}
                    {on && (tb.includes?.length || tb.desc) ? (
                      <div className="gtr-fade" style={{ marginTop: 6, font: "500 12px/1.55 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                        {tb.includes?.length ? tb.includes.join(" · ") : tb.desc}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ШАГ 3 · дата, время, гости */}
      {table ? (
        <div className="gtr-fade" style={{ display: "grid", gap: 10 }}>
          <Eyebrow>{t("ШАГ 3 · КОГДА И СКОЛЬКО ВАС")}</Eyebrow>
          <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              {label(t("Дата"))}
              <input
                className="gtr-input"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={dateIso}
                onChange={(e) => setDateIso(e.target.value)}
              />
              {!dateOk ? (
                <span className="gtr-mono" style={{ display: "block", marginTop: 4, font: "500 11px/1.5 'JetBrains Mono',monospace", color: AMBER }}>
                  {t("Club Room работает ср–сб — выберите другую дату")}
                </span>
              ) : null}
            </div>
            <div>
              {label(t("Гостей"))}
              <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,.16)", height: 38 }}>
                <button className="gtr-btn" style={{ border: "none" }} onClick={() => setGuests((g) => Math.max(1, g - 1))}>
                  −
                </button>
                <span className="gtr-mono" style={{ flex: 1, textAlign: "center", font: "700 13px/1 'JetBrains Mono',monospace" }}>
                  {guests}
                </span>
                <button className="gtr-btn" style={{ border: "none" }} onClick={() => setGuests((g) => Math.min(maxPax, g + 1))}>
                  +
                </button>
              </div>
              {table.extraPax && guests > table.pax ? (
                <span className="gtr-mono" style={{ display: "block", marginTop: 4, font: "500 11px/1.5 'JetBrains Mono',monospace", color: AMBER }}>
                  +{thb((table.extraPrice ?? 0) * (guests - table.pax))} {t("за доп. гостей (зачтётся на бар)")}
                </span>
              ) : null}
            </div>
          </div>
          <div>
            {label(t("Время"))}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {table.slots.map((s) => (
                <button
                  key={s}
                  className="gtr-btn"
                  onClick={() => setSlot(s)}
                  style={s === slot ? { borderColor: RED, color: "#fff", background: "rgba(229,35,27,.18)" } : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="gtr-mono" style={{ display: "block", marginTop: 5, font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
              {zone?.arrival}
            </span>
          </div>
        </div>
      ) : null}

      {/* ШАГ 4 · предзаказ. Только там, где у площадки есть своё меню:
          у коворкинга и других залов без кухни шаг рисовался пустым, и
          кнопка «Открыть меню» разворачивала ничто. */}
      {table && sections.length ? (
        <div className="gtr-fade">
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <Eyebrow>
              {t("ШАГ 4 · ПРЕДЗАКАЗ")} {cartLines.length ? `· ${cartLines.length} · ${thb(cartTotal)}` : `· ${t("ПО ЖЕЛАНИЮ")}`}
            </Eyebrow>
            <button className="gtr-btn" onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? t("Свернуть меню") : t("Открыть меню")}
            </button>
          </div>
          {cartLines.length ? (
            <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
              {cartLines.map((l) => (
                <div
                  key={`${l.id}-${l.opt ?? ""}`}
                  style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid rgba(46,204,113,.25)", padding: "6px 10px" }}
                >
                  <span style={{ flex: 1, font: "600 13px/1.45 'Golos Text',sans-serif" }}>
                    {l.name}
                    {l.opt ? <span style={{ color: "var(--gtr-t3)" }}> · {l.opt}</span> : null}
                  </span>
                  <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                    ×{l.qty} · {thb(l.price * l.qty)}
                  </span>
                  <button
                    className="gtr-btn"
                    style={{ padding: "2px 8px" }}
                    onClick={() =>
                      setCart((c) => {
                        const k = l.opt ? `${l.id}::${l.opt}` : l.id;
                        const { [k]: _gone, ...rest } = c;
                        return rest;
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {menuOpen ? (
            <Card className="gtr-fade" style={{ padding: 14 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {sections.map((s) => (
                  <button
                    key={s.id}
                    className="gtr-btn"
                    onClick={() => setSecId(s.id)}
                    style={s.id === secId ? { borderColor: RED, color: "#fff", background: "rgba(229,35,27,.18)" } : undefined}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div style={{ maxHeight: 430, overflowY: "auto", display: "grid", gap: 12, paddingRight: 4 }}>
                {(sections.find((s) => s.id === secId) ?? sections[0])?.groups.map((g) => (
                    <div key={g.id}>
                      <div
                        className="gtr-mono"
                        style={{
                          font: "700 11px/1 'JetBrains Mono',monospace",
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          color: AMBER,
                          margin: "4px 0 6px",
                        }}
                      >
                        {g.name}
                        {"ru" in g && g.ru !== g.name ? <span style={{ color: "var(--gtr-t3)" }}> · {g.ru}</span> : null}
                      </div>
                      {(g.items as MenuItem[]).map((it) => {
                        const inCart = cartLines.filter((l) => l.id === it.id).reduce((s, l) => s + l.qty, 0);
                        return (
                          <div
                            key={it.id}
                            onClick={() => setDish(it)}
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              padding: "6px 4px",
                              borderBottom: "1px solid rgba(255,255,255,.05)",
                              cursor: "pointer",
                            }}
                          >
                            {it.photo ? (
                              <img
                                src={it.photo}
                                alt=""
                                loading="lazy"
                                style={{ width: 44, height: 34, objectFit: "cover", flexShrink: 0 }}
                              />
                            ) : (
                              <span style={{ width: 44, height: 34, flexShrink: 0, background: "rgba(255,255,255,.04)" }} />
                            )}
                            <span style={{ flex: 1, minWidth: 0, font: "600 13px/1.45 'Golos Text',sans-serif" }}>
                              {it.name}
                              {inCart ? <Chip color={GREEN}> ×{inCart}</Chip> : null}
                            </span>
                            <span className="gtr-mono" style={{ font: "600 12px/1 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                              {it.opts ? `${t("от")} ` : ""}
                              {it.price ? it.price.toLocaleString("ru-RU") : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* ШАГ 5 · контакты и отправка */}
      {table ? (
        <div className="gtr-fade" style={{ display: "grid", gap: 10 }}>
          <Eyebrow>{t("ШАГ 5 · КОНТАКТ И ОТПРАВКА")}</Eyebrow>
          <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              {label(t("Имя"))}
              <input className="gtr-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              {label(t("Телефон / WhatsApp"))}
              <input className="gtr-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            {label(t("Пожелания"))}
            <input
              className="gtr-input"
              placeholder={t("День рождения, вид на закат, детское кресло…")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              border: "1px solid rgba(255,255,255,.1)",
              padding: "10px 12px",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ font: "700 12.5px/1.45 'Golos Text',sans-serif" }}>
                {zone?.name} · {table.name}
              </div>
              <div className="gtr-mono" style={{ marginTop: 4, font: "500 12px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t2)" }}>
                {dateIso || "—"} · {slot || "—"} · {guests} {t("чел.")}
                <br />
                {t("депозит")}{" "}
                <b style={{ color: GREEN }}>{thb(table.perPerson ? table.deposit * guests : table.deposit)}</b>
                {cartTotal ? (
                  <>
                    {" "}
                    · {t("предзаказ")} <b style={{ color: GREEN }}>{thb(cartTotal)}</b>
                  </>
                ) : null}
              </div>
            </div>
            <button
              className="gtr-btn gtr-btn-red"
              disabled={!dateIso || !dateOk || !slot || !name.trim() || !phone.trim() || state === "…"}
              onClick={() => void submit()}
            >
              {t("Отправить бронь")}
            </button>
          </div>
          {state && state !== "…" ? (
            <span className="gtr-mono" style={{ font: "500 12px/1.5 'JetBrains Mono',monospace", color: AMBER }}>
              {state}
            </span>
          ) : null}
          <span className="gtr-mono" style={{ font: "500 11px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}>
            {t("Оплата депозита — на площадке при подтверждении. Депозит зачитывается кредитом на еду и напитки по правилам Café del Mar.")}
          </span>
        </div>
      ) : null}

      {dish ? (
        <DishModal
          item={dish}
          qty0={cartLines.find((l) => l.id === dish.id)?.qty ?? 0}
          opt0={cartLines.find((l) => l.id === dish.id)?.opt}
          onAdd={(q, o) => putLine(dish, q, o)}
          onClose={() => setDish(null)}
        />
      ) : null}
    </div>
  );
}

// Проверка «есть ли рассадка» и зоны зала живут в реестре — экраны
// импортируют их отсюда по привычке, чтобы не переписывать call-site'ы.
export { hasReserve, zonesOfSpace } from "./venue-commerce";
