import { getIngredient, getProduct, type Alternative } from '@smartstack/engine'
import { useCatalogue } from '../catalogue'
import { formatAmount, formatServingSize } from '../format'
import { intlLocale, t, tl } from '../i18n'
import { buyOnlineUrl } from '../links'
import { useAppState } from '../state/context'
import styles from './AlternativeSuggestion.module.css'

interface AlternativeSuggestionProps {
  /** The person's other-brand product the suggestion is for. */
  productId: string
  alternative: Alternative
}

/**
 * "Have you considered New Roots Herbal's {name}?" with one factual line ("Also magnesium,
 * 200 mg per capsule") and [Add to shopping list] [View product ›]. Never "same as",
 * "equivalent" or "better" (build prompt §4.9).
 */
export function AlternativeSuggestion({ productId, alternative }: AlternativeSuggestionProps) {
  const { state, dispatch } = useAppState()
  const catalogue = useCatalogue()
  const product = getProduct(alternative.productId, catalogue)
  if (!product) return null
  const onList = state.shopping.some((s) => s.productId === product.id)
  const fact = alternative.facts[0]
  const ingredient = fact ? getIngredient(fact.ingredientId, catalogue) : undefined

  return (
    <div className={`notice ${styles.box}`}>
      <p>{t('alt.consider', { product: tl(product.name) })}</p>
      {fact && ingredient && (
        <p className="small">
          {t('alt.also', {
            ingredient: tl(ingredient.name).toLocaleLowerCase(intlLocale()),
            amount: formatAmount(fact.amount, fact.unit),
            serving: formatServingSize(fact.serving).replace(/^1\s+/, ''),
          })}
        </p>
      )}
      <div className="row">
        {onList ? (
          <span className="small muted">{t('manage.onShopping')}</span>
        ) : (
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() =>
              dispatch({
                type: 'ADD_TO_SHOPPING',
                productId: product.id,
                reason: 'alternative',
                replacesProductId: productId,
              })
            }
          >
            {t('manage.addToShopping')}
          </button>
        )}
        {product.sourceUrl && (
          <a
            className="btn btn--small btn--link"
            href={buyOnlineUrl(product.sourceUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('alt.view')} ›
          </a>
        )}
      </div>
    </div>
  )
}
