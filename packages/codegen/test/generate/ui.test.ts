import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import type { ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

/** What the layouts, pages and components generate (T7c). */
const UI_FILES = [
  'layers/blog/app/components/blog/PostCard.vue',
  'layers/blog/app/components/blog/Tip.vue',
  'layers/blog/app/pages/catalog/[category].vue',
  'layers/blog/app/pages/index.vue',
  'layers/blog/app/pages/posts/[slug].vue',
  'layers/blog/app/pages/posts/new.vue',
  'layers/blog/app/pages/weather/[city].vue',
  'layers/core/app/layouts/main.vue'
]

describe('generateUi on the golden fixture', () => {
  const files = generateUi(fixtureModel())
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8')).files as Record<string, { source?: string }>

  it('emits exactly the UI files', () => {
    expect(files.map(file => file.path)).toEqual(UI_FILES)
  })

  it.each(UI_FILES)('%s matches the fixture byte for byte', (path) => {
    expect(files.find(file => file.path === path)?.content).toBe(readFileSync(join(fixtureRoot, path), 'utf8'))
  })

  it('records each file as managed with the model file it comes from', () => {
    for (const file of files) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.source, file.path).toBe(manifest[file.path]!.source)
    }
  })

  it('is deterministic', () => {
    expect(generateUi(fixtureModel())).toEqual(files)
  })
})

/** The fixture with one extra node in the index page's root. */
const withNode = (node: ModelNode) => {
  const model = fixtureModel()
  model.modules.blog!.pages.find(page => page.name === 'index')!.root.children!.push(node)
  return model
}
const indexPage = (model: Model) => generateUi(model).find(file => file.path.endsWith('pages/index.vue'))!.content

describe('generateUi rules', () => {
  it('refuses style tokens the registry does not have, naming the file and node', () => {
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Text', props: { text: 'x' }, style: { fontSize: 'lg' } })))
      .toThrow(/index\.json \(node n_x\): Unknown style token "fontSize"/)
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Text', props: { text: 'x' }, style: { p: '7' } })))
      .toThrow(/"7" is not a value of style token "p"/)
  })

  it('refuses node types and interactions it cannot generate yet', () => {
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Video' }))).toThrow(/node type Video can't be generated yet/)
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Button', props: { text: 'x' }, interactions: [{ on: 'click', do: [{ kind: 'setVariant' }] }] })))
      .toThrow(/click interaction can't be generated yet/)
  })

  it('refuses bindings to names the page does not use', () => {
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Text', props: { text: { $bind: 'nope.title' } } }))).toThrow(/"nope\.title" doesn't refer to anything/)
  })

  it('escapes static text and attributes so they never become markup or interpolation', () => {
    const page = indexPage(withNode({ id: 'n_x', type: 'Text', props: { text: '<b>{{ secret }}</b> & co' } }))
    expect(page).toContain('<p>&lt;b&gt;&#123;&#123; secret }}&lt;/b&gt; &amp; co</p>')
    const button = indexPage(withNode({ id: 'n_x', type: 'Button', props: { text: 'Say "hi"' } }))
    expect(button).toContain('<UButton label="Say &quot;hi&quot;" />')
    const lines = indexPage(withNode({ id: 'n_x', type: 'Text', props: { text: `a\rb${String.fromCharCode(0x2028)}c` } }))
    expect(lines).toContain('<p>a&#13;b&#8232;c</p>')
  })

  it('renders hex colours inline and theme tokens as classes', () => {
    const page = indexPage(withNode({ id: 'n_x', type: 'Text', props: { text: 'x' }, style: { bg: '#ff0066', color: 'muted' } }))
    expect(page).toContain('<p class="text-muted" style="background-color: #ff0066">x</p>')
  })

  it('only declares the composable parts the template uses', () => {
    const page = indexPage(fixtureModel())
    // The quotes List reads its status for its error line (T3c2), nothing else: no error, no refresh.
    expect(page).toContain('const { data: quotes, status: quotesStatus } = useLatestQuotes(3)')
    expect(page).not.toMatch(/quotesError|refresh/)
  })

  it('calls useSeoMeta after the declarations its getters read (unhead calls them at once)', () => {
    const page = generateUi(fixtureModel()).find(file => file.path.endsWith('posts/[slug].vue'))!.content
    expect(page.indexOf('useSeoMeta(')).toBeGreaterThan(page.indexOf('const { post, isLoading: postLoading }'))
  })

  it('refuses container tags outside the allowed set', () => {
    expect(() => generateUi(withNode({ id: 'n_x', type: 'Container', props: { tag: 'script' } }))).toThrow(/tag must be one of/)
  })
})
