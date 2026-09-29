// Resized, palette-optimized copy of the New Roots Herbal logo for the welcome screen.
// Source: brand/nrh-logo.png (800 × 735, not shipped). Output: public/nrh-logo.png at
// 320 px wide, twice the 160 px it is displayed at.
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = fileURLToPath(new URL('../brand/nrh-logo.png', import.meta.url))
const output = fileURLToPath(new URL('../public/nrh-logo.png', import.meta.url))

const info = await sharp(source)
  .resize({ width: 320 })
  .png({ palette: true, quality: 90, colours: 256, dither: 1, compressionLevel: 9, effort: 10 })
  .toFile(output)
console.log(`public/nrh-logo.png ${info.width}×${info.height}, ${info.size} bytes`)
