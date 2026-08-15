// Публичная регистрация с выбором роли. Посетитель заходит мгновенно;
// артист / организатор / площадка / команда — заявка, которую подтверждает
// основатель (Telegram-кнопки у BOSS + карточка в дашборде). До одобрения
// входа нет — логин честно отвечает «на рассмотрении».
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { sessionFn } from "@/gtr/auth";
import { signupApplyFn, signupVisitorFn } from "@/gtr/kv-api";
import { Eyebrow } from "@/gtr/ui";
import "@/gtr/i18n";

export const Route = createFileRoute("/gtr/signup")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  component: SignupPage,
});

const KINDS: [string, string, string][] = [
  // [kind, заголовок, подпись]
  ["visitor", "Посетитель", "Афиша, бронь столов, подбор вечеринок — вход сразу"],
  ["artist", "Артист", "Профиль, сеты, букинг — после подтверждения"],
  ["organizer", "Организатор", "Конструктор событий и площадки — после подтверждения"],
  ["venue", "Площадка", "Афиша, брони и гости — после подтверждения"],
  ["team", "Хочу в команду", "Работа с GTR — после подтверждения"],
];

function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kind, setKind] = useState("visitor");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      if (kind === "visitor") {
        const r = await signupVisitorFn({ data: { name, email, password } });
        if (r.ok) navigate({ to: "/gtr/$screen", params: { screen: "feed" } });
        else setErr(r.error ?? t("Не получилось"));
      } else {
        const r = await signupApplyFn({ data: { name, email, password, kind, about } });
        if (r.ok) setApplied(true);
        else setErr(r.error ?? t("Не получилось"));
      }
    } catch {
      setErr(t("Сервер недоступен"));
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="gtr-card" style={{ width: "min(460px, 100%)", padding: "28px 30px", display: "grid", gap: 14 }}>
          <img src="/brand/GTR_primary_dark_clean.svg" alt="GTR" style={{ height: 40, width: "auto", justifySelf: "start" }} />
          <Eyebrow>{t("ЗАЯВКА ОТПРАВЛЕНА")}</Eyebrow>
          <div style={{ font: "500 12.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
            {t("Подтверждение — у основателя GTR. Как только заявку одобрят, просто войдите со своим email и паролем.")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="gtr-btn gtr-btn-red" style={{ textDecoration: "none" }} href="https://t.me/gtr_live" target="_blank" rel="noreferrer">
              📣 {t("Канал новостей")}
            </a>
            <a className="gtr-btn" style={{ textDecoration: "none" }} href="/gtr/login">
              {t("К входу")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="gtr-card" style={{ width: "min(480px, 100%)", padding: "26px 28px", display: "grid", gap: 12 }}>
        <img src="/brand/GTR_primary_dark_clean.svg" alt="GTR" style={{ height: 40, width: "auto", justifySelf: "start" }} />
        <Eyebrow>{t("КТО ВЫ В GTR?")}</Eyebrow>
        <div style={{ display: "grid", gap: 6 }}>
          {KINDS.map(([k, title, sub]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                cursor: "pointer",
                background: kind === k ? "rgba(229,35,27,.14)" : "rgba(255,255,255,.04)",
                border: kind === k ? "1px solid #E5231B" : "1px solid rgba(255,255,255,.1)",
                color: "inherit",
              }}
            >
              <div style={{ font: "700 12px/1.2 Oswald,sans-serif", textTransform: "uppercase", letterSpacing: ".04em" }}>
                {t(title)}
              </div>
              <div style={{ marginTop: 3, font: "500 10px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
                {t(sub)}
              </div>
            </button>
          ))}
        </div>
        <input className="gtr-input" placeholder={t("Имя")} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="gtr-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="gtr-input"
          type="password"
          placeholder={t("Пароль (от 6 символов)")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {kind !== "visitor" ? (
          <textarea
            className="gtr-input"
            style={{ minHeight: 70, resize: "vertical" }}
            placeholder={t("О себе: кто вы, ссылки на соцсети / площадку / миксы")}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        ) : null}
        {err ? <div style={{ font: "600 11px/1.4 'Golos Text',sans-serif", color: "#E5231B" }}>{err}</div> : null}
        <button className="gtr-btn gtr-btn-red" disabled={busy} style={{ opacity: busy ? 0.6 : 1 }} onClick={() => void submit()}>
          {busy ? t("Секунду…") : kind === "visitor" ? t("Создать аккаунт") : t("Отправить заявку")}
        </button>
        <a href="/gtr/login" style={{ font: "500 10.5px/1.4 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
          {t("Уже есть аккаунт? Войти")}
        </a>
      </div>
    </div>
  );
}
