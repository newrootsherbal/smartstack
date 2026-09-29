import {
  MAX_DOSES_PER_DAY,
  MEAL_ANCHORS,
  type Adjustment,
  type AdjustmentCode,
  type Anchor,
  type Catalogue,
  type MealAnchor,
  type PinAnchor,
  type Placement,
  type Product,
  type Reason,
  type ReasonParams,
  type Routine,
  type RuleAttribute,
  type Schedule,
  type Severity,
  type Stack,
  type StackItem,
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
/** Rule id carried by the adjustment of a dose the person pinned. */
export const PIN_RULE_ID = 'user:pin'

const SEVERITY_RANK: Record<Severity, number> = {
  important: 5,
  timing_conflict: 4,
  consideration: 3,
  product_instruction: 2,
  informational: 1,
}

interface Mover {
  ruleId: string
  code: AdjustmentCode
  params: ReasonParams
}

interface DoseState {
  productId: string
  /** Creation order within the product: the index into `StackItem.pins`. */
  slot: number
  doseIndex: number
  /** Time the dose would have without any rule (first meal for dose 0, its meal anchor after). */
  baselineMinutes: number
  minutes: number
  anchor: PinAnchor | null
  /** The person's chosen anchor: the dose never moves. */
  pinned: PinAnchor | null
  /** Never moves: pinned, or a medication dose (pinned or not). */
  fixed: boolean
  /** A medication dose: no rules, no reasons, no adjustment; it only moves other products. */
  medication: boolean
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

function anchorMinutes(r: RoutineMinutes, anchor: PinAnchor): number {
  const value = anchor === 'bedtime' ? r.bedtime : anchor === 'wake' ? r.wake : r[anchor]
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

/** A pinned meal the routine skips falls back like a meal preference does. */
function resolvePin(pin: PinAnchor, available: ReadonlySet<MealAnchor>): PinAnchor {
  if (pin === 'wake' || pin === 'bedtime') return pin
  return resolveMeal([pin], available)
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
 * SUGGEST_BEDTIME never places a dose.
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

/**
 * Where an extra dose of a product goes: the next preferred meal (dinner, lunch,
 * breakfast) it does not already use, then bedtime, then the middle of the widest
 * gap in its day. Two doses of one product never share a time.
 */
function extraDoseSlot(
  used: ReadonlySet<PinAnchor>,
  assigned: readonly number[],
  r: RoutineMinutes,
  available: ReadonlySet<MealAnchor>,
): { anchor: Anchor | null; minutes: number } {
  const meal = EXTRA_DOSE_ORDER.find(
    (a) => available.has(a) && !used.has(a) && !assigned.includes(anchorMinutes(r, a)),
  )
  if (meal) return { anchor: meal, minutes: anchorMinutes(r, meal) }
  if (!used.has('bedtime') && !assigned.includes(r.bedtime)) {
    return { anchor: 'bedtime', minutes: r.bedtime }
  }

  const points = [...new Set([r.wake, ...assigned, r.bedtime])].sort((a, b) => a - b)
  let start = points[0]!
  let end = points[0]!
  for (let i = 1; i < points.length; i++) {
    if (points[i]! - points[i - 1]! > end - start) {
      start = points[i - 1]!
      end = points[i]!
    }
  }
  let minutes = roundUpTo((start + end) / 2, ROUNDING_STEP_MINUTES)
  while (assigned.includes(minutes) && minutes < MINUTES_PER_DAY - ROUNDING_STEP_MINUTES) {
    minutes += ROUNDING_STEP_MINUTES
  }
  return { anchor: null, minutes }
}

/**
 * Steps 1 + 2 for one product: baseline at the first meal, then fixed anchors; extra
 * doses take the next preferred meal (dinner, lunch, breakfast) not yet used by the
 * product. Pinned slots then take the anchor the person chose, and an unpinned dose that
 * would share a time with a pinned one takes the next free slot instead.
 *
 * A medication has no rules, so its doses land where a product without rules would (the
 * first meal, then dinner, lunch, breakfast, bedtime) unless pinned, and every dose is then
 * fixed: the app asks for one time per dose, so an unpinned medication dose only happens
 * with incomplete data, and it is treated as if pinned where it landed (never moved, still
 * moving other products) without being reported as a pin.
 */
function layoutProduct(
  item: StackItem,
  rules: readonly TimingRule[],
  r: RoutineMinutes,
  available: ReadonlySet<MealAnchor>,
  firstMeal: MealAnchor,
  medication: boolean,
): DoseState[] {
  const count = Math.min(item.dosesPerDay, MAX_DOSES_PER_DAY)
  const fixed = pickFixedAnchor(rules, available)
  const firstAnchor: Anchor = fixed?.anchor ?? firstMeal
  const doses: DoseState[] = [
    {
      productId: item.productId,
      slot: 0,
      doseIndex: 0,
      baselineMinutes: anchorMinutes(r, firstMeal),
      minutes: anchorMinutes(r, firstAnchor),
      anchor: firstAnchor,
      pinned: null,
      fixed: medication,
      medication,
      movedBy:
        fixed && firstAnchor !== firstMeal
          ? { ruleId: fixed.rule.id, code: fixed.code, params: { anchor: firstAnchor } }
          : null,
      reasons: [],
    },
  ]
  const used = new Set<PinAnchor>([firstAnchor])
  const assigned = [doses[0]!.minutes]
  for (let i = 1; i < count; i++) {
    const slot = extraDoseSlot(used, assigned, r, available)
    if (slot.anchor) used.add(slot.anchor)
    assigned.push(slot.minutes)
    doses.push({
      productId: item.productId,
      slot: i,
      doseIndex: i,
      baselineMinutes: slot.minutes,
      minutes: slot.minutes,
      anchor: slot.anchor,
      pinned: null,
      fixed: medication,
      medication,
      movedBy: null,
      reasons: [],
    })
  }

  const pins = item.pins ?? []
  if (!pins.some((p, i) => p && i < count)) return doses

  for (const dose of doses) {
    const pin = pins[dose.slot]
    if (!pin) continue
    const anchor = resolvePin(pin, available)
    dose.pinned = anchor
    dose.fixed = true
    dose.anchor = anchor
    dose.minutes = anchorMinutes(r, anchor)
    dose.movedBy = { ruleId: PIN_RULE_ID, code: 'MOVED_BY_YOU', params: { anchor } }
  }
  // Unpinned doses keep their place unless a pinned dose of the same product took it.
  const taken = doses.filter((d) => d.pinned)
  const takenAnchors = new Set<PinAnchor>(taken.map((d) => d.anchor!))
  const takenMinutes = taken.map((d) => d.minutes)
  for (const dose of doses) {
    if (dose.pinned) continue
    if (!takenMinutes.includes(dose.minutes)) {
      if (dose.anchor) takenAnchors.add(dose.anchor)
      takenMinutes.push(dose.minutes)
      continue
    }
    const slot = extraDoseSlot(takenAnchors, takenMinutes, r, available)
    if (slot.anchor) takenAnchors.add(slot.anchor)
    takenMinutes.push(slot.minutes)
    dose.anchor = slot.anchor
    dose.minutes = slot.minutes
    dose.movedBy = null
  }
  return doses
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
    // Added once per product after placement (step 3b).
    if (rule.attribute === 'SUGGEST_BEDTIME') continue
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
      doseIndex: dose.doseIndex,
      params,
    })
  }
  return reasons
}

interface SeparationConstraint {
  rule: TimingRule
  separation: number
  conflicts: number[]
  /** The doses behind `conflicts` (empty for coffee). */
  others: DoseState[]
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
      constraints.push({ rule, separation, conflicts: [r.coffee], others: [], otherProductIds: [] })
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
      others,
      otherProductIds: [...new Set(others.map((d) => d.productId))],
      otherIngredientId: ingredientId,
    })
  }
  return constraints
}

/**
 * A medication's push rules: the SEPARATE_FROM_CALCIUM / SEPARATE_FROM_IRON rules its
 * canonical ingredients carry (first per attribute in rules order, as `rulesForProduct`
 * picks them). Coffee rules are left out: coffee cannot be moved.
 */
function ingredientSeparationRules(product: Product, cat: Catalogue): TimingRule[] {
  const ids = new Set(product.ingredients.map((pi) => pi.ingredientId))
  const byAttribute = new Map<string, TimingRule>()
  for (const rule of cat.rules) {
    if (!('ingredientId' in rule.appliesTo) || !ids.has(rule.appliesTo.ingredientId)) continue
    if (rule.attribute !== 'SEPARATE_FROM_CALCIUM' && rule.attribute !== 'SEPARATE_FROM_IRON') {
      continue
    }
    if (!byAttribute.has(rule.attribute)) byAttribute.set(rule.attribute, rule)
  }
  return [...byAttribute.values()]
}

function violates(minutes: number, c: SeparationConstraint): boolean {
  return c.conflicts.some((conflict) => Math.abs(minutes - conflict) < c.separation)
}

function separationParams(
  c: Pick<SeparationConstraint, 'separation' | 'otherIngredientId' | 'otherProductIds'>,
): ReasonParams {
  return {
    separationMinutes: c.separation,
    ...(c.otherIngredientId ? { otherIngredientId: c.otherIngredientId } : {}),
    ...(c.otherProductIds.length ? { otherProductIds: c.otherProductIds } : {}),
  }
}

function addSeparationReasons(dose: DoseState, constraints: readonly SeparationConstraint[]) {
  for (const c of constraints) {
    dose.reasons.push({
      ruleId: c.rule.id,
      attribute: c.rule.attribute,
      severity: c.rule.severity,
      productId: dose.productId,
      doseIndex: dose.doseIndex,
      params: separationParams(c),
    })
  }
}

/**
 * The earliest time ≥ `from`, among `conflict + separation` rounded up to 15 minutes,
 * that satisfies every constraint at once; undefined when none fits in the day.
 */
function earliestClearTime(
  from: number,
  constraints: readonly Pick<SeparationConstraint, 'conflicts' | 'separation'>[],
): number | undefined {
  const candidates = [
    ...new Set(
      constraints.flatMap((c) =>
        c.conflicts.map((conflict) => roundUpTo(conflict + c.separation, ROUNDING_STEP_MINUTES)),
      ),
    ),
  ]
    .filter((t) => t >= from && t < MINUTES_PER_DAY)
    .sort((a, b) => a - b)
  return candidates.find((t) =>
    constraints.every((c) => !c.conflicts.some((x) => Math.abs(t - x) < c.separation)),
  )
}

/**
 * Step 3 — move a dose to the earliest time ≥ (conflict + separation), rounded up
 * to 15 minutes, that satisfies every separation constraint at once.
 */
function applySeparation(dose: DoseState, constraints: SeparationConstraint[]): void {
  addSeparationReasons(dose, constraints)

  const violated = constraints.filter((c) => violates(dose.minutes, c))
  if (violated.length === 0) return

  const target = earliestClearTime(dose.minutes, constraints)
  if (target === undefined) return // cannot satisfy today; leave the dose where it is

  // Worded by the most severe violated rule (first in rules order on ties).
  const mover = violated.reduce((best, c) =>
    SEVERITY_RANK[c.rule.severity] > SEVERITY_RANK[best.rule.severity] ? c : best,
  )
  dose.minutes = target
  dose.anchor = null
  dose.movedBy = {
    ruleId: mover.rule.id,
    code:
      mover.rule.attribute === 'SEPARATE_FROM_COFFEE_TEA'
        ? 'MOVED_AWAY_FROM_COFFEE_TEA'
        : 'MOVED_AWAY_FROM_INGREDIENT',
    params: separationParams(mover),
  }
}

/** From the other product's side: calcium kept apart from iron reads "separately from iron". */
function mirroredAttribute(rule: TimingRule): RuleAttribute {
  if (!('ingredientId' in rule.appliesTo)) return rule.attribute
  if (rule.appliesTo.ingredientId === 'iron') return 'SEPARATE_FROM_IRON'
  if (rule.appliesTo.ingredientId === 'calcium') return 'SEPARATE_FROM_CALCIUM'
  return rule.attribute
}

function ruleIngredient(rule: TimingRule): string | undefined {
  return 'ingredientId' in rule.appliesTo ? rule.appliesTo.ingredientId : undefined
}

/**
 * Step 3 for a dose that never moves (pinned, or a medication). An unpinned dose it
 * conflicts with moves instead (to the earliest time that clears the fixed dose and its own
 * rules). Two fixed doses both stay, and the later one gets a timing-conflict reason, unless
 * it is a medication: a medication carries no reasons (not even its own separation reasons),
 * so the other product's dose gets it.
 */
function separateAroundFixed(
  dose: DoseState,
  constraints: SeparationConstraint[],
  all: readonly DoseState[],
  rulesByProduct: ReadonlyMap<string, TimingRule[]>,
  r: RoutineMinutes,
  cat: Catalogue,
): void {
  if (!dose.medication) addSeparationReasons(dose, constraints)
  for (const c of constraints) {
    for (const other of c.others) {
      if (Math.abs(other.minutes - dose.minutes) >= c.separation) continue
      const ingredient = ruleIngredient(c.rule)
      const mirrored: ReasonParams = {
        separationMinutes: c.separation,
        ...(ingredient ? { otherIngredientId: ingredient } : {}),
        otherProductIds: [dose.productId],
      }
      if (other.fixed) {
        if (dose.medication && other.medication) continue
        let flagged = other.minutes > dose.minutes ? other : dose
        if (flagged.medication) flagged = flagged === dose ? other : dose
        const params: ReasonParams =
          flagged === dose
            ? { ...separationParams(c), otherProductIds: [other.productId], pinnedConflict: true }
            : { ...mirrored, pinnedConflict: true }
        flagged.reasons.push({
          ruleId: c.rule.id,
          attribute: flagged === dose ? c.rule.attribute : mirroredAttribute(c.rule),
          severity: 'timing_conflict',
          productId: flagged.productId,
          doseIndex: flagged.doseIndex,
          params,
        })
        continue
      }
      const imposed = { conflicts: [dose.minutes], separation: c.separation }
      const own = separationConstraints(
        other,
        rulesByProduct.get(other.productId) ?? [],
        all,
        r,
        cat,
      )
      if (!other.reasons.some((x) => x.ruleId === c.rule.id)) {
        other.reasons.push({
          ruleId: c.rule.id,
          attribute: mirroredAttribute(c.rule),
          severity: c.rule.severity,
          productId: other.productId,
          doseIndex: other.doseIndex,
          params: mirrored,
        })
      }
      const target = earliestClearTime(other.minutes, [imposed, ...own])
      if (target === undefined) continue
      other.minutes = target
      other.anchor = null
      other.movedBy = { ruleId: c.rule.id, code: 'MOVED_AWAY_FROM_INGREDIENT', params: mirrored }
    }
  }
}

/**
 * Step 3b — the bedtime suggestion (SUGGEST_BEDTIME): an informational reason on the
 * product's last dose of the day, only when no dose is at bedtime, nothing is pinned
 * and the person did not turn the suggestion down.
 */
function addBedtimeSuggestion(
  item: StackItem,
  rules: readonly TimingRule[],
  doses: readonly DoseState[],
): void {
  const rule = rules.find((x) => x.attribute === 'SUGGEST_BEDTIME')
  if (!rule) return
  if (item.dismissed?.includes('SUGGEST_BEDTIME')) return
  if (doses.some((d) => d.anchor === 'bedtime' || d.pinned)) return
  const last = doses.reduce((a, b) => (b.minutes > a.minutes ? b : a))
  last.reasons.push({
    ruleId: rule.id,
    attribute: 'SUGGEST_BEDTIME',
    severity: rule.severity,
    productId: last.productId,
    doseIndex: last.doseIndex,
    params: {},
  })
}

function anchorAt(minutes: number, r: RoutineMinutes, group: readonly DoseState[]) {
  if (minutes === r.bedtime) return 'bedtime'
  for (const meal of MEAL_ANCHORS) if (r[meal] === minutes) return meal
  if (minutes === r.wake && group.some((d) => d.anchor === 'wake')) return 'wake'
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
  /** Medications only: the separation rules their ingredients carry, used to move others. */
  const pushRulesByProduct = new Map<string, TimingRule[]>()
  const dosesByItem = new Map<StackItem, DoseState[]>()

  // Steps 1 + 2: baseline, fixed anchors, extra doses, then the person's pins.
  for (const item of stack) {
    const product = getProduct(item.productId, cat)
    if (!product) throw new Error(`unknown product: ${item.productId}`)
    const medication = product.kind === 'medication'
    const rules = rulesForProduct(product, cat)
    rulesByProduct.set(product.id, rules)
    if (medication) pushRulesByProduct.set(product.id, ingredientSeparationRules(product, cat))
    const productDoses = layoutProduct(item, rules, r, available, firstMeal, medication)
    dosesByItem.set(item, productDoses)
    doses.push(...productDoses)
  }

  for (const dose of doses) {
    dose.reasons = baseReasons(dose, rulesByProduct.get(dose.productId) ?? [])
  }

  // Step 3: separation, in stack order, against the current position of every other dose.
  // A medication never moves and has no rules of its own, but the separation rules its
  // ingredients carry move the other products away from it (an iron medication moves a
  // calcium supplement, never the reverse).
  for (const dose of doses) {
    const rules = dose.medication
      ? (pushRulesByProduct.get(dose.productId) ?? [])
      : (rulesByProduct.get(dose.productId) ?? [])
    const constraints = separationConstraints(dose, rules, doses, r, cat)
    if (!constraints.length) continue
    if (dose.fixed) separateAroundFixed(dose, constraints, doses, rulesByProduct, r, cat)
    else applySeparation(dose, constraints)
  }

  for (const [item, productDoses] of dosesByItem) {
    addBedtimeSuggestion(item, rulesByProduct.get(item.productId) ?? [], productDoses)
  }

  // Step 4: one adjustment per product whose final time differs from baseline. A medication
  // is where the person takes it: nothing was moved, so it has none.
  const adjustments: Adjustment[] = []
  const adjusted = new Set<string>()
  for (const dose of doses) {
    if (dose.medication || adjusted.has(dose.productId)) continue
    if (dose.minutes === dose.baselineMinutes || !dose.movedBy) continue
    adjusted.add(dose.productId)
    adjustments.push({
      code: dose.movedBy.code,
      productId: dose.productId,
      ruleId: dose.movedBy.ruleId,
      params: {
        ...dose.movedBy.params,
        from: formatHHMM(dose.baselineMinutes),
        to: formatHHMM(dose.minutes),
      },
    })
  }

  // Number each product's doses in time order, so "four times daily" reads Dose 1…4
  // across the day (checkbox keys and reasons follow the same numbering).
  for (const list of dosesByItem.values()) {
    const ordered = [...list].sort((a, b) => a.minutes - b.minutes || a.slot - b.slot)
    ordered.forEach((dose, i) => {
      dose.doseIndex = i
      for (const reason of dose.reasons) reason.doseIndex = i
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
      anchor: anchorAt(minutes, r, group),
      productIds: [...new Set(group.map((d) => d.productId))],
      doses: group.map((d) => ({
        productId: d.productId,
        doseIndex: d.doseIndex,
        slot: d.slot,
        ...(d.pinned ? { pinned: d.pinned } : {}),
      })),
      reasons: group.flatMap((d) => d.reasons),
    }))

  return {
    placements,
    adjustments,
    duplicates: findDuplicateIngredients(stack, cat),
  }
}
