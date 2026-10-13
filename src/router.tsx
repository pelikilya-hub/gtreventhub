import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Один механизм смены экранов на весь продукт — View Transitions:
    // браузер снимает старый кадр, React рисует новый, CSS растворяет
    // одно в другое (gtr.css «переход экрана»). Где API нет, экран
    // меняется мгновенно — без запасной анимации и без второго механизма.
    defaultViewTransition: true,
  });

  return router;
};
