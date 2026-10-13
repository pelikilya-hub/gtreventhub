import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { I18nextProvider } from "react-i18next";

import gtrCss from "@/gtr/gtr.css?url";
import { ContentProvider } from "@/gtr/content";
import { installZoom } from "@/gtr/zoom";
import i18n, { preferredLang, setUiLang } from "@/gtr/i18n";
import { ssrUiLang } from "@/gtr/i18n-lang";

export const Route = createFileRoute("/gtr")({
  head: () => ({
    meta: [
      { title: "GTR Event — операционная платформа площадок Пхукета" },
      {
        name: "description",
        content:
          "GTR Event: дашборд площадки, конструктор события, календарь программы, база площадок и артистов Пхукета.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: gtrCss }],
  }),
  loader: () => ({ lang: ssrUiLang() }),
  component: GtrLayout,
});

function GtrLayout() {
  const { lang } = Route.useLoaderData();
  // Масштаб на трёх пальцах: щипок двумя больше не растягивает вёрстку.
  useEffect(() => installZoom(), []);
  // Старые гости выбирали язык до появления cookie: сервер о выборе не
  // знает и отрисовал по языку телефона. Догоняем выбор после гидрации и
  // пишем cookie — со следующей загрузки страница сразу придёт на нём.
  // Переключаем после полной загрузки: экраны грузятся лениво и гидрируются
  // позже оболочки, смена языка раньше ломала бы их гидрацию.
  useEffect(() => {
    const want = preferredLang();
    if (want === i18n.language) return;
    let timer = 0;
    const run = () => {
      timer = window.setTimeout(() => setUiLang(want), 250);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    return () => {
      window.removeEventListener("load", run);
      window.clearTimeout(timer);
    };
  }, []);
  // На сервере i18n — один экземпляр на все запросы, язык в нём менять
  // нельзя: параллельные запросы перебивали бы друг друга. Каждой
  // отрисовке — свой клон с языком запроса; в браузере — общий экземпляр.
  const inst = useMemo(
    () => (typeof window === "undefined" ? i18n.cloneInstance({ lng: lang }) : i18n),
    [lang],
  );

  return (
    <I18nextProvider i18n={inst}>
      <div className="gtr-app" data-lang={lang} style={{ minHeight: "100vh" }}>
        <ContentProvider>
          <Outlet />
        </ContentProvider>
      </div>
    </I18nextProvider>
  );
}
