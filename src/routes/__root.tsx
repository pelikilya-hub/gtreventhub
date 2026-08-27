import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
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
        // maximum-scale/user-scalable убирают системный щипок там, где браузер
        // их слушает (Android). iOS их игнорирует — там то же самое делает
        // gtr/zoom.ts, он же отдаёт увеличение трём пальцам.
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      // Значения по умолчанию для всего продукта. Витрина (/ и /en) их
      // перекрывает своими — там текст пишется под выдачу, а не под кабинет.
      { title: "GTR Event — ночной Таиланд: афиша, бронь столов, артисты" },
      {
        name: "description",
        content:
          "GTR Event: живая афиша площадок Таиланда, бронь стола, маршрут вечера, каталог артистов и кабинеты площадок.",
      },
      // Ссылку кидают в мессенджеры — без og-тегов превью там пустое
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "GTR Event" },
      { property: "og:locale", content: "ru_RU" },
      { property: "og:title", content: "GTR Event — ночной Таиланд в одном приложении" },
      {
        property: "og:description",
        content:
          "Афиша на каждый вечер, бронь стола, маршрут вечера и подбор вечеринок под твой музыкальный вкус.",
      },
      { property: "og:image", content: "/og-cover.png" },
      { name: "twitter:card", content: "summary_large_image" },
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
      // Шрифты подгружались по мере надобности, и текст перерисовывался по
      // очереди: сначала системный, потом гротеск, потом моно — на телефоне
      // это читалось как наложение трёх шрифтов. Четыре начертания, которые
      // держат почти весь текст, забираем сразу, до первой отрисовки.
      { rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous",
        href: "/fonts/gtr/GolosText-500-cyrillic.woff2" },
      { rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous",
        href: "/fonts/gtr/GolosText-600-cyrillic.woff2" },
      { rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous",
        href: "/fonts/gtr/JetBrainsMono-500-cyrillic.woff2" },
      { rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous",
        href: "/fonts/gtr/Oswald-600-cyrillic.woff2" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: ReactNode }) {
  // Язык документа — не украшение: по нему поисковик решает, для какой
  // аудитории страница, а экранный диктор выбирает голос. Английская
  // витрина под lang="ru" читалась бы русским синтезатором и конкурировала
  // бы в выдаче с русской версией как дубль.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const lang = path === "/en" || path.startsWith("/en/") ? "en" : "ru";
  return (
    <html lang={lang} style={{ background: "#0A0B0D" }}>
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
