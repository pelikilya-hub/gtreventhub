// Английская открытая афиша. «en_» в имени файла — путь /en/afisha без
// вложения в маршрут /en: витрина не рендерит дочерних страниц.
import { createFileRoute } from "@tanstack/react-router";

import { seoLinks, seoMeta } from "@/gtr/seo";
import { Afisha } from "@/landing/Afisha";
import { publicAfishaFn } from "@/landing/afisha-data";
import { LANDING_FONTS } from "@/landing/Landing";
import landingCss from "@/landing/landing.css?url";

export const Route = createFileRoute("/en_/afisha")({
  loader: () => publicAfishaFn(),
  head: () => ({
    meta: seoMeta("en", "afisha"),
    links: [...seoLinks("en", "afisha"), { rel: "stylesheet", href: landingCss }, ...LANDING_FONTS],
  }),
  component: () => <Afisha lang="en" data={Route.useLoaderData()} />,
});
