import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    solid(),
    // Same approach as opencode's app (packages/app/vite.pwa.ts): a generated service worker
    // that precaches the whole build, so the installed app opens instantly and works offline
    // for browsing past chats. API calls are never cached.
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Jonny's AI project",
        short_name: "Jonny's AI project",
        description: "Jonny's private AI chat, coding and research app.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#141413",
        background_color: "#141413",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The agents (public/agents) aren't precached: the roster is kept fresh, and each
        // agent's brief is cached once it's been used, so they work offline after that.
        runtimeCaching: [
          { urlPattern: /\/agents\/index\.json$/, handler: "StaleWhileRevalidate", options: { cacheName: "agents-index" } },
          { urlPattern: /\/agents\/[\w-]+\.md$/, handler: "CacheFirst", options: { cacheName: "agents", expiration: { maxEntries: 400 } } },
        ],
      },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
})
