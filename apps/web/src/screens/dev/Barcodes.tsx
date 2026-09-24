import { listProducts } from '@smartstack/engine'
import bwipjs from 'bwip-js/browser'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { t, tl } from '../../i18n'
import styles from './Dev.module.css'

function ean13Svg(code: string): string {
  try {
    return bwipjs.toSVG({
      bcid: 'ean13',
      text: code,
      includetext: true,
      textxalign: 'center',
      scale: 3,
      height: 18,
    })
  } catch (err) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="0" y="20">${String(err)}</text></svg>`
  }
}

/** Every sample EAN-13 rendered large enough to scan off a monitor. */
export default function DevBarcodes() {
  const items = useMemo(() => listProducts().map((p) => ({ p, svg: ean13Svg(p.upc) })), [])
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
        <h1>{t('dev.barcodesTitle')}</h1>
        <p className="muted">{t('dev.barcodesIntro')}</p>
      </header>
      <ul className={styles.barcodes}>
        {items.map(({ p, svg }) => (
          <li key={p.id} className="card stack-v">
            <div className="row row--between">
              <strong>{tl(p.name)}</strong>
              <span className="small muted">{p.sku}</span>
            </div>
            <div className={styles.svg} dangerouslySetInnerHTML={{ __html: svg }} />
          </li>
        ))}
      </ul>
    </main>
  )
}
