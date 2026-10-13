// Тайская открытая афиша. «th_» в имени файла — путь /th/afisha без
// вложения в маршрут /th: витрина не рендерит дочерних страниц.
import { createFileRoute } from "@tanstack/react-router";

import { seoLinks, seoMeta } from "@/gtr/seo";
import { Afisha } from "@/landing/Afisha";
import { publicAfishaFn } from "@/landing/afisha-data";
import { LANDING_FONTS } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/th_/afisha")({
  loader: () => publicAfishaFn(),
  head: () => ({
    meta: seoMeta("th", "afisha"),
    links: [...seoLinks("th", "afisha"), { rel: "stylesheet", href: landingCss }, ...LANDING_FONTS],
  }),
  component: () => <Afisha lang="th" data={Route.useLoaderData()} />,
});
