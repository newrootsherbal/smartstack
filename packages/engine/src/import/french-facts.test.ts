import { describe, expect, it } from 'vitest'
import { alignFrenchNames, cleanFrenchName, frenchFactsToParserInput } from './french-facts'
import { parseRecipe } from './recipe'

describe('frenchFactsToParserInput', () => {
  it('rewrites French numerals, units and section words for the English parser', () => {
    const text = frenchFactsToParserInput(
      'Chaque gélule contient : Huile de poisson1?414 mg Vitamines : E (20 UI)13,38 mg AT ' +
        'D3 (1 000 UI)25 mcg Lactobacillus acidophilus R0418 605 millions d’UFC ' +
        'Lactobacillus rhamnosus R0011 4,4 milliards d’UFC (11 milliards) Broméline ' +
        '(3 600 000 UP FCC) Autres ingrédients : gélatine.',
    )
    expect(text).toContain('Each gélule contient : Huile de poisson1414 mg')
    expect(text).toContain('Vitamins: E (20 IU)13.38 mg AT')
    expect(text).toContain('D3 (1000 IU)25 mcg')
    expect(text).toContain('R0418 605 million CFU')
    expect(text).toContain('R0011 4.4 billion CFU (11 billion)')
    expect(text).toContain('(3600000 UP FCC)')
    expect(text).toContain('Other ingredients : gélatine.')
  })

  it('leaves strain codes, vitamin names and extract ratios alone when merging thousands', () => {
    expect(frenchFactsToParserInput('Bifidobacterium breve R0070 330 millions d’UFC')).toBe(
      'Bifidobacterium breve R0070 330 million CFU',
    )
    expect(frenchFactsToParserInput('B12 1 000 mcg')).toBe('B12 1000 mcg')
    expect(frenchFactsToParserInput('extrait 10:1 200 mg')).toBe('extrait 10:1 200 mg')
  })

  it('turns qualifier words into the English ones the parser strips', () => {
    expect(
      frenchFactsToParserInput(
        'Extrait de champignon reishi standardisé à 40 % de polysaccharides, fournissant 30 % de bêta‑glucanes30 mg',
      ),
    ).toBe(
      'Extrait de champignon reishi standardized à 40 % de polysaccharides, providing 30 % de bêta‑glucanes30 mg',
    )
  })
})

describe('cleanFrenchName', () => {
  it('drops qualifiers and leading connectors, and keeps French decimals', () => {
    expect(
      cleanFrenchName('Extrait de racine de curcuma, 95 % de curcuminoïdes, providing curcumine I'),
    ).toBe('Extrait de racine de curcuma, 95 % de curcuminoïdes')
    expect(cleanFrenchName('Extrait de reishi standardized à 40 %')).toBe('Extrait de reishi')
    expect(cleanFrenchName('et Quercétine')).toBe('Quercétine')
    expect(cleanFrenchName('Extrait de racine d’ashwagandha, 2.5 % de withanolides')).toBe(
      'Extrait de racine d’ashwagandha, 2,5 % de withanolides',
    )
  })
})

describe('alignFrenchNames', () => {
  const en = parseRecipe(
    'Each softgel contains: Fish oil (from wild anchovies [Engraulidae])1,414 mg Providing: ' +
      'Eicosapentaenoic acid (EPA)660 mg Docosahexaenoic acid (DHA)330 mg Other ingredients: gelatin.',
  )

  it('names every English item from the French text when the amounts line up', () => {
    const fr =
      'Chaque gélule contient : Huile de poisson (provenant d’anchois [Engraulidae] sauvages)1?414 mg ' +
      'Fournissant : Acide eicosapentaénoïque (AEP)660 mg Acide docosahexaénoïque (ADH)330 mg ' +
      'Autres ingrédients : gélatine.'
    expect(en.items.map((i) => i.name)).toEqual([
      'Fish oil',
      'Eicosapentaenoic acid',
      'Docosahexaenoic acid',
    ])
    expect(alignFrenchNames(en.items, fr)).toEqual([
      'Huile de poisson',
      'Acide eicosapentaénoïque',
      'Acide docosahexaénoïque',
    ])
  })

  it('pairs by amount when the French list is in another order', () => {
    const fr =
      'Chaque gélule contient : Acide docosahexaénoïque330 mg Acide eicosapentaénoïque660 mg ' +
      'Huile de poisson1?414 mg'
    expect(alignFrenchNames(en.items, fr)).toEqual([
      'Huile de poisson',
      'Acide eicosapentaénoïque',
      'Acide docosahexaénoïque',
    ])
  })

  it('skips items whose amount is repeated, since order alone cannot tell them apart', () => {
    const herbs = parseRecipe(
      'Each capsule contains: Birch leaf100 mg Uva ursi leaf100 mg Nettle leaf50 mg',
    )
    const fr =
      'Chaque capsule contient : Feuille de busserole100 mg Feuille de bouleau100 mg ' +
      'Feuille d’ortie50 mg'
    expect(alignFrenchNames(herbs.items, fr)).toEqual([undefined, undefined, 'Feuille d’ortie'])
  })

  it('reads a multi with bare vitamin letters, sections and a standardized extract', () => {
    const multiEn = parseRecipe(
      'Each vegetable capsule contains: Vitamins: C (from 80 mg calcium ascorbate)56 mg ' +
        'B1 (thiamine hydrochloride)50 mg Minerals: Magnesium (from magnesium citrate)35 mg ' +
        'Lutein (from marigold)2 mg Reishi extract, standardized to 40% polysaccharides30 mg ' +
        'Other ingredients: cellulose.',
    )
    const multiFr =
      'Chaque capsule végétale contient : Vitamines : C (de 80 mg d’ascorbate de calcium)56 mg ' +
      'B1 (chlorhydrate de thiamine)50 mg Minéraux : Magnésium (de citrate de magnésium)35 mg ' +
      'Lutéine (de souci)2 mg Extrait de reishi normalisé à 40 % de polysaccharides30 mg ' +
      'Autres ingrédients : cellulose.'
    expect(multiEn.items.map((i) => i.name)).toEqual([
      'Vitamin C',
      'Vitamin B1',
      'Magnesium',
      'Lutein',
      'Reishi extract',
    ])
    expect(alignFrenchNames(multiEn.items, multiFr)).toEqual([
      'Vitamin C',
      'Vitamin B1',
      'Magnésium',
      'Lutéine',
      'Extrait de reishi',
    ])
  })

  it('returns nothing when the item count, an amount or a unit differs', () => {
    expect(
      alignFrenchNames(
        en.items,
        'Chaque gélule contient : Huile de poisson1?414 mg Acide eicosapentaénoïque660 mg',
      ),
    ).toEqual([])
    expect(
      alignFrenchNames(
        en.items,
        'Chaque gélule contient : Huile de poisson1?414 mg Acide eicosapentaénoïque660 mg ' +
          'Acide docosahexaénoïque300 mg',
      ),
    ).toEqual([])
    expect(
      alignFrenchNames(
        en.items,
        'Chaque gélule contient : Huile de poisson1?414 mg Acide eicosapentaénoïque660 mcg ' +
          'Acide docosahexaénoïque330 mg',
      ),
    ).toEqual([])
    expect(alignFrenchNames(en.items, undefined)).toEqual([])
    expect(alignFrenchNames([], 'Chaque gélule contient : Huile de poisson1?414 mg')).toEqual([])
  })
})
