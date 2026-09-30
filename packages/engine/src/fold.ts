// Combining diacritical marks, built from char codes so no bare accent sits in the source.
const DIACRITICS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

/** Lowercase without accents, so "echinacee" finds "Échinacée" and "acetyl" finds "Acétyl". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase()
}
