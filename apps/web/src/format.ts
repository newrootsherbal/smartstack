import type { Product } from '@smartstack/shared'
import { t } from './i18n'

/** "10000000000 CFU" → "10 billion CFU"; "300 mg" stays "300 mg". */
export function formatAmount(amount: number, unit: string): string {
  const n =
    amount >= 1e9
      ? `${trim(amount / 1e9)} billion`
      : amount >= 1e6
        ? `${trim(amount / 1e6)} million`
        : trim(amount).toLocaleString('en-CA')
  return `${n} ${unit}`.trim()
}

function trim(n: number): number {
  return Math.round(n * 100) / 100
}

/** "Once a day", "Twice a day", … */
export function timesLabel(n: number): string {
  const key = String(Math.min(Math.max(Math.round(n), 1), 4)) as '1' | '2' | '3' | '4'
  return t(`times.${key}`)
}

/** "2 capsules", "1 softgel", "½ dose" */
export function formatUnits(units: number, form: Product['form']): string {
  const word = t(`form.${form}.${units === 1 ? 'one' : 'other'}`)
  const n = units === 0.5 ? '½' : units.toLocaleString('en-CA')
  return `${n} ${word}`
}
