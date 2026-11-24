import { describe, expect, it } from 'vitest'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { LEGACY_LAYOUT_TREE } from './layout-legacy.fixture'

/** The markup of the fixture tree, appended to the index page: from its `<section>` to its closing tag. */
const legacyMarkup = () => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  result.model.modules.blog!.pages.find(page => page.name === 'index')!.root.children!.push(structuredClone(LEGACY_LAYOUT_TREE))
  const lines = generateUi(result.model).find(file => file.path.endsWith('pages/index.vue'))!.content.split('\n')
  const start = lines.findIndex(line => line.includes('<section class="flex p-4 gap-3'))
  const indent = lines[start]!.match(/^ */)![0]
  const end = lines.findIndex((line, index) => index > start && line === `${indent}</section>`)
  return lines.slice(start, end + 1).map(line => line.slice(indent.length)).join('\n')
}

describe('legacy layout containers (layout-containers S4)', () => {
  // Taken before the one-container model; the only deliberate change since: a child of a Container or
  // Card laid out as a row, or of a Column set to a grid, no longer gets the vertical stack's `self-stretch` (T2).
  it('render the same markup as before the one-container model', () => {
    expect(legacyMarkup()).toMatchInlineSnapshot(`
      "<section class="flex p-4 gap-3 flex-col items-start self-stretch">
        <div class="flex gap-3 md:gap-6 flex-row flex-wrap items-center self-stretch">
          <p class="whitespace-pre-line">a</p>
          <div class="flex w-full flex-col" />
          <div class="flex gap-2 flex-col" />
        </div>
        <nav class="flex flex-row justify-between self-stretch">
          <p class="whitespace-pre-line">b</p>
        </nav>
        <div class="flex gap-3 flex-col md:flex-row items-start self-stretch">
          <h3 class="text-2xl font-semibold text-center self-stretch">c</h3>
          <div class="flex gap-1 flex-row self-stretch" />
          <UButton label="d" />
        </div>
        <div class="grid gap-6 self-stretch grid-cols-3 md:grid-cols-4">
          <div class="flex flex-col col-span-2" />
          <p class="whitespace-pre-line">e</p>
        </div>
        <div class="ring ring-default p-4 bg-default rounded-lg self-stretch overflow-hidden">
          <div class="flex gap-3 flex-row items-start">
            <p class="whitespace-pre-line">f</p>
            <div class="flex flex-col" />
          </div>
        </div>
        <div class="flex gap-2 flex-row self-stretch">
          <div class="flex flex-col" />
        </div>
        <div class="flex-col self-stretch grid-cols-2 grid">
          <div class="flex flex-col" />
        </div>
      </section>"
    `)
  })
})
