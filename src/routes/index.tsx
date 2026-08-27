// Корень домена: публичная витрина продукта.
//
// Раньше здесь стоял редирект в приложение. Это удобно тому, кто уже внутри,
// и полностью слепо снаружи: приложение помечено noindex, значит по имени
// продукта не находилось ничего. Теперь на корне живёт витрина, а тот, у
// кого уже есть сессия, по-прежнему уезжает прямо в кабинет — ему
// рекламировать продукт незачем.
import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionFn } from "@/gtr/auth";
import { publicStatsFn } from "@/gtr/public-stats";
import { seoLinks, seoMeta } from "@/gtr/seo";
import { Landing } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { user } = await sessionFn();
    if (user) throw redirect({ to: "/gtr/$screen", params: { screen: "dash" } });
  },
  loader: () => publicStatsFn(),
  head: () => ({
    meta: seoMeta("ru"),
    links: [...seoLinks("ru"), { rel: "stylesheet", href: landingCss }],
  }),
  component: () => <Landing lang="ru" stats={Route.useLoaderData()} />,
});
