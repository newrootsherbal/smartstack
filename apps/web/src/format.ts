import type { Product } from '@smartstack/shared'
import { getLocale, intlLocale, lookupMessage, t } from './i18n'

/** 637.5 → "637.5" / "637,5"; 10000 → "10,000" / "10 000". */
export function formatNumber(n: number): string {
  return n.toLocaleString(intlLocale())
}

/** A canonical unit as printed in the current language: IU → UI and CFU → UFC in French. */
export function formatUnit(unit: string): string {
  return lookupMessage(`unit.${unit}`) ?? unit
}

/**
 * French counts as singular below two ("1,5 milliard", "0,5 cuillère"); English only at
 * one and below, which keeps "½ teaspoon" singular as well.
 */
export function pluralForm(n: number): 'one' | 'other' {
  if (getLocale() === 'fr') return n < 2 ? 'one' : 'other'
  return n <= 1 ? 'one' : 'other'
}

/** "10000000000 CFU" → "10 billion CFU" / "10 milliards UFC"; "300 mg" stays "300 mg". */
export function formatAmount(amount: number, unit: string): string {
  const n =
    amount >= 1e9
      ? scaled(amount / 1e9, 'billion')
      : amount >= 1e6
        ? scaled(amount / 1e6, 'million')
        : formatNumber(trim(amount))
  return `${n} ${formatUnit(unit)}`.trim()
}

function scaled(value: number, word: 'billion' | 'million'): string {
  const v = trim(value)
  return `${formatNumber(v)} ${t(`amount.${word}.${pluralForm(v)}`)}`
}

function trim(n: number): number {
  return Math.round(n * 100) / 100
}

/** "Once a day", "Twice a day", … */
export function timesLabel(n: number): string {
  const key = String(Math.min(Math.max(Math.round(n), 1), 4)) as '1' | '2' | '3' | '4'
  return t(`times.${key}`)
}

/**
 * "2 capsules", "4 drops", "½ teaspoon" — "2 capsules", "4 gouttes", "½ cuillère à thé".
 * Uses the label's own unit word when the importer found one (through the `unitLabel`
 * vocabulary), otherwise the generic word for the form.
 */
export function formatUnits(
  units: number,
  form: Product['form'],
  unitLabel?: string | undefined,
): string {
  const n = units === 0.5 ? '½' : formatNumber(units)
  const plural = pluralForm(units)
  if (unitLabel) {
    const known = lookupMessage(`unitLabel.${unitLabel}.${plural}`)
    if (known) return `${n} ${known}`
    // A unit word the vocabulary does not know yet: English can still print it as found.
    if (getLocale() === 'en') {
      return `${n} ${plural === 'one' || unitLabel === 'ml' ? unitLabel : `${unitLabel}s`}`
    }
  }
  return `${n} ${t(`form.${form}.${plural}`)}`
}

/** Leading quantity ("1", "½", "1 ¾", "2.5") and the phrase after it. */
const SERVING = /^(\d+(?:[.,]\d+)?(?:\s[½¼¾])?|[½¼¾])\s+(.+)$/
const PARENTHETICAL = /\s*\(([^)]*)\)\s*$/
const COUNTED = /^(\d+(?:[.,]\d+)?)\s+([a-z-]+)$/i

/**
 * The label's serving phrase ("1 enteric-coated capsule", "1 ml (40 drops)") in the
 * current language, through the `serving` vocabulary. Phrasing the vocabulary does not
 * cover stays as printed on the label.
 */
export function formatServingSize(servingSize: string): string {
  if (getLocale() === 'en') return servingSize
  const m = SERVING.exec(servingSize.trim())
  if (!m) return servingSize
  const quantity = m[1]!
  let rest = m[2]!
  let suffix = ''
  const paren = PARENTHETICAL.exec(rest)
  if (paren) {
    rest = rest.slice(0, paren.index)
    // "(40 drops)" → "(40 gouttes)"; anything else in the parentheses stays as printed.
    const inner = paren[1]!.trim()
    const counted = COUNTED.exec(inner)
    const word = counted ? lookupMessage(`serving.${slug(counted[2]!)}`) : undefined
    suffix = ` (${counted && word ? `${counted[1]} ${word}` : inner})`
  }
  const phrase = lookupMessage(`serving.${slug(rest)}`)
  return phrase ? `${quantity} ${phrase}${suffix}` : servingSize
}

function slug(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
