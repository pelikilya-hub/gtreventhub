// Публичная афиша: gtrevent.com/afisha и /en/afisha.
//
// Отвечает на главный вопрос продукта — «кто играет сегодня» — без входа.
// Выбор дня и региона живёт в состоянии страницы, а не в адресе: сервер
// отдаёт всю двухнедельную ленту одним HTML, поисковик видит каждое
// событие, а переключение дня мгновенное, без запроса.
//
// Бронь и маршрут остаются в приложении: кнопка ведёт на регистрацию,
// потому что заявке площадке нужен живой человек с контактом.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { APP_URL } from "../gtr/app-url";
import type { SeoLang } from "../gtr/seo";
import type { PublicAfisha, PublicEvent } from "./afisha-data";
import { Arrow, LpFoot, LpTop } from "./Landing";
import { useLandingFx } from "./fx";

const T = {
  ru: {
    eyebrow: "Афиша · Таиланд",
    h1: "Кто играет|сегодня",
    lead: "Программа клубов, пляжных клубов и баров на две недели вперёд. Собирается с официальных анонсов площадок и обновляется каждые два часа.",
    all: "Все",
    allDays: "Все дни",
    today: "Сегодня",
    tomorrow: "Завтра",
    book: "Забронировать стол",
    source: "Анонс площадки",
    noTime: "время уточняется",
    emptyH: "На этот день анонсов пока нет",
    emptyP: "Афиша собирается с сайтов и соцсетей площадок. Загляни в другой день или открой приложение — там подборка под твою музыку.",
    count: (n: number) => `${n} ${plural(n, ["событие", "события", "событий"])}`,
    ctaH: "Бронь, маршрут|и подбор под музыку",
    ctaP: "В приложении стол бронируется за пару касаний, а афиша подстраивается под твой вкус.",
    signup: "Создать аккаунт",
  },
  en: {
    eyebrow: "Lineup · Thailand",
    h1: "Who plays|tonight",
    lead: "Clubs, beach clubs and bars, two weeks ahead. Collected from the venues' official announcements and refreshed every two hours.",
    all: "All",
    allDays: "All days",
    today: "Today",
    tomorrow: "Tomorrow",
    book: "Book a table",
    source: "Venue announcement",
    noTime: "time tba",
    emptyH: "No announcements for this day yet",
    emptyP: "The lineup is collected from venues' websites and socials. Try another day or open the app for picks matched to your music.",
    count: (n: number) => `${n} ${n === 1 ? "event" : "events"}`,
    ctaH: "Booking, routes|and your music",
    ctaP: "In the app a table is two taps away, and the lineup adapts to your taste.",
    signup: "Create an account",
  },
  th: {
    eyebrow: "โปรแกรม · ประเทศไทย",
    h1: "ใครเล่น|คืนนี้",
    lead: "โปรแกรมคลับ บีชคลับ และบาร์ล่วงหน้าสองสัปดาห์ รวบรวมจากประกาศทางการของแต่ละร้าน อัปเดตทุกสองชั่วโมง",
    all: "ทั้งหมด",
    allDays: "ทุกวัน",
    today: "คืนนี้",
    tomorrow: "พรุ่งนี้",
    book: "จองโต๊ะ",
    source: "ประกาศของร้าน",
    noTime: "รอยืนยันเวลา",
    emptyH: "วันนี้ยังไม่มีอีเวนต์ประกาศ",
    emptyP: "โปรแกรมรวบรวมจากเว็บไซต์และโซเชียลของร้าน ลองดูวันอื่น หรือเปิดแอปเพื่อดูปาร์ตี้ที่ตรงกับเพลงที่คุณชอบ",
    count: (n: number) => `${n} อีเวนต์`,
    ctaH: "จองโต๊ะ วางเส้นทาง|และเพลงที่คุณชอบ",
    ctaP: "ในแอปจองโต๊ะได้ในไม่กี่แตะ และโปรแกรมจะปรับตามรสนิยมของคุณ",
    signup: "สร้างบัญชี",
  },
} as const;

function plural(n: number, forms: [string, string, string]) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return forms[0];
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return forms[1];
  return forms[2];
}

function Accent({ text }: { text: string }) {
  const [a, b] = text.split("|");
  return b === undefined ? (
    <>{a}</>
  ) : (
    <>
      {a} <em>{b}</em>
    </>
  );
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function dayLabel(iso: string, today: string, lang: SeoLang) {
  const t = T[lang];
  if (iso === today) return t.today;
  if (iso === addDays(today, 1)) return t.tomorrow;
  const wd = WEEKDAYS[lang][new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${wd} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

// Свои имена дней, а не Intl: ICU воркера и браузера расходятся в регистре
// и сокращениях, и подпись, разная на сервере и в клиенте, сломала бы
// гидрацию — React перерисовал бы всю страницу.
const WEEKDAYS: Record<SeoLang, string[]> = {
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
};

export function Afisha({ lang, data }: { lang: SeoLang; data: PublicAfisha }) {
  const t = T[lang];
  const root = useRef<HTMLDivElement>(null);
  useLandingFx(root);

  const days = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.events) m.set(e.dateIso, (m.get(e.dateIso) ?? 0) + 1);
    return [...m.entries()];
  }, [data.events]);
  const regionCodes = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.events) m.set(e.region, (m.get(e.region) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [data.events]);

  // По умолчанию — сегодня, если сегодня что-то есть; иначе вся лента.
  const [day, setDay] = useState<string>(() => (days.some(([d]) => d === data.today) ? data.today : ""));
  const [region, setRegion] = useState("");

  const shown = data.events.filter((e) => (!day || e.dateIso === day) && (!region || e.region === region));
  const groups = useMemo(() => {
    const g = new Map<string, PublicEvent[]>();
    for (const e of shown) g.set(e.dateIso, [...(g.get(e.dateIso) ?? []), e]);
    return [...g.entries()];
  }, [shown]);

  const regionLabel = (c: string) => data.regions[c]?.[lang] ?? c;

  return (
    <div className="lp lp-af" ref={root}>
      <script
        type="application/ld+json"
        // Собрано из наших данных и JSON.stringify — экранирование «</» ниже.
        dangerouslySetInnerHTML={{ __html: eventsJsonLd(data.events, lang, regionLabel) }}
      />
      <LpTop lang={lang} page="afisha" />

      <main>
        <section className="lp-wrap lp-af-head">
          <div className="lp-mono lp-kick lp-in1" data-decode="">
            <i className="lp-dot" /> {t.eyebrow}
          </div>
          <h1 className="lp-in3">
            <Accent text={t.h1} />
          </h1>
          <p className="lp-lead lp-in4">{t.lead}</p>
        </section>

        <div className="lp-af-bar">
          <div className="lp-wrap">
            <div className="lp-af-days" role="tablist" aria-label={t.allDays}>
              <button type="button" role="tab" aria-selected={!day} className="lp-af-day" onClick={() => setDay("")}>
                <b>{t.allDays}</b>
                <span>{data.events.length}</span>
              </button>
              {days.map(([d, n]) => (
                <button
                  type="button"
                  role="tab"
                  key={d}
                  aria-selected={day === d}
                  className="lp-af-day"
                  onClick={() => setDay(d)}
                >
                  <b>{dayLabel(d, data.today, lang)}</b>
                  <span>{n}</span>
                </button>
              ))}
            </div>
            {regionCodes.length > 1 && (
              <div className="lp-af-regions">
                <button type="button" aria-pressed={!region} className="lp-chip lp-af-chip" onClick={() => setRegion("")}>
                  {t.all}
                </button>
                {regionCodes.map((c) => (
                  <button
                    type="button"
                    key={c}
                    aria-pressed={region === c}
                    className="lp-chip lp-af-chip"
                    onClick={() => setRegion(c)}
                  >
                    {regionLabel(c)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="lp-wrap lp-af-list" aria-live="polite">
          {groups.length === 0 && (
            <div className="lp-af-empty">
              <h2>{t.emptyH}</h2>
              <p className="lp-sec-p">{t.emptyP}</p>
            </div>
          )}
          {groups.map(([d, list]) => (
            <div className="lp-af-group" key={`${d}|${region}`}>
              <div className="lp-af-date">
                <b>{dayLabel(d, data.today, lang)}</b>
                <span className="lp-mono">{t.count(list.length)}</span>
              </div>
              <div className="lp-af-grid">
                {list.map((e, i) => (
                  <article className="lp-ev" key={e.id} style={{ "--i": Math.min(i, 8) } as CSSProperties}>
                    <div className="lp-ev-img">
                      <Poster src={e.poster} venue={e.venue} eager={i < 4} />
                    </div>
                    <div className="lp-ev-body">
                      {/* время и вход — под афишей, а не поверх: в углах
                          постера обычно и стоят дата и имена */}
                      <div className="lp-mono lp-ev-meta">
                        <span className="lp-ev-time">{e.time ?? t.noTime}</span>
                        {e.price && <span className="lp-ev-price">{e.price}</span>}
                        <span className="lp-ev-region">{regionLabel(e.region)}</span>
                      </div>
                      <h3>{e.title}</h3>
                      <div className="lp-ev-venue">{e.venue}</div>
                      <div className="lp-ev-act">
                        <a className="lp-btn lp-btn-sm lp-btn-red" href={`${APP_URL}/gtr/signup`}>
                          {t.book}
                        </a>
                        {e.url && (
                          <a className="lp-ev-src" href={e.url} rel="noopener nofollow" target="_blank">
                            {t.source}
                            <Arrow />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
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
              <a className="lp-btn lp-btn-red lp-btn-beat" href={`${APP_URL}/gtr/signup`}>
                {t.signup}
                <Arrow />
              </a>
            </div>
          </div>
        </section>
      </main>

      <LpFoot lang={lang} />
    </div>
  );
}

/** Постер с запасным вариантом. Ошибка картинки могла случиться ещё до
 *  гидрации — тогда onError уже не придёт, поэтому проверяем и при монтаже. */
function Poster({ src, venue, eager }: { src: string; venue: string; eager: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) {
    return (
      <div className="lp-ev-ph" aria-hidden>
        <b>GTR</b>
        <span>{venue}</span>
      </div>
    );
  }
  // Афиша целиком: вписываем, а не обрезаем. Площадки шлют квадраты,
  // сторис и горизонтальные обложки — в рамке 4:5 через cover у них
  // пропадали края с датой и именами. Поля закрывает размытая копия.
  return (
    <>
      <img className="lp-ev-bg" src={src} alt="" aria-hidden loading={eager ? "eager" : "lazy"} decoding="async" />
      <img
        ref={ref}
        className="lp-ev-poster"
        src={src}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </>
  );
}

/** schema.org Event для каждого анонса: так афиша может попасть в блок
 *  событий выдачи. Только то, что есть на карточке, — без выдуманных полей. */
function eventsJsonLd(events: PublicEvent[], lang: SeoLang, regionLabel: (c: string) => string): string {
  const graph = events.slice(0, 60).map((e) => ({
    "@type": "Event",
    name: e.title,
    startDate: e.time && /^\d{1,2}:\d{2}$/.test(e.time) ? `${e.dateIso}T${e.time.padStart(5, "0")}:00+07:00` : e.dateIso,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    image: `${APP_URL}${e.poster}`,
    ...(e.url ? { url: e.url } : {}),
    location: {
      "@type": "Place",
      name: e.venue,
      address: { "@type": "PostalAddress", addressRegion: regionLabel(e.region), addressCountry: "TH" },
    },
    inLanguage: lang,
  }));
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}
