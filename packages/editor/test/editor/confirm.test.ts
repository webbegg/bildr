import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import EditorConfirm from '../../src/components/editor/EditorConfirm.vue'
import { provideEditor } from '../../src/editor/useEditor.ts'
import type { ConfirmOptions } from '../../src/editor/useEditor.ts'
import type { UseEntry } from '../../src/shared/dataArtifacts.ts'
import { click, mountWithApp, settle } from '../helpers.ts'
import { boot, setupHarness } from './boot.ts'
import { q, qa, text } from './dataKit.ts'

/**
 * The editor's confirm dialog (EditorConfirm) on its own, over `editor.confirm`: what it shows for `description`, `items` and the
 * `uses` of a delete or a rename, what opening a use does, and the one-button dialog of a `blocked` change.
 */

setupHarness()

const PAGE: UseEntry = { kind: 'page', id: 'pg_index', name: 'index', what: ['A Text shows “post.title”'] }
const AUTOMATIC: UseEntry = { kind: 'action', id: 'act_create_post', name: 'createPost', what: ['Takes it as its input'], follows: true }

/** The editor, with the confirm dialog mounted over it. */
const mountConfirm = async () => {
  const { editor } = await boot()
  const Host = defineComponent({
    setup() {
      provideEditor(editor)
      return () => h(EditorConfirm)
    }
  })
  await mountWithApp(Host)
  return editor
}
const REQUEST: ConfirmOptions = { title: 'Delete it?', description: 'It goes for good.', confirmLabel: 'Delete', danger: true }
/** The labels of the dialog's buttons (a place's link has none: it is an icon). */
const buttons = () => qa('[role="dialog"] button').map(text).filter(Boolean)

describe('the confirm dialog', () => {
  it('asks with the title, the description and the lines it reaches, and answers yes on its confirm button', async () => {
    const editor = await mountConfirm()
    const answer = editor.confirm({ ...REQUEST, items: ['pg_one', 'pg_two'] })
    await settle()
    expect(text(q('[role="dialog"]'))).toContain('Delete it?')
    expect(text(q('[data-confirm-description]'))).toBe('It goes for good.')
    expect(qa('[data-confirm-items] li').map(text)).toEqual(['pg_one', 'pg_two'])
    expect(buttons()).toEqual(['Cancel', 'Delete'])
    expect(q('[data-confirm-ok]')!.hasAttribute('disabled')).toBe(false)
    await click(q('[data-confirm-ok]'))
    expect(await answer).toBe(true)
    expect(q('[data-confirm]')).toBeNull()
  })

  it('answers no on Cancel, and closes', async () => {
    const editor = await mountConfirm()
    const answer = editor.confirm(REQUEST)
    await settle()
    await click(q('[data-confirm-cancel]'))
    expect(await answer).toBe(false)
    expect(q('[data-confirm]')).toBeNull()
  })

  it('lists the uses as links, tags the ones the module changes itself, and answers no and closes when one is opened', async () => {
    const editor = await mountConfirm()
    const answer = editor.confirm({ ...REQUEST, uses: [PAGE, AUTOMATIC] })
    await settle()
    expect(qa('[data-confirm-uses] [data-use]').map(use => use.getAttribute('data-use'))).toEqual(['page:pg_index', 'action:act_create_post'])
    expect(text(q('[data-use="page:pg_index"]'))).not.toContain('Updated automatically')
    expect(text(q('[data-use="action:act_create_post"]'))).toContain('Updated automatically')
    // The change itself is still there to confirm: `uses` alone does not block it.
    expect(buttons()).toEqual(['Cancel', 'Delete'])
    await click(q('[data-use-open="action:act_create_post"]'))
    expect(await answer).toBe(false)
    expect(q('[data-confirm]')).toBeNull()
    expect(editor.actionId).toBe('act_create_post')
  })

  it('has one Close button, and no confirm button, when the change is blocked', async () => {
    const editor = await mountConfirm()
    const answer = editor.confirm({ ...REQUEST, title: '“title” is used in 1 place', uses: [PAGE], blocked: true })
    await settle()
    expect(text(q('[role="dialog"]'))).toContain('“title” is used in 1 place')
    expect(qa('[data-confirm-uses] [data-use]')).toHaveLength(1)
    expect(buttons()).toEqual(['Close'])
    expect(q('[data-confirm-ok]')).toBeNull()
    await click(q('[data-confirm-cancel]'))
    expect(await answer).toBe(false)
    expect(q('[data-confirm]')).toBeNull()
  })

  it('answers no to a dialog that is still open when another is asked for', async () => {
    const editor = await mountConfirm()
    const first = editor.confirm(REQUEST)
    await settle()
    const second = editor.confirm({ ...REQUEST, title: 'Another?' })
    await settle()
    expect(await first).toBe(false)
    expect(text(q('[role="dialog"]'))).toContain('Another?')
    await click(q('[data-confirm-ok]'))
    expect(await second).toBe(true)
  })
})
