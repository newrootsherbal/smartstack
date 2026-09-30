/**
 * Health Canada prefill for the Other brand form (§4.7): `GET /api/lookup/npn/:npn` (Licensed
 * Natural Health Products Database) and `GET /api/lookup/din/:din` (Drug Product Database),
 * proxied and mapped by the Worker. The person reviews everything before saving.
 */
import { z } from 'zod'
import { MAX_DOSES_PER_DAY } from './limits'

/** An NPN or a DIN: exactly 8 digits. */
export const LOOKUP_NUMBER_RE = /^\d{8}$/
export const LookupNumber = z.string().regex(LOOKUP_NUMBER_RE)

export const LOOKUP_LANGS = ['en', 'fr'] as const
export type LookupLang = (typeof LOOKUP_LANGS)[number]

/** Units the Other brand form offers for an ingredient amount. */
export const INGREDIENT_UNITS = ['mg', 'mcg', 'IU', 'CFU', 'g', 'ml'] as const
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number]

/** Dose units of the Other brand form (the engine's `unitLabel` words, plus g, gummy, other). */
export const DOSE_UNITS = [
  'capsule',
  'tablet',
  'softgel',
  'drop',
  'ml',
  'g',
  'scoop',
  'teaspoon',
  'tablespoon',
  'gummy',
  'other',
] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

export const PREFILL_FORMS = ['capsule', 'tablet', 'softgel', 'powder', 'liquid', 'other'] as const

export const PrefillIngredient = z.object({
  /** As Health Canada names it, in the requested language (cut at 120 characters). */
  name: z.string().min(1).max(120),
  /**
   * Per dosage unit (one capsule, one tablet, one ml…) as licensed; null when Health Canada
   * gives none or gives it per another quantity.
   */
  amount: z.number().positive().nullable(),
  /** One of INGREDIENT_UNITS when recognized, otherwise Health Canada's word (≤ 12 characters). */
  unit: z.string().min(1).max(12).nullable(),
})
export type PrefillIngredient = z.infer<typeof PrefillIngredient>

export const PrefillDose = z.object({
  /** Units per dose; the lower bound of a range ("1 to 2 capsules" → 1). */
  amount: z.number().positive(),
  unit: z.enum(DOSE_UNITS),
  /** Times per day (lower bound of a range); null unless licensed per day and 1–4. */
  frequency: z.number().int().min(1).max(MAX_DOSES_PER_DAY).nullable(),
})
export type PrefillDose = z.infer<typeof PrefillDose>

export const ProductPrefill = z.object({
  source: z.enum(['lnhpd', 'dpd']),
  npn: z.string().regex(LOOKUP_NUMBER_RE).nullable(),
  din: z.string().regex(LOOKUP_NUMBER_RE).nullable(),
  /** Product name (NPN) or brand name (DIN), as licensed (DIN names are in capitals). */
  name: z.string().min(1).max(120),
  /** The licence holder (NPN) or the company (DIN): the form's Brand / Company field. */
  brand: z.string().min(1).max(80).nullable(),
  form: z.enum(PREFILL_FORMS).nullable(),
  /** Medications with one active ingredient: "25 mcg", or "125 mg / 5 ml" for liquids. */
  strength: z.string().min(1).max(40).nullable(),
  /** Natural health products only (adults' dose when several populations are licensed). */
  dose: PrefillDose.nullable(),
  ingredients: z.array(PrefillIngredient).max(40),
  /** A follow-up call failed: ingredients, dose or form may be missing; the rest is right. */
  partial: z.boolean(),
})
export type ProductPrefill = z.infer<typeof ProductPrefill>
