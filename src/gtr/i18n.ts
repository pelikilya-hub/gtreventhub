// Локализация приложения: i18next с «естественными ключами» — ключ равен
// русской строке, словари en/th переводят её. Непереведённое честно
// показывается по-русски (fallback — сам ключ), названия площадок и имена
// артистов не переводятся никогда. Язык хранится в localStorage и в
// профиле (prefs.uiLang) — переключение мгновенное, без перезагрузки.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { EN, TH } from "./i18n-dict";

export type UiLang = "ru" | "en" | "th";
export const UI_LANGS: [UiLang, string][] = [
  ["ru", "Русский"],
  ["en", "English"],
  ["th", "ไทย"],
];

// Первый визит — язык телефона решает: тайцу тайский, русскому русский,
// остальному миру английский. Явный выбор весит больше и живёт в
// localStorage и в cookie: cookie нужна серверу, чтобы первая же
// страница пришла на языке гостя, а не на русском с переключением.
export const pickLang = (langs: string[]): UiLang => {
  for (const raw of langs) {
    const l = String(raw || "").trim().toLowerCase();
    if (l.startsWith("ru") || l.startsWith("be") || l.startsWith("uk") || l.startsWith("kk"))
      return "ru";
    if (l.startsWith("th")) return "th";
    if (l) return "en";
  }
  return "en";
};

const isLang = (v: unknown): v is UiLang => v === "en" || v === "th" || v === "ru";

const detect = (): UiLang => {
  if (typeof navigator === "undefined") return "ru";
  return pickLang([navigator.language, ...(navigator.languages ?? [])]);
};

/** Язык, который выбрал бы сам гость: явный выбор, затем язык телефона. */
export const preferredLang = (): UiLang => {
  if (typeof localStorage === "undefined") return "ru";
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLang(v)) return v;
  } catch {
    // приватный режим
  }
  const c = typeof document !== "undefined" ? document.cookie.match(/(?:^|; )gtr-lang=(ru|en|th)/) : null;
  return c ? (c[1] as UiLang) : detect();
};

// Стартовый язык в браузере — тот, на котором сервер отрисовал страницу
// (атрибут data-lang у корня приложения). Иначе гидрация видела бы
// русскую разметку под английским словарём, React перерисовывал бы всё
// дерево, а гость видел мелькание русского текста.
const initial = (): UiLang => {
  if (typeof document !== "undefined") {
    const ssr = document.querySelector<HTMLElement>(".gtr-app[data-lang]")?.dataset.lang;
    if (isLang(ssr)) return ssr;
  }
  return preferredLang();
};

const LANG_KEY = "gtr-lang";

// Постобработчик: строки, которых нет в словаре интерфейса, ищем в словаре
// данных площадок. Так t(описание площадки) работает так же, как t(кнопка),
// и язык берётся у того экземпляра, что рисует (на сервере — клон запроса).
const dataPost = {
  type: "postProcessor" as const,
  name: "gtr-data",
  process(value: string, key: string | string[], _opts: unknown, translator: { language?: string }) {
    const k = Array.isArray(key) ? key[0] : key;
    if (typeof value !== "string" || value !== k) return value;
    return tData(value, translator?.language ?? i18n.language);
  },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).use(dataPost).init({
    postProcess: ["gtr-data"],
    resources: {
      en: { translation: EN },
      th: { translation: TH },
    },
    lng: initial(),
    // Запасной язык — «ru», то есть сам ключ: русский текст и есть ключ
    // словаря. Объектная форма с отдельным запасным для тайского ломала
    // разрешение переводов целиком — меню переставало переводиться, —
    // поэтому тайский добор делаем данными, а не настройкой резолвера.
    fallbackLng: "ru",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    parseMissingKeyHandler: (key) => key, // русский ключ и есть перевод по умолчанию
    returnEmptyString: false,
  });
}

// Словарь данных площадок (описания, музыка, часы, инфраструктура) —
// отдельными файлами по языку: это больше сотни килобайт текста, и
// тащить их в общий бандл ради русскоязычного гостя незачем. Ключ —
// FNV-1a от исходной строки (иначе каждая длинная русская фраза лежала бы
// в файле дважды). Файл подгружается вместе с ленивым кодом экрана (см.
// lazyScreen в shell.tsx), поэтому к гидрации перевод уже на месте. На
// сервере грузим оба языка: он рисует страницы гостям с разными языками.
const DATA_DICT: Record<"en" | "th", () => Promise<{ default: Record<string, string> }>> = {
  en: () => import("./data/i18n/venues.en.json"),
  th: () => import("./data/i18n/venues.th.json"),
};
const dataDict: Partial<Record<"en" | "th", Record<string, string>>> = {};
const dataLoaded = new Map<string, Promise<void>>();
// Промис с полем status: React.use() читает его и не приостанавливает
// отрисовку, если словарь уже загружен (иначе смена языка мигала бы).
type Thenable = Promise<void> & { status?: "pending" | "fulfilled" };
const loadDataDict = (lang: "en" | "th"): Thenable => {
  let p = dataLoaded.get(lang) as Thenable | undefined;
  if (!p) {
    const np: Thenable = DATA_DICT[lang]()
      .then((m) => {
        dataDict[lang] = m.default;
      })
      .catch(() => {
        // нет сети — покажем исходный текст, следующая попытка при смене экрана
        dataLoaded.delete(lang);
      })
      .finally(() => {
        np.status = "fulfilled";
      });
    np.status = "pending";
    p = np;
    dataLoaded.set(lang, p);
  }
  return p;
};
const READY: Thenable = Object.assign(Promise.resolve(), { status: "fulfilled" as const });

/** Готовность словаря данных для языка — стабильный промис для React.use(). */
export const dataDictReady = (lang: string = i18n.language): Thenable =>
  lang === "en" || lang === "th" ? loadDataDict(lang) : READY;
export const ensureDataDict = (lang: string = i18n.language): Promise<void> => {
  if (typeof window === "undefined")
    return Promise.all([loadDataDict("en"), loadDataDict("th")]).then(() => {});
  return lang === "en" || lang === "th" ? loadDataDict(lang) : Promise.resolve();
};

/** FNV-1a 32 бит по кодам символов — та же функция, что собирает словарь. */
export const dataKey = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** Перевод строки из данных площадки на язык интерфейса. Нет перевода —
 *  исходная строка: лучше честный русский, чем пустое место. */
export const tData = (text: unknown, lang: string = i18n.language): string => {
  const s = typeof text === "string" ? text : text == null ? "" : String(text);
  if (!s || (lang !== "en" && lang !== "th")) return s;
  return dataDict[lang]?.[dataKey(s.trim())] ?? s;
};

export const setUiLang = (lang: UiLang) => {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // приватный режим — язык доживёт до конца сессии
  }
  try {
    document.cookie = `${LANG_KEY}=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookie запрещены — сервер будет брать язык браузера
  }
  // словарь данных — до смены языка, чтобы экран не мигнул русским
  void ensureDataDict(lang).finally(() => void i18n.changeLanguage(lang));
};

export default i18n;
