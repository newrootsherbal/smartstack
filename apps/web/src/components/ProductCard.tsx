import { getIngredient } from '@smartstack/engine'
import type { Product } from '@smartstack/shared'
import { useState } from 'react'
import { formatAmount, formatServingSize } from '../format'
import { t, tl } from '../i18n'
import styles from './ProductCard.module.css'

const COLLAPSED_ROWS = 8

export function ProductCard({ product }: { product: Product }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? product.ingredients : product.ingredients.slice(0, COLLAPSED_ROWS)
  const hidden = product.ingredients.length - rows.length
  const sizes = (product.variants ?? [])
    .map((v) => (v.size ? tl(v.size) : null))
    .filter((s): s is string => !!s)

  return (
    <div className={`card ${styles.card}`}>
      <div className="row row--between">
        <div>
          <h3>{tl(product.name)}</h3>
          {product.subtitle && <p className="small">{tl(product.subtitle)}</p>}
          <p className="small muted">
            {product.brand} · {formatServingSize(product.servingSize)}
          </p>
        </div>
        {product.status === 'sample' ? (
          <span className="tag tag--sample">{t('common.sample')}</span>
        ) : (
          <span className="tag">{t('common.draft')}</span>
        )}
      </div>
      <p className="small muted">
        NPN {product.npn} · SKU {product.sku}
        {sizes.length > 0 && <> · {t('add.sizes', { sizes: sizes.join(', ') })}</>}
      </p>
      <div>
        <p className="small" style={{ fontWeight: 600 }}>
          {t('add.ingredients', { serving: formatServingSize(product.servingSize) })}
        </p>
        <ul className={styles.ingredients}>
          {rows.map((pi) => {
            const ing = getIngredient(pi.ingredientId)
            return (
              <li key={pi.ingredientId}>
                <span>{ing ? tl(ing.name) : pi.ingredientId}</span>
                <span className="muted">{formatAmount(pi.amountPerDose, ing?.unit ?? '')}</span>
              </li>
            )
          })}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            className="btn btn--link btn--small"
            onClick={() => setExpanded(true)}
          >
            {t('common.andMore', { count: hidden })}
          </button>
        )}
      </div>
    </div>
  )
}
