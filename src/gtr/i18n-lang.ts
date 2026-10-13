// Язык первой отрисовки. Сервер берёт его из cookie gtr-lang (явный выбор
// гостя), а без неё — из заголовка Accept-Language, по тем же правилам,
// что и браузер. Так первая страница сразу приходит на языке гостя, и
// браузеру нечего переключать во время гидрации.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

import i18n, { pickLang, type UiLang } from "./i18n";

export const ssrUiLang = createIsomorphicFn()
  .server((): UiLang => {
    const c = getCookie("gtr-lang");
    if (c === "ru" || c === "en" || c === "th") return c;
    const header = getRequestHeader("accept-language") ?? "";
    // «th-TH,th;q=0.9,en;q=0.8» → по порядку предпочтения
    const langs = header
      .split(",")
      .map((x) => x.split(";")[0])
      .filter(Boolean);
    return langs.length ? pickLang(langs) : "ru";
  })
  .client((): UiLang => {
    const l = i18n.language;
    return l === "en" || l === "th" ? l : "ru";
  });
