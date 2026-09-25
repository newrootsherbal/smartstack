/**
 * French supplement facts → French ingredient names.
 *
 * The website publishes the facts in both languages with the same items and amounts
 * ("Quercetin100 mg" / "Quercétine100 mg"). Once the French text is rewritten so the
 * English parser reads its numbers ("13,38", "1 000"), units ("UI", "millions d’UFC"),
 * section words and qualifiers ("fournissant"), the two lists carry the same amounts and
 * each French name is taken from the item with the same amount. Only amounts that occur
 * once in the product identify an item: French labels sometimes list equal amounts in
 * another order, and an English fallback beats a wrong translation. Lists that differ in
 * length or in their amounts do not describe the same items and yield nothing.
 */
import { parseRecipe, type ParsedItem } from './recipe'

// NBSP, thin, narrow no-break and figure spaces, built from char codes so no literal exotic whitespace sits in the source.
const SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f, 0x2007)}]`, 'g')
/**
 * "1 414" thousands groups, also when glued to a name ("poisson1 414 mg"). Not after a
 * digit, an uppercase letter or a colon, so strain codes ("R0418 605 millions"), vitamin
 * names ("B12 1 000 mcg" keeps "B12") and extract ratios ("10:1 200 mg") stay apart.
 */
const THOUSANDS = /(?<![\dA-Z,.:])(\d{1,3}(?:\d{3})*) (\d{3})(?!\d)/g
/** The website sometimes mangles the narrow no-break space in a number to "?". */
const MANGLED_THOUSANDS = /(\d)\?(\d{3})(?!\d)/g

// JavaScript's \b does not know accented letters, so word edges are spelled out.
const B = '(?<![a-zà-ÿ])'
const E = '(?![a-zà-ÿ])'
const word = (alternatives: string, flags = 'gi') =>
  new RegExp(`${B}(?:${alternatives})${E}`, flags)

const STRUCTURE: [RegExp, string][] = [
  [/^Chaque\b|^Chacune\b/i, 'Each'],
  [/^Une\b/i, 'One'],
  [/^Deux\b/i, 'Two'],
  [/^Trois\b/i, 'Three'],
  [/^Quatre\b/i, 'Four'],
  [/^Ingrédients\s*\(par\b/i, 'Ingredients (per'],
  [/^Contenu\s*:/i, 'Contents:'],
  [word('Valeur nutritive'), 'Nutrition Facts'],
  [word('Ingrédients médicinaux'), 'Medicinal ingredients'],
  [word('Ingrédients non[-‑ ]?médicinaux'), 'Non-medicinal ingredients'],
  [word('Autres ingrédients'), 'Other ingredients'],
  [word('Contient aussi'), 'Also contains'],
  [word('Ne contient pas'), 'Contains no'],
  [word('Ultrapure?'), 'Ultrapure'],
  [word('Dans une (?:gélule|capsule)'), 'In a softgel'],
  [word('Cellules UFC'), 'CFU Cells'],
  [/\bVitamines\s*:/gi, 'Vitamins:'],
  [/\bMinéraux\s*:/gi, 'Minerals:'],
  [/\bFournissant\s*:/gi, 'Providing:'],
  [/\bSouches humaines\s*:/gi, 'Human Strains:'],
  [/\bSouches? végétales?\s*:/gi, 'Plant Strains:'],
  [/\bSouches laitières\s*:/gi, 'Dairy Strains:'],
  // Qualifiers after a name: the parser's cleanName strips their English forms.
  [word('fournissant'), 'providing'],
  [word('livrant|procurant'), 'delivering'],
  [word('standardis[ée]e?s?|normalis[ée]e?s?|titr[ée]e?s?'), 'standardized'],
  [word('équivalent[es]?'), 'equivalent'],
  [word('contenant|renfermant'), 'containing'],
  [/\b(?:millions?)\s+d[’']\s*UFC\b/gi, 'million CFU'],
  [/\b(?:milliards?)\s+d[’']\s*UFC\b/gi, 'billion CFU'],
  [/\bmilliards?\b/gi, 'billion'],
  [/\bmillions?\b/gi, 'million'],
  [/\bUFC\b/g, 'CFU'],
  [/\bUI\b/g, 'IU'],
]

/** French label text rewritten so parseRecipe reads its numbers, units and markers. */
export function frenchFactsToParserInput(text: string): string {
  let out = text.replace(SPACES, ' ').replace(MANGLED_THOUSANDS, '$1$2')
  // "3 600 000": each pass merges one group.
  for (let i = 0; i < 3; i++) {
    const merged = out.replace(THOUSANDS, '$1$2')
    if (merged === out) break
    out = merged
  }
  // "13,38 mg": a comma between digits is a decimal in French.
  out = out.replace(/(\d),(\d)/g, '$1.$2')
  for (const [re, replacement] of STRUCTURE) out = out.replace(re, replacement)
  return out
}

const QUALIFIERS = word('providing|delivering|standardized|equivalent|containing', 'i')

/** The parser's cleaned French name, with its decimals back in French ("2,5 %"). */
export function cleanFrenchName(name: string): string {
  const cut = name.search(new RegExp(`[,;]? +${QUALIFIERS.source}`, 'i'))
  return (cut >= 0 ? name.slice(0, cut) : name)
    .replace(/^[\s,.;:–‑*-]+|[\s,.;:–‑*-]+$/g, '')
    .replace(/^(?:et|plus|de|d[’'])\s*/i, '')
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .trim()
}

const key = (item: ParsedItem) => `${item.amount} ${item.unit}`

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)
}

/**
 * The French name for each English item, by index; undefined where the item's amount is
 * not unique in the product. Empty when the two lists differ in length or in amounts.
 */
export function alignFrenchNames(
  enItems: readonly ParsedItem[],
  frRecipe: string | undefined,
): (string | undefined)[] {
  if (!frRecipe || enItems.length === 0) return []
  const fr = parseRecipe(frenchFactsToParserInput(frRecipe))
  if (fr.items.length !== enItems.length) return []
  // Same amounts overall (order aside), or the texts do not list the same items.
  const sortedEn = [...enItems].sort((a, b) => a.amount - b.amount || a.unit.localeCompare(b.unit))
  const sortedFr = [...fr.items].sort((a, b) => a.amount - b.amount || a.unit.localeCompare(b.unit))
  for (let i = 0; i < sortedEn.length; i++) {
    if (sortedEn[i]!.unit !== sortedFr[i]!.unit || !close(sortedEn[i]!.amount, sortedFr[i]!.amount))
      return []
  }
  const count = new Map<string, number>()
  for (const item of enItems) count.set(key(item), (count.get(key(item)) ?? 0) + 1)
  const frByKey = new Map(fr.items.map((item) => [key(item), item]))
  return enItems.map((item) => {
    if (count.get(key(item)) !== 1) return undefined
    const match = frByKey.get(key(item))
    const name = match ? cleanFrenchName(match.name) : ''
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : undefined
  })
}
