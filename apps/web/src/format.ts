/** "10000000000 CFU" → "10 billion CFU"; "300 mg" stays "300 mg". */
export function formatAmount(amount: number, unit: string): string {
  const n = amount >= 1e9 ? `${amount / 1e9} billion` : amount.toLocaleString('en-CA')
  return `${n} ${unit}`
}
