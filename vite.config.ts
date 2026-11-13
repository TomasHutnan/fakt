import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// base "./" keeps the build working both at fakt.hutnan.dev and at
// <user>.github.io/fakt/ before the custom domain is set up.
export default defineConfig({
  base: "./",
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Fakt?",
        short_name: "Fakt?",
        description: "Vedomostná hra pre partiu na jednom telefóne.",
        lang: "sk",
        display: "standalone",
        start_url: "./",
        scope: "./",
        background_color: "#f4f3ef",
        theme_color: "#f4f3ef",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,json}"],
        navigateFallback: null,
        ignoreURLParametersMatching: [/.*/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
