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

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
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
  void i18n.changeLanguage(lang);
};

export default i18n;
