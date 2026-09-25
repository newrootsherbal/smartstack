import { describe, expect, it } from 'vitest'
import { parseRecipe, parseServingSize } from './recipe'

const IRON =
  'Each vegetable capsule contains: Iron (from iron bisglycinate)35 mg Vitamin C (ascorbic acid)75 mg Inositol hexanicotinate, flush-free (providing 4.55 mg of vitamin B3)5 mg Vitamin B1 (thiamine hydrochloride)5 mg Vitamin B2 (riboflavin-5′‑phosphate sodium)5 mg Vitamin B6 (pyridoxal-5′‑phosphate)5 mg Copper (from cupric citrate)1 mg Folate (from calcium ʟ‑5‑methyltetrahydrofolate)1,000 mcg Vitamin B12 (methylcobalamin)1,000 mcg Other ingredients: Microcrystalline cellulose, vegetable magnesium stearate, and silicon dioxide in a non‑GMO vegetable capsule composed of vegetable carbohydrate gum and purified water.'

const MULTI =
  'Each vegetable capsule contains: Vitamins: C (from 80 mg calcium ascorbate)56 mg B1 (thiamine hydrochloride)50 mg B3 (inositol hexanicotinate, flush-free)50 mg B5 (calcium ᴅ‑pantothenate)50 mg B6 (pyridoxal-5′‑phosphate)50 mg B2 (riboflavin)25 mg B2 (riboflavin-5′‑phosphate)25 mg E (ᴅ‑alpha‑tocopheryl acid succinate) (20 IU)13.38 mg AT Folate (from calcium ʟ‑5‑methyltetrahydrofolate)1 mg B12 (methylcobalamin)1 mg Biotin150 mcg K2 (menaquinone-4)25 mcg D3 (cholecalciferol) (1,000 IU)25 mcg Minerals: Magnesium (from magnesium citrate)35 mg Zinc (from zinc citrate)10 mg Copper (from copper gluconate)1 mg Manganese (from manganese citrate)1 mg Molybdenum (from molybdenum citrate)150 mcg Chromium (from chromium chelate)50 mcg Selenium (from yeast-free ʟ‑selenomethionine)10 mcg Other ingredients: Microcrystalline cellulose.'

const OMEGA =
  'Each softgel contains: Fish oil (omega-3 fatty acids from wild, deep-sea whole anchovies [Engraulidae] and/or whole sardines [Clupeidae])1,414 mg Providing: Eicosapentaenoic acid (EPA)660 mg Docosahexaenoic acid (DHA)330 mg Ultrapure, pharmaceutical grade. Other ingredients: Natural vitamin E (ᴅ‑alpha‑tocopherol) (from non‑GMO sunflower)3.35 mg AT (5 IU) In a softgel composed of fish gelatin, vegetable glycerin, and purified water.'

const PROBIOTIC =
  'Each GPS™ natural water-based enteric-coated vegetable capsule protects contents from stomach acids and delivers 100% potency of the following 11 strains of live, active, healthy, and whole cells (15 billion) to the intestines: Human Strains: Lactobacillus acidophilus R0418 825 million CFU Bifidobacterium longum ssp. longum R0175 450 million CFU Bifidobacterium breve R0070 450 million CFU Plant Strain: Lactobacillus plantarum R1012 600 million CFU Dairy Strains: Lactobacillus rhamnosus R0011 6 billion CFU Lactobacillus helveticus R0052 750 million CFU CFU Cells = Colony-Forming Unit Cells. Potency guaranteed at expiry'

const VITAMIN_D =
  'Each softgel contains: Vitamin D3 (cholecalciferol)25 mcg (1,000 IU) Other ingredients: Organic sunflower oil, rosemary extract, and natural vitamin E (ᴅ‑alpha‑tocopherol, from non‑GMO sunflower) in a softgel composed of glycerin, bovine gelatin, and purified water.'

describe('parseRecipe', () => {
  it('parses a straightforward mineral formula', () => {
    const r = parseRecipe(IRON)
    expect(r.servingSize).toBe('1 capsule')
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['Iron', 35, 'mg'],
      ['Vitamin C', 75, 'mg'],
      ['Inositol hexanicotinate, flush-free', 5, 'mg'],
      ['Vitamin B1', 5, 'mg'],
      ['Vitamin B2', 5, 'mg'],
      ['Vitamin B6', 5, 'mg'],
      ['Copper', 1, 'mg'],
      ['Folate', 1000, 'mcg'],
      ['Vitamin B12', 1000, 'mcg'],
    ])
    expect(r.unparsed).toEqual([])
  })

  it('handles section labels, bare vitamin letters and alternate IU amounts', () => {
    const r = parseRecipe(MULTI)
    const byName = Object.fromEntries(r.items.map((i) => [i.name, `${i.amount} ${i.unit}`]))
    expect(byName['Vitamin C']).toBe('56 mg')
    expect(byName['Vitamin E']).toBe('13.38 mg')
    expect(byName['Vitamin D3']).toBe('25 mcg')
    expect(byName['Vitamin K2']).toBe('25 mcg')
    expect(byName['Biotin']).toBe('150 mcg')
    expect(byName['Magnesium']).toBe('35 mg')
    expect(byName['Selenium']).toBe('10 mcg')
    expect(r.items.filter((i) => i.name === 'Vitamin B2')).toHaveLength(2)
    expect(r.items.find((i) => i.name === 'Magnesium')?.section).toBe('Minerals')
    expect(r.unparsed).toEqual([])
  })

  it('reads fish oil totals and the EPA/DHA breakdown, ignoring bracketed species', () => {
    const r = parseRecipe(OMEGA)
    expect(r.servingSize).toBe('1 softgel')
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Fish oil', 1414],
      ['Eicosapentaenoic acid', 660],
      ['Docosahexaenoic acid', 330],
    ])
  })

  it('converts million/billion CFU and stops at the legend', () => {
    const r = parseRecipe(PROBIOTIC)
    expect(r.servingSize).toBe('1 enteric-coated capsule')
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['Lactobacillus acidophilus R0418', 825e6, 'CFU'],
      ['Bifidobacterium longum ssp. longum R0175', 450e6, 'CFU'],
      ['Bifidobacterium breve R0070', 450e6, 'CFU'],
      ['Lactobacillus plantarum R1012', 600e6, 'CFU'],
      ['Lactobacillus rhamnosus R0011', 6e9, 'CFU'],
      ['Lactobacillus helveticus R0052', 750e6, 'CFU'],
    ])
    expect(r.items[4]?.section).toBe('Dairy Strains')
  })

  it('keeps the primary unit when an IU equivalent follows', () => {
    const r = parseRecipe(VITAMIN_D)
    expect(r.items).toEqual([
      {
        name: 'Vitamin D3',
        raw: 'Vitamin D3 (cholecalciferol)',
        amount: 25,
        unit: 'mcg',
        section: null,
      },
    ])
  })

  it('parses serving-size phrases', () => {
    expect(parseServingSize('Each teaspoon (5 ml) contains:')).toBe('1 teaspoon (5 ml)')
    expect(parseServingSize('Each ½ teaspoon contains:')).toBe('½ teaspoon')
    expect(parseServingSize('Ingredients (per 2 vegetable capsules): X 1 mg')).toBe(
      '2 vegetable capsules',
    )
    expect(parseServingSize('Two scoops contain: X')).toBe('2 scoops')
    expect(parseServingSize('Wild chaga mushroom 500 mg')).toBeNull()
  })
})

const TWO_COLUMN =
  'Contents:2 Capsules8 Capsules Vitamins: C (from calcium ascorbate)43.75 mg175 mg E (ᴅ‑alpha‑tocopheryl acid succinate)33.44 mg AT133.76 mg AT B5 (calcium ᴅ‑pantothenate)11.5 mg46 mg B1 (thiamin hydrochloride)8.25 mg33 mg Folate (from calcium ʟ‑5‑methyltetrahydrofolate)95 mcg380 mcg Biotin16.5 mcg66 mcg Minerals: Zinc (from zinc citrate)3.75 mg15 mg Other ingredients: cellulose.'

describe('parseRecipe — two-column tables and junk', () => {
  it('reads the first column of a two-column table and its serving size', () => {
    const r = parseRecipe(TWO_COLUMN)
    expect(r.servingSize).toBe('2 capsules')
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['Vitamin C', 43.75, 'mg'],
      ['Vitamin E', 33.44, 'mg'],
      ['Vitamin B5', 11.5, 'mg'],
      ['Vitamin B1', 8.25, 'mg'],
      ['Folate', 95, 'mcg'],
      ['Biotin', 16.5, 'mcg'],
      ['Zinc', 3.75, 'mg'],
    ])
    expect(r.unparsed).toEqual([])
  })

  it('reads "contains 600 mg of vitamin C" and refuses the surrounding sentences', () => {
    const r = parseRecipe(
      '100% pure vitamin C (ascorbic acid). Each ⅛ teaspoon contains 600 mg of vitamin C. No fillers or excipients.',
    )
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([['Vitamin C', 600, 'mg']])
    expect(r.unparsed).toEqual(['No fillers or excipients'])
  })

  it('drops a preamble sentence in front of the ingredient', () => {
    const r = parseRecipe(
      'Each softgel contains: 100% natural mixed carotenoids from red palm fruit. beta-Carotene (provitamin A) (15 mg) 25,000 IU Also contains alpha-carotene.',
    )
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([['beta-Carotene', 25000, 'IU']])
  })

  it('trims standardization qualifiers so long extract names still parse', () => {
    const r = parseRecipe(
      'Each vegetable capsule contains: Reishi (Ganoderma lucidum) fruiting body extract, standardized to 40% polysaccharides, providing 30% beta-glucans500 mg Hot-water extraction Other ingredients: Vegetable magnesium stearate.',
    )
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['Reishi fruiting body extract', 500, 'mg'],
    ])
    expect(r.unparsed).toEqual(['Hot-water extraction'])
  })

  it('recovers from a parenthesis that never closes', () => {
    const r = parseRecipe(
      'Each teaspoon contains: Fish oil (from wild, deep-sea whole anchovies (Engraulidae) and/or whole sardines (Clupeidae)4,500 mg Providing: Eicosapentaenoic acid (EPA)900 mg Docosahexaenoic acid (DHA)600 mg Other ingredients: Natural lemon flavour.',
    )
    expect(r.servingSize).toBe('1 teaspoon')
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Fish oil', 4500],
      ['Eicosapentaenoic acid', 900],
      ['Docosahexaenoic acid', 600],
    ])
  })

  it('drops a footnote glued to the first item and its asterisks', () => {
    const r = parseRecipe(
      'Each vegetable capsule contains: * Each mushroom extract is standardized to 40% polysaccharides Chaga (Inonotus obliquus) mushroom extract*68 mg Coriolus (Trametes versicolor) mushroom extract*68 mg Other ingredients: cellulose.',
    )
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Chaga mushroom extract', 68],
      ['Coriolus mushroom extract', 68],
    ])
    expect(r.unparsed).toEqual([])
  })

  it('drops a labelled group heading glued to its first item', () => {
    const r = parseRecipe(
      'Each capsule contains: Kola nut (Cola acuminata) extract, 10% caffeine510 mg *100% of the RDA of the following: Vitamin B3 (niacinamide)20 mg Vitamin B6 (pyridoxine hydrochloride)2 mg Other ingredients: cellulose.',
    )
    expect(r.items.map((i) => [i.name, i.amount])).toEqual([
      ['Kola nut extract, 10% caffeine', 510],
      ['Vitamin B3', 20],
      ['Vitamin B6', 2],
    ])
  })
})

describe('parseRecipe — foods', () => {
  it('reads only the serving size from a Nutrition Facts table', () => {
    const r = parseRecipe(
      'Grass-fed beef bone broth protein powder. Nutrition Facts Per 3 rounded tbsp. (30 g) Calories 110 % Daily Value* Fat 0 g0 % Saturated 0 g0 % + Trans 0 g Carbohydrate 1 g0 % Fibre 1 g4 % Sugars 0 g Protein 27 g Cholesterol 0 mg Sodium 300 mg13 % Vitamin B12 0.9 ug 38 %',
    )
    expect(r.nutritionFacts).toBe(true)
    expect(r.servingSize).toBe('3 rounded tbsp. (30 g)')
    expect(r.items).toEqual([])
    expect(r.unparsed).toEqual([])
  })

  it('still reads a medicinal list that follows a Nutrition Facts table', () => {
    const r = parseRecipe(
      'Nutrition Facts Serving size: approx. 1 Tbsp. (16 ml)Servings per container: 16 Calories 48 Fat 0 g Medicinal ingredients: Olive (Olea europaea) leaf extract 500 mg Other ingredients: Water.',
    )
    expect(r.servingSize).toBe('1 Tbsp. (16 ml)')
    expect(r.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ['Olive leaf extract', 500, 'mg'],
    ])
  })
})
