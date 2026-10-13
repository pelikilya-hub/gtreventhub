// Страницы билетов для гостя: событие с покупкой и заказ с оплатой и
// билетом. Открываются без входа — ссылку на событие кидают в чат, и
// человек должен купить билет за минуту, не заводя аккаунт.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toDataURL } from "qrcode";

import { promptpayPayload } from "./promptpay";
import { setUiLang, UI_LANGS, type UiLang } from "./i18n";
import {
  buyTicketFn,
  claimPaidFn,
  ticketEventFn,
  ticketOrderFn,
  type PublicPayCfg,
  type PublicTicketEvent,
} from "./tickets";

const fmtThb = (n: number) => `฿${n.toLocaleString("en-US")}`;

function useDateLabel() {
  const { i18n } = useTranslation();
  const loc = { ru: "ru-RU", en: "en-GB", th: "th-TH" }[i18n.language] ?? "en-GB";
  return (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(loc, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
}

function TixTop() {
  const { i18n } = useTranslation();
  return (
    <header className="gtr-tix-top">
      <Link to="/" className="gtr-tix-logo" aria-label="GTR Event">
        <img src="/brand/GTR_primary_dark_clean.svg" alt="GTR Event" height={26} />
      </Link>
      <div className="gtr-lang" role="group" aria-label="Language">
        {UI_LANGS.map(([code]) => (
          <button
            key={code}
            type="button"
            aria-pressed={i18n.language === code}
            onClick={() => setUiLang(code as UiLang)}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}

function Poster({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <div className="gtr-tix-poster gtr-tix-poster-empty">GTR</div>;
  return (
    <div className="gtr-tix-poster">
      <img className="gtr-tix-poster-bg" src={src} alt="" aria-hidden />
      <img className="gtr-tix-poster-img" src={src} alt={alt} />
    </div>
  );
}

// ---------- событие и покупка ----------

export function TicketEventPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dateLabel = useDateLabel();
  const [ev, setEv] = useState<PublicTicketEvent | null>(null);
  const [err, setErr] = useState("");
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    ticketEventFn({ data: { id } })
      .then((r) => (r.ok ? setEv(r.event) : setErr(r.reason)))
      .catch(() => setErr("Сервер недоступен"));
  }, [id]);

  const buy = async () => {
    if (!ev) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await buyTicketFn({ data: { evId: ev.id, name, phone, qty } });
      if (r.ok) navigate({ to: "/gtr/o/$id", params: { id: r.id } });
      else setMsg(r.reason);
    } catch {
      setMsg("Сервер недоступен");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gtr-tix">
      <TixTop />
      {err ? <p className="gtr-tix-err">{t(err)}</p> : null}
      {!ev && !err ? <div className="gtr-tix-skel" aria-hidden /> : null}
      {ev ? (
        <div className="gtr-tix-grid">
          <Poster src={ev.poster} alt={ev.title} />
          <div className="gtr-tix-body">
            <div className="gtr-af-kick">{t("БИЛЕТЫ")}</div>
            <h1 className="gtr-tix-h1">{ev.title}</h1>
            <div className="gtr-tix-when">
              {dateLabel(ev.dateIso)}
              {ev.time ? ` · ${ev.time}` : ""}
            </div>
            {ev.venueName ? <div className="gtr-tix-venue">{ev.venueName}</div> : null}
            {ev.desc ? <p className="gtr-tix-desc">{ev.desc}</p> : null}

            <div className="gtr-tix-price">
              <b>{fmtThb(ev.price)}</b>
              <span>
                {ev.left > 0
                  ? t("осталось {{n}}", { n: ev.left })
                  : t("билеты закончились")}
              </span>
            </div>

            {ev.active && ev.left > 0 ? (
              <div className="gtr-af-sheet-form">
                <div className="gtr-af-field">
                  <span>{t("Билетов")}</span>
                  <div className="gtr-af-guests">
                    <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="−">
                      −
                    </button>
                    <b>{qty}</b>
                    <button
                      type="button"
                      onClick={() => setQty((q) => Math.min(Math.min(10, ev.left), q + 1))}
                      aria-label="+"
                    >
                      +
                    </button>
                  </div>
                </div>
                <label className="gtr-af-field">
                  <span>{t("Имя")}</span>
                  <input className="gtr-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </label>
                <label className="gtr-af-field">
                  <span>{t("Телефон / WhatsApp")}</span>
                  <input
                    className="gtr-input"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <button className="gtr-btn gtr-btn-red gtr-tix-buy" disabled={busy} onClick={buy}>
                  {busy ? t("Оформляем…") : `${t("Купить")} · ${fmtThb(ev.price * qty)}`}
                </button>
                {msg ? <div className="gtr-af-note gtr-af-note-red">{t(msg)}</div> : null}
                <p className="gtr-tix-fine">
                  {t("Оплата — переводом PromptPay из приложения любого тайского банка. После подтверждения оплаты билет появится на странице заказа.")}
                </p>
              </div>
            ) : (
              <p className="gtr-tix-fine">{t("Продажа на это событие закрыта.")}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- заказ: оплата и билет ----------

export function TicketOrderPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const dateLabel = useDateLabel();
  const [data, setData] = useState<{
    order: { id: string; ref: string; qty: number; amount: number; name: string; status: string; claimed: boolean };
    event: PublicTicketEvent | null;
    pay: PublicPayCfg;
  } | null>(null);
  const [err, setErr] = useState("");
  const [payQr, setPayQr] = useState("");
  const [ticketQr, setTicketQr] = useState("");
  const [claiming, setClaiming] = useState(false);

  // Пока заказ не решён, страница сама проверяет статус: гость не должен
  // обновлять её руками, чтобы увидеть билет.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = () =>
      ticketOrderFn({ data: { id } })
        .then((r) => {
          if (!alive) return;
          if (!r.ok) return setErr(r.reason);
          setData(r);
          if (r.order.status === "pending") timer = window.setTimeout(load, 15000);
        })
        .catch(() => alive && setErr("Сервер недоступен"));
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const opts = { margin: 1, width: 360, color: { dark: "#0A0B0D", light: "#FFFFFF" } };
    if (data.order.status === "pending" && data.pay)
      toDataURL(promptpayPayload(data.pay.id, data.order.amount), opts).then(setPayQr).catch(() => {});
    if (data.order.status === "paid" || data.order.status === "used")
      toDataURL(`GTR-TIX:${data.order.id}`, opts).then(setTicketQr).catch(() => {});
  }, [data]);

  const claim = async () => {
    if (!data) return;
    setClaiming(true);
    await claimPaidFn({ data: { id } }).catch(() => {});
    setData({ ...data, order: { ...data.order, claimed: true } });
    setClaiming(false);
  };

  const o = data?.order;
  const e = data?.event;
  return (
    <div className="gtr-tix">
      <TixTop />
      {err ? <p className="gtr-tix-err">{t(err)}</p> : null}
      {!data && !err ? <div className="gtr-tix-skel" aria-hidden /> : null}
      {o ? (
        <div className="gtr-tix-order">
          <div className="gtr-af-kick">
            {o.status === "pending"
              ? t("ОПЛАТА ЗАКАЗА")
              : o.status === "rejected"
                ? t("ЗАКАЗ ОТКЛОНЁН")
                : t("ВАШ БИЛЕТ")}
          </div>
          {e ? (
            <>
              <h1 className="gtr-tix-h1">{e.title}</h1>
              <div className="gtr-tix-when">
                {dateLabel(e.dateIso)}
                {e.time ? ` · ${e.time}` : ""}
                {e.venueName ? ` · ${e.venueName}` : ""}
              </div>
            </>
          ) : null}

          <div className="gtr-tix-sum">
            <span>
              {o.qty} × {t("билет")} · {o.name}
            </span>
            <b>{fmtThb(o.amount)}</b>
          </div>

          {o.status === "pending" ? (
            <>
              <div className="gtr-tix-ref">
                <span>{t("Код заказа — укажите его в комментарии к переводу")}</span>
                <b>{o.ref}</b>
              </div>
              {payQr ? (
                <img className="gtr-tix-qr" src={payQr} alt="PromptPay QR" />
              ) : (
                <p className="gtr-tix-fine">{t("Оплата временно недоступна — напишите нам в Telegram.")}</p>
              )}
              {data?.pay ? (
                <p className="gtr-tix-fine">
                  {t("Получатель")}: {data.pay.name}.{" "}
                  {t("Отсканируйте QR в приложении банка или сохраните его в галерею и откройте оттуда.")}
                </p>
              ) : null}
              {o.claimed ? (
                <div className="gtr-af-note gtr-af-note-ok">
                  {t("Спасибо! Сверяем поступление — билет появится здесь, страницу можно не обновлять.")}
                </div>
              ) : (
                <button className="gtr-btn gtr-btn-red gtr-tix-buy" disabled={claiming} onClick={claim}>
                  {t("Я оплатил")}
                </button>
              )}
            </>
          ) : null}

          {o.status === "paid" || o.status === "used" ? (
            <>
              {ticketQr ? <img className="gtr-tix-qr" src={ticketQr} alt={t("QR билета")} /> : null}
              <div className="gtr-tix-ref">
                <span>{t("Покажите QR или назовите код на входе")}</span>
                <b>{o.ref}</b>
              </div>
              {o.status === "used" ? (
                <div className="gtr-af-note">{t("Билет уже использован на входе.")}</div>
              ) : (
                <p className="gtr-tix-fine">{t("Сохраните эту страницу или сделайте скриншот.")}</p>
              )}
            </>
          ) : null}

          {o.status === "rejected" ? (
            <p className="gtr-tix-fine">
              {t("Оплата по этому заказу не найдена. Если вы платили — напишите нам в Telegram и пришлите чек.")}
            </p>
          ) : null}

          <a className="gtr-tix-help" href="https://t.me/bangtaostyle" target="_blank" rel="noreferrer">
            {t("Вопрос по заказу — Telegram @bangtaostyle")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
