/**
 * Parser for the label's suggested use, e.g.
 * "Adults: Take 1 capsule daily with food or as directed by your health-care practitioner."
 * Produces the default times per day, units per occasion and the timing hints the
 * label states. Heuristic by design: everything it emits is `unreviewed`.
 */
import { MAX_DOSES_PER_DAY, type RuleAttribute } from '@smartstack/shared'

export type TimingAttribute = Extract<
  RuleAttribute,
  'WITH_FOOD' | 'WITHOUT_FOOD' | 'BEDTIME' | 'MORNING' | 'TAKE_WITH_WATER'
>

export interface SuggestedUseParse {
  dosesPerDay: number
  unitsPerDose: number | null
  /** Singular unit word as printed: "capsule", "softgel", "teaspoon"… */
  unitLabel: string | null
  /** Timing hints found, each with the label sentence that states it. */
  timing: { attribute: TimingAttribute; sentence: string }[]
}

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  once: 1,
  twice: 2,
}

const num = (s: string | undefined): number | null => {
  if (!s) return null
  const w = s.toLowerCase()
  if (w in WORDS) return WORDS[w]!
  if (w === '½' || w === '¼') return 0.5
  const n = Number.parseInt(w, 10)
  return Number.isFinite(n) ? n : null
}

const TIMING: [TimingAttribute, RegExp][] = [
  ['WITH_FOOD', /\bwith (?:a |your )?(?:meals?|food|breakfast|dinner|supper|lunch)\b/i],
  [
    'WITHOUT_FOOD',
    /\bempty stomach\b|\bwithout food\b|\bbetween meals\b|\bbefore (?:a |your )?meals?\b/i,
  ],
  ['BEDTIME', /\bbedtime\b|\bbefore (?:going to )?bed\b|\bat night\b|\bbefore sleep\b/i],
  ['MORNING', /\bin the morning\b|\bupon (?:waking|rising)\b|\bon rising\b/i],
  ['TAKE_WITH_WATER', /\bwith (?:a (?:full |large )?glass of |plenty of )?water\b/i],
]

const FRENCH: Record<TimingAttribute, RegExp> = {
  WITH_FOOD:
    /avec (?:de la )?nourriture|avec (?:un|les|des|le|vos) repas|en mangeant|au moment des repas/i,
  WITHOUT_FOOD: /à jeun|entre les repas|estomac vide|avant (?:les|le) repas/i,
  BEDTIME: /au coucher|avant (?:de )?(?:se coucher|dormir|le coucher)|le soir/i,
  MORNING: /le matin|au réveil|au lever/i,
  TAKE_WITH_WATER: /avec (?:de l[’']eau|un (?:grand )?verre d[’']eau|beaucoup d[’']eau)/i,
}

const EXOTIC_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, 'g')

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseSuggestedUse(text: string): SuggestedUseParse {
  const clean = text.replace(EXOTIC_SPACES, ' ').replace(/\s+/g, ' ').trim()

  // Units per occasion: the first "Take N <unit>" (a range keeps its low end).
  const take =
    /\btake\s+(\d+|½|¼|one|two|three|four|five|six)(?:\s*(?:[–‑-]|to)\s*(?:\d+|one|two|three|four|five|six))?\s+(?:\([^)]*\)\s*)?([a-zA-Z]+)/i.exec(
      clean,
    )
  let unitsPerDose: number | null = null
  let unitLabel: string | null = null
  if (take) {
    unitsPerDose = num(take[1])
    unitLabel = take[2]!.toLowerCase().replace(/s$/, '')
    if (
      !/^(capsule|softgel|tablet|caplet|drop|teaspoon|tablespoon|scoop|ml|sachet|lozenge|chewable|ovule|dose|serving|cup|bag)$/.test(
        unitLabel,
      )
    ) {
      unitLabel = null
      unitsPerDose = null
    }
  }

  // Times per day: first frequency phrase after the first "Take".
  const afterTake = take ? clean.slice(take.index) : clean
  let dosesPerDay = 1
  const times =
    /\b(\d+|one|two|three|four|five|six)(?:\s*(?:[–‑-]|to|or)\s*(?:\d+|one|two|three|four|five|six))?\s+times?\s+(?:daily|a day|per day)\b/i.exec(
      afterTake,
    )
  const twice = /\b(twice|once)\s+(?:daily|a day|per day)\b/i.exec(afterTake)
  const every = /\bevery\s+(\d+)\s*(?:to\s*\d+\s*)?hours?\b/i.exec(afterTake)
  const pick = [times, twice, every].filter(Boolean).sort((a, b) => a!.index - b!.index)[0]
  if (pick === times && times) dosesPerDay = num(times[1]) ?? 1
  else if (pick === twice && twice) dosesPerDay = num(twice[1]) ?? 1
  else if (pick === every && every) dosesPerDay = Math.max(1, Math.round(24 / Number(every[1])))
  dosesPerDay = Math.min(Math.max(dosesPerDay, 1), MAX_DOSES_PER_DAY)

  const sentences = splitSentences(clean)
  const timing: SuggestedUseParse['timing'] = []
  for (const [attribute, re] of TIMING) {
    const sentence = sentences.find((s) => re.test(s))
    if (sentence) timing.push({ attribute, sentence })
  }
  // "with water or juice" is not a meal; "with food" wins over "with water" only when both exist.
  return { dosesPerDay, unitsPerDose, unitLabel, timing }
}

/** The French sentence stating the same hint, when one can be found. */
export function frenchSentenceFor(
  attribute: TimingAttribute,
  frText: string | undefined,
): string | undefined {
  if (!frText) return undefined
  return splitSentences(frText).find((s) => FRENCH[attribute].test(s))
}
