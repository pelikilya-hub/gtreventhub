// Публичная регистрация посетителя: имя, email, пароль — и сразу в кабинет.
// Google OAuth добавится второй кнопкой, когда появятся ключи OAuth-клиента.
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { sessionFn } from "@/gtr/auth";
import { signupVisitorFn } from "@/gtr/kv-api";
import { Eyebrow } from "@/gtr/ui";
import "@/gtr/i18n";

export const Route = createFileRoute("/gtr/signup")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  component: SignupPage,
});

function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await signupVisitorFn({ data: { name, email, password } });
      if (r.ok) navigate({ to: "/gtr/$screen", params: { screen: "feed" } });
      else setErr(r.error ?? t("Не получилось"));
    } catch {
      setErr(t("Сервер недоступен"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div className="gtr-card" style={{ width: "min(420px, 100%)", padding: "26px 28px", display: "grid", gap: 12 }}>
        <img
          src="/brand/GTR_primary_dark_clean.svg"
          alt="GTR"
          style={{ height: 40, width: "auto", justifySelf: "start" }}
        />
        <Eyebrow>{t("АККАУНТ ПОСЕТИТЕЛЯ")}</Eyebrow>
        <div style={{ font: "500 11.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
          {t("События, заведения, карта и бронь столов — вся ночная жизнь Пхукета в одном месте.")}
        </div>
        <input
          className="gtr-input"
          placeholder={t("Имя")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="gtr-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="gtr-input"
          type="password"
          placeholder={t("Пароль (от 6 символов)")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {err ? (
          <div style={{ font: "600 11px/1.4 'Golos Text',sans-serif", color: "#E5231B" }}>{err}</div>
        ) : null}
        <button
          className="gtr-btn gtr-btn-red"
          style={{ padding: "12px 16px" }}
          disabled={busy || !email.trim() || password.length < 6}
          onClick={() => void submit()}
        >
          {busy ? "…" : t("Создать аккаунт")}
        </button>
        <button
          className="gtr-btn"
          onClick={() => navigate({ to: "/gtr/login" })}
        >
          {t("У меня уже есть аккаунт — войти")}
        </button>
      </div>
    </div>
  );
}
