// Вступление по ссылке-приглашению: /gtr/join?code=join-…
// Человек сам заводит аккаунт (имя, email, пароль) и сразу попадает в кабинет.
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { sessionFn } from "@/gtr/auth";
import { OWNER_TG } from "@/gtr/community";
import { inviteInfoFn, joinFn } from "@/gtr/kv-api";
import { Eyebrow } from "@/gtr/ui";

export const Route = createFileRoute("/gtr/join")({
  validateSearch: (s: Record<string, unknown>) => ({ code: String(s.code ?? "") }),
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  loaderDeps: ({ search }) => ({ code: search.code }),
  loader: async ({ deps }) => await inviteInfoFn({ data: { code: deps.code } }),
  component: JoinPage,
});

function JoinPage() {
  const { t } = useTranslation();
  const info = Route.useLoaderData();
  const { code } = Route.useSearch();
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
      const r = await joinFn({ data: { code, name, email, password } });
      if (r.ok) navigate({ to: "/gtr/$screen", params: { screen: "dash" } });
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
      <div
        className="gtr-card"
        style={{
          width: "min(430px, 100%)",
          padding: "26px 28px",
          display: "grid",
          gap: 14,
          position: "relative",
          overflow: "hidden",
          clipPath: "polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%)",
        }}
      >
        <div className="gtr-laser" style={{ top: 0, ["--gtr-run" as string]: "160px" }} />
        <img src="/brand/GTR_horizontal_dark.svg" alt="GTR" style={{ height: 36, width: "auto", justifySelf: "start" }} />
        <Eyebrow>ПРИГЛАШЕНИЕ В GTR EVENT</Eyebrow>

        {!info.ok ? (
          <>
            {/* Человек пришёл по приглашению — он не наш инженер. Внутреннюю
                причину («Хранилище недоступно») переводим на человеческий и
                даём, кому написать: без этого приглашение просто теряется. */}
            <div style={{ font: "600 15px/1.4 'Golos Text',sans-serif" }}>
              {/^Хранилище/.test(info.error ?? "")
                ? t("Приглашение сейчас не проверить — база на минуту недоступна. Попробуйте открыть ссылку ещё раз через пару минут.")
                : t("Приглашение не действует: ссылка устарела или уже использована.")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                className="gtr-btn gtr-btn-red"
                style={{ textDecoration: "none" }}
                href={OWNER_TG}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Написать команде GTR")} →
              </a>
              <a className="gtr-btn" style={{ textDecoration: "none" }} href="/gtr/login">
                {t("Ко входу")} →
              </a>
            </div>
          </>
        ) : (
          <>
            <div style={{ font: "600 15px/1.45 'Golos Text',sans-serif" }}>
              {info.inviterName} {t("приглашает вас")}
              {info.team ? " " + t("в свою команду") : ""} — {t("роль")} «{t(info.roleLabel)}».
            </div>
            <div style={{ font: "500 11.5px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
              {t("Создайте аккаунт — событие, площадки, артисты и подрядчики Пхукета будут в вашем кабинете.")}
            </div>
            <input
              className="gtr-input"
              style={{ padding: "10px 12px" }}
              placeholder={t("Имя и фамилия")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="gtr-input"
              style={{ padding: "10px 12px" }}
              placeholder="email@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="gtr-input"
              style={{ padding: "10px 12px" }}
              placeholder={t("Пароль (от 6 символов)")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button
              className="gtr-btn gtr-btn-red"
              style={{ padding: "11px 16px", opacity: busy ? 0.5 : 1 }}
              disabled={busy || !name.trim() || !email.trim() || password.length < 6}
              onClick={submit}
            >
              Создать аккаунт и войти →
            </button>
            {err ? (
              <div style={{ font: "500 11px/1.4 'Golos Text',sans-serif", color: "#FF5B4D" }}>{err}</div>
            ) : null}
            <div
              className="gtr-mono"
              style={{ font: "500 9px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
            >
              Уже есть аккаунт? <a href="/gtr/login" style={{ color: "inherit" }}>Войти</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
