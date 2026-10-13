// Тайская витрина. Как и английская — отдельный адрес со своим
// каноническим URL и hreflang-тройкой, а не переключатель на корне.
import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionFn } from "@/gtr/auth";
import { publicStatsFn } from "@/gtr/public-stats";
import { seoLinks, seoMeta } from "@/gtr/seo";
import { LANDING_FONTS, Landing } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/th")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  loader: () => publicStatsFn(),
  head: () => ({
    meta: seoMeta("th"),
    links: [
      ...seoLinks("th"),
      { rel: "stylesheet", href: landingCss },
      ...LANDING_FONTS,
    ],
  }),
  component: () => <Landing lang="th" stats={Route.useLoaderData()} />,
});
