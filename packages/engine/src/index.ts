// @smartstack/engine — the rules engine.
// Pure TypeScript. Zone-free: works in minutes since midnight and returns local HH:MM.
// No DOM, no Cloudflare, no user-facing strings (the UI renders rule ids and
// adjustment codes through i18n; rule explanations are data).

export const ENGINE_VERSION = '0.2.0'

export {
  DISTINCTIVE_NAME_WORDS,
  MAX_ALTERNATIVES,
  MIN_ALTERNATIVE_SCORE,
  servingsPerDose,
  suggestAlternatives,
  type Alternative,
  type AlternativeFact,
} from './alternatives'
export {
  barcodesMatch,
  ean13CheckDigit,
  isValidEan13,
  isValidEan8,
  isValidRetailBarcode,
  isValidUpcA,
  normalizeBarcode,
  sampleEan13,
  SAMPLE_EAN13_PREFIX,
  upcaCheckDigit,
} from './barcode'
export {
  catalogue,
  curatedAlternatives,
  findProductByBarcode,
  getIngredient,
  getProduct,
  getRule,
  listProducts,
  productBarcodes,
  productContainsIngredient,
  rulesForProduct,
  searchProducts,
} from './catalogue'
export { findDuplicateIngredients } from './duplicates'
export {
  applyTick,
  dailyUse,
  daysLeft,
  inventoryUnitFor,
  isLow,
  LOW_STOCK_DAYS,
  parsePackageSize,
  productSizes,
  refill,
  undoTick,
  unitsPerDose,
  type PackageSize,
  type ProductSize,
} from './inventory'
export { sampleCatalogue } from './sample'
export { buildSchedule, type BuildScheduleOptions } from './scheduler'
export { shiftRoutine } from './shift'
export { loadProductText, productText, type ProductText } from './text'
export { formatHHMM, MINUTES_PER_DAY, parseHHMM, roundUpTo } from './time'
export {
  canonicalIngredients,
  engineKind,
  mergeCatalogue,
  normalizeIngredientUnit,
  recognizeIngredient,
  toEngineProduct,
  userRuleId,
  userRules,
} from './user-products'
export {
  validateAlternatives,
  validateCatalogue,
  type AlternativesValidation,
  type ValidationResult,
} from './validate'
