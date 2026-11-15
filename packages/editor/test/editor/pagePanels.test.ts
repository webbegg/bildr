import { defineComponent, h, onBeforeUnmount, provide } from 'vue'
import { describe, expect, it } from 'vitest'
import EditorPageCollection from '../../src/components/editor/EditorPageCollection.vue'
import EditorPageLayout from '../../src/components/editor/EditorPageLayout.vue'
import { createDesign, DESIGN_KEY } from '../../src/design/store.ts'
import { createEditor, provideEditor } from '../../src/editor/useEditor.ts'
import { baseHandlers, setupHarness } from '../design/harness.ts'
import { mockActions, mountWithApp, settle } from '../helpers.ts'
import type { Handler } from '../helpers.ts'

/**
 * The page settings' rows (U3): the layout the page renders in, its slots, and the detail page rows
 * (the Collection is disabled with a "coming soon" hint; the P5 "Data this page uses" panel sits under it).
 * Mounted on their own over the store, as the Inspector (U4) will mount them.
 */

setupHarness()

/** Mounts `component` with the store and the adapter provided, on page `file`. */
const mountOn = async (component: unknown, file: string, extra: Record<string, Handler> = {}) => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra })
  const Host = defineComponent({
    setup() {
      const design = createDesign()
      provide(DESIGN_KEY, design)
      const editor = provideEditor(createEditor(design))
      void editor.start().then(() => editor.selectPage(file))
      onBeforeUnmount(() => editor.dispose())
      return () => h(component as never)
    }
  })
  await mountWithApp(Host)
  await settle()
  return actions
}

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)

describe('EditorPageCollection', () => {
  it('shows the Collection disabled with a coming-soon hint, and the page\'s path when it takes parameters', async () => {
    await mountOn(EditorPageCollection, 'pg_post_detail')
    expect(q('[data-page-collection]')).not.toBeNull()
    expect(q('[data-page-collection] [role="combobox"]')?.hasAttribute('disabled')).toBe(true)
    expect(q('[data-page-collection-soon]')?.textContent).toContain('coming soon')
    expect(q('[data-page-path]')?.textContent?.trim()).toBe('/posts/:slug')
  })

  it('keeps the P5 panel of what the page uses next to it', async () => {
    await mountOn(EditorPageCollection, 'pg_index')
    expect(q('[data-testid="page-uses"]')).not.toBeNull()
    expect(q('[data-page-path]')).toBeNull()
  })
})

describe('EditorPageLayout', () => {
  it('shows the page\'s layout with an Edit button, and the layout\'s named slots as Own content switches', async () => {
    const actions = await mountOn(EditorPageLayout, 'pg_index', { page_set_slot: () => ({ changed: [] }) })
    expect(q('[data-page-layout]')?.textContent).toContain('main')
    expect(q('[aria-label="Edit layout main"]')).not.toBeNull()
    const slot = q('[aria-label$=": own content"]')
    expect(slot).not.toBeNull()
    slot!.click()
    await settle()
    expect(actions.named('page_set_slot')).toHaveLength(1)
    expect(actions.named('page_set_slot')[0]!.input).toMatchObject({ page: 'pg_index', filled: expect.any(Boolean) })
  })
})
