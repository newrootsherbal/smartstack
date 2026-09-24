import {
  MAX_DOSES_PER_DAY,
  MEAL_ANCHORS,
  type Adjustment,
  type AdjustmentCode,
  type Anchor,
  type Catalogue,
  type MealAnchor,
  type Placement,
  type Reason,
  type ReasonParams,
  type Routine,
  type Schedule,
  type Severity,
  type Stack,
  type TimingRule,
} from '@smartstack/shared'
import {
  catalogue as seedCatalogue,
  getProduct,
  productContainsIngredient,
  rulesForProduct,
} from './catalogue'
import { findDuplicateIngredients } from './duplicates'
import { formatHHMM, MINUTES_PER_DAY, parseHHMM, roundUpTo } from './time'

export interface BuildScheduleOptions {
  catalogue?: Catalogue
}

/** Order in which extra doses claim meal anchors. */
const EXTRA_DOSE_ORDER: readonly MealAnchor[] = ['dinner', 'lunch', 'breakfast']
/** Fallback order when a preferred anchor is missing from the routine. */
const FALLBACK_ORDER: readonly MealAnchor[] = ['breakfast', 'lunch', 'dinner']
const ROUNDING_STEP_MINUTES = 15
const DEFAULT_SEPARATION_MINUTES = 120

const SEVERITY_RANK: Record<Severity, number> = {
  important: 5,
  timing_conflict: 4,
  consideration: 3,
  product_instruction: 2,
  informational: 1,
}

interface Mover {
  rule: TimingRule
  code: AdjustmentCode
  params: ReasonParams
}

interface DoseState {
  productId: string
  doseIndex: number
  /** Time the dose would have without any rule (first meal for dose 0, its meal anchor after). */
  baselineMinutes: number
  minutes: number
  anchor: Anchor | null
  movedBy: Mover | null
  reasons: Reason[]
}

interface RoutineMinutes {
  wake: number
  bedtime: number
  coffee: number | null
  breakfast: number | null
  lunch: number | null
  dinner: number | null
  exercise: number | null
}

function parseRoutine(routine: Routine): RoutineMinutes {
  const opt = (v: string | null) => (v === null ? null : parseHHMM(v))
  return {
    wake: parseHHMM(routine.wake),
    bedtime: parseHHMM(routine.bedtime),
    coffee: opt(routine.coffee),
    breakfast: opt(routine.breakfast),
    lunch: opt(routine.lunch),
    dinner: opt(routine.dinner),
    exercise: opt(routine.exercise),
  }
}

function anchorMinutes(r: RoutineMinutes, anchor: Anchor): number {
  const value = anchor === 'bedtime' ? r.bedtime : r[anchor]
  if (value === null) throw new Error(`anchor ${anchor} is not in the routine`)
  return value
}

function firstAvailable(order: readonly MealAnchor[], available: ReadonlySet<MealAnchor>) {
  return order.find((a) => available.has(a))
}

/**
 * Resolve a preferred meal anchor: first preference present in the routine,
 * otherwise the fixed fallback chain breakfast → lunch → dinner.
 */
function resolveMeal(
  preferred: readonly MealAnchor[],
  available: ReadonlySet<MealAnchor>,
): MealAnchor {
  const hit = firstAvailable(preferred, available) ?? firstAvailable(FALLBACK_ORDER, available)
  if (!hit) throw new Error('routine has no meal anchor')
  return hit
}

interface FixedAnchor {
  anchor: Anchor
  rule: TimingRule
  code: AdjustmentCode
}

/**
 * Step 2 — fixed-anchor rules. Product-level (label) rules are considered before
 * ingredient-level ones; within a level the priority is
 * BEDTIME > EVENING > MORNING > preferredAnchors (WITH_FAT / WITH_FOOD) > plain WITH_FOOD.
 */
function pickFixedAnchor(
  rules: readonly TimingRule[],
  available: ReadonlySet<MealAnchor>,
): FixedAnchor | null {
  // A time the label states (bedtime, morning, a meal preference) beats what an
  // ingredient implies; a plain "with food" names no time, so it only decides
  // when nothing else does (and an evening calcium dose is still "with food").
  const productLevel = rules.filter((r) => 'productId' in r.appliesTo)
  const ingredientLevel = rules.filter((r) => !('productId' in r.appliesTo))
  return (
    pickFixedAnchorFrom(productLevel, available, false) ??
    pickFixedAnchorFrom(ingredientLevel, available, false) ??
    pickFixedAnchorFrom(rules, available, true)
  )
}

function pickFixedAnchorFrom(
  rules: readonly TimingRule[],
  available: ReadonlySet<MealAnchor>,
  plainWithFood: boolean,
): FixedAnchor | null {
  const byAttr = (attr: TimingRule['attribute']) => rules.find((r) => r.attribute === attr)
  if (plainWithFood) {
    const withFood = byAttr('WITH_FOOD') ?? byAttr('WITH_FAT')
    if (withFood) {
      return {
        anchor: resolveMeal(['breakfast'], available),
        rule: withFood,
        code: 'MOVED_TO_MEAL',
      }
    }
    return null
  }

  const bedtime = byAttr('BEDTIME')
  if (bedtime) return { anchor: 'bedtime', rule: bedtime, code: 'MOVED_TO_BEDTIME' }

  const evening = byAttr('EVENING')
  if (evening) {
    return { anchor: resolveMeal(['dinner'], available), rule: evening, code: 'MOVED_TO_EVENING' }
  }

  const morning = byAttr('MORNING')
  if (morning) {
    return {
      anchor: resolveMeal(['breakfast'], available),
      rule: morning,
      code: 'MOVED_TO_MORNING',
    }
  }

  const withPreference = rules.find(
    (r) => (r.attribute === 'WITH_FAT' || r.attribute === 'WITH_FOOD') && r.preferredAnchors,
  )
  if (withPreference?.preferredAnchors) {
    return {
      anchor: resolveMeal(withPreference.preferredAnchors, available),
      rule: withPreference,
      code: 'MOVED_TO_MEAL',
    }
  }

  return null
}

function nextExtraAnchor(used: ReadonlySet<Anchor>, available: ReadonlySet<MealAnchor>): Anchor {
  const meal = EXTRA_DOSE_ORDER.find((a) => available.has(a) && !used.has(a))
  if (meal) return meal
  if (!used.has('bedtime')) return 'bedtime'
  // Every anchor already used: reuse meals in the same order.
  return EXTRA_DOSE_ORDER.find((a) => available.has(a)) ?? 'bedtime'
}

const FIXED_ANCHOR_ATTRIBUTES = new Set(['MORNING', 'EVENING', 'BEDTIME'])
const MEAL_ADVICE_ATTRIBUTES = new Set(['WITH_FOOD', 'WITH_FAT'])
const SEPARATION_ATTRIBUTES = new Set([
  'SEPARATE_FROM_CALCIUM',
  'SEPARATE_FROM_IRON',
  'SEPARATE_FROM_COFFEE_TEA',
])

/** Non-separation reasons for one dose (separation reasons are added in step 3). */
function baseReasons(dose: DoseState, rules: readonly TimingRule[]): Reason[] {
  const reasons: Reason[] = []
  for (const rule of rules) {
    if (SEPARATION_ATTRIBUTES.has(rule.attribute)) continue
    if (FIXED_ANCHOR_ATTRIBUTES.has(rule.attribute)) {
      const target: Anchor =
        rule.attribute === 'BEDTIME'
          ? 'bedtime'
          : rule.attribute === 'EVENING'
            ? 'dinner'
            : 'breakfast'
      if (dose.anchor !== target) continue
    }
    const params: ReasonParams = {}
    if (FIXED_ANCHOR_ATTRIBUTES.has(rule.attribute) || MEAL_ADVICE_ATTRIBUTES.has(rule.attribute)) {
      params.anchor = dose.anchor
    }
    reasons.push({
      ruleId: rule.id,
      attribute: rule.attribute,
      severity: rule.severity,
      productId: dose.productId,
      params,
    })
  }
  return reasons
}

interface SeparationConstraint {
  rule: TimingRule
  separation: number
  conflicts: number[]
  otherProductIds: string[]
  otherIngredientId?: string
}

function separationConstraints(
  dose: DoseState,
  rules: readonly TimingRule[],
  all: readonly DoseState[],
  r: RoutineMinutes,
  cat: Catalogue,
): SeparationConstraint[] {
  const constraints: SeparationConstraint[] = []
  for (const rule of rules) {
    if (!SEPARATION_ATTRIBUTES.has(rule.attribute)) continue
    const separation = rule.separationMinutes ?? DEFAULT_SEPARATION_MINUTES
    if (rule.attribute === 'SEPARATE_FROM_COFFEE_TEA') {
      // No coffee in the routine → the rule is silent (no reason, no move).
      if (r.coffee === null) continue
      constraints.push({ rule, separation, conflicts: [r.coffee], otherProductIds: [] })
      continue
    }
    const ingredientId = rule.attribute === 'SEPARATE_FROM_CALCIUM' ? 'calcium' : 'iron'
    const others = all.filter((d) => {
      if (d.productId === dose.productId) return false
      const product = getProduct(d.productId, cat)
      return product ? productContainsIngredient(product, ingredientId) : false
    })
    if (others.length === 0) continue
    constraints.push({
      rule,
      separation,
      conflicts: others.map((d) => d.minutes),
      otherProductIds: [...new Set(others.map((d) => d.productId))],
      otherIngredientId: ingredientId,
    })
  }
  return constraints
}

function violates(minutes: number, c: SeparationConstraint): boolean {
  return c.conflicts.some((conflict) => Math.abs(minutes - conflict) < c.separation)
}

/**
 * Step 3 — move a dose to the earliest time ≥ (conflict + separation), rounded up
 * to 15 minutes, that satisfies every separation constraint at once.
 */
function applySeparation(dose: DoseState, constraints: SeparationConstraint[]): void {
  for (const c of constraints) {
    dose.reasons.push({
      ruleId: c.rule.id,
      attribute: c.rule.attribute,
      severity: c.rule.severity,
      productId: dose.productId,
      params: {
        separationMinutes: c.separation,
        ...(c.otherIngredientId ? { otherIngredientId: c.otherIngredientId } : {}),
        ...(c.otherProductIds.length ? { otherProductIds: c.otherProductIds } : {}),
      },
    })
  }

  const violated = constraints.filter((c) => violates(dose.minutes, c))
  if (violated.length === 0) return

  const candidates = [
    ...new Set(
      constraints.flatMap((c) =>
        c.conflicts.map((conflict) => roundUpTo(conflict + c.separation, ROUNDING_STEP_MINUTES)),
      ),
    ),
  ]
    .filter((t) => t >= dose.minutes && t < MINUTES_PER_DAY)
    .sort((a, b) => a - b)

  const target = candidates.find((t) => constraints.every((c) => !violates(t, c)))
  if (target === undefined) return // cannot satisfy today; leave the dose where it is

  // Worded by the most severe violated rule (first in rules order on ties).
  const mover = violated.reduce((best, c) =>
    SEVERITY_RANK[c.rule.severity] > SEVERITY_RANK[best.rule.severity] ? c : best,
  )
  dose.minutes = target
  dose.anchor = null
  dose.movedBy = {
    rule: mover.rule,
    code:
      mover.rule.attribute === 'SEPARATE_FROM_COFFEE_TEA'
        ? 'MOVED_AWAY_FROM_COFFEE_TEA'
        : 'MOVED_AWAY_FROM_INGREDIENT',
    params: {
      separationMinutes: mover.separation,
      ...(mover.otherIngredientId ? { otherIngredientId: mover.otherIngredientId } : {}),
      ...(mover.otherProductIds.length ? { otherProductIds: mover.otherProductIds } : {}),
    },
  }
}

function anchorAt(minutes: number, r: RoutineMinutes): Anchor | null {
  if (minutes === r.bedtime) return 'bedtime'
  for (const meal of MEAL_ANCHORS) if (r[meal] === minutes) return meal
  return null
}

/**
 * Build the day's schedule. Deterministic, zone-free: minutes since local
 * midnight in, "HH:MM" out. Throws on an unknown product id.
 */
export function buildSchedule(
  routine: Routine,
  stack: Stack,
  options: BuildScheduleOptions = {},
): Schedule {
  const cat = options.catalogue ?? seedCatalogue
  const r = parseRoutine(routine)
  const available = new Set<MealAnchor>(MEAL_ANCHORS.filter((m) => r[m] !== null))
  const firstMeal = firstAvailable(FALLBACK_ORDER, available)
  if (!firstMeal) throw new Error('routine needs at least one meal')

  const doses: DoseState[] = []
  const rulesByProduct = new Map<string, TimingRule[]>()

  // Steps 1 + 2: baseline at the first meal, then fixed anchors; extra doses take
  // the next preferred meal (dinner, lunch, breakfast) not yet used by the product.
  for (const item of stack) {
    const product = getProduct(item.productId, cat)
    if (!product) throw new Error(`unknown product: ${item.productId}`)
    const rules = rulesForProduct(product, cat)
    rulesByProduct.set(product.id, rules)

    const fixed = pickFixedAnchor(rules, available)
    const firstAnchor: Anchor = fixed?.anchor ?? firstMeal
    const first: DoseState = {
      productId: product.id,
      doseIndex: 0,
      baselineMinutes: anchorMinutes(r, firstMeal),
      minutes: anchorMinutes(r, firstAnchor),
      anchor: firstAnchor,
      movedBy:
        fixed && firstAnchor !== firstMeal
          ? { rule: fixed.rule, code: fixed.code, params: { anchor: firstAnchor } }
          : null,
      reasons: [],
    }
    doses.push(first)

    const used = new Set<Anchor>([firstAnchor])
    const count = Math.min(item.dosesPerDay, MAX_DOSES_PER_DAY)
    for (let i = 1; i < count; i++) {
      const anchor = nextExtraAnchor(used, available)
      used.add(anchor)
      const minutes = anchorMinutes(r, anchor)
      doses.push({
        productId: product.id,
        doseIndex: i,
        baselineMinutes: minutes,
        minutes,
        anchor,
        movedBy: null,
        reasons: [],
      })
    }
  }

  for (const dose of doses) {
    dose.reasons = baseReasons(dose, rulesByProduct.get(dose.productId) ?? [])
  }

  // Step 3: separation, in stack order, against the current position of every other dose.
  for (const dose of doses) {
    const rules = rulesByProduct.get(dose.productId) ?? []
    const constraints = separationConstraints(dose, rules, doses, r, cat)
    if (constraints.length) applySeparation(dose, constraints)
  }

  // Step 4: one adjustment per product whose final time differs from baseline.
  const adjustments: Adjustment[] = []
  const adjusted = new Set<string>()
  for (const dose of doses) {
    if (adjusted.has(dose.productId)) continue
    if (dose.minutes === dose.baselineMinutes || !dose.movedBy) continue
    adjusted.add(dose.productId)
    adjustments.push({
      code: dose.movedBy.code,
      productId: dose.productId,
      ruleId: dose.movedBy.rule.id,
      params: {
        ...dose.movedBy.params,
        from: formatHHMM(dose.baselineMinutes),
        to: formatHHMM(dose.minutes),
      },
    })
  }

  // Group into placements by time; products sharing a time share one reminder.
  const byMinutes = new Map<number, DoseState[]>()
  for (const dose of doses) {
    const list = byMinutes.get(dose.minutes) ?? []
    list.push(dose)
    byMinutes.set(dose.minutes, list)
  }
  const placements: Placement[] = [...byMinutes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minutes, group]) => ({
      time: formatHHMM(minutes),
      minutes,
      anchor: anchorAt(minutes, r),
      productIds: [...new Set(group.map((d) => d.productId))],
      doses: group.map((d) => ({ productId: d.productId, doseIndex: d.doseIndex })),
      reasons: group.flatMap((d) => d.reasons),
    }))

  return {
    placements,
    adjustments,
    duplicates: findDuplicateIngredients(stack, cat),
  }
}
