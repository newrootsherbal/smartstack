// Placeholder manifest screenshots (Chrome's richer install dialog needs at
// least one narrow and one wide). Replace with real captures before the beta.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')

function mock(width, height) {
  const rows = [
    ['MORNING', '8:00 AM', ['Multivitamin', 'Vitamin D']],
    ['9:30 AM', '', ['Iron']],
    ['LUNCH', '12:00 PM', ['Fish oil', 'Probiotic']],
    ['EVENING', '6:00 PM', ['Calcium']],
    ['BEDTIME', '10:30 PM', ['Magnesium']],
  ]
  const scale = width / 540
  const pad = 32 * scale
  let y = 150 * scale
  let body = ''
  for (const [label, time, items] of rows) {
    body += `<rect x="${pad}" y="${y}" width="${width - pad * 2}" height="${(44 + items.length * 40) * scale}" rx="${14 * scale}" fill="#fff" stroke="#dfe1dc"/>`
    body += `<text x="${pad + 16 * scale}" y="${y + 28 * scale}" font-size="${13 * scale}" font-weight="700" fill="#5f6368" letter-spacing="1">${label}</text>`
    body += `<text x="${width - pad - 16 * scale}" y="${y + 28 * scale}" font-size="${14 * scale}" font-weight="700" fill="#1b1b1b" text-anchor="end">${time}</text>`
    items.forEach((item, i) => {
      const iy = y + (56 + i * 40) * scale
      body += `<rect x="${pad + 16 * scale}" y="${iy - 14 * scale}" width="${20 * scale}" height="${20 * scale}" rx="${5 * scale}" fill="none" stroke="#1f6f5c" stroke-width="${2 * scale}"/>`
      body += `<text x="${pad + 48 * scale}" y="${iy + 2 * scale}" font-size="${16 * scale}" font-weight="600" fill="#1b1b1b">${item}</text>`
    })
    y += (44 + items.length * 40 + 16) * scale
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif">
    <rect width="${width}" height="${height}" fill="#f7f7f5"/>
    <rect width="${width}" height="${40 * scale}" fill="#fff6dc"/>
    <text x="${pad}" y="${26 * scale}" font-size="${11 * scale}" fill="#5c4300">Sample data — not reviewed, not medical advice.</text>
    <text x="${pad}" y="${100 * scale}" font-size="${30 * scale}" font-weight="700" fill="#1b1b1b">Today</text>
    <text x="${pad}" y="${126 * scale}" font-size="${14 * scale}" fill="#5f6368">Your personalized supplement schedule</text>
    ${body}
  </svg>`
}

for (const [name, w, h] of [
  ['screenshot-narrow.png', 540, 1080],
  ['screenshot-wide.png', 1280, 800],
]) {
  const png = await sharp(Buffer.from(mock(w, h)))
    .png()
    .toBuffer()
  writeFileSync(resolve(publicDir, name), png)
  console.log(`wrote public/${name} (${w}x${h})`)
}
