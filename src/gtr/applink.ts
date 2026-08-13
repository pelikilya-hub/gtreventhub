// Диплинки в нативные приложения: по веб-ссылке строим URI-схему приложения
// (Spotify, Instagram, YouTube, Telegram…). Тап пробует открыть приложение;
// если через полторы секунды вкладка всё ещё видима (приложения нет) —
// открываем обычную веб-ссылку. На десктопе схемы просто не срабатывают,
// и человек попадает на сайт, как раньше.

export function appScheme(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");

    if (host === "open.spotify.com") {
      const m = path.match(/^\/(artist|track|album|playlist|user)\/([A-Za-z0-9]+)/);
      if (m) return `spotify:${m[1]}:${m[2]}`;
    }
    if (host === "instagram.com") {
      const m = path.match(/^\/([A-Za-z0-9_.]+)$/);
      if (m) return `instagram://user?username=${m[1]}`;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `vnd.youtube://watch?v=${v}`;
      return `vnd.youtube://${host}${u.pathname}${u.search}`;
    }
    if (host === "youtu.be") return `vnd.youtube://watch?v=${path.slice(1)}`;
    if (host === "t.me" || host === "telegram.me") {
      const m = path.match(/^\/([A-Za-z0-9_]+)/);
      if (m) {
        const start = u.searchParams.get("start");
        return `tg://resolve?domain=${m[1]}${start ? `&start=${encodeURIComponent(start)}` : ""}`;
      }
    }
    // SoundCloud, Beatport, Facebook: надёжной публичной схемы нет —
    // работают universal links, отдаём обычный URL
    return null;
  } catch {
    return null;
  }
}

const isMobile = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Открыть «умно»: на мобильном — приложение с фолбэком на веб, иначе веб
export function openAppLink(url: string) {
  const scheme = appScheme(url);
  if (!scheme || !isMobile()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const started = Date.now();
  const fallback = window.setTimeout(() => {
    // приложение перехватило переход → вкладка скрыта, фолбэк не нужен
    if (!document.hidden && Date.now() - started < 2200) {
      window.open(url, "_blank", "noopener");
    }
  }, 1400);
  const clear = () => {
    window.clearTimeout(fallback);
    document.removeEventListener("visibilitychange", clear);
  };
  document.addEventListener("visibilitychange", clear);
  window.location.href = scheme;
}
