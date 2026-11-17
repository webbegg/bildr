import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import DataNewCollection from '../../src/components/data/DataNewCollection.vue'
import { provideEditor } from '../../src/editor/useEditor.ts'
import { Failure, settle } from '../helpers.ts'
import { selectOption, world } from '../design/harness.ts'
import { boot, setupHarness } from './boot.ts'

/**
 * The New collection dialog (S7), mounted as the Data tree hosts it: a name and where the rows live (Sample data, the default;
 * Database, only when the project has one; REST API, an existing or a new connection), what each choice does on Create, and
 * that a refusal stays inside it.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const wrappers: Array<{ unmount: () => void }> = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

const made = { entity_create: () => ({ entityId: 'ent_menu', repositoryId: 'repo_menu', queryIds: [] }) }

/** Mounts the dialog open inside the editor; `handed` collects what it hands to the connection dialogs. */
const mounted = async (extra: Record<string, (input: Record<string, unknown>) => unknown> = made, props: Record<string, unknown> = {}) => {
  const { editor, actions } = await boot(extra)
  const handed: Array<[string, unknown]> = []
  const closed: boolean[] = []
  const Host = defineComponent({
    setup: () => {
      provideEditor(editor)
      return () => h(UApp, null, {
        default: () => h(DataNewCollection as never, {
          'open': true,
          ...props,
          'onUpdate:open': (value: boolean) => closed.push(value),
          'onConnection': (value: unknown) => handed.push(['connection', value]),
          'onImport': (value: unknown) => handed.push(['import', value])
        })
      })
    }
  })
  wrappers.push(mount(Host, { attachTo: document.body, global: { plugins: [ui] } }))
  await settle()
  return { editor, actions, handed, closed }
}

const storage = (kind: string) => q(`[data-storage="${kind}"]`)!
const checked = () => qa('[data-storage][aria-checked="true"]').map(option => option.getAttribute('data-storage'))
const name = () => q('[data-new-collection-name]') as HTMLInputElement
const type = async (value: string) => {
  name().value = value
  name().dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
const create = async () => {
  q('[data-artifact-submit]')!.click()
  await settle()
}

describe('the New collection dialog', () => {
  it('asks for a name and where the rows live, with Sample data chosen', async () => {
    await mounted()
    expect(text(q('[role="dialog"]'))).toContain('New collection')
    expect(name().value).toBe('')
    expect(qa('[data-storage]').map(option => option.getAttribute('data-storage'))).toEqual(['sample', 'database', 'rest'])
    expect(checked()).toEqual(['sample'])
    expect(text(storage('sample'))).toContain('Sample data')
    expect(text(storage('sample'))).toContain('Rows you edit here.')
    expect(text(storage('database'))).toContain('Rows live in your app\'s database.')
  })

  it('cannot be created without a name', async () => {
    await mounted()
    expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(true)
    await type('Menu')
    expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(false)
  })

  it('does not offer Database when the project has none', async () => {
    world.model.datasources = world.model.datasources.filter(source => source.kind !== 'sqlite')
    await mounted()
    expect(qa('[data-storage]').map(option => option.getAttribute('data-storage'))).toEqual(['sample', 'rest'])
  })

  it('creates on Sample data by default, over a source named "sample", and opens the Fields tab', async () => {
    const { editor, actions, closed } = await mounted({ ...made, datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }) })
    await type('Menu')
    await create()
    expect(actions.named('datasource_create').map(call => call.input)).toEqual([{ name: 'sample', kind: 'memory' }])
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Menu', source: 'ds_sample', fields: [{ name: 'title', type: 'text' }] }])
    expect(editor.dataTab).toBe('fields')
    expect(editor.mode).toBe('data')
    expect(editor.collectionId).toBe('ent_menu')
    expect(closed).toEqual([false])
  })

  it('creates on the project\'s memory source when it has one', async () => {
    world.model.datasources.push({ id: 'ds_scratch', name: 'scratch', kind: 'memory', env: {} })
    const { actions } = await mounted()
    await type('Menu')
    await create()
    expect(actions.named('datasource_create')).toEqual([])
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Menu', source: 'ds_scratch', fields: [{ name: 'title', type: 'text' }] }])
  })

  it('creates on the database when Database is chosen', async () => {
    const { editor, actions } = await mounted()
    await type('Menu')
    storage('database').click()
    await settle()
    expect(checked()).toEqual(['database'])
    await create()
    expect(actions.named('datasource_create')).toEqual([])
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Menu', source: 'ds_main', fields: [{ name: 'title', type: 'text' }] }])
    expect(editor.dataTab).toBe('fields')
  })

  it('makes nothing when the user cancels', async () => {
    const { actions, closed } = await mounted()
    await type('Menu')
    const cancel = qa('[role="dialog"] button').find(button => text(button) === 'Cancel')!
    cancel.click()
    await settle()
    expect(closed).toEqual([false])
    expect(actions.named('datasource_create')).toEqual([])
    expect(actions.named('entity_create')).toEqual([])
  })

  it('shows a refusal inside the dialog, keeps what was typed and chosen, and removes the source it made', async () => {
    const { editor, actions, closed } = await mounted({
      datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }),
      entity_create: () => new Failure(422, 'invalid', 'Module "blog" already has the entity Menu (ent_menu)'),
      datasource_delete: () => ({ changed: [], database: false })
    })
    await type('Menu')
    await create()
    expect(text(q('[data-artifact-error]'))).toContain('already has the entity')
    expect(editor.error).toBeNull()
    expect(name().value).toBe('Menu')
    expect(checked()).toEqual(['sample'])
    expect(closed).toEqual([])
    expect(actions.named('datasource_delete').map(call => call.input)).toEqual([{ datasource: 'ds_sample' }])
    expect(editor.dataTab).not.toBe('fields')
    // Typing again clears it.
    await type('Menu2')
    expect(q('[data-artifact-error]')).toBeNull()
  })

  describe('on REST API', () => {
    const rest = async (props: Record<string, unknown> = {}) => {
      const mount_ = await mounted(made, props)
      storage('rest').click()
      await settle()
      return mount_
    }

    it('offers the project\'s connections and a new one, and chooses the first connection', async () => {
      await rest()
      expect(checked()).toEqual(['rest'])
      expect(text(q('[data-new-collection-connection]'))).toContain('quotes')
      expect(q('[data-artifact-submit]')!.textContent).toContain('Continue')
    })

    it('hands an existing connection and the name to its collection dialog, and makes nothing itself', async () => {
      const { actions, handed, closed } = await rest()
      await type('Menu')
      await create()
      expect(handed).toEqual([['connection', { connection: 'ds_quotes', name: 'Menu' }]])
      expect(closed).toEqual([false])
      expect(actions.named('entity_create')).toEqual([])
      expect(actions.named('datasource_create')).toEqual([])
    })

    it('hands "New connection…" to the Import from URL dialog', async () => {
      const { handed, closed } = await rest()
      await selectOption(q('[data-new-collection-connection] [role="combobox"]') ?? q('[data-new-collection-connection]'), 'New connection…')
      await type('Menu')
      await create()
      expect(handed).toEqual([['import', { name: 'Menu' }]])
      expect(closed).toEqual([false])
    })

    it('opens with REST API and that connection when it is asked for one (the connection\'s Add…)', async () => {
      const { handed } = await mounted(made, { connection: 'ds_quotes' })
      expect(checked()).toEqual(['rest'])
      await type('Menu')
      await create()
      expect(handed).toEqual([['connection', { connection: 'ds_quotes', name: 'Menu' }]])
    })

    it('needs no name: the connection dialog proposes one from the endpoint', async () => {
      const { handed } = await rest()
      expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(false)
      await create()
      expect(handed).toEqual([['connection', { connection: 'ds_quotes', name: '' }]])
    })

    it('has only a new connection to offer when the project has none', async () => {
      world.model.datasources = world.model.datasources.filter(source => source.kind !== 'rest')
      world.model.modules.blog!.entities = world.model.modules.blog!.entities.filter(entity => entity.id !== 'ent_quote')
      world.model.modules.blog!.repositories = world.model.modules.blog!.repositories.filter(repository => repository.entity !== 'ent_quote')
      const { handed } = await rest()
      await create()
      expect(handed).toEqual([['import', { name: '' }]])
    })
  })
})
