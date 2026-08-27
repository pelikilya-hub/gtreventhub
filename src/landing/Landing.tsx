// Витрина gtrevent.com: единственная страница продукта, открытая всем.
//
// Раньше корень домена молча редиректил в приложение, а приложение помечено
// noindex — то есть по запросу «gtr event phuket» не находилось ничего. Для
// продукта, который зовут ставить на телефон, это дыра: человек слышит
// название в баре, вбивает его в поиск и не находит.
//
// Страница делает ровно три вещи: объясняет, что это, показывает живые
// цифры базы и уводит внутрь — открыть, поставить на телефон, завести
// аккаунт. Кабинеты, контакты площадок и прайсы сюда не попадают: витрина
// говорит о продукте, а не выкладывает его содержимое наружу.
import { Link } from "@tanstack/react-router";

import { APP_URL } from "../gtr/app-url";
import { SEO_PATH, seoJsonLd, type SeoLang } from "../gtr/seo";

export type LandingStats = { venues: number; artists: number; regions: number };

const T = {
  ru: {
    open: "Открыть приложение",
    signup: "Создать аккаунт",
    eyebrow: "Ночной Таиланд",
    h1: "Куда пойти сегодня — знает приложение",
    lead:
      "Живая афиша клубов, пляжных клубов и баров Таиланда: кто играет сегодня, где и во сколько. Бронь стола за пару касаний, маршрут вечера на карте и подбор вечеринок под твою музыку.",
    stVenues: "площадок в базе",
    stArtists: "артистов с музыкой",
    stRegions: "региона Таиланда",
    stFree: "вход бесплатный",
    whatEyebrow: "Что внутри",
    whatH: "Вечер собирается сам",
    feats: [
      ["Афиша на каждый вечер", "Программа площадок собирается автоматически с их официальных источников — сайтов, Facebook и Instagram. Открыл — видишь, кто играет сегодня."],
      ["Бронь стола", "Заявка уходит прямо площадке, ответ — в течение 15 минут. Для заведений с рассадкой выбираешь зону, стол и предзаказ по меню."],
      ["Подбор под твою музыку", "Свяжи Spotify или отметь любимые жанры — приложение находит вечеринки, где играет твоё, а не то, что громче рекламируют."],
      ["Маршрут вечера", "Отмечаешь несколько мест — получаешь маршрут на карте и порядок обхода. Чек-ины и баллы за отзывы прилагаются."],
      ["Артисты", "Каталог диджеев и музыкантов: чем играют, где выступали, ссылки на музыку и клипы. Понятно, стоит ли ехать."],
      ["Кабинет площадки", "Заведение ведёт свою афишу, залы и прайс, принимает заявки и брони. Кабинет открывается сразу после подтверждения."],
    ],
    regionsEyebrow: "География",
    regionsH: "Пять регионов, один вечер",
    regionsP: "База растёт волнами: сначала лучшие площадки региона, потом хвост. Каждая запись — с источником, без выдуманных фактов.",
    installEyebrow: "Установка",
    installH: "Ставится как приложение, весит как страница",
    installP: "Никаких магазинов и обновлений: открываешь адрес в браузере и добавляешь на главный экран. Дальше запускается на весь экран, без адресной строки.",
    steps: [
      ["iPhone", "Открой gtrevent.com в Safari → «Поделиться» → «На экран «Домой»."],
      ["Android", "Открой в Chrome → меню ⋮ → «Установить приложение»."],
      ["Аккаунт", "Заведи профиль — афиша начнёт подстраиваться под твой вкус, откроются бронь и маршрут вечера."],
    ],
    ctaH: "Открой сегодняшний вечер",
    ctaP: "Приложение бесплатное, регистрация занимает минуту.",
    footRights: "Каталог площадок и артистов — собственная база GTR Event.",
    contact: "Связь и сотрудничество",
    langSwitch: "English",
  },
  en: {
    open: "Open the app",
    signup: "Create an account",
    eyebrow: "Thailand nightlife",
    h1: "The app knows where to go tonight",
    lead:
      "Live lineups from clubs, beach clubs and bars across Thailand: who plays tonight, where and at what time. Table booking in two taps, an evening route on the map and parties matched to your music.",
    stVenues: "venues in the base",
    stArtists: "artists with music",
    stRegions: "regions of Thailand",
    stFree: "free to use",
    whatEyebrow: "What's inside",
    whatH: "The night plans itself",
    feats: [
      ["Nightly lineups", "Venue programmes are collected automatically from their official sources — websites, Facebook and Instagram. Open the app and see who plays tonight."],
      ["Table booking", "The request goes straight to the venue, answered within 15 minutes. Where seating is mapped, you pick the zone, the table and a pre-order from the menu."],
      ["Matched to your music", "Connect Spotify or pick your genres — the app finds parties that play your sound, not the ones with the loudest ads."],
      ["Evening route", "Mark a few places and get a route on the map in walking order. Check-ins and points for reviews included."],
      ["Artists", "A catalogue of DJs and musicians: what they play, where they played, links to music and videos. You know whether it's worth the ride."],
      ["Venue cabinet", "A venue runs its own lineup, rooms and rates, and receives requests and bookings. The cabinet opens as soon as the venue confirms."],
    ],
    regionsEyebrow: "Geography",
    regionsH: "Five regions, one night out",
    regionsP: "The base grows in waves: the best venues of a region first, the tail after. Every record carries its source — nothing invented.",
    installEyebrow: "Install",
    installH: "Installs like an app, weighs like a page",
    installP: "No stores, no updates: open the address in a browser and add it to your home screen. It then runs full screen, with no address bar.",
    steps: [
      ["iPhone", "Open gtrevent.com in Safari → Share → Add to Home Screen."],
      ["Android", "Open in Chrome → menu ⋮ → Install app."],
      ["Account", "Create a profile — the lineup starts matching your taste, booking and the evening route open up."],
    ],
    ctaH: "Open tonight",
    ctaP: "The app is free, signing up takes a minute.",
    footRights: "The venue and artist catalogue is GTR Event's own database.",
    contact: "Contact and partnerships",
    langSwitch: "Русский",
  },
} as const;

const REGIONS: [string, string, string][] = [
  ["Пхукет", "Phuket", "phuket"],
  ["Самуи", "Samui", "samui"],
  ["Панган", "Phangan", "phangan"],
  ["Паттайя", "Pattaya", "pattaya"],
  ["Бангкок", "Bangkok", "bangkok"],
  ["Пханг-Нга", "Phang Nga", "phangnga"],
];

const ICONS = [
  "M3 6h18v15H3z M8 3v5 M16 3v5 M3 11h18",
  "M4 10h16v2a6 6 0 0 1-12 0z M12 12v6 M8 21h8",
  "M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z M12 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  "M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 20a7 7 0 0 1 14 0",
  "M3 21V8l9-5 9 5v13 M9 21v-7h6v7",
];

export function Landing({ lang, stats }: { lang: SeoLang; stats: LandingStats }) {
  const t = T[lang];
  const other: SeoLang = lang === "ru" ? "en" : "ru";
  const app = (path: string) => `${APP_URL}${path}`;

  return (
    <div className="lp">
      {/* Разметка schema.org: бренд, сайт и приложение одним блоком. */}
      <script
        type="application/ld+json"
        // Строка собрана нами из констант — пользовательского ввода здесь нет.
        dangerouslySetInnerHTML={{ __html: seoJsonLd(lang, stats) }}
      />

      <header className="lp-wrap lp-top">
        <a className="lp-logo" href={SEO_PATH[lang]}>
          <img src="/icon-256.png" alt="" width={30} height={30} />
          GTR EVENT
        </a>
        <nav>
          <Link className="lp-btn lp-btn-sm" to={SEO_PATH[other] as "/"}>
            {t.langSwitch}
          </Link>
          <a className="lp-btn lp-btn-sm lp-btn-red" href={app("/gtr/tonight")}>
            {t.open}
          </a>
        </nav>
      </header>

      <main>
        <section className="lp-wrap lp-hero">
          <div className="lp-mono">{t.eyebrow}</div>
          <h1>{t.h1}</h1>
          <p>{t.lead}</p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-red" href={app("/gtr/tonight")}>
              {t.open}
            </a>
            <a className="lp-btn" href={app("/gtr/signup")}>
              {t.signup}
            </a>
          </div>
        </section>

        <section className="lp-wrap">
          <div className="lp-stats">
            <div className="lp-stat">
              <b>{stats.venues}</b>
              <span className="lp-mono">{t.stVenues}</span>
            </div>
            <div className="lp-stat">
              <b>{stats.artists}</b>
              <span className="lp-mono">{t.stArtists}</span>
            </div>
            <div className="lp-stat">
              <b>{stats.regions}</b>
              <span className="lp-mono">{t.stRegions}</span>
            </div>
            <div className="lp-stat">
              <b>0 ฿</b>
              <span className="lp-mono">{t.stFree}</span>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <div className="lp-mono">{t.whatEyebrow}</div>
          <h2>{t.whatH}</h2>
          <div className="lp-grid">
            {t.feats.map(([h, p], i) => (
              <article className="lp-card" key={h}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                  <path d={ICONS[i]} />
                </svg>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <div className="lp-mono">{t.regionsEyebrow}</div>
          <h2>{t.regionsH}</h2>
          <p>{t.regionsP}</p>
          <div className="lp-regions">
            {REGIONS.map(([ru, en]) => (
              <a className="lp-region" href={app("/gtr/base")} key={en}>
                {lang === "ru" ? ru : en}
                <i>{lang === "ru" ? en : ru}</i>
              </a>
            ))}
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <div className="lp-mono">{t.installEyebrow}</div>
          <h2>{t.installH}</h2>
          <p>{t.installP}</p>
          <div className="lp-steps">
            {t.steps.map(([h, p]) => (
              <div className="lp-step" key={h}>
                <b>{h}</b>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <h2>{t.ctaH}</h2>
          <p>{t.ctaP}</p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-red" href={app("/gtr/tonight")}>
              {t.open}
            </a>
            <a className="lp-btn" href={app("/gtr/signup")}>
              {t.signup}
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-wrap lp-foot">
        <span>© GTR Event</span>
        <span>{t.footRights}</span>
        <span className="lp-sp">
          {t.contact}:{" "}
          <a href="https://t.me/bangtaostyle" rel="noopener">
            @bangtaostyle
          </a>
        </span>
      </footer>
    </div>
  );
}
