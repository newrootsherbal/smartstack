import { productBarcodes, sampleCatalogue, searchProducts } from '@smartstack/engine'
import type { Product } from '@smartstack/shared'
import bwipjs from 'bwip-js/browser'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { t, tl } from '../../i18n'
import styles from './Dev.module.css'

const MAX_RENDERED = 12

function barcodeSvg(code: string): string {
  try {
    return bwipjs.toSVG({
      bcid: code.length === 12 ? 'upca' : 'ean13',
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

/** Real products (UPC-A, one per variant) and the sample fixtures (EAN-13), scannable off a monitor. */
export default function DevBarcodes() {
  const [query, setQuery] = useState('')
  const matches = useMemo<Product[]>(() => {
    const real = searchProducts(query)
    const samples = sampleCatalogue.products.filter((p) =>
      p.name.en.toLowerCase().includes(query.trim().toLowerCase()),
    )
    return [...real, ...samples]
  }, [query])
  const shown = matches.slice(0, MAX_RENDERED)

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
        <input
          className="input"
          type="search"
          placeholder={t('add.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('add.searchPlaceholder')}
        />
        <p className="small muted">
          {t('add.results', { count: matches.length })}
          {matches.length > MAX_RENDERED && ` · showing ${MAX_RENDERED}`}
        </p>
      </header>
      <ul className={styles.barcodes}>
        {shown.map((p) => (
          <li key={p.id} className="card stack-v">
            <div className="row row--between">
              <strong>{tl(p.name)}</strong>
              <span className="small muted">{p.npn}</span>
            </div>
            {productBarcodes(p).map((code) => {
              const variant = p.variants?.find((v) => v.upc === code)
              return (
                <div key={code} className="stack-v">
                  {variant && (
                    <span className="small muted">
                      SKU {variant.sku}
                      {variant.size && ` · ${tl(variant.size)}`}
                      {variant.format && ` ${tl(variant.format)}`}
                    </span>
                  )}
                  <div
                    className={styles.svg}
                    dangerouslySetInnerHTML={{ __html: barcodeSvg(code) }}
                  />
                </div>
              )
            })}
          </li>
        ))}
      </ul>
    </main>
  )
}
