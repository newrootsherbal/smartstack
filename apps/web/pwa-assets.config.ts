import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// `npm run assets` regenerates public/pwa-*.png, maskable-icon-512x512.png,
// apple-touch-icon-180x180.png and favicon.ico from public/icon.svg.
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset: {
    ...minimal2023Preset,
    // Solid background for the iOS Home Screen icon (iOS does not support transparency).
    apple: { sizes: [180], padding: 0.15, resizeOptions: { background: '#1f6f5c' } },
    maskable: { sizes: [512], padding: 0.3, resizeOptions: { background: '#1f6f5c' } },
  },
  images: ['public/icon.svg'],
})
