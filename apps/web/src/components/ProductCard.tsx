import { getIngredient } from '@smartstack/engine'
import type { Product } from '@smartstack/shared'
import { formatAmount } from '../format'
import { t, tl } from '../i18n'
import styles from './ProductCard.module.css'

export function ProductCard({ product }: { product: Product }) {
  return (
    <div className={`card ${styles.card}`}>
      <div className="row row--between">
        <div>
          <h3>{tl(product.name)}</h3>
          <p className="small muted">
            {product.brand} · {product.form} · {product.servingSize}
          </p>
        </div>
        {product.status === 'sample' && (
          <span className="tag tag--sample">{t('common.sample')}</span>
        )}
      </div>
      <p className="small muted">
        SKU {product.sku} · UPC {product.upc} · NPN {product.npn}
      </p>
      <div>
        <p className="small" style={{ fontWeight: 600 }}>
          {t('add.ingredients')}
        </p>
        <ul className={styles.ingredients}>
          {product.ingredients.map((pi) => {
            const ing = getIngredient(pi.ingredientId)
            return (
              <li key={pi.ingredientId}>
                <span>{ing ? tl(ing.name) : pi.ingredientId}</span>
                <span className="muted">{formatAmount(pi.amountPerDose, ing?.unit ?? '')}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
