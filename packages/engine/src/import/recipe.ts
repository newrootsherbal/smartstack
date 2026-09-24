/**
 * Parser for the supplement-facts ("recipe") text published on newrootsherbal.com:
 *
 *   "Each vegetable capsule contains: Iron (from iron bisglycinate)35 mg Vitamin C
 *    (ascorbic acid)75 mg … Other ingredients: …"
 *
 * Pure string processing; no network, no DOM. Whatever cannot be parsed is
 * returned in `unparsed` so the importer can report it.
 */

export type RawUnit = 'mg' | 'mcg' | 'g' | 'IU' | 'CFU'

export interface ParsedItem {
  /** Name with parentheticals and brackets removed, e.g. "Vitamin C". */
  name: string
  /** Name as printed, e.g. "Vitamin C (ascorbic acid)". */
  raw: string
  amount: number
  unit: RawUnit
  /** Section label the item appeared under ("Vitamins", "Dairy Strains", …) or null. */
  section: string | null
}

export interface RecipeParse {
  servingSize: string | null
  items: ParsedItem[]
  unparsed: string[]
}

// NBSP, thin, narrow no-break and figure spaces, built from char codes so no literal exotic whitespace sits in the source.
const SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f, 0x2007)}]`, 'g')
const END_MARKERS =
  /\b(?:Other ingredients?|Also contains?|Non[-‑]?medicinal ingredients?|Non[-‑]?medicinal|CFU Cells\s*=|Ultrapure|In a (?:non[-‑]?GMO )?(?:softgel|capsule)|Contains no)\b/i

// A unit ends where the next letter would start: "mg175 mg" (two-column tables) is two amounts.
const AMOUNT_UNIT =
  /^(\d[\d,]*(?:\.\d+)?)\s*(million|billion)?\s*(mg|mcg|µg|ug|g|IU|UI|CFU)(?![A-Za-z])(?:\s*AT(?![A-Za-z]))?/
const AMOUNT_UNIT_LOOSE = /^(\d[\d,]*(?:\.\d+)?)\s*(million|billion)\b(?!\s*(?:mg|mcg|g|IU))/
const TRAILING_ALT = /^\s*\(\s*(?:≈\s*)?[\d,]*(?:\.\d+)?\s*(?:IU|UI|mcg|mg|µg|g|%)\s*\)/
/** A second amount right after the first one: the "per 8 capsules" column of a two-column table. */
const SECOND_COLUMN =
  /^\s*\d[\d,]*(?:\.\d+)?\s*(?:million|billion)?\s*(?:mg|mcg|µg|ug|g|IU|UI|CFU)(?![A-Za-z])(?:\s*AT(?![A-Za-z]))?/
const SECTION_LABEL = /^([A-Z][A-Za-z’'‑-]*(?:\s+[A-Za-z’'‑-]+){0,3}):\s*/

/** A plausible ingredient name: some letters, not a stray token, not a sentence. */
function isIngredientName(name: string): boolean {
  if (name.length > 80) return false
  if ((name.match(/[A-Za-zÀ-ÿ]/g) ?? []).length < 2) return false
  if (/^(at|of|per|and|each|total)$/i.test(name)) return false
  if (/\bcontains?\b|\bprovides?\b|^\d|^%/i.test(name)) return false
  return true
}

function normalizeUnit(word: string, scale: string | undefined): { unit: RawUnit; factor: number } {
  const w = word.toLowerCase()
  const s = scale?.toLowerCase()
  const mult = s === 'billion' ? 1e9 : s === 'million' ? 1e6 : 1
  if (w === 'cfu') return { unit: 'CFU', factor: mult }
  if (w === 'mg') return { unit: 'mg', factor: mult }
  if (w === 'mcg' || w === 'µg' || w === 'ug') return { unit: 'mcg', factor: mult }
  if (w === 'g') return { unit: 'g', factor: mult }
  return { unit: 'IU', factor: mult }
}

/** "Each vegetable capsule contains:" → "1 vegetable capsule"; null when absent. */
export function parseServingSize(text: string): string | null {
  // Two-column tables ("Contents: 2 Capsules 8 Capsules …") are read per first column.
  const contents = /^Contents:\s*(\d+\s*(?:capsules?|softgels?|tablets?|scoops?))/i.exec(text)
  if (contents) return contents[1]!.toLowerCase().replace(/\s+/g, ' ')
  const m =
    /^(?:Each|Every)\s+(.+?)\s+(?:contains?|provides?|delivers?|protects|of)\b/i.exec(text) ??
    /^Ingredients \(per (.+?)\)/i.exec(text) ??
    /^(One|Two|Three|Four)\s+(.+?)\s+contains?\b/i.exec(text)
  if (!m) return null
  let phrase = (m[2] && m[1] && /^(One|Two|Three|Four)$/i.test(m[1]) ? `${m[1]} ${m[2]}` : m[1])!
    .replace(/™|®/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4' }
  phrase = phrase.replace(/^(one|two|three|four)\b/i, (w) => words[w.toLowerCase()] ?? w)
  if (/capsule/i.test(phrase) && !/^\d/.test(phrase)) {
    return /enteric/i.test(phrase) ? '1 enteric-coated capsule' : '1 capsule'
  }
  if (/softgel/i.test(phrase) && !/^\d/.test(phrase)) return '1 softgel'
  if (/tablet|caplet|lozenge/i.test(phrase) && !/^\d/.test(phrase))
    return `1 ${phrase.toLowerCase()}`
  return /^\d|^½|^¼/.test(phrase) ? phrase : `1 ${phrase}`
}

function cleanName(raw: string): string {
  return raw
    .replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[™®]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–‑-]+|[\s,.;:–‑-]+$/g, '')
    .replace(/^(?:and|plus|providing|from)\s+/i, '')
    .trim()
}

function vitaminize(name: string, section: string | null): string {
  // "B5", "D3", "K2" only ever mean vitamins; bare "A", "C", "E" need a Vitamins section.
  if (/^(B\d{1,2}|D\d|K\d)$/i.test(name)) return `Vitamin ${name.toUpperCase()}`
  if (section && /vitamin/i.test(section) && /^(A|C|D|E|K)$/i.test(name)) {
    return `Vitamin ${name.toUpperCase()}`
  }
  return name
}

export function parseRecipe(text: string): RecipeParse {
  const source = text.replace(SPACES, ' ').replace(/\s+/g, ' ').trim()
  const servingSize = parseServingSize(source)

  // Body starts after the first colon that follows the opener; end at the first end marker.
  let body = source
  const opener = /^(?:Each|Every|Ingredients|One|Two|Three|Four|Contents)\b[^:]*:\s*/i.exec(source)
  if (opener) body = source.slice(opener[0].length)
  // Two-column tables start with their column headers: "2 Capsules 8 Capsules".
  body = body.replace(
    /^\d+\s*(?:capsules?|softgels?|tablets?|scoops?)\s*\d+\s*(?:capsules?|softgels?|tablets?|scoops?)\s*/i,
    '',
  )
  const end = END_MARKERS.exec(body)
  if (end && end.index > 0) body = body.slice(0, end.index)

  const items: ParsedItem[] = []
  const unparsed: string[] = []
  let section: string | null = null
  let buffer = ''
  let depth = 0
  let i = 0

  const flushUnparsed = () => {
    const leftover = cleanName(buffer)
    if (leftover.length > 2) unparsed.push(leftover)
    buffer = ''
  }

  while (i < body.length) {
    const ch = body[i]!
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)

    if (depth === 0) {
      // Section label at the start of an item, e.g. "Minerals: " or "Dairy Strains: ".
      if (buffer.trim() === '') {
        const label = SECTION_LABEL.exec(body.slice(i))
        if (label && !/\d/.test(label[1]!)) {
          section = label[1]!
          i += label[0].length
          continue
        }
      }
      const rest = body.slice(i)
      const m = AMOUNT_UNIT.exec(rest) ?? AMOUNT_UNIT_LOOSE.exec(rest)
      if (m && buffer.trim() !== '') {
        const amountText = m[1]!.replace(/,/g, '')
        const unitWord = m[3] ?? 'CFU'
        const { unit, factor } = normalizeUnit(unitWord, m[2])
        const raw = buffer
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[,;:–-]+$/, '')
        const name = vitaminize(cleanName(raw), section)
        if (name && isIngredientName(name)) {
          items.push({ name, raw, amount: Number(amountText) * factor, unit, section })
        } else {
          unparsed.push(raw)
        }
        buffer = ''
        i += m[0].length
        // Skip "(1,000 IU)"-style equivalents and any second-column amounts.
        for (;;) {
          const alt = TRAILING_ALT.exec(body.slice(i))
          if (alt) {
            i += alt[0].length
            continue
          }
          const second = SECOND_COLUMN.exec(body.slice(i))
          if (second) {
            i += second[0].length
            continue
          }
          break
        }
        continue
      }
    }
    buffer += ch
    i++
  }
  flushUnparsed()

  return { servingSize, items, unparsed }
}
