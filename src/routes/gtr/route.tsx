import { Outlet, createFileRoute } from "@tanstack/react-router";

import gtrCss from "@/gtr/gtr.css?url";
import { ContentProvider } from "@/gtr/content";

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
  return (
    <div className="gtr-app" style={{ minHeight: "100vh" }}>
      <ContentProvider>
        <Outlet />
      </ContentProvider>
    </div>
  );
}
