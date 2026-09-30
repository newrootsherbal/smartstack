import { describe, expect, it } from 'vitest'
import { buildAll, convert } from '../../scripts/legal.mjs'
import content from './content.json'

describe('legal pages', () => {
  it('are up to date with docs/privacy (run `npm run legal -w apps/web` after editing)', () => {
    expect(content).toEqual(buildAll())
  })

  it('drop the drafting comments and keep headings, bold, nested lists and tables', () => {
    const blocks = convert(`<!-- note -->
# Title

Some **bold** text
on two lines.

- one
- two
  - nested
    continued

| A | B |
| --- | --- |
| **x** | y |
`)
    expect(blocks).toEqual([
      { h: 1, text: 'Title' },
      { p: ['Some ', { b: 'bold' }, ' text on two lines.'] },
      {
        ul: [{ text: ['one'] }, { text: ['two'], children: [{ text: ['nested continued'] }] }],
      },
      { table: { head: [['A'], ['B']], rows: [[[{ b: 'x' }], ['y']]] } },
    ])
  })
})
