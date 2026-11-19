import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empaquetado desktop (Tauri sidecar) + `npm run lumen:standalone`.
  output: "standalone",
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
