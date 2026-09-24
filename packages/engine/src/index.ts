// @smartstack/engine — the rules engine.
// Pure TypeScript. Zone-free: works in minutes since midnight and returns local HH:MM.
// No DOM, no Cloudflare, no user-facing strings (the UI renders rule ids and
// adjustment codes through i18n).

export const ENGINE_VERSION = '0.2.0'

export {
  barcodesMatch,
  ean13CheckDigit,
  isValidEan13,
  isValidRetailBarcode,
  isValidUpcA,
  normalizeBarcode,
  sampleEan13,
  SAMPLE_EAN13_PREFIX,
  upcaCheckDigit,
} from './barcode'
export {
  catalogue,
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
export { sampleCatalogue } from './sample'
export { buildSchedule, type BuildScheduleOptions } from './scheduler'
export { shiftRoutine } from './shift'
export { loadProductText, productText, type ProductText } from './text'
export { formatHHMM, MINUTES_PER_DAY, parseHHMM, roundUpTo } from './time'
export { validateCatalogue, type ValidationResult } from './validate'
