import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // Registered by hand in main.tsx through `virtual:pwa-register`.
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'New Roots SmartStack',
        short_name: 'SmartStack',
        description:
          'Scan your supplements, enter your daily routine and get a personalized schedule with reminders and the reason behind every timing.',
        lang: 'en',
        start_url: '/today',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1f6f5c',
        background_color: '#f7f7f5',
        categories: ['health', 'lifestyle'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: 'screenshot-narrow.png',
            sizes: '540x1080',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Today: your personalized supplement schedule',
          },
          {
            src: 'screenshot-wide.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Today: your personalized supplement schedule',
          },
        ],
      },
      injectManifest: {
        // The ZXing reader WASM (~1 MB) is precached from our origin.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // One origin in development too: the browser talks to Vite, Vite forwards
    // /api to `wrangler dev` on 8787. No CORS anywhere.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
})
