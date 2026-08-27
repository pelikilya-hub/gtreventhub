import { useEffect, useRef } from "react";

// Раскрытие блоков при прокрутке.
//
// Длинная страница, где всё видно сразу, читается простынёй: глаз не
// понимает, где заканчивается один блок и начинается другой. Здесь каждый
// помеченный блок проявляется, когда до него доскроллили, — страница
// набирается на ходу и обретает ритм.
//
// Прячем блоки только после того, как сценарий действительно запустился:
// класс на контейнер вешает этот хук. Если JS не доехал, ничего не скрыто,
// и страница остаётся читаемой — украшение не должно ломать содержимое.

export function useReveal<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!items.length) return;

    root.classList.add("gtr-reveal-on");

    // Кому движение мешает — тому сразу всё показываем.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((el) => el.classList.add("in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target); // раскрылось — больше не следим
        }
      },
      // Блок проявляется чуть раньше, чем упрётся в нижнюю кромку экрана:
      // иначе анимация начинается уже после того, как её увидели.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
