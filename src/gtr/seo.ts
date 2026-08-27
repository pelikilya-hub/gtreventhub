// SEO публичной витрины.
//
// До этого gtrevent.com отдавал поисковику пустоту: корень редиректил в
// приложение, приложение помечено noindex, и в выдаче не было ничего — ни
// названия, ни описания, ни превью в мессенджере. Продукт, который зовут
// ставить на телефон, обязан находиться по имени.
//
// Здесь собрано всё, что видит робот и превью-бот: заголовки, описания,
// канонические адреса, языковые альтернативы и разметка schema.org.
// Кабинеты как были закрыты, так и остаются: индексируется витрина, а не
// внутренности продукта.
import { APP_URL } from "./app-url";

export type SeoLang = "ru" | "en";

/** Языки витрины и их адреса. Русский живёт в корне — это домашний язык
 *  продукта и главная страница домена. */
export const SEO_PATH: Record<SeoLang, string> = { ru: "/", en: "/en" };

export const canonicalOf = (lang: SeoLang) => `${APP_URL}${SEO_PATH[lang]}`;

/** Обложка для превью в мессенджерах и выдаче. Отдельная картинка 1200×630:
 *  иконка приложения в этой роли обрезается в квадрат и читается как ошибка. */
export const OG_IMAGE = `${APP_URL}/og-cover.png`;

type Copy = {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  locale: string;
};

export const SEO_COPY: Record<SeoLang, Copy> = {
  ru: {
    title: "GTR Event — ночной Таиланд: афиша, бронь столов, артисты",
    description:
      "Куда пойти сегодня в Таиланде: живая афиша клубов и пляжных клубов Пхукета, Самуи, Пангана, Паттайи и Бангкока, бронь стола за пару касаний, ИИ-подбор вечеринок под твою музыку.",
    ogTitle: "GTR Event — ночной Таиланд в одном приложении",
    ogDescription:
      "Афиша на каждый вечер, бронь стола, маршрут вечера и подбор вечеринок под твой музыкальный вкус. Пхукет, Самуи, Панган, Паттайя, Бангкок.",
    locale: "ru_RU",
  },
  en: {
    title: "GTR Event — Thailand nightlife: lineups, table booking, artists",
    description:
      "Where to go tonight in Thailand: live lineups from clubs and beach clubs in Phuket, Samui, Phangan, Pattaya and Bangkok, table booking in two taps, AI party match for your music taste.",
    ogTitle: "GTR Event — Thailand nightlife in one app",
    ogDescription:
      "Tonight's lineup, table booking, an evening route on the map and parties matched to your music. Phuket, Samui, Phangan, Pattaya, Bangkok.",
    locale: "en_US",
  },
};

/** Мета-теги страницы витрины: то, что попадает в выдачу и в превью ссылки. */
export function seoMeta(lang: SeoLang) {
  const c = SEO_COPY[lang];
  const other: SeoLang = lang === "ru" ? "en" : "ru";
  return [
    { title: c.title },
    { name: "description", content: c.description },
    // Витрину индексируем целиком, включая картинки и большие превью —
    // ровно противоположно кабинетам, которые остаются noindex.
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "GTR Event" },
    { property: "og:url", content: canonicalOf(lang) },
    { property: "og:locale", content: c.locale },
    { property: "og:locale:alternate", content: SEO_COPY[other].locale },
    { property: "og:title", content: c.ogTitle },
    { property: "og:description", content: c.ogDescription },
    { property: "og:image", content: OG_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: c.ogTitle },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: c.ogTitle },
    { name: "twitter:description", content: c.ogDescription },
    { name: "twitter:image", content: OG_IMAGE },
  ];
}

/** Канонический адрес и языковые альтернативы. Без hreflang две версии
 *  витрины конкурируют друг с другом в выдаче как дубли. */
export function seoLinks(lang: SeoLang) {
  return [
    { rel: "canonical", href: canonicalOf(lang) },
    { rel: "alternate", hrefLang: "ru", href: canonicalOf("ru") },
    { rel: "alternate", hrefLang: "en", href: canonicalOf("en") },
    { rel: "alternate", hrefLang: "x-default", href: canonicalOf("ru") },
  ];
}

/** Разметка schema.org одним блоком.
 *
 *  Три сущности, каждая со своей работой: Organization отвечает за
 *  карточку бренда, WebSite — за имя сайта в выдаче, MobileApplication —
 *  за то, чтобы продукт читался как приложение, а не как блог. */
export function seoJsonLd(lang: SeoLang, stats: { venues: number; artists: number }): string {
  const c = SEO_COPY[lang];
  const graph = [
    {
      "@type": "Organization",
      "@id": `${APP_URL}/#org`,
      name: "GTR Event",
      url: APP_URL,
      logo: `${APP_URL}/icon-512.png`,
      email: "pelikilya@gmail.com",
      areaServed: "TH",
      sameAs: ["https://t.me/bangtaostyle"],
    },
    {
      "@type": "WebSite",
      "@id": `${APP_URL}/#site`,
      url: APP_URL,
      name: "GTR Event",
      inLanguage: lang,
      description: c.description,
      publisher: { "@id": `${APP_URL}/#org` },
    },
    {
      "@type": "MobileApplication",
      "@id": `${APP_URL}/#app`,
      name: "GTR Event",
      url: APP_URL,
      applicationCategory: "TravelApplication",
      operatingSystem: "iOS, Android, Web",
      inLanguage: ["ru", "en", "th"],
      image: OG_IMAGE,
      description: c.ogDescription,
      featureList: [
        `${stats.venues} venues across Thailand`,
        `${stats.artists} artists with music and credits`,
        "Live nightly lineups",
        "Table booking",
        "AI party match",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "THB" },
      publisher: { "@id": `${APP_URL}/#org` },
    },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}
