// Converts docs/privacy/{privacy-policy,terms}.{en,fr}.md into apps/web/src/legal/content.json
// for the /privacy and /terms pages: no Markdown library at runtime. Handles what those files
// use: headings, paragraphs, **bold**, bullet lists (one nested level) and pipe tables. HTML
// comments (the drafting notes) are dropped. Run `npm run legal -w apps/web` after editing them;
// a test fails when the JSON is out of date.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DOCS = new URL('../../../docs/privacy/', import.meta.url)
const OUT = new URL('../src/legal/content.json', import.meta.url)

/** "text **bold** more" → ["text ", { b: "bold" }, " more"] */
export function inline(text) {
  const parts = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ b: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => inline(c.trim()))

/** Markdown → blocks: { h, level, text } | { p } | { ul: [{ text, children? }] } | { table }. */
export function convert(markdown) {
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const blocks = []
  let paragraph = []
  let list = null
  let item = null

  const flush = () => {
    if (paragraph.length) blocks.push({ p: inline(paragraph.join(' ')) })
    paragraph = []
    if (list) blocks.push({ ul: list })
    list = null
    item = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      // A blank line ends a paragraph; a list may continue after it only with another item.
      if (paragraph.length) flush()
      if (list && !/^\s*- /.test(lines[i + 1] ?? '')) flush()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ h: heading[1].length, text: heading[2].trim() })
      continue
    }
    if (line.trim().startsWith('|')) {
      flush()
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++])
      i--
      const [head, , ...body] = rows
      blocks.push({ table: { head: cells(head), rows: body.map(cells) } })
      continue
    }
    const bullet = /^(\s*)- (.*)$/.exec(line)
    if (bullet) {
      if (paragraph.length) {
        blocks.push({ p: inline(paragraph.join(' ')) })
        paragraph = []
      }
      list ??= []
      const entry = { text: bullet[2] }
      if (bullet[1].length >= 2 && item) {
        item.children ??= []
        item.children.push(entry)
      } else {
        list.push(entry)
        item = entry
      }
      continue
    }
    if (list && /^\s+\S/.test(line)) {
      // Continuation of the last bullet (nested or not).
      const last = item?.children?.at(-1) ?? item
      last.text += ` ${line.trim()}`
      continue
    }
    if (list) flush()
    paragraph.push(line.trim())
  }
  flush()
  // Bullet texts get their bold parsed last, once continuation lines are joined.
  const finish = (entries) =>
    entries.map(({ text, children }) => ({
      text: inline(text),
      ...(children ? { children: finish(children) } : {}),
    }))
  return blocks.map((b) => (b.ul ? { ul: finish(b.ul) } : b))
}

export function buildAll() {
  const read = (name) => readFileSync(new URL(name, DOCS), 'utf8')
  return {
    privacy: {
      en: convert(read('privacy-policy.en.md')),
      fr: convert(read('privacy-policy.fr.md')),
    },
    terms: { en: convert(read('terms.en.md')), fr: convert(read('terms.fr.md')) },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUT, `${JSON.stringify(buildAll(), null, 1)}\n`)
  console.log(`wrote ${fileURLToPath(OUT)}`)
}
