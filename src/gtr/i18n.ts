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

const stored = (): UiLang => {
  if (typeof localStorage === "undefined") return "ru";
  const v = localStorage.getItem("gtr-lang");
  return v === "en" || v === "th" ? v : "ru";
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: EN },
      th: { translation: TH },
    },
    lng: stored(),
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
    localStorage.setItem("gtr-lang", lang);
  } catch {
    // приватный режим — язык доживёт до конца сессии
  }
  void i18n.changeLanguage(lang);
};

export default i18n;
