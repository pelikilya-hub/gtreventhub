// Билеты в кабинете BOSS: завести событие, сверить оплаты, погасить билет
// на входе. Заказы ждут подтверждения здесь — деньги приходят на PromptPay
// напрямую, и только человек видит, дошёл ли перевод.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PH } from "../data/app-data";
import {
  checkInTicketFn,
  decideTicketOrderFn,
  saveTicketEventFn,
  ticketsAdminFn,
  type TicketEvent,
  type TicketOrder,
} from "../tickets";

type Row = { event: TicketEvent; left: number; orders: TicketOrder[] };
const fmtThb = (n: number) => `฿${n.toLocaleString("en-US")}`;
const EMPTY = { title: "", dateIso: "", time: "22:00", vid: "", poster: "", desc: "", price: 500, capacity: 100 };

export function TicketsAdmin() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState("");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [door, setDoor] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    ticketsAdminFn()
      .then((r) => r.ok && setRows(r.events as Row[]))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const save = async () => {
    setMsg("");
    const v = form.vid ? PH.venues.find((x) => x.id === form.vid) : undefined;
    const r = await saveTicketEventFn({
      data: { ...form, id: editId || undefined, venueName: v?.name, price: Number(form.price), capacity: Number(form.capacity) },
    }).catch(() => ({ ok: false as const, reason: "Сервер недоступен" }));
    if (!r.ok) return setMsg(r.reason);
    setForm({ ...EMPTY });
    setEditId("");
    setOpen(false);
    load();
  };

  const edit = (e: TicketEvent) => {
    setEditId(e.id);
    setForm({
      title: e.title,
      dateIso: e.dateIso,
      time: e.time ?? "",
      vid: e.vid ?? "",
      poster: e.poster ?? "",
      desc: e.desc ?? "",
      price: e.price,
      capacity: e.capacity,
    });
    setOpen(true);
  };

  const toggle = async (e: TicketEvent) => {
    await saveTicketEventFn({ data: { ...e, active: !e.active } }).catch(() => {});
    load();
  };

  const decide = async (o: TicketOrder, ok: boolean) => {
    const r = await decideTicketOrderFn({ data: { id: o.id, ok } }).catch(() => null);
    if (r && !r.ok) setMsg(r.reason);
    load();
  };

  const check = async () => {
    if (!code.trim()) return;
    const r = await checkInTicketFn({ data: { code } }).catch(() => ({ ok: false as const, reason: "Сервер недоступен" }));
    const info = "info" in r && r.info ? ` · ${r.info.name} · ${r.info.qty} × · ${r.info.title}` : "";
    setDoor({ ok: r.ok, text: (r.ok ? t("Проходите") : t(r.reason)) + info });
    if (r.ok) setCode("");
    load();
  };

  const link = (id: string) => `${location.origin}/gtr/t/${id}`;
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(link(id));
      setCopied(id);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      window.prompt(t("Ссылка на продажу"), link(id));
    }
  };

  const pending = rows.flatMap((r) => r.orders.filter((o) => o.status === "pending").map((o) => ({ o, e: r.event })));

  return (
    <section className="gtr-dash-sec">
      <div className="gtr-dash-sec-head">
        <h2 className="gtr-dash-h">{t("Билеты")}</h2>
        <button
          className="gtr-btn gtr-btn-red gtr-btn-sm"
          onClick={() => {
            setEditId("");
            setForm({ ...EMPTY });
            setOpen((x) => !x);
          }}
        >
          {open && !editId ? t("Закрыть") : t("+ Событие с билетами")}
        </button>
      </div>

      {open ? (
        <div className="gtr-tix-form">
          <label className="gtr-af-field">
            <span>{t("Название события")}</span>
            <input className="gtr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <div className="gtr-tix-form-row">
            <label className="gtr-af-field">
              <span>{t("Дата")}</span>
              <input className="gtr-input" type="date" value={form.dateIso} onChange={(e) => setForm({ ...form, dateIso: e.target.value })} />
            </label>
            <label className="gtr-af-field">
              <span>{t("Время")}</span>
              <input className="gtr-input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </label>
          </div>
          <label className="gtr-af-field">
            <span>{t("Площадка")}</span>
            <select className="gtr-input" value={form.vid} onChange={(e) => setForm({ ...form, vid: e.target.value })}>
              <option value="">{t("— не указана —")}</option>
              {PH.venues
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="gtr-tix-form-row">
            <label className="gtr-af-field">
              <span>{t("Цена билета, ฿")}</span>
              <input className="gtr-input" type="number" min={1} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </label>
            <label className="gtr-af-field">
              <span>{t("Тираж")}</span>
              <input className="gtr-input" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            </label>
          </div>
          <label className="gtr-af-field">
            <span>{t("Постер — ссылка на картинку")}</span>
            <input className="gtr-input" placeholder="https://…" value={form.poster} onChange={(e) => setForm({ ...form, poster: e.target.value })} />
          </label>
          <label className="gtr-af-field">
            <span>{t("Описание")}</span>
            <textarea className="gtr-input" rows={3} value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
          </label>
          <div className="gtr-dash-cta" style={{ marginTop: 4 }}>
            <button className="gtr-btn gtr-btn-red" onClick={save}>
              {editId ? t("Сохранить") : t("Открыть продажу")}
            </button>
            {editId ? (
              <button className="gtr-btn gtr-btn-ghost" onClick={() => { setOpen(false); setEditId(""); }}>
                {t("Отмена")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {msg ? <div className="gtr-af-note gtr-af-note-red">{t(msg)}</div> : null}

      {/* оплаты к сверке — первыми: это деньги, которые ждут человека */}
      {pending.length ? (
        <>
          <div className="gtr-tix-sub">{t("Оплаты к подтверждению")} · {pending.length}</div>
          {pending.map(({ o, e }) => (
            <div key={o.id} className="gtr-dash-row">
              <span className="gtr-dash-row-t">
                <b className="gtr-tix-code">{o.ref}</b> · {fmtThb(o.amount)}
                {o.claimed ? <span className="gtr-tix-claimed"> · {t("гость сообщил об оплате")}</span> : null}
                <small>
                  {o.name} · {o.phone} · {o.qty} × {e.title}
                </small>
              </span>
              <button className="gtr-btn gtr-btn-red gtr-btn-sm" onClick={() => decide(o, true)}>
                {t("✓ Оплата пришла")}
              </button>
              <button className="gtr-btn gtr-btn-ghost gtr-btn-sm" onClick={() => decide(o, false)}>
                {t("Отклонить")}
              </button>
            </div>
          ))}
        </>
      ) : null}

      {/* события с продажами */}
      {rows.length ? (
        <>
          <div className="gtr-tix-sub">{t("События")}</div>
          {rows.map(({ event: e, left, orders }) => {
            const paid = orders.filter((o) => o.status === "paid" || o.status === "used");
            const revenue = paid.reduce((s, o) => s + o.amount, 0);
            const inside = orders.filter((o) => o.status === "used").reduce((s, o) => s + o.qty, 0);
            return (
              <div key={e.id} className="gtr-dash-row">
                <span className="gtr-dash-row-t">
                  {e.title}
                  <small>
                    {e.dateIso}
                    {e.time ? ` ${e.time}` : ""}
                    {e.venueName ? ` · ${e.venueName}` : ""} · {t("продано {{s}} из {{c}}", { s: e.sold, c: e.capacity })} ·{" "}
                    {t("осталось {{n}}", { n: left })} · {t("на входе {{n}}", { n: inside })}
                    {e.active ? "" : ` · ${t("продажа закрыта")}`}
                  </small>
                </span>
                <span className="gtr-dash-row-v">{fmtThb(revenue)}</span>
                <button className="gtr-btn gtr-btn-sm" onClick={() => copy(e.id)}>
                  {copied === e.id ? t("Скопировано") : t("Ссылка")}
                </button>
                <button className="gtr-btn gtr-btn-ghost gtr-btn-sm" onClick={() => edit(e)}>
                  {t("Изменить")}
                </button>
                <button className="gtr-btn gtr-btn-ghost gtr-btn-sm" onClick={() => toggle(e)}>
                  {e.active ? t("Закрыть продажу") : t("Открыть продажу")}
                </button>
              </div>
            );
          })}
        </>
      ) : !open ? (
        <div className="gtr-dash-row">
          <span className="gtr-dash-row-t">{t("Событий с билетами пока нет.")}</span>
        </div>
      ) : null}

      {/* вход: код заказа или содержимое QR */}
      <div className="gtr-tix-sub">{t("Проверка на входе")}</div>
      <div className="gtr-dash-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <input
          className="gtr-input"
          style={{ flex: "1 1 200px", minWidth: 0 }}
          placeholder={t("Код заказа, например K7M2QX")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          autoCapitalize="characters"
        />
        <button className="gtr-btn gtr-btn-red" onClick={check}>
          {t("Погасить билет")}
        </button>
      </div>
      {door ? (
        <div className={`gtr-af-note ${door.ok ? "gtr-af-note-ok" : "gtr-af-note-red"}`}>{door.text}</div>
      ) : null}
    </section>
  );
}
