import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import DataArtifactCreate from '../../src/components/data/DataArtifactCreate.vue'
import DataArtifactDelete from '../../src/components/data/DataArtifactDelete.vue'
import DataArtifactRename from '../../src/components/data/DataArtifactRename.vue'
import { provideEditor } from '../../src/editor/useEditor.ts'
import { settle } from '../helpers.ts'
import { boot, setupHarness } from './boot.ts'

/**
 * The three dialogs of the Queries and Actions sections (S10), mounted with what they are about already asked for: the first
 * thing a dialog does is run its `opened` callback (`useArtifactDialog` watches immediately), which must not read what is not
 * built yet.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

/** Mounts `dialog` with `props` inside the editor, as the Data screen hosts it. */
const mounted = async (dialog: typeof DataArtifactCreate | typeof DataArtifactDelete | typeof DataArtifactRename, props: Record<string, unknown>) => {
  const { editor } = await boot()
  const Host = defineComponent({
    setup: () => {
      provideEditor(editor)
      return () => h(UApp, null, { default: () => h(dialog as never, props) })
    }
  })
  wrappers.push(mount(Host, { attachTo: document.body, global: { plugins: [ui] } }))
  await settle()
  return editor
}

describe('a dialog mounted with its target already set', () => {
  it('Rename starts with the name of the query', async () => {
    await mounted(DataArtifactRename, { target: { kind: 'query', id: 'q_featured_posts' } })
    expect(text(q('[role="dialog"]'))).toContain('Rename query')
    expect((q('[data-artifact-name]') as HTMLInputElement).value).toBe('featuredPosts')
    expect(text(q('[data-artifact-hint]'))).toContain('`useFeaturedPosts`')
  })

  it('Rename starts with the name of the action', async () => {
    await mounted(DataArtifactRename, { target: { kind: 'action', id: 'act_create_post' } })
    expect(text(q('[role="dialog"]'))).toContain('Rename action')
    expect((q('[data-artifact-name]') as HTMLInputElement).value).toBe('createPost')
  })

  it('Delete shows what it deletes', async () => {
    await mounted(DataArtifactDelete, { target: { kind: 'action', id: 'act_publish_post' } })
    expect(text(q('[role="dialog"]'))).toContain('Delete action')
    expect(text(q('[role="dialog"]'))).toContain('(publishPost)')
  })

  it('Create starts on the first collection, with an empty name', async () => {
    await mounted(DataArtifactCreate, { kind: 'query' })
    expect(text(q('[role="dialog"]'))).toContain('New query')
    expect(text(q('[data-artifact-collection-select]'))).toContain('Post')
    expect((q('[data-artifact-name]') as HTMLInputElement).value).toBe('')
  })
})
