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
import { useEffect, useRef, type CSSProperties } from "react";

import { APP_URL } from "../gtr/app-url";
import { PAGE_PATH, SEO_LANGS, SEO_PATH, seoJsonLd, type SeoLang } from "../gtr/seo";
import { useLandingFx } from "./fx";

export type LandingStats = { venues: number; artists: number; regions: number };

const T = {
  ru: {
    open: "Открыть приложение",
    afisha: "Афиша",
    afishaNow: "Афиша на сегодня",
    login: "Войти",
    signup: "Создать аккаунт",
    eyebrow: "Ночной Таиланд",
    h1: "Куда пойти сегодня —|знает приложение",
    lead:
      "Живая афиша клубов, пляжных клубов и баров Таиланда: кто играет сегодня, где и во сколько. Бронь стола за пару касаний, маршрут вечера на карте и подбор вечеринок под твою музыку.",
    stVenues: "площадок в базе",
    stArtists: "артистов с музыкой",
    stRegions: "региона Таиланда",
    stFree: "вход бесплатный",
    whatEyebrow: "Что внутри",
    whatH: "Вечер|собирается сам",
    feats: [
      ["Афиша на каждый вечер", "Программа площадок собирается автоматически с их официальных источников — сайтов, Facebook и Instagram. Открыл — видишь, кто играет сегодня."],
      ["Бронь стола", "Заявка уходит прямо площадке, ответ — в течение 15 минут. Для заведений с рассадкой выбираешь зону, стол и предзаказ по меню."],
      ["Подбор под твою музыку", "Свяжи Spotify или отметь любимые жанры — приложение находит вечеринки, где играет твоё, а не то, что громче рекламируют."],
      ["Маршрут вечера", "Отмечаешь несколько мест — получаешь маршрут на карте и порядок обхода. Чек-ины и баллы за отзывы прилагаются."],
      ["Артисты", "Каталог диджеев и музыкантов: чем играют, где выступали, ссылки на музыку и клипы. Понятно, стоит ли ехать."],
      ["Кабинет площадки", "Заведение ведёт свою афишу, залы и прайс, принимает заявки и брони. Кабинет открывается сразу после подтверждения."],
    ],
    regionsEyebrow: "География",
    regionsH: "Острова, побережье,|столица",
    regionsP: "База растёт волнами: сначала лучшие площадки региона, потом хвост. Каждая запись — с источником, без выдуманных фактов.",
    installEyebrow: "Установка",
    installH: "Ставится как приложение,|весит как страница",
    installP: "Никаких магазинов и обновлений: открываешь адрес в браузере и добавляешь на главный экран. Дальше запускается на весь экран, без адресной строки.",
    steps: [
      ["iPhone", "Открой gtrevent.com в Safari → «Поделиться» → «На экран «Домой»."],
      ["Android", "Открой в Chrome → меню ⋮ → «Установить приложение»."],
      ["Аккаунт", "Заведи профиль — афиша начнёт подстраиваться под твой вкус, откроются бронь и маршрут вечера."],
    ],
    ctaH: "Открой|сегодняшний вечер",
    ctaP: "Приложение бесплатное, регистрация занимает минуту.",
    footRights: "Каталог площадок и артистов — собственная база GTR Event.",
    contact: "Связь и сотрудничество",
    langSwitch: "Русский",
    scroll: "Листай",
    tonight: "Пхукет · сейчас",
    ticker: ["Живая афиша", "Бронь стола", "Маршрут вечера", "Подбор под музыку", "Пхукет", "Самуи", "Панган", "Бангкок", "Паттайя"],
    liveEyebrow: "Эфир · bangtaostyle.com",
    liveH: "Кольцо Таиланда|в прямом эфире",
    liveP: "Экипаж GTR проходит страну по кругу. Трансляция, машина на карте маршрута и чат с экипажем — на bangtaostyle.com.",
    liveState: "Ждём сигнал",
    liveBtn: "Смотреть эфир",
  },
  en: {
    open: "Open the app",
    afisha: "Lineup",
    afishaNow: "Tonight's lineup",
    login: "Sign in",
    signup: "Create an account",
    eyebrow: "Thailand nightlife",
    h1: "The app knows|where to go tonight",
    lead:
      "Live lineups from clubs, beach clubs and bars across Thailand: who plays tonight, where and at what time. Table booking in two taps, an evening route on the map and parties matched to your music.",
    stVenues: "venues in the base",
    stArtists: "artists with music",
    stRegions: "regions of Thailand",
    stFree: "free to use",
    whatEyebrow: "What's inside",
    whatH: "The night|plans itself",
    feats: [
      ["Nightly lineups", "Venue programmes are collected automatically from their official sources — websites, Facebook and Instagram. Open the app and see who plays tonight."],
      ["Table booking", "The request goes straight to the venue, answered within 15 minutes. Where seating is mapped, you pick the zone, the table and a pre-order from the menu."],
      ["Matched to your music", "Connect Spotify or pick your genres — the app finds parties that play your sound, not the ones with the loudest ads."],
      ["Evening route", "Mark a few places and get a route on the map in walking order. Check-ins and points for reviews included."],
      ["Artists", "A catalogue of DJs and musicians: what they play, where they played, links to music and videos. You know whether it's worth the ride."],
      ["Venue cabinet", "A venue runs its own lineup, rooms and rates, and receives requests and bookings. The cabinet opens as soon as the venue confirms."],
    ],
    regionsEyebrow: "Geography",
    regionsH: "Islands, coast,|capital",
    regionsP: "The base grows in waves: the best venues of a region first, the tail after. Every record carries its source — nothing invented.",
    installEyebrow: "Install",
    installH: "Installs like an app,|weighs like a page",
    installP: "No stores, no updates: open the address in a browser and add it to your home screen. It then runs full screen, with no address bar.",
    steps: [
      ["iPhone", "Open gtrevent.com in Safari → Share → Add to Home Screen."],
      ["Android", "Open in Chrome → menu ⋮ → Install app."],
      ["Account", "Create a profile — the lineup starts matching your taste, booking and the evening route open up."],
    ],
    ctaH: "Open|tonight",
    ctaP: "The app is free, signing up takes a minute.",
    footRights: "The venue and artist catalogue is GTR Event's own database.",
    contact: "Contact and partnerships",
    langSwitch: "English",
    scroll: "Scroll",
    tonight: "Phuket · now",
    ticker: ["Live lineups", "Table booking", "Evening route", "Matched to your music", "Phuket", "Samui", "Phangan", "Bangkok", "Pattaya"],
    liveEyebrow: "Live · bangtaostyle.com",
    liveH: "The Thailand ring|live on air",
    liveP: "The GTR crew drives a full loop of the country. The stream, the car on the route map and the crew chat are on bangtaostyle.com.",
    liveState: "Standby",
    liveBtn: "Watch the stream",
  },
  th: {
    open: "เปิดแอป",
    afisha: "โปรแกรม",
    afishaNow: "โปรแกรมคืนนี้",
    login: "เข้าสู่ระบบ",
    signup: "สร้างบัญชี",
    eyebrow: "ไนท์ไลฟ์ไทย",
    h1: "คืนนี้ไปไหนดี —|แอปรู้",
    lead:
      "โปรแกรมสดจากคลับ บีชคลับ และบาร์ทั่วไทย: ใครเล่นคืนนี้ ที่ไหน กี่โมง จองโต๊ะได้ในไม่กี่แตะ วางเส้นทางเที่ยวบนแผนที่ และเลือกปาร์ตี้ตามเพลงที่คุณชอบ",
    stVenues: "สถานที่ในฐานข้อมูล",
    stArtists: "ศิลปินพร้อมเพลง",
    stRegions: "ภูมิภาคของไทย",
    stFree: "ใช้ฟรี",
    whatEyebrow: "มีอะไรในแอป",
    whatH: "ค่ำคืน|ที่วางแผนเองได้",
    feats: [
      ["โปรแกรมทุกคืน", "โปรแกรมของแต่ละร้านรวบรวมอัตโนมัติจากช่องทางทางการ — เว็บไซต์ Facebook และ Instagram เปิดแอปก็เห็นทันทีว่าคืนนี้ใครเล่น"],
      ["จองโต๊ะ", "คำขอส่งตรงถึงร้าน ตอบกลับภายใน 15 นาที ร้านที่มีผังที่นั่ง เลือกโซน โต๊ะ และสั่งเมนูล่วงหน้าได้"],
      ["ตรงกับเพลงที่คุณชอบ", "เชื่อม Spotify หรือเลือกแนวเพลงที่ชอบ แอปจะหาปาร์ตี้ที่เล่นแนวของคุณ ไม่ใช่แค่ที่โฆษณาดังที่สุด"],
      ["เส้นทางเที่ยวคืนนี้", "เลือกไว้หลายที่ แล้วได้เส้นทางบนแผนที่เรียงตามลำดับ พร้อมเช็กอินและแต้มจากรีวิว"],
      ["ศิลปิน", "รวมดีเจและนักดนตรี: เล่นแนวไหน เคยเล่นที่ไหน ลิงก์เพลงและคลิป รู้ก่อนว่าคุ้มที่จะไปไหม"],
      ["แดชบอร์ดสำหรับร้าน", "ร้านจัดการโปรแกรม ห้อง และราคาเอง รับคำขอและการจองได้ แดชบอร์ดเปิดใช้ทันทีหลังยืนยันร้าน"],
    ],
    regionsEyebrow: "พื้นที่",
    regionsH: "เกาะ ชายฝั่ง|และเมืองหลวง",
    regionsP: "ฐานข้อมูลเติบโตเป็นระลอก: เริ่มจากร้านเด่นของแต่ละพื้นที่ แล้วค่อยขยาย ทุกข้อมูลมีแหล่งอ้างอิง ไม่มีการแต่งเติม",
    installEyebrow: "ติดตั้ง",
    installH: "ติดตั้งเหมือนแอป|เบาเหมือนเว็บ",
    installP: "ไม่ต้องผ่านสโตร์ ไม่ต้องอัปเดต: เปิดลิงก์ในเบราว์เซอร์แล้วเพิ่มไปที่หน้าจอหลัก จากนั้นเปิดได้เต็มจอ ไม่มีแถบที่อยู่",
    steps: [
      ["iPhone", "เปิด gtrevent.com ใน Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม"],
      ["Android", "เปิดใน Chrome → เมนู ⋮ → ติดตั้งแอป"],
      ["บัญชี", "สร้างโปรไฟล์ — โปรแกรมจะปรับตามรสนิยมของคุณ และเปิดใช้การจองกับเส้นทางเที่ยวคืนนี้"],
    ],
    ctaH: "เปิด|คืนนี้ของคุณ",
    ctaP: "แอปใช้ฟรี สมัครใช้เวลาแค่นาทีเดียว",
    footRights: "ฐานข้อมูลสถานที่และศิลปินเป็นของ GTR Event เอง",
    contact: "ติดต่อและร่วมงาน",
    langSwitch: "ภาษาไทย",
    scroll: "เลื่อนลง",
    tonight: "ภูเก็ต · ตอนนี้",
    ticker: ["โปรแกรมสด", "จองโต๊ะ", "เส้นทางเที่ยว", "ตรงกับเพลงที่ชอบ", "ภูเก็ต", "สมุย", "พะงัน", "กรุงเทพฯ", "พัทยา"],
    liveEyebrow: "ไลฟ์ · bangtaostyle.com",
    liveH: "วงรอบประเทศไทย|ถ่ายทอดสด",
    liveP: "ทีม GTR ขับรถวนรอบประเทศ ดูไลฟ์ รถบนแผนที่เส้นทาง และแชตกับทีมได้ที่ bangtaostyle.com",
    liveState: "รอสัญญาณ",
    liveBtn: "ดูไลฟ์",
  },
} as const;

export const LANDING_T = T;

/** Адрес афиши на языке витрины. */
export const AFISHA_PATH = PAGE_PATH.afisha;

// [ru, en, th, код]
const REGIONS: [string, string, string, string][] = [
  ["Пхукет", "Phuket", "ภูเก็ต", "phuket"],
  ["Самуи", "Samui", "เกาะสมุย", "samui"],
  ["Панган", "Phangan", "เกาะพะงัน", "phangan"],
  ["Паттайя", "Pattaya", "พัทยา", "pattaya"],
  ["Бангкок", "Bangkok", "กรุงเทพฯ", "bangkok"],
  ["Пханг-Нга", "Phang Nga", "พังงา", "phangnga"],
];

// Кольцо эфира bangtaostyle.com — тот же порядок, что в его описании.
const RING: [string, string, string][] = [
  ["Пхукет", "Phuket", "ภูเก็ต"],
  ["Самуи", "Samui", "สมุย"],
  ["Панган", "Phangan", "พะงัน"],
  ["Чиангмай", "Chiang Mai", "เชียงใหม่"],
  ["Аюттхая", "Ayutthaya", "อยุธยา"],
  ["Бангкок", "Bangkok", "กรุงเทพฯ"],
  ["Паттайя", "Pattaya", "พัทยา"],
];

const LIVE_URL = "https://bangtaostyle.com";

// Знак и заголовки первого экрана: без предзагрузки они проявляются
// с опозданием и герой перескакивает с системного шрифта на фирменный.
const fontLink = (href: string) =>
  ({ rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous", href }) as const;
export const LANDING_FONTS = [
  fontLink("/fonts/gtr/Trashed.woff2"),
  fontLink("/fonts/g/unbounded-cyrillic-13.woff2"),
  fontLink("/fonts/g/unbounded-latin-15.woff2"),
  fontLink("/fonts/gtr/GlitchCity.woff2"),
];

const ICONS = [
  "M3 6h18v15H3z M8 3v5 M16 3v5 M3 11h18",
  "M4 10h16v2a6 6 0 0 1-12 0z M12 12v6 M8 21h8",
  "M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z M12 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  "M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 20a7 7 0 0 1 14 0",
  "M3 21V8l9-5 9 5v13 M9 21v-7h6v7",
];

/** «до|после»: вторая часть заголовка — фирменным красным. */
function Accent({ text }: { text: string }) {
  const [a, b] = text.split("|");
  if (b === undefined) return <>{a}</>;
  return (
    <>
      {a} <em>{b}</em>
    </>
  );
}

const plain = (s: string) => s.replace("|", " ");
const pad = (n: number) => String(n).padStart(2, "0");

export function Landing({ lang, stats }: { lang: SeoLang; stats: LandingStats }) {
  const t = T[lang];
  const app = (path: string) => `${APP_URL}${path}`;
  const root = useRef<HTMLDivElement>(null);
  useLandingFx(root);

  return (
    <div className="lp" ref={root}>
      {/* Разметка schema.org: бренд, сайт и приложение одним блоком. */}
      <script
        type="application/ld+json"
        // Строка собрана нами из констант — пользовательского ввода здесь нет.
        dangerouslySetInnerHTML={{ __html: seoJsonLd(lang, stats) }}
      />

      <LpTop lang={lang} page="home" />

      <main>
        <section className="lp-hero">
          <div className="lp-hero-bg" aria-hidden>
            <span className="lp-glow" />
            <span className="lp-grid-bg" />
            <span className="lp-laser" />
          </div>
          <div className="lp-wrap lp-hero-in">
            <div className="lp-mono lp-kick lp-in1" data-decode="">
              <i className="lp-dot" /> {t.eyebrow}
            </div>
            {/* Вход — на обёртке: сбой меняет анимацию самого знака и
                иначе перезапускал бы вход, знак мигал бы пустотой. */}
            <div className="lp-in2" aria-hidden>
              <div className="lp-mark" data-text="GTR EVENT">
                GTR EVENT
              </div>
            </div>
            <h1 className="lp-in3">
              <Accent text={t.h1} />
            </h1>
            <p className="lp-lead lp-in4">{t.lead}</p>
            <div className="lp-cta lp-in5">
              <Link className="lp-btn lp-btn-red lp-btn-beat" to={AFISHA_PATH[lang] as "/"}>
                {t.afishaNow}
                <Arrow />
              </Link>
              <a className="lp-btn" href={app("/gtr/signup")}>
                {t.signup}
              </a>
            </div>
          </div>
          <div className="lp-cue lp-mono" aria-hidden>
            {t.scroll}
            <i />
          </div>
        </section>

        <div className="lp-ticker" aria-hidden>
          <div className="lp-ticker-in">
            {[0, 1].map((k) => (
              <span key={k}>
                {t.ticker.map((w) => (
                  <span key={w}>
                    {w}
                    <i>✕</i>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <section className="lp-wrap">
          <div className="lp-stats" data-rv="">
            <Stat n={stats.venues} label={t.stVenues} />
            <Stat n={stats.artists} label={t.stArtists} />
            <Stat n={stats.regions} label={t.stRegions} />
            <div className="lp-stat">
              <b className="lp-num">0 ฿</b>
              <span className="lp-mono">{t.stFree}</span>
            </div>
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <SecHead eyebrow={t.whatEyebrow} title={t.whatH} />
          <div className="lp-grid">
            {t.feats.map(([h, p], i) => (
              <article className="lp-card" key={h} data-rv="" style={{ "--i": i } as CSSProperties}>
                <div className="lp-card-top">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                    <path d={ICONS[i]} />
                  </svg>
                  <span className="lp-idx">{pad(i + 1)}</span>
                </div>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-live">
          <div className="lp-wrap lp-live-in">
            <div>
              <SecHead eyebrow={t.liveEyebrow} title={t.liveH} />
              <p className="lp-sec-p" data-rv="">
                {t.liveP}
              </p>
              <div className="lp-cta" data-rv="">
                <a className="lp-btn lp-btn-red" href={LIVE_URL} rel="noopener">
                  {t.liveBtn}
                  <Arrow />
                </a>
                <span className="lp-chip">
                  <i className="lp-dot lp-dot-blink" />
                  {t.liveState}
                </span>
              </div>
            </div>
            <ol className="lp-ring" data-rv="" aria-label={plain(t.liveH)}>
              {[...RING, RING[0]].map(([ru, en, th], i) => (
                <li key={`${en}${i}`} style={{ "--i": i } as CSSProperties}>
                  <span className="lp-idx">{pad(i + 1)}</span>
                  {{ ru, en, th }[lang]}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <SecHead eyebrow={t.regionsEyebrow} title={t.regionsH} />
          <p className="lp-sec-p" data-rv="">
            {t.regionsP}
          </p>
          <div className="lp-regions">
            {REGIONS.map(([ru, en, th], i) => (
              <a className="lp-region" href={app("/gtr/base")} key={en} data-rv="" style={{ "--i": i } as CSSProperties}>
                <span className="lp-idx">{pad(i + 1)}</span>
                <b>{{ ru, en, th }[lang]}</b>
                {lang === "en" ? <i className="lp-mono">{th}</i> : <i className="lp-trash">{en}</i>}
                <Arrow />
              </a>
            ))}
          </div>
        </section>

        <section className="lp-wrap lp-sec">
          <SecHead eyebrow={t.installEyebrow} title={t.installH} />
          <p className="lp-sec-p" data-rv="">
            {t.installP}
          </p>
          <div className="lp-steps">
            {t.steps.map(([h, p], i) => (
              <div className="lp-step" key={h} data-rv="" style={{ "--i": i } as CSSProperties}>
                <span className="lp-step-n">{i + 1}</span>
                <b>{h}</b>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap">
            <h2 data-rv="" data-decode="">
              <Accent text={t.ctaH} />
            </h2>
            <p className="lp-sec-p" data-rv="">
              {t.ctaP}
            </p>
            <div className="lp-cta" data-rv="">
              <Link className="lp-btn lp-btn-red lp-btn-beat" to={AFISHA_PATH[lang] as "/"}>
                {t.afishaNow}
                <Arrow />
              </Link>
              <a className="lp-btn" href={app("/gtr/signup")}>
                {t.signup}
              </a>
            </div>
          </div>
        </section>
      </main>

      <LpFoot lang={lang} />
    </div>
  );
}

export function LpTop({ lang, page }: { lang: SeoLang; page: "home" | "afisha" }) {
  const t = T[lang];
  // Явный выбор английской или тайской витрины запоминаем для приложения:
  // гость, пришедший на /th, после регистрации должен попасть в тайский
  // интерфейс, а не в русский по умолчанию. Русский корень открывают все
  // подряд, поэтому он выбор не записывает.
  useEffect(() => {
    if (lang === "ru") return;
    try {
      document.cookie = `gtr-lang=${lang}; path=/; max-age=31536000; samesite=lax`;
      localStorage.setItem("gtr-lang", lang);
    } catch {
      // cookie и хранилище запрещены — приложение возьмёт язык телефона
    }
  }, [lang]);
  return (
    <header className="lp-top">
      <div className="lp-wrap lp-top-in">
        <a className="lp-logo" href={SEO_PATH[lang]} aria-label="GTR Event">
          <img src="/icon-256.png" alt="" width={28} height={28} />
          <b>GTR</b>
          <span>EVENT</span>
        </a>
        <span className="lp-chip lp-hide-m" aria-hidden>
          <i className="lp-dot" />
          {t.tonight} <b data-clock>--:--</b>
        </span>
        <nav>
          {SEO_LANGS.filter((l) => l !== lang).map((l) => (
            <Link
              key={l}
              className="lp-btn lp-btn-sm lp-btn-ghost"
              to={PAGE_PATH[page][l] as "/"}
              hrefLang={l}
              aria-label={T[l].langSwitch}
            >
              <span className="lp-hide-s">{T[l].langSwitch}</span>
              <span className="lp-show-s" aria-hidden>
                {l.toUpperCase()}
              </span>
            </Link>
          ))}
          <a className="lp-btn lp-btn-sm lp-btn-ghost lp-hide-s" href={`${APP_URL}/gtr/login`}>
            {t.login}
          </a>
          <Link className="lp-btn lp-btn-sm lp-btn-red" to={AFISHA_PATH[lang] as "/"}>
            {t.afisha}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LpFoot({ lang }: { lang: SeoLang }) {
  const t = T[lang];
  return (
    <footer className="lp-wrap lp-foot">
      <span className="lp-foot-mark">GTR</span>
      <span>© GTR Event</span>
      <span>{t.footRights}</span>
      <span className="lp-sp">
        {t.contact}:{" "}
        <a href="https://t.me/bangtaostyle" rel="noopener">
          @bangtaostyle
        </a>
      </span>
    </footer>
  );
}

function SecHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="lp-head" data-rv="">
      <div className="lp-mono lp-kick" data-decode="">
        {eyebrow}
      </div>
      <h2 data-decode="">
        <Accent text={title} />
      </h2>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="lp-stat">
      <b className="lp-num" data-count={n}>
        {n}
      </b>
      <span className="lp-mono">{label}</span>
    </div>
  );
}

export function Arrow() {
  return (
    <svg className="lp-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
