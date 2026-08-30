// Двери входа на экране: Telegram, Google, телефон.
//
// Один компонент на экран входа и на регистрацию: там и там это одни и
// те же три кнопки, а «войти» и «зарегистрироваться» через них — вообще
// одно действие. Человек не выбирает, новый он или старый; он жмёт
// «Telegram», а разберёмся мы сами (см. identity.ts).
//
// Показываем только настроенные двери. Кнопка, ведущая к ошибке
// провайдера, хуже отсутствующей: человек решает, что сломан продукт,
// а не что мы чего-то не подключили.
//
// Телеграм-вход сделан кодом-ссылкой, а не виджетом: виджету нужен
// домен в BotFather и живой скрипт telegram.org на странице, а код
// работает везде, включая нашу Android-оболочку со старым WebView.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { phoneCodeFn, phoneVerifyFn, tgLoginPollFn, tgLoginStartFn } from "./auth-doors";

type Doors = { telegram: boolean; google: boolean; phone: boolean };

const Err = ({ text }: { text: string }) => (
  <div
    style={{
      font: "500 11px/1.4 'Golos Text',sans-serif",
      color: "#E5231B",
      background: "rgba(229,35,27,.1)",
      border: "1px solid rgba(229,35,27,.35)",
      borderRadius: 8,
      padding: "8px 11px",
    }}
  >
    {text}
  </div>
);

export function AuthDoors({ doors, onDone }: { doors: Doors; onDone: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "tg" | "phone">("");
  // Ссылка на бота остаётся на экране: всплывающее окно могли закрыть
  // или заблокировать, и тогда это единственный путь дальше.
  const [tgUrl, setTgUrl] = useState("");
  const [phase, setPhase] = useState<"" | "phone" | "code">("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<{ phone: string; via: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Опрос кода — единственное, что живёт дольше клика. Гасим его при
  // уходе с экрана: иначе он продолжит стучать в сервер из размонти-
  // рованного компонента и попытается впустить уже ушедшего человека.
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const startTelegram = async () => {
    setError(null);
    setBusy("tg");
    try {
      const res = await tgLoginStartFn();
      if (!res.ok) {
        setError(res.error);
        setBusy("");
        return;
      }
      setTgUrl(res.url);
      // Новая вкладка удобнее: наш экран остаётся, и человеку есть куда
      // вернуться. Заблокировали — ссылка ниже никуда не делась.
      window.open(res.url, "_blank", "noopener");
      const started = Date.now();
      poll.current = setInterval(async () => {
        // Код живёт пять минут; после этого опрашивать нечего.
        if (Date.now() - started > res.ttl * 1000) {
          if (poll.current) clearInterval(poll.current);
          setBusy("");
          setError(t("Код входа истёк — нажмите кнопку ещё раз"));
          return;
        }
        const p = await tgLoginPollFn({ data: { code: res.code } }).catch(() => null);
        if (!p) return;
        if (p.ok) {
          if (poll.current) clearInterval(poll.current);
          onDone();
        } else if (!("waiting" in p) || !p.waiting) {
          if (poll.current) clearInterval(poll.current);
          setBusy("");
          setError(p.error ?? t("Вход не удался"));
        }
      }, 2000);
    } catch (e) {
      setError(String(e).slice(0, 160));
      setBusy("");
    }
  };

  const askCode = async () => {
    setError(null);
    setBusy("phone");
    try {
      const res = await phoneCodeFn({ data: { phone } });
      if (!res.ok) setError(res.error);
      else {
        setSentTo({ phone: res.phone, via: res.via });
        setPhase("code");
      }
    } finally {
      setBusy("");
    }
  };

  const enterCode = async () => {
    setError(null);
    setBusy("phone");
    try {
      const res = await phoneVerifyFn({ data: { phone, code } });
      if (!res.ok) setError(res.error);
      else onDone();
    } finally {
      setBusy("");
    }
  };

  if (!doors.telegram && !doors.google && !doors.phone) return null;

  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
      {doors.telegram ? (
        <button
          className="gtr-btn"
          style={{ width: "100%", padding: "11px 13px" }}
          disabled={busy === "tg"}
          onClick={startTelegram}
        >
          {busy === "tg" ? t("Ждём подтверждения в Telegram…") : t("Войти через Telegram")}
        </button>
      ) : null}

      {tgUrl && busy === "tg" ? (
        <div
          style={{
            font: "500 11px/1.5 'Golos Text',sans-serif",
            color: "rgba(255,255,255,.6)",
            textAlign: "center",
          }}
        >
          {t("Не открылось?")}{" "}
          <a href={tgUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#E5231B" }}>
            {t("Открыть бота")}
          </a>
        </div>
      ) : null}

      {doors.google ? (
        // Обычная ссылка, а не кнопка со скриптом: вход через Google —
        // это переход на его домен и возврат, и браузеру про это лучше
        // знать заранее.
        <a
          className="gtr-btn"
          href="/api/google-auth"
          style={{ width: "100%", padding: "11px 13px", textAlign: "center", display: "block" }}
        >
          {t("Войти через Google")}
        </a>
      ) : null}

      {doors.phone && phase === "" ? (
        <button
          className="gtr-btn"
          style={{ width: "100%", padding: "11px 13px" }}
          onClick={() => setPhase("phone")}
        >
          {t("Войти по номеру телефона")}
        </button>
      ) : null}

      {phase === "phone" ? (
        <div style={{ display: "grid", gap: 8 }}>
          <input
            className="gtr-input"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder={t("0812345678 или +7 999 …")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            className="gtr-btn gtr-btn-red"
            style={{ padding: "11px 13px" }}
            disabled={busy === "phone" || phone.trim().length < 6}
            onClick={askCode}
          >
            {busy === "phone" ? t("Отправляем…") : t("Прислать код")}
          </button>
        </div>
      ) : null}

      {phase === "code" ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              font: "500 11px/1.5 'Golos Text',sans-serif",
              color: "rgba(255,255,255,.6)",
            }}
          >
            {t("Код отправлен на")} {sentTo?.phone} · {sentTo?.via}
          </div>
          <input
            className="gtr-input"
            // Не type=number: он режет ведущие нули и показывает стрелки
            // вверх-вниз там, где нужна цифровая клавиатура.
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button
            className="gtr-btn gtr-btn-red"
            style={{ padding: "11px 13px" }}
            disabled={busy === "phone" || code.length < 6}
            onClick={enterCode}
          >
            {busy === "phone" ? t("Проверяем…") : t("Войти")}
          </button>
          <button
            className="gtr-btn"
            style={{ padding: "9px 13px" }}
            onClick={() => {
              setPhase("phone");
              setCode("");
              setError(null);
            }}
          >
            {t("Изменить номер")}
          </button>
        </div>
      ) : null}

      {error ? <Err text={t(error)} /> : null}
    </div>
  );
}
