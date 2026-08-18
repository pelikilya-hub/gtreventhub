// Отпечаток задеплоенной сборки. Приложение спрашивает его на входе, при
// возврате на вкладку и раз в несколько минут — и, если отпечаток разошёлся
// с тем, что крутится в браузере, предлагает обновиться.
//
// Ответ намеренно без кэша: закэшированная версия «текущей версии» —
// это ровно та поломка, которую эта ручка и лечит.
import { createFileRoute } from "@tanstack/react-router";

declare const __GTR_BUILD__: string;

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ build: __GTR_BUILD__ }), {
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        }),
    },
  },
});
