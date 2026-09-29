/**
 * What a person keeps: stack entries with their bottle, the shopping list, their own
 * products and the health profile. Stored on the device (guests) and synced to D1
 * (accounts). Every synced entity carries `updatedAt` (device clock, last write wins).
 */
import { z } from 'zod'
import { MAX_DOSES_PER_DAY } from './limits'

// ---------------------------------------------------------------------------
// Bottles
// ---------------------------------------------------------------------------

/** Capsules, softgels and tablets are counted one by one; liquids and powders in servings. */
export const INVENTORY_UNITS = ['unit', 'serving'] as const
export const InventoryUnit = z.enum(INVENTORY_UNITS)
export type InventoryUnit = z.infer<typeof InventoryUnit>

/** Days of use left at which a bottle is "running low" and joins the shopping list. */
export const LOW_STOCK_DAYS = 5

export const Inventory = z.object({
  /** Units or servings left (decimals allowed for servings). */
  remaining: z.number().min(0),
  unit: InventoryUnit,
  /** A full bottle: the default refill amount. Null when unknown. */
  packageSize: z.number().positive().nullable(),
  /** When this bottle was flagged "running low" (cleared on refill); null = not flagged. */
  lowFlaggedAt: z.number().nullable(),
})
export type Inventory = z.infer<typeof Inventory>

// ---------------------------------------------------------------------------
// Shopping list
// ---------------------------------------------------------------------------

/** low: added when the bottle ran low · manual: added by the person · alternative: a suggestion. */
export const SHOPPING_REASONS = ['low', 'manual', 'alternative'] as const
export const ShoppingReason = z.enum(SHOPPING_REASONS)
export type ShoppingReason = z.infer<typeof ShoppingReason>

export const ShoppingItem = z.object({
  productId: z.string().min(1),
  reason: ShoppingReason,
  /** For `alternative`: the other-brand product it would replace. */
  replacesProductId: z.string().min(1).optional(),
  addedAt: z.number(),
  updatedAt: z.number(),
})
export type ShoppingItem = z.infer<typeof ShoppingItem>

// ---------------------------------------------------------------------------
// Products the person adds by hand (accounts only): other brands, medications, foods
// ---------------------------------------------------------------------------

/** Ids of the person's own products; never used by bundled catalogue data. */
export const USER_PRODUCT_ID_PREFIX = 'u_'
/** Ids of the label rules built on the device: `user:{productId}:{attribute}`. */
export const USER_RULE_ID_PREFIX = 'user:'

export const USER_PRODUCT_TYPES = ['nhp', 'medication', 'food', 'other'] as const
export const UserProductType = z.enum(USER_PRODUCT_TYPES)
export type UserProductType = z.infer<typeof UserProductType>

export const USER_PRODUCT_TIMINGS = [
  'WITH_FOOD',
  'WITHOUT_FOOD',
  'MORNING',
  'EVENING',
  'BEDTIME',
] as const
export const UserProductTiming = z.enum(USER_PRODUCT_TIMINGS)
export type UserProductTiming = z.infer<typeof UserProductTiming>

export const UserProductIngredient = z.object({
  /** Canonical ingredient id when recognized; null = free text (shown, not used by rules). */
  ingredientId: z.string().min(1).nullable(),
  name: z.string().min(1).max(120),
  amount: z.number().positive().nullable(),
  unit: z.string().min(1).max(12).nullable(),
})
export type UserProductIngredient = z.infer<typeof UserProductIngredient>

export const UserProduct = z.object({
  /** 'u_' + UUID, created on the device. */
  id: z.string().regex(/^u_[0-9a-f-]{36}$/),
  productType: UserProductType,
  /** Required except for medications (the company is optional). */
  brand: z.string().min(1).max(80).nullable(),
  name: z.string().min(1).max(120),
  upc: z
    .string()
    .regex(/^\d{8,13}$/)
    .nullable(),
  npn: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  din: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
  strength: z.string().min(1).max(40).nullable(),
  form: z.enum(['capsule', 'tablet', 'softgel', 'powder', 'liquid', 'other']),
  doseUnit: z.string().min(1).max(20),
  unitsPerDose: z.number().positive(),
  dosesPerDay: z.number().int().min(1).max(MAX_DOSES_PER_DAY),
  packageQuantity: z.number().positive().nullable(),
  packageUnit: z.enum(['unit', 'ml', 'g']).nullable(),
  timing: z.array(UserProductTiming),
  ingredients: z.array(UserProductIngredient).max(40),
  directions: z.string().max(1000).nullable(),
  warnings: z.string().max(1000).nullable(),
  notes: z.string().max(1000).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type UserProduct = z.infer<typeof UserProduct>

// ---------------------------------------------------------------------------
// Health profile (accounts only; sensitive, express consent)
// ---------------------------------------------------------------------------

/** Condition codes by group. Codes are stable; the labels live in the dictionaries. */
export const HEALTH_CONDITION_GROUPS = {
  heart: ['high_blood_pressure', 'high_cholesterol', 'heart_disease'],
  metabolism: ['type2_diabetes', 'prediabetes', 'thyroid'],
  digestion: ['ibs', 'gerd', 'ibd', 'celiac'],
  bones: ['osteoporosis', 'arthritis'],
  mind: ['anxiety', 'depression', 'sleep_trouble'],
  other: [
    'migraine',
    'iron_deficiency_anemia',
    'kidney_disease',
    'liver_disease',
    'pcos',
    'menopause',
    'asthma',
    'eczema_psoriasis',
    'autoimmune',
  ],
} as const
export const HEALTH_CONDITIONS = Object.values(HEALTH_CONDITION_GROUPS).flat()
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number]

export const HEALTH_GOALS = [
  'sleep',
  'stress',
  'energy',
  'immunity',
  'digestion',
  'heart',
  'joints_bones',
  'brain_focus',
  'skin_hair_nails',
  'sports',
  'weight',
  'healthy_aging',
  'womens_health',
  'mens_health',
  'prenatal',
] as const
export type HealthGoal = (typeof HEALTH_GOALS)[number]

export const DIETS = ['vegan', 'vegetarian', 'gluten_free', 'dairy_free', 'low_carb'] as const
export const AVOIDS = ['soy', 'dairy', 'gluten', 'nuts', 'fish_shellfish', 'eggs'] as const
export const GENDERS = ['woman', 'man', 'non_binary', 'another', 'prefer_not'] as const
export const PREGNANCY_STATUSES = [
  'pregnant',
  'breastfeeding',
  'trying',
  'none',
  'prefer_not',
] as const
export const ACTIVITY_LEVELS = ['low', 'moderate', 'high'] as const

export const HealthProfile = z.object({
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  gender: z.enum(GENDERS).nullable(),
  pregnancy: z.enum(PREGNANCY_STATUSES).nullable(),
  conditions: z.array(z.enum(HEALTH_CONDITIONS as [HealthCondition, ...HealthCondition[]])),
  goals: z.array(z.enum(HEALTH_GOALS)),
  diet: z.array(z.enum(DIETS)),
  avoids: z.array(z.enum(AVOIDS)),
  activity: z.enum(ACTIVITY_LEVELS).nullable(),
  /** Express consent to store the profile (C4). */
  storageConsentAt: z.number(),
  /** Consent to use it for targeted news (C5); null = never (the default). */
  targetingConsentAt: z.number().nullable(),
  updatedAt: z.number(),
})
export type HealthProfile = z.infer<typeof HealthProfile>
