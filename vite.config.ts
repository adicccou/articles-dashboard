import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => {
  const isTrading = mode === "trading";

  return {
    plugins: [
      tailwindcss(),
      cloudflare({
        configPath: isTrading ? "wrangler.trading.jsonc" : "wrangler.marketing.jsonc",
        inspectorPort: isTrading ? 9230 : 9229,
      }),
    ],
    server: {
      port: isTrading ? 5191 : 5190,
    },
  };
});
