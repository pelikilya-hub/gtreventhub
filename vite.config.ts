import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// Отпечаток сборки. Приложение сравнивает его с тем, что отдаёт сервер,
// и понимает, что вкладка живёт на устаревшей версии. Без этого открытая
// иконка с домашнего экрана неделями показывает старый продукт: человек
// «зашёл и обновлений нет», хотя они давно в проде.
const BUILD = String(Date.now());

export default defineConfig({
  define: { __GTR_BUILD__: JSON.stringify(BUILD) },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    // HTML без cache-control iOS кэширует эвристически: телефон неделями
    // держит старый бандл и не видит новых фич. Хэшированные ассеты
    // кэшируются вечно (_headers), а сам HTML — никогда.
    nitro({
      config: {
        routeRules: {
          "/**": { headers: { "cache-control": "no-cache" } },
        },
      },
    }),
    viteReact(),
  ],
});
