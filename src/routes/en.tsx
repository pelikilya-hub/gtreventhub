// Английская витрина. Отдельный адрес, а не переключатель языка на корне:
// поисковику нужна страница с одним языком, своим каноническим адресом и
// hreflang-парой — иначе две версии конкурируют друг с другом как дубли.
import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionFn } from "@/gtr/auth";
import { publicStatsFn } from "@/gtr/public-stats";
import { seoLinks, seoMeta } from "@/gtr/seo";
import { Landing } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/en")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  loader: () => publicStatsFn(),
  head: () => ({
    meta: seoMeta("en"),
    links: [...seoLinks("en"), { rel: "stylesheet", href: landingCss }],
  }),
  component: () => <Landing lang="en" stats={Route.useLoaderData()} />,
});
