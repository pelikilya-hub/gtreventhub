// Сторож витрины.
//
// SEO ломается тихо: кто-то поправил заголовок, забыл canonical, снял
// hreflang — и через месяц выясняется, что домен пропал из выдачи. Здесь
// зафиксировано то, что должно быть на странице всегда, и то, чего на ней
// быть не должно никогда: кабинеты в карте сайта и открытая индексация
// приложения.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_URL } from "../app-url";
import { canonicalOf, OG_IMAGE, SEO_COPY, seoJsonLd, seoLinks, seoMeta } from "../seo";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("мета витрины", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`${lang}: заголовок и описание в пределах, которые выдача не режет`, () => {
      const c = SEO_COPY[lang];
      // Google показывает ~60 знаков заголовка и ~160 описания. Длиннее —
      // не ошибка, но обрезанное на полуслове предложение выглядит небрежно.
      expect(c.title.length).toBeGreaterThan(20);
      expect(c.title.length).toBeLessThanOrEqual(70);
      expect(c.description.length).toBeGreaterThan(80);
      expect(c.description.length).toBeLessThanOrEqual(200);
    });

    it(`${lang}: страница разрешена к индексации и несёт превью`, () => {
      const meta = seoMeta(lang);
      const by = (k: string, v: string) =>
        meta.find((m) => (m as Record<string, string>)[k] === v) as Record<string, string>;
      expect(by("name", "robots").content).toContain("index");
      expect(by("name", "robots").content).not.toContain("noindex");
      expect(by("property", "og:image").content).toBe(OG_IMAGE);
      expect(by("name", "twitter:card").content).toBe("summary_large_image");
      expect(by("property", "og:url").content).toBe(canonicalOf(lang));
    });

    it(`${lang}: канонический адрес и обе языковые альтернативы`, () => {
      const links = seoLinks(lang);
      expect(links.find((l) => l.rel === "canonical")?.href).toBe(canonicalOf(lang));
      const alt = links.filter((l) => l.rel === "alternate").map((l) => l.hrefLang);
      expect(alt).toEqual(["ru", "en", "x-default"]);
    });
  }

  it("адреса витрины строятся от APP_URL, а не вписаны руками", () => {
    expect(canonicalOf("ru")).toBe(`${APP_URL}/`);
    expect(canonicalOf("en")).toBe(`${APP_URL}/en`);
    expect(OG_IMAGE.startsWith(APP_URL)).toBe(true);
  });

  it("разметка schema.org — валидный JSON с тремя сущностями", () => {
    const ld = JSON.parse(seoJsonLd("ru", { venues: 354, artists: 312 })) as {
      "@graph": { "@type": string }[];
    };
    expect(ld["@graph"].map((n) => n["@type"])).toEqual([
      "Organization",
      "WebSite",
      "MobileApplication",
    ]);
  });
});

describe("robots и карта сайта", () => {
  const robots = read("public/robots.txt");
  const sitemap = read("public/sitemap.xml");

  it("приложение закрыто от поиска, витрина открыта", () => {
    expect(robots).toMatch(/^Disallow: \/gtr\/$/m);
    expect(robots).toMatch(/^Allow: \/\$$/m);
    expect(robots).toMatch(/^Allow: \/en\$$/m);
  });

  it("краулеры ИИ по-прежнему запрещены поимённо", () => {
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "CCBot", "Bytespider"])
      expect(robots, bot).toContain(`User-agent: ${bot}`);
  });

  it("robots указывает на карту сайта", () => {
    expect(robots).toContain(`Sitemap: ${APP_URL}/sitemap.xml`);
  });

  it("в карте сайта только витрина — кабинеты туда не попадают", () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${APP_URL}/`, `${APP_URL}/en`]);
    // адреса, а не комментарии: в шапке файла /gtr/ упомянут как раз затем,
    // чтобы объяснить, почему его здесь нет
    for (const l of locs) expect(l).not.toContain("/gtr/");
  });

  it("у обеих страниц карты объявлены языковые альтернативы", () => {
    expect([...sitemap.matchAll(/hreflang="ru"/g)]).toHaveLength(2);
    expect([...sitemap.matchAll(/hreflang="en"/g)]).toHaveLength(2);
    expect([...sitemap.matchAll(/hreflang="x-default"/g)]).toHaveLength(2);
  });
});

describe("кабинеты остаются закрытыми", () => {
  it("раздел /gtr помечен noindex", () => {
    expect(read("src/routes/gtr/route.tsx")).toContain('content: "noindex"');
  });
});
