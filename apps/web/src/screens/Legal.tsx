import { Fragment, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import type { Block, Inline, ListItem } from '../../scripts/legal.mjs'
import { en, fr, getLocale } from '../i18n'
import content from '../legal/content.json'
import styles from './Legal.module.css'

/** Drafts until the Privacy Officer approves them (VITE_LEGAL_DRAFT=false at launch). */
const DRAFT = import.meta.env.VITE_LEGAL_DRAFT !== 'false'

function inline(parts: Inline[]): ReactNode {
  return parts.map((part, i) =>
    typeof part === 'string' ? (
      <Fragment key={i}>{part}</Fragment>
    ) : (
      <strong key={i}>{part.b}</strong>
    ),
  )
}

function list(items: ListItem[]): ReactNode {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {inline(item.text)}
          {item.children && list(item.children)}
        </li>
      ))}
    </ul>
  )
}

function block(b: Block, i: number): ReactNode {
  if ('h' in b) {
    const Heading = b.h === 1 ? 'h1' : b.h === 2 ? 'h2' : 'h3'
    return <Heading key={i}>{b.text}</Heading>
  }
  if ('p' in b) return <p key={i}>{inline(b.p)}</p>
  if ('ul' in b) return <Fragment key={i}>{list(b.ul)}</Fragment>
  return (
    <div key={i} className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {b.table.head.map((cell, j) => (
              <th key={j}>{inline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, j) => (
                <td key={j}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** /privacy and /terms, rendered from docs/privacy at build time (`?lang=fr|en` to pick one). */
export default function Legal({ doc }: { doc: 'privacy' | 'terms' }) {
  const [params] = useSearchParams()
  const requested = params.get('lang')
  const lang = requested === 'fr' || requested === 'en' ? requested : getLocale()
  const blocks = (content as { privacy: Record<string, Block[]>; terms: Record<string, Block[]> })[
    doc
  ][lang]!
  return (
    <main className={`screen screen--no-nav ${styles.legal}`} lang={lang}>
      {/* In the page's own language, which `?lang=` may set apart from the app's. */}
      {DRAFT && <p className="notice notice--warn">{(lang === 'fr' ? fr : en).legal.draft}</p>}
      {blocks.map(block)}
    </main>
  )
}
