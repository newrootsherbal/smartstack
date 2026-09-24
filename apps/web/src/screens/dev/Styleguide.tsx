import { SEVERITIES } from '@smartstack/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { SeverityBadge } from '../../components/SeverityBadge'
import { Sheet } from '../../components/Sheet'
import { t } from '../../i18n'
import styles from './Dev.module.css'

const TOKENS = [
  '--color-bg',
  '--color-surface',
  '--color-text',
  '--color-text-muted',
  '--color-primary',
  '--sev-important',
  '--sev-timing',
  '--sev-consideration',
  '--sev-product',
  '--sev-info',
]

/** All five severity badges (only three appear in seed data), plus the primitives. */
export default function DevStyleguide() {
  const [open, setOpen] = useState(false)
  return (
    <main className="screen screen--no-nav">
      <header className="stack-v">
        <Link
          to="/settings"
          className="btn btn--link btn--small"
          style={{ alignSelf: 'flex-start' }}
        >
          ← {t('nav.settings')}
        </Link>
        <h1>{t('dev.styleguideTitle')}</h1>
      </header>

      <section className="card stack-v">
        <h2>Severity</h2>
        {SEVERITIES.map((s) => (
          <div key={s} className="row row--between">
            <code className="small">{s}</code>
            <SeverityBadge severity={s} />
          </div>
        ))}
      </section>

      <section className="card stack-v">
        <h2>Buttons</h2>
        <div className={styles.wrapRow}>
          <button className="btn btn--primary">Primary</button>
          <button className="btn">Default</button>
          <button className="btn btn--outline">Outline</button>
          <button className="btn btn--danger">Danger</button>
          <button className="btn btn--link">Link</button>
          <button className="btn btn--primary" disabled>
            Disabled
          </button>
        </div>
      </section>

      <section className="card stack-v">
        <h2>Notices</h2>
        <p className="notice">Default notice</p>
        <p className="notice notice--warn">Warning notice</p>
        <p className="notice notice--error">Error notice</p>
        <p>
          <span className="tag">Tag</span> <span className="tag tag--sample">Sample</span>
        </p>
      </section>

      <section className="card stack-v">
        <h2>Inputs</h2>
        <div className="field">
          <label className="field__label">Time</label>
          <input className="input" type="time" defaultValue="07:30" />
        </div>
        <div className="field">
          <label className="field__label">Select</label>
          <select className="input" defaultValue="1">
            <option value="1">1 per day</option>
            <option value="2">2 per day</option>
          </select>
        </div>
        <button className="btn btn--outline" onClick={() => setOpen(true)}>
          Open sheet
        </button>
      </section>

      <section className="card stack-v">
        <h2>Tokens</h2>
        <ul className={styles.tokens}>
          {TOKENS.map((name) => (
            <li key={name}>
              <span className={styles.swatch} style={{ background: `var(${name})` }} />
              <code className="small">{name}</code>
            </li>
          ))}
        </ul>
      </section>

      <Sheet open={open} onClose={() => setOpen(false)} title="Sheet">
        <p>Bottom sheet content.</p>
      </Sheet>
    </main>
  )
}
