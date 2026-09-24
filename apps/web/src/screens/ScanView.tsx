import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { getScanner, type Scanner } from '../platform/scanner'
import styles from './ScanView.module.css'

interface ScanViewProps {
  onDetected: (code: string) => void
  onUnavailable: () => void
}

const DETECT_INTERVAL_MS = 250

/** Camera + scanner loop. Lazy-loaded so the WASM only ships on this screen. */
export default function ScanView({ onDetected, onUnavailable }: ScanViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'unavailable'>(
    'starting',
  )
  const [engine, setEngine] = useState<Scanner['engine'] | null>(null)
  const detectedRef = useRef(onDetected)
  useEffect(() => {
    detectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastCode = ''
    let lastAt = 0

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        onUnavailable()
        return
      }
      try {
        const [scanner, media] = await Promise.all([
          getScanner(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
            audio: false,
          }),
        ])
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        stream = media
        setEngine(scanner.engine)
        const video = videoRef.current
        if (!video) return
        video.srcObject = media
        await video.play()
        setStatus('scanning')

        const tick = async () => {
          if (cancelled) return
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
              const codes = await scanner.detect(video)
              const code = codes[0]
              const now = Date.now()
              // Debounce: report a code once, or again after 3 s.
              if (code && (code !== lastCode || now - lastAt > 3000)) {
                lastCode = code
                lastAt = now
                detectedRef.current(code)
              }
            } catch {
              // A single bad frame is not fatal.
            }
          }
          if (!cancelled) timer = setTimeout(tick, DETECT_INTERVAL_MS)
        }
        void tick()
      } catch (err) {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ''
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
      }
    }
    void start()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onUnavailable])

  return (
    <div className={styles.wrap}>
      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
        <div className={styles.reticle} aria-hidden="true" />
      </div>
      {status === 'starting' && <p className="muted small">{t('add.scanStarting')}</p>}
      {status === 'scanning' && (
        <p className="muted small">
          {t('add.scanHint')}
          {engine && <span className={styles.engine}> · {t('add.engine', { engine })}</span>}
        </p>
      )}
      {status === 'denied' && <p className="notice notice--warn">{t('add.cameraDenied')}</p>}
      {status === 'unavailable' && (
        <p className="notice notice--warn">{t('add.cameraUnavailable')}</p>
      )}
    </div>
  )
}
