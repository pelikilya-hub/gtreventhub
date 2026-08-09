import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GTR Event — операционная платформа площадок Пхукета" },
      {
        name: "description",
        content:
          "GTR Event: конструктор события, смета с комиссией, каталоги площадок, артистов и подрядчиков Пхукета.",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" style={{ background: "#0A0B0D" }}>
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, background: "#0A0B0D" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster position="top-center" richColors theme="dark" />
    </>
  );
}

function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0A0B0D",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, fontWeight: 700 }}>404</div>
        <Link to="/gtr" style={{ color: "#E5231B" }}>
          На главную GTR Event
        </Link>
      </div>
    </div>
  );
}
