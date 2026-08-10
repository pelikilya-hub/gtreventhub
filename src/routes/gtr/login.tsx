import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { accessModeFn, loginFn, sessionFn } from "@/gtr/auth";
import { V } from "@/gtr/data/app-data";
import { Eyebrow } from "@/gtr/ui";

export const Route = createFileRoute("/gtr/login")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user)
      throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  loader: async () => await accessModeFn(),
  component: LoginPage,
});

const DEMO = [
  {
    email: "pr@gtr.events",
    label: "PR-директор",
    ini: "ПД",
    venue: "VEN-0013",
  },
  {
    email: "owner@gtr.events",
    label: "Владелец",
    ini: "ВЛ",
    venue: "VEN-0061",
  },
  {
    email: "sales@gtr.events",
    label: "Event-продажи",
    ini: "ПР",
    venue: "VEN-0033",
  },
  { email: "admin@gtr.events", label: "GTR-админ", ini: "АД", venue: "" },
];

function LoginPage() {
  const { demo } = Route.useLoaderData();
  const navigate = useNavigate();
  const [email, setEmail] = useState("pr@gtr.events");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (em: string, pw: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await loginFn({ data: { email: em, password: pw } });
      if (res.ok) {
        navigate({ to: "/gtr/$screen", params: { screen: "dash" } });
      } else {
        setError(res.error);
      }
    } catch {
      setError("Не удалось выполнить вход. Попробуйте ещё раз.");
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
        padding: 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="gtr-beam" />
      <div className="gtr-glowbar" style={{ left: "18%" }} />
      <div
        className="gtr-glowbar"
        style={{ left: "78%", animationDelay: "1.4s" }}
      />

      <div
        className="gtr-fade"
        style={{ width: "100%", maxWidth: 420, position: "relative" }}
      >
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div
            className="gtr-oswald gtr-neon"
            style={{
              font: "700 34px/1 Oswald,sans-serif",
              letterSpacing: ".08em",
              color: "#fff",
            }}
          >
            GTR <span style={{ color: "#E5231B" }}>EVENT</span>
          </div>
          <Eyebrow style={{ marginTop: 10 }}>
            ОПЕРАЦИОННАЯ ПЛАТФОРМА · ПХУКЕТ
          </Eyebrow>
        </div>

        <div className="gtr-card" style={{ padding: 24 }}>
          {!demo ? null : (
            <>
              <Eyebrow style={{ marginBottom: 12 }}>
                БЫСТРЫЙ ВХОД · ДЕМО-РОЛИ
              </Eyebrow>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 18,
                }}
              >
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    className="gtr-pal-btn"
                    disabled={busy}
                    onClick={() => {
                      setEmail(d.email);
                      submit(d.email, "gtr2026");
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        flex: "none",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        font: "700 9.5px/1 Oswald,sans-serif",
                        color: "#fff",
                        background:
                          email === d.email
                            ? "#E5231B"
                            : "rgba(255,255,255,.09)",
                      }}
                    >
                      {d.ini}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600 }}>
                        {d.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 3,
                          font: "500 9.5px/1.2 'JetBrains Mono',monospace",
                          color: "rgba(255,255,255,.4)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {d.venue ? V(d.venue).name : "Сеть · 97 площадок"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <Eyebrow style={{ marginBottom: 10 }}>
            {demo ? "ИЛИ ПО EMAIL И ПАРОЛЮ" : "ВХОД ПО EMAIL И ПАРОЛЮ"}
          </Eyebrow>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(email, password);
            }}
            style={{ display: "grid", gap: 10 }}
          >
            <input
              className="gtr-input"
              type="email"
              autoComplete="username"
              placeholder="email@gtr.events"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="gtr-input"
              type="password"
              autoComplete="current-password"
              placeholder={demo ? "Пароль (демо: gtr2026)" : "Пароль"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error ? (
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
                {error}
              </div>
            ) : null}
            <button
              className="gtr-btn gtr-btn-red"
              type="submit"
              disabled={busy}
              style={{ padding: "11px 13px" }}
            >
              {busy ? "Входим…" : "Войти в кабинет"}
            </button>
          </form>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0 12px",
              color: "rgba(255,255,255,.25)",
            }}
          >
            <span
              style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }}
            />
            <span
              className="gtr-mono"
              style={{
                font: "600 8.5px/1 'JetBrains Mono',monospace",
                letterSpacing: ".1em",
              }}
            >
              ВЫ ОРГАНИЗАТОР?
            </span>
            <span
              style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }}
            />
          </div>
          <button
            className="gtr-btn"
            style={{ width: "100%", padding: "11px 13px" }}
            onClick={() => navigate({ to: "/gtr/organizer" })}
          >
            Открыть витрину организатора · без входа →
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            textAlign: "center",
            font: "500 10.5px/1.5 'JetBrains Mono',monospace",
            color: "rgba(255,255,255,.35)",
          }}
        >
          Сессия — httpOnly cookie, подпись HMAC-SHA256 · роли и права — на
          сервере
        </div>
      </div>
    </div>
  );
}
