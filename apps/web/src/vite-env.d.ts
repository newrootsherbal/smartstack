/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Public VAPID key (base64url). Empty until the keys are generated. */
  readonly VITE_VAPID_PUBLIC_KEY: string
  /** Sent as X-Beta-Key on PUT /api/me. A speed bump, not security. */
  readonly VITE_BETA_KEY: string
}

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

/** Chrome's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent
}

interface Navigator {
  /** iOS Safari only: true when running from the Home Screen. */
  standalone?: boolean
}
