import type { ReactNode } from 'react'

/**
 * Consent and notice texts keep the exact wording of docs/privacy/consent-texts.md, where the
 * linked words are in [brackets]. This renders the bracketed part as `link(words)`.
 */
export function ConsentText({ text, link }: { text: string; link: (words: string) => ReactNode }) {
  const match = /\[([^\]]+)\]/.exec(text)
  if (!match) return <>{text}</>
  return (
    <>
      {text.slice(0, match.index)}
      {link(match[1]!)}
      {text.slice(match.index + match[0].length)}
    </>
  )
}
