import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" } },
  preview: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { pdf: ["pdfjs-dist"], vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"] } } },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["logo.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "GPlanSiS|DOCS — Gestão de documentos técnicos",
        short_name: "GPS DOCS",
        description: "Lista mestra, revisões, GRD, workflow de aprovação e OCR de documentos de engenharia.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#F3F5F6",
        theme_color: "#14202B",
        categories: ["business", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Minhas pendências", url: "/pendencias" },
          { name: "Lista mestra", url: "/documentos" },
          { name: "Buscar", url: "/busca" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { // listas e detalhes: rede primeiro, cache como reserva offline
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") && !url.pathname.includes("/files/"),
            handler: "NetworkFirst",
            options: { cacheName: "api", networkTimeoutSeconds: 6, expiration: { maxEntries: 300, maxAgeSeconds: 86400 } },
          },
          { // miniaturas são imutáveis por arquivo
            urlPattern: ({ url }) => /\/api\/files\/[^/]+\/thumb/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "thumbs", expiration: { maxEntries: 500, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
    }),
  ],
});
