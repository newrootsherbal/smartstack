// @smartstack/engine — the rules engine.
// Pure TypeScript. Zone-free: works in minutes since midnight and returns local HH:MM.
// No DOM, no Cloudflare, no user-facing strings (the UI renders rule ids and
// adjustment codes through i18n).

export const ENGINE_VERSION = '0.1.0'

export {
  barcodesMatch,
  ean13CheckDigit,
  isValidEan13,
  normalizeBarcode,
  sampleEan13,
  SAMPLE_EAN13_PREFIX,
} from './barcode'
export {
  catalogue,
  findProductByBarcode,
  getIngredient,
  getProduct,
  getRule,
  listProducts,
  productContainsIngredient,
  rulesForProduct,
} from './catalogue'
export { findDuplicateIngredients } from './duplicates'
export { buildSchedule, type BuildScheduleOptions } from './scheduler'
export { shiftRoutine } from './shift'
export { formatHHMM, MINUTES_PER_DAY, parseHHMM, roundUpTo } from './time'
export { validateCatalogue, type ValidationResult } from './validate'
