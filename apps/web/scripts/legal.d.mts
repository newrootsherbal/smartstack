// Types for the build script, so the drift test can import it.
export type Inline = string | { b: string }
export interface ListItem {
  text: Inline[]
  children?: ListItem[]
}
export type Block =
  | { h: number; text: string }
  | { p: Inline[] }
  | { ul: ListItem[] }
  | { table: { head: Inline[][]; rows: Inline[][][] } }
export type LegalDoc = Record<'en' | 'fr', Block[]>
export function inline(text: string): Inline[]
export function convert(markdown: string): Block[]
export function buildAll(): { privacy: LegalDoc; terms: LegalDoc }
