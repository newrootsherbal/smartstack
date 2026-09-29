/** Outbound links the app builds. */

/** A product page with the shopping-list campaign tags (build prompt §4.6). */
export function buyOnlineUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl)
  url.searchParams.set('utm_source', 'smartstack')
  url.searchParams.set('utm_medium', 'app')
  url.searchParams.set('utm_campaign', 'shopping_list')
  return url.toString()
}
