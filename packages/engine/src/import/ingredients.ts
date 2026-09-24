/**
 * Canonical ingredient identities for the website importer. Label names vary
 * ("C (from 80 mg calcium ascorbate)", "Vitamin C (ascorbic acid)"); rules and
 * duplicate detection need one id per nutrient.
 */
import type { Unit } from '@smartstack/shared'

export interface CanonicalIngredient {
  en: string
  fr: string
  unit: Unit
}

/** Known nutrients with fixed display names and canonical units. */
export const CANONICAL: Record<string, CanonicalIngredient> = {
  'vitamin-a': { en: 'Vitamin A', fr: 'Vitamine A', unit: 'mcg' },
  'vitamin-b1': { en: 'Vitamin B1 (thiamine)', fr: 'Vitamine B1 (thiamine)', unit: 'mg' },
  'vitamin-b2': { en: 'Vitamin B2 (riboflavin)', fr: 'Vitamine B2 (riboflavine)', unit: 'mg' },
  'vitamin-b3': { en: 'Vitamin B3 (niacin)', fr: 'Vitamine B3 (niacine)', unit: 'mg' },
  'vitamin-b5': {
    en: 'Vitamin B5 (pantothenic acid)',
    fr: 'Vitamine B5 (acide pantothénique)',
    unit: 'mg',
  },
  'vitamin-b6': { en: 'Vitamin B6', fr: 'Vitamine B6', unit: 'mg' },
  'vitamin-b12': { en: 'Vitamin B12', fr: 'Vitamine B12', unit: 'mcg' },
  folate: { en: 'Folate', fr: 'Folate', unit: 'mcg' },
  biotin: { en: 'Biotin', fr: 'Biotine', unit: 'mcg' },
  'vitamin-c': { en: 'Vitamin C', fr: 'Vitamine C', unit: 'mg' },
  'vitamin-d': { en: 'Vitamin D', fr: 'Vitamine D', unit: 'mcg' },
  'vitamin-e': { en: 'Vitamin E', fr: 'Vitamine E', unit: 'mg' },
  'vitamin-k': { en: 'Vitamin K', fr: 'Vitamine K', unit: 'mcg' },
  iron: { en: 'Iron', fr: 'Fer', unit: 'mg' },
  calcium: { en: 'Calcium', fr: 'Calcium', unit: 'mg' },
  magnesium: { en: 'Magnesium', fr: 'Magnésium', unit: 'mg' },
  zinc: { en: 'Zinc', fr: 'Zinc', unit: 'mg' },
  copper: { en: 'Copper', fr: 'Cuivre', unit: 'mg' },
  selenium: { en: 'Selenium', fr: 'Sélénium', unit: 'mcg' },
  chromium: { en: 'Chromium', fr: 'Chrome', unit: 'mcg' },
  manganese: { en: 'Manganese', fr: 'Manganèse', unit: 'mg' },
  molybdenum: { en: 'Molybdenum', fr: 'Molybdène', unit: 'mcg' },
  iodine: { en: 'Iodine', fr: 'Iode', unit: 'mcg' },
  potassium: { en: 'Potassium', fr: 'Potassium', unit: 'mg' },
  boron: { en: 'Boron', fr: 'Bore', unit: 'mg' },
  silicon: { en: 'Silicon', fr: 'Silicium', unit: 'mg' },
  choline: { en: 'Choline', fr: 'Choline', unit: 'mg' },
  inositol: { en: 'Inositol', fr: 'Inositol', unit: 'mg' },
  epa: { en: 'EPA (omega-3)', fr: 'AEP (oméga-3)', unit: 'mg' },
  dha: { en: 'DHA (omega-3)', fr: 'ADH (oméga-3)', unit: 'mg' },
  'fish-oil': { en: 'Fish oil', fr: 'Huile de poisson', unit: 'mg' },
  probiotic: { en: 'Probiotic cultures', fr: 'Cultures probiotiques', unit: 'CFU' },
  'coenzyme-q10': { en: 'Coenzyme Q10', fr: 'Coenzyme Q10', unit: 'mg' },
  melatonin: { en: 'Melatonin', fr: 'Mélatonine', unit: 'mg' },
}

/** Ordered: first match wins. Tested against the name with parentheticals removed. */
const PATTERNS: [RegExp, string][] = [
  [/^vitamin d\d?\b|cholecalciferol|ergocalciferol|^d3?$/i, 'vitamin-d'],
  [/^vitamin c\b|ascorb|^c$/i, 'vitamin-c'],
  [/^vitamin b\s?12\b|cobalamin|^b12$/i, 'vitamin-b12'],
  [/^vitamin b\s?6\b|pyridox|^b6$/i, 'vitamin-b6'],
  [/^vitamin b\s?1\b|thiamin|^b1$/i, 'vitamin-b1'],
  [/^vitamin b\s?2\b|riboflavin|^b2$/i, 'vitamin-b2'],
  [/^vitamin b\s?3\b|niacin|nicotinamide|^b3$/i, 'vitamin-b3'],
  [/^vitamin b\s?5\b|pantothen|^b5$/i, 'vitamin-b5'],
  [/^folate|folic|methyltetrahydrofolate/i, 'folate'],
  [/^biotin/i, 'biotin'],
  [/^vitamin e\b|tocopher|^e$/i, 'vitamin-e'],
  [/^vitamin k\d?\b|menaquinone|phylloquinone|^k\d?$/i, 'vitamin-k'],
  [/^vitamin a\b|retin|beta.?carotene|^a$/i, 'vitamin-a'],
  [/^iron\b/i, 'iron'],
  [/^calcium\b/i, 'calcium'],
  [/^magnesium\b/i, 'magnesium'],
  [/^zinc\b/i, 'zinc'],
  [/^copper\b/i, 'copper'],
  [/^selenium\b/i, 'selenium'],
  [/^chromium\b/i, 'chromium'],
  [/^manganese\b/i, 'manganese'],
  [/^molybdenum\b/i, 'molybdenum'],
  [/^iodine\b|^iodide\b/i, 'iodine'],
  [/^potassium\b/i, 'potassium'],
  [/^boron\b/i, 'boron'],
  [/^silic(on|a)\b/i, 'silicon'],
  [/^choline\b/i, 'choline'],
  [/^inositol\b|^myo.?inositol/i, 'inositol'],
  [/eicosapentaenoic|\bepa\b/i, 'epa'],
  [/docosahexaenoic|\bdha\b/i, 'dha'],
  [/^fish oil|^omega.?3\b|^krill oil|^cod liver oil/i, 'fish-oil'],
  [
    /lactobacillus|bifidobacterium|streptococcus|saccharomyces|bacillus|lactococcus|pediococcus|enterococcus|lacticaseibacillus|limosilactobacillus|ligilactobacillus|lactiplantibacillus/i,
    'probiotic',
  ],
  [/coenzyme q10|ubiquinol|ubiquinone|\bcoq10\b/i, 'coenzyme-q10'],
  [/^melatonin/i, 'melatonin'],
]

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Canonical id for a label ingredient name (parentheticals already removed). */
export function canonicalIngredientId(baseName: string): string {
  const name = baseName.trim()
  for (const [re, id] of PATTERNS) if (re.test(name)) return id
  return slugify(name) || 'unknown'
}

/** Display names for an id: canonical when known, otherwise the label's own words. */
export function ingredientNames(id: string, baseName: string): { en: string; fr?: string } {
  const known = CANONICAL[id]
  if (known) return { en: known.en, fr: known.fr }
  return { en: baseName.trim() }
}
