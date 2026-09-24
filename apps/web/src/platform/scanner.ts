/**
 * Barcode scanning behind a small interface. Web now: the native
 * `window.BarcodeDetector` when it supports our formats (Android Chrome),
 * otherwise the ZXing WASM ponyfill with the .wasm served from our origin.
 * Later native: @capacitor-mlkit/barcode-scanning behind the same interface.
 */
import { normalizeBarcode } from '@smartstack/engine'

export const SCAN_FORMATS = ['ean_13', 'upc_a', 'upc_e', 'code_128', 'qr_code'] as const
export type ScanFormat = (typeof SCAN_FORMATS)[number]

export interface Scanner {
  engine: 'native' | 'zxing'
  /** Normalized raw values found in the frame (empty when none). */
  detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap): Promise<string[]>
}

interface DetectedBarcodeLike {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: unknown): Promise<DetectedBarcodeLike[]>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function nativeDetector(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

export function hasCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

let scannerPromise: Promise<Scanner> | null = null

/** Lazily create the scanner (loads the WASM only when needed, only once). */
export function getScanner(): Promise<Scanner> {
  scannerPromise ??= createScanner().catch((err: unknown) => {
    scannerPromise = null
    throw err
  })
  return scannerPromise
}

async function createScanner(): Promise<Scanner> {
  const Native = nativeDetector()
  if (Native?.getSupportedFormats) {
    try {
      const supported = await Native.getSupportedFormats()
      if (SCAN_FORMATS.every((f) => supported.includes(f))) {
        const detector = new Native({ formats: [...SCAN_FORMATS] })
        return wrap('native', detector)
      }
    } catch {
      // fall through to the ponyfill
    }
  }

  const [{ BarcodeDetector: Ponyfill, prepareZXingModule }, { default: wasmUrl }] =
    await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])

  // Serve the WASM from our origin (precached by the service worker), never a CDN.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  })

  const detector = new Ponyfill({ formats: [...SCAN_FORMATS] })
  return wrap('zxing', detector)
}

function wrap(engine: Scanner['engine'], detector: BarcodeDetectorLike): Scanner {
  return {
    engine,
    async detect(source) {
      const results = await detector.detect(source)
      return [...new Set(results.map((r) => normalizeBarcode(r.rawValue)).filter(Boolean))]
    },
  }
}
