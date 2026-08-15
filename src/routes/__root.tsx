import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover обязателен: без него iOS отдаёт env(safe-area-inset-*)
      // равным нулю, и весь учёт чёлки, Dynamic Island и полоски home в CSS
      // не работает — в установленном PWA (status-bar-style black-translucent)
      // контент уезжает под статус-бар.
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "GTR Event — операционная платформа площадок Пхукета" },
      {
        name: "description",
        content:
          "GTR Event: конструктор события, смета с комиссией, каталоги площадок, артистов и подрядчиков Пхукета.",
      },
      // Ссылку кидают в мессенджеры — без og-тегов превью там пустое
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "GTR Event" },
      { property: "og:locale", content: "ru_RU" },
      { property: "og:title", content: "GTR Event — операционная платформа площадок Пхукета" },
      {
        property: "og:description",
        content:
          "Конструктор события, смета с комиссией GTR, каталоги 104 площадок, 312 артистов, подрядчиков и оборудования.",
      },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#0A0B0D" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "GTR Event" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/brand/GTR_favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/icon-256.png", type: "image/png", sizes: "256x256" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
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
  // После деплоя старые чанки исчезают: если открытая PWA пробует лениво
  // подгрузить экран старой сборки — перезагружаемся на свежую (один раз,
  // чтобы не зациклиться)
  useEffect(() => {
    const onPreloadError = (e: Event) => {
      e.preventDefault();
      const KEY = "gtr-reload-guard";
      if (sessionStorage.getItem(KEY) !== "1") {
        sessionStorage.setItem(KEY, "1");
        location.reload();
      }
    };
    const clearGuard = () => sessionStorage.removeItem("gtr-reload-guard");
    window.addEventListener("vite:preloadError", onPreloadError);
    const t = setTimeout(clearGuard, 15000);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      clearTimeout(t);
    };
  }, []);
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
