import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
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
