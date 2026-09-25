// @smartstack/shared — types and zod schemas shared by the engine, the web app and the Worker.
// Exported as TypeScript source (no build step).
import { z } from 'zod'

export const SHARED_VERSION = '0.1.0'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** "HH:MM", 24-hour, zero-padded. All routine times are local wall-clock times. */
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const HHMM = z.string().regex(HHMM_RE, 'expected HH:MM (24-hour)')
export type HHMM = z.infer<typeof HHMM>

/** Text with English required and French optional (Phase 1 ships English only). */
export const LocalizedText = z.object({
  en: z.string().min(1),
  fr: z.string().optional(),
})
export type LocalizedText = z.infer<typeof LocalizedText>

/** ISO calendar date, e.g. 2026-09-24. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

// ---------------------------------------------------------------------------
// Severity — exactly the pitch document's five levels.
// ---------------------------------------------------------------------------

export const SEVERITIES = [
  'important', // red — "Action required" (medication interactions; out of scope for seed data)
  'timing_conflict', // orange — "Action recommended"
  'consideration', // yellow
  'product_instruction', // blue — copied from the real label (never in seed data)
  'informational', // outline
] as const
export const Severity = z.enum(SEVERITIES)
export type Severity = z.infer<typeof Severity>

/** Severities allowed in unreviewed seed data. */
export const SEED_SEVERITIES = ['timing_conflict', 'consideration', 'informational'] as const

// ---------------------------------------------------------------------------
// Review metadata — present on every product and rule.
// ---------------------------------------------------------------------------

export const ReviewStatus = z.enum(['unreviewed', 'in_review', 'reviewed'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

export const ReviewFields = z.object({
  reviewStatus: ReviewStatus,
  /** ISO date of the last review, or null when never reviewed. */
  lastReviewed: IsoDate.nullable(),
  /** Reviewer name or team, or null when never reviewed. */
  reviewedBy: z.string().min(1).nullable(),
})
export type ReviewFields = z.infer<typeof ReviewFields>

// ---------------------------------------------------------------------------
// Catalogue: ingredients, products, rules (static JSON in packages/engine/data)
// ---------------------------------------------------------------------------

/**
 * Canonical units. No unit conversion in Phase 1.
 * CFU is included because probiotics cannot be expressed in mg / mcg / IU.
 */
export const UNITS = ['mg', 'mcg', 'IU', 'CFU'] as const
export const Unit = z.enum(UNITS)
export type Unit = z.infer<typeof Unit>

export const Ingredient = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  unit: Unit,
})
export type Ingredient = z.infer<typeof Ingredient>

export const ProductIngredient = z.object({
  ingredientId: z.string().min(1),
  /** Amount per single dose, in the ingredient's canonical unit. */
  amountPerDose: z.number().positive(),
})
export type ProductIngredient = z.infer<typeof ProductIngredient>

export const ProductStatus = z.enum(['sample', 'draft', 'reviewed'])
export type ProductStatus = z.infer<typeof ProductStatus>

/** A product may switch off rules inherited from its ingredients. */
export const RuleOverrides = z.object({
  /** Rule ids that must not apply to this product. */
  disable: z.array(z.string().min(1)).optional(),
})
export type RuleOverrides = z.infer<typeof RuleOverrides>

export const MAX_DOSES_PER_DAY = 4

/** One retail size of a product. All variants share the recipe, NPN and rules. */
export const ProductVariant = z.object({
  sku: z.string().min(1),
  /** Digits only: 12-digit UPC-A or 13-digit EAN-13. */
  upc: z.string().regex(/^\d{12,13}$/),
  size: LocalizedText.optional(),
  format: LocalizedText.optional(),
})
export type ProductVariant = z.infer<typeof ProductVariant>

export const Product = z
  .object({
    id: z.string().min(1),
    /** Primary SKU (first variant). */
    sku: z.string().min(1),
    /** Primary barcode as printed: 12-digit UPC-A or 13-digit EAN-13. */
    upc: z.string().regex(/^\d{12,13}$/),
    /** Natural Product Number; absent for foods, sweeteners, essential and skin oils. */
    npn: z.string().min(1).optional(),
    /**
     * nhp: licensed natural health product · food: ingested but not licensed (protein,
     * MCT oil, sweeteners) · topical: essential and skin oils, never scheduled.
     */
    kind: z.enum(['nhp', 'food', 'topical']).default('nhp'),
    brand: z.string().min(1),
    name: LocalizedText,
    /** Short label for schedule rows, push titles and adjustment sentences, e.g. "Iron". */
    shortName: LocalizedText,
    /** Label subtitle, e.g. "35 mg Elemental Iron". */
    subtitle: LocalizedText.optional(),
    form: z.enum(['capsule', 'tablet', 'softgel', 'powder', 'liquid', 'other']),
    servingSize: z.string().min(1),
    /** Times per day suggested on the label (occasions, not units). */
    dosesPerDayDefault: z.number().int().min(1).max(MAX_DOSES_PER_DAY),
    /** Units per occasion suggested on the label, e.g. 2 (capsules). */
    unitsPerDose: z.number().positive().optional(),
    /** The label's own unit word for one dose, singular, e.g. "drop", "teaspoon". */
    unitLabel: z.string().min(1).optional(),
    /**
     * Label text. Inline for small catalogues (sample fixtures, CSV imports); the
     * website import keeps it in a separate, lazily loaded file to keep the bundle small.
     */
    directions: LocalizedText.optional(),
    warnings: LocalizedText.optional(),
    status: ProductStatus,
    labelVersion: z.string().min(1),
    /** May be empty when the label lists no medicinal ingredient the importer can read. */
    ingredients: z.array(ProductIngredient),
    variants: z.array(ProductVariant).optional(),
    ruleOverrides: RuleOverrides.optional(),
    /** Public product page the data was imported from. */
    sourceUrl: z.url().optional(),
    sourceUpdatedAt: z.string().optional(),
  })
  .extend(ReviewFields.shape)
export type Product = z.infer<typeof Product>

export const RULE_ATTRIBUTES = [
  'WITH_FOOD',
  'WITHOUT_FOOD',
  'WITH_FAT',
  'MORNING',
  'EVENING',
  'BEDTIME',
  'SEPARATE_FROM_CALCIUM',
  'SEPARATE_FROM_IRON',
  'SEPARATE_FROM_COFFEE_TEA',
  'TAKE_WITH_WATER',
  'REFRIGERATE',
] as const
export const RuleAttribute = z.enum(RULE_ATTRIBUTES)
export type RuleAttribute = z.infer<typeof RuleAttribute>

/** Anchors a dose can be attached to. Coffee is a conflict source, never an anchor. */
export const ANCHORS = ['breakfast', 'lunch', 'dinner', 'bedtime'] as const
export const Anchor = z.enum(ANCHORS)
export type Anchor = z.infer<typeof Anchor>

export const MEAL_ANCHORS = ['breakfast', 'lunch', 'dinner'] as const
export const MealAnchor = z.enum(MEAL_ANCHORS)
export type MealAnchor = z.infer<typeof MealAnchor>

export const RuleTarget = z.union([
  z.object({ ingredientId: z.string().min(1) }),
  z.object({ productId: z.string().min(1) }),
])
export type RuleTarget = z.infer<typeof RuleTarget>

export const TimingRule = z
  .object({
    id: z.string().min(1),
    attribute: RuleAttribute,
    appliesTo: RuleTarget,
    severity: Severity,
    /** Required for SEPARATE_FROM_* attributes. */
    separationMinutes: z.number().int().positive().optional(),
    /** Ordered meal preferences for WITH_FOOD / WITH_FAT. */
    preferredAnchors: z.array(MealAnchor).min(1).optional(),
    explanation: LocalizedText,
    /** A real public URL, or null rendered as "Source: to be added". Never invented. */
    evidenceUrl: z.url().nullable(),
  })
  .extend(ReviewFields.shape)
export type TimingRule = z.infer<typeof TimingRule>

export const Catalogue = z.object({
  ingredients: z.array(Ingredient),
  products: z.array(Product),
  rules: z.array(TimingRule),
})
export type Catalogue = z.infer<typeof Catalogue>

// ---------------------------------------------------------------------------
// User data (browser localStorage is the source of truth)
// ---------------------------------------------------------------------------

export const ROUTINE_KEYS = [
  'wake',
  'coffee',
  'breakfast',
  'lunch',
  'dinner',
  'exercise',
  'bedtime',
] as const
export type RoutineKey = (typeof ROUTINE_KEYS)[number]

/**
 * Daily routine. Wake and bedtime are required. Optional anchors are `null` when
 * the user toggles "I don't…". At least one meal is required.
 */
export const Routine = z
  .object({
    wake: HHMM,
    bedtime: HHMM,
    coffee: HHMM.nullable(),
    breakfast: HHMM.nullable(),
    lunch: HHMM.nullable(),
    dinner: HHMM.nullable(),
    exercise: HHMM.nullable(),
  })
  .refine((r) => r.breakfast !== null || r.lunch !== null || r.dinner !== null, {
    message: 'at least one meal is required',
    path: ['breakfast'],
  })
export type Routine = z.infer<typeof Routine>

export const StackItem = z.object({
  productId: z.string().min(1),
  dosesPerDay: z.number().int().min(1).max(MAX_DOSES_PER_DAY),
})
export type StackItem = z.infer<typeof StackItem>

export const Stack = z.array(StackItem)
export type Stack = z.infer<typeof Stack>

// ---------------------------------------------------------------------------
// Engine output (structured; the UI renders everything through i18n)
// ---------------------------------------------------------------------------

export const ADJUSTMENT_CODES = [
  'MOVED_AWAY_FROM_INGREDIENT',
  'MOVED_AWAY_FROM_COFFEE_TEA',
  'MOVED_TO_MEAL',
  'MOVED_TO_MORNING',
  'MOVED_TO_EVENING',
  'MOVED_TO_BEDTIME',
] as const
export type AdjustmentCode = (typeof ADJUSTMENT_CODES)[number]

export interface ReasonParams {
  /** Anchor the rule attached the dose to, when any. */
  anchor?: Anchor | null
  separationMinutes?: number
  /** For SEPARATE_FROM_<ingredient>: the ingredient kept apart. */
  otherIngredientId?: string
  /** Products in the stack that triggered a separation rule. */
  otherProductIds?: string[]
}

export interface Reason {
  ruleId: string
  attribute: RuleAttribute
  severity: Severity
  productId: string
  /** The dose this reason belongs to (a placement can hold several doses of one product). */
  doseIndex: number
  params: ReasonParams
}

export interface PlacedDose {
  productId: string
  /** 0-based index of this dose within the product's day, in time order. */
  doseIndex: number
}

export interface Placement {
  /** Local wall-clock time, "HH:MM". */
  time: HHMM
  /** Minutes since local midnight. */
  minutes: number
  anchor: Anchor | null
  productIds: string[]
  doses: PlacedDose[]
  reasons: Reason[]
}

export interface Adjustment {
  code: AdjustmentCode
  productId: string
  ruleId: string
  params: ReasonParams & { from: HHMM; to: HHMM }
}

export interface DuplicateEntry {
  productId: string
  amountPerDose: number
  dosesPerDay: number
  dailyAmount: number
}

export interface DuplicateIngredient {
  ingredientId: string
  unit: Unit
  entries: DuplicateEntry[]
  total: number
}

export interface Schedule {
  placements: Placement[]
  adjustments: Adjustment[]
  duplicates: DuplicateIngredient[]
}

// ---------------------------------------------------------------------------
// API contracts (/api/me/…, bearer UUID). Validated by the Worker, reused by the client.
// ---------------------------------------------------------------------------

export const Platform = z.enum(['ios', 'android', 'desktop'])
export type Platform = z.infer<typeof Platform>

export const PutMeBody = z.object({
  /** IANA time zone, e.g. America/Toronto. */
  tz: z.string().min(1).max(64),
  platform: Platform,
})
export type PutMeBody = z.infer<typeof PutMeBody>

export const PushSubscriptionBody = z.object({
  endpoint: z.url().startsWith('https://'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
})
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>

export const MAX_ACTIVE_REMINDERS = 200
export const MAX_SUBSCRIPTIONS_PER_USER = 5
export const MAX_TITLE_LENGTH = 60
export const MAX_BODY_LENGTH = 100
export const MAX_SLOT_KEY_LENGTH = 32

export const ReminderInput = z.object({
  /** Epoch milliseconds, computed in the browser per local calendar day. */
  scheduledAt: z.number().int().positive(),
  /** ≤ 32 chars; unique per (user, scheduledAt). Also used as the push `topic`. */
  slotKey: z.string().min(1).max(MAX_SLOT_KEY_LENGTH),
  productIds: z.array(z.string().min(1)).min(1).max(20),
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
})
export type ReminderInput = z.infer<typeof ReminderInput>

export const PutScheduleBody = z.object({
  reminders: z.array(ReminderInput).max(MAX_ACTIVE_REMINDERS),
})
export type PutScheduleBody = z.infer<typeof PutScheduleBody>

/** Optional text for the test reminder (composed in the browser from en.json). */
export const TestReminderBody = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
  body: z.string().min(1).max(MAX_BODY_LENGTH).optional(),
})
export type TestReminderBody = z.infer<typeof TestReminderBody>

export const ApiError = z.object({
  error: z.string(),
  detail: z.unknown().optional(),
})
export type ApiError = z.infer<typeof ApiError>
