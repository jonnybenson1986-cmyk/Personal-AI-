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
        name: "Personal AI",
        short_name: "Personal AI",
        description: "One private chat app for Claude and ChatGPT.",
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
      },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
})
