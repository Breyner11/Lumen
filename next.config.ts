import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empaquetado desktop (Tauri sidecar) + `npm run lumen:standalone`.
  output: "standalone",
  // Evita el indicador «N» de Next Dev que tapa el botón + del composer en móvil.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
