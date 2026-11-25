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
  const start = lines.findIndex(line => line.includes('<section class="flex flex-col items-start gap-3'))
  const indent = lines[start]!.match(/^ */)![0]
  const end = lines.findIndex((line, index) => index > start && line === `${indent}</section>`)
  return lines.slice(start, end + 1).map(line => line.slice(indent.length)).join('\n')
}

describe('legacy layout containers (layout-containers S4)', () => {
  // Taken before the one-container model; the only deliberate change since: a child of a Container or
  // Card laid out as a row (or of a Container laid out as a grid or a block) no longer gets the vertical
  // stack's `self-stretch` (T2, log L4). Every other type keeps its type's rule, a Column set to a grid too.
  // Since codegen-architecture T1 the classes are in Tailwind's order, without a default `flex-row`, and a
  // 1px border is the bare `border-*` class: the same CSS. A static one-line Text has no `whitespace-pre-line` (no-op).
  it('render the same markup as before the one-container model', () => {
    expect(legacyMarkup()).toMatchInlineSnapshot(`
      "<section class="flex flex-col items-start gap-3 self-stretch p-4">
        <div class="flex flex-wrap items-center gap-3 self-stretch md:gap-6">
          <p>a</p>
          <div class="flex w-full flex-col" />
          <div class="flex flex-col gap-2" />
        </div>
        <nav class="flex justify-between self-stretch">
          <p>b</p>
        </nav>
        <div class="flex flex-col items-start gap-3 self-stretch md:flex-row">
          <h3 class="self-stretch text-center text-2xl font-semibold">c</h3>
          <div class="flex gap-1 self-stretch" />
          <UButton label="d" />
        </div>
        <div class="grid grid-cols-3 gap-6 self-stretch md:grid-cols-4">
          <div class="col-span-2 flex flex-col" />
          <p>e</p>
        </div>
        <div class="self-stretch overflow-hidden rounded-lg bg-default p-4 ring ring-default">
          <div class="flex items-start gap-3">
            <p>f</p>
            <div class="flex flex-col" />
          </div>
        </div>
        <div class="flex gap-2 self-stretch">
          <div class="flex flex-col" />
        </div>
        <div class="grid grid-cols-2 self-stretch">
          <div class="flex flex-col self-stretch" />
        </div>
      </section>"
    `)
  })
})
