/**
 * Colour themes. Each one is a block of CSS custom properties in styles/themes.css,
 * selected by `data-theme` on <html>. The same attribute on any element previews that
 * theme inside the current one (the swatches in Settings).
 */
export const THEME_IDS = ['rooted', 'fresh', 'blush', 'bold', 'ice', 'energy', 'wild'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** What new users get, and what `:root` carries when nothing is stored. */
export const DEFAULT_THEME: ThemeId = 'rooted'

export const THEMES: readonly { id: ThemeId; emoji: string }[] = [
  { id: 'rooted', emoji: '🌿' },
  { id: 'fresh', emoji: '☀️' },
  { id: 'blush', emoji: '🎀' },
  { id: 'bold', emoji: '🖤' },
  { id: 'ice', emoji: '🧊' },
  { id: 'energy', emoji: '🍊' },
  { id: 'wild', emoji: '🍄' },
]

/**
 * Switch the document to a theme. The browser chrome (Android status bar, installed-app
 * title bar) follows the theme's background through the theme-color meta tag. index.html
 * sets the same attribute inline before the first paint, so a dark theme never flashes light.
 */
export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement
  root.dataset.theme = theme
  const bg = getComputedStyle(root).getPropertyValue('--color-bg').trim()
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta && bg) meta.content = bg
}
