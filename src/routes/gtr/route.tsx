import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import gtrCss from "@/gtr/gtr.css?url";
import { ContentProvider } from "@/gtr/content";
import { installZoom } from "@/gtr/zoom";

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
  component: GtrLayout,
});

function GtrLayout() {
  // Масштаб на трёх пальцах: щипок двумя больше не растягивает вёрстку.
  useEffect(() => installZoom(), []);

  return (
    <div className="gtr-app" style={{ minHeight: "100vh" }}>
      <ContentProvider>
        <Outlet />
      </ContentProvider>
    </div>
  );
}
