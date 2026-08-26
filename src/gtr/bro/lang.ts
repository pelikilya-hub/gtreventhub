// Язык разговора GTR BRO — одна точка правды для обеих голосовых полос
// и текста.
//
// Раньше язык был прибит к русскому в трёх местах сразу: speechConfig
// premium-полосы просил ru-RU, оба серверных входа клали language: "ru"
// в контекст промпта, а браузерный слух резервной полосы читал свой
// localStorage-ключ. Поменять язык разговора значило править три файла
// и всё равно получить полурусский ответ.
//
// Умолчание — язык браузера, а не английский: продукт написан
// по-русски, база знаний и характер BRO тоже, и молча переключать
// на английский всех гостей острова нельзя. Явный выбор в интерфейсе
// перебивает умолчание и живёт в этом телефоне.

export type BroLang = "ru" | "en";

const KEY = "gtr.bro.lang";

export const isBroLang = (v: unknown): v is BroLang => v === "ru" || v === "en";

/** Язык по умолчанию — из браузера. Всё, что не английское, считаем
 *  русским: третьего интерфейса у продукта пока нет. */
export const defaultLang = (): BroLang => {
  try {
    return navigator.language.toLowerCase().startsWith("en") ? "en" : "ru";
  } catch {
    return "ru";
  }
};

export const loadLang = (): BroLang => {
  try {
    const v = localStorage.getItem(KEY);
    if (isBroLang(v)) return v;
  } catch {
    // приватный режим — переживём, останется умолчание
  }
  return defaultLang();
};

export const saveLang = (v: BroLang): void => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // не сохранилось — язык доживёт до конца сессии в памяти
  }
};

/** Локаль для распознавания и синтеза речи в браузере. */
export const speechLocale = (lang: BroLang): string => (lang === "en" ? "en-US" : "ru-RU");

/** Железная инструкция модели. Строкой «Язык интерфейса: en» в середине
 *  промпта модель пренебрегает — на живых прогонах она отвечала
 *  по-русски на английский вопрос. Поэтому язык уходит отдельным
 *  правилом в самый конец: последняя инструкция весит больше всего. */
export const langDirective = (lang: BroLang): string =>
  lang === "en"
    ? "\n\n---\n\n# Language\n\nSpeak and write ONLY in English, every single reply, even when the question is in another language. Keep venue, event and artist names exactly as they are in the data — never translate or transliterate them. Your character, tone and all other rules stay the same; only the language changes."
    : "\n\n---\n\n# Язык\n\nГовори и пиши ТОЛЬКО по-русски, в каждой реплике, даже если вопрос задан на другом языке. Названия площадок, событий и артистов оставляй ровно так, как они лежат в данных, — не переводи и не транслитерируй. Характер, тон и остальные правила не меняются, меняется только язык.";
