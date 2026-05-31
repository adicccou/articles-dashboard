import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => {
  const isTrading = mode === "trading";
  const isArticles = mode === "articles";

  return {
    plugins: [
      tailwindcss(),
      cloudflare({
        configPath: isTrading ? "wrangler.trading.jsonc" : isArticles ? "wrangler.articles.jsonc" : "wrangler.marketing.jsonc",
        inspectorPort: isTrading ? 9230 : isArticles ? 9231 : 9229,
      }),
    ],
    server: {
      port: isTrading ? 5191 : isArticles ? 5192 : 5190,
    },
  };
});
