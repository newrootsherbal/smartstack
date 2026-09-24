import { getProduct, getRule } from '@smartstack/engine'
import type { Reason } from '@smartstack/shared'
import { useProductText } from '../hooks/useProductText'
import { t, tl } from '../i18n'
import { SeverityBadge } from './SeverityBadge'
import { Sheet } from './Sheet'
import styles from './WhySheet.module.css'

interface WhySheetProps {
  reasons: Reason[] | null
  onClose: () => void
}

/** Explanation + severity badge, then the pitch document's four "Learn more" rows. */
export function WhySheet({ reasons, onClose }: WhySheetProps) {
  const open = reasons !== null && reasons.length > 0
  const first = reasons?.[0]
  const product = first ? getProduct(first.productId) : undefined
  const text = useProductText(product)
  const title = product ? `${t('why.title')} ${tl(product.shortName)}` : t('why.title')

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {(reasons ?? []).map((reason) => {
        const rule = getRule(reason.ruleId)
        if (!rule) return null
        return (
          <article key={reason.ruleId} className={styles.reason}>
            <p className={styles.explanation}>{tl(rule.explanation)}</p>
            <SeverityBadge severity={rule.severity} />
            <details className={styles.details}>
              <summary>{t('common.learnMore')}</summary>
              <dl className={styles.dl}>
                <dt>{t('why.evidence')}</dt>
                <dd>
                  {rule.evidenceUrl ? (
                    <a href={rule.evidenceUrl} target="_blank" rel="noopener noreferrer">
                      {t('why.openSource')}
                      <span className="visually-hidden"> ({rule.evidenceUrl})</span>
                    </a>
                  ) : (
                    <span className="muted">{t('common.sourceToBeAdded')}</span>
                  )}
                </dd>
                <dt>{t('why.productInfo')}</dt>
                <dd>
                  {product ? (
                    <div className="stack-v">
                      {product.status === 'sample' ? (
                        <p className="small muted">
                          <span className="tag tag--sample">{t('common.sample')}</span>{' '}
                          {t('why.sampleNote')}
                        </p>
                      ) : (
                        <p className="small muted">{t('why.draftNote')}</p>
                      )}
                      <p>
                        <strong>{t('why.directions')}:</strong>{' '}
                        {text ? (text.directions ? tl(text.directions) : '—') : t('common.loading')}
                      </p>
                      <p>
                        <strong>{t('why.warnings')}:</strong>{' '}
                        {text ? (text.warnings ? tl(text.warnings) : '—') : t('common.loading')}
                      </p>
                      {product.sourceUrl && (
                        <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {t('why.productPage')}
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </dd>
                <dt>{t('why.lastReviewed')}</dt>
                <dd>{rule.lastReviewed ?? t('common.notYetReviewed')}</dd>
                <dt>{t('why.reviewedBy')}</dt>
                <dd>{rule.reviewedBy ?? t('common.notYetReviewed')}</dd>
              </dl>
            </details>
          </article>
        )
      })}
    </Sheet>
  )
}
