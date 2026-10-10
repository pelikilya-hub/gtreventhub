// Открытая афиша: кто играет сегодня и на две недели вперёд — без входа.
// Сессию не проверяем: афиша нужна и гостю, и тому, кто уже внутри.
import { createFileRoute } from "@tanstack/react-router";

import { seoLinks, seoMeta } from "@/gtr/seo";
import { Afisha } from "@/landing/Afisha";
import { publicAfishaFn } from "@/landing/afisha-data";
import { LANDING_FONTS } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/afisha")({
  loader: () => publicAfishaFn(),
  head: () => ({
    meta: seoMeta("ru", "afisha"),
    links: [...seoLinks("ru", "afisha"), { rel: "stylesheet", href: landingCss }, ...LANDING_FONTS],
  }),
  component: () => <Afisha lang="ru" data={Route.useLoaderData()} />,
});
