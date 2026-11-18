import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import DataNewCollection from '../../src/components/data/DataNewCollection.vue'
import { provideEditor } from '../../src/editor/useEditor.ts'
import { Failure, settle } from '../helpers.ts'
import { chooseConnection, world } from '../design/harness.ts'
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

/**
 * Mounts the dialog inside the editor, open as its parent holds it (`isOpen`: what the dialog asks for with `update:open` is
 * taken on, as the Data tree does); `handed` collects what it hands to the connection dialogs and `closed` what it asked for.
 */
const mounted = async (extra: Record<string, (input: Record<string, unknown>) => unknown> = made, props: Record<string, unknown> = {}) => {
  const { editor, actions, design } = await boot(extra)
  const handed: Array<[string, unknown]> = []
  const closed: boolean[] = []
  const isOpen = ref(true)
  const Host = defineComponent({
    setup: () => {
      provideEditor(editor)
      return () => h(UApp, null, {
        default: () => h(DataNewCollection as never, {
          'open': isOpen.value,
          ...props,
          'onUpdate:open': (value: boolean) => {
            closed.push(value)
            isOpen.value = value
          },
          'onConnection': (value: unknown) => handed.push(['connection', value]),
          'onImport': (value: unknown) => handed.push(['import', value])
        })
      })
    }
  })
  wrappers.push(mount(Host, { attachTo: document.body, global: { plugins: [ui] } }))
  await settle()
  return { editor, actions, design, handed, closed, isOpen }
}

const storage = (kind: string) => q(`[data-storage="${kind}"]`)!
const kinds = () => qa('[data-storage]').map(option => option.getAttribute('data-storage'))
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
const cancelButton = () => qa('[role="dialog"] button').find(button => text(button) === 'Cancel')!
const withoutDatabase = () => {
  world.model.datasources = world.model.datasources.filter(source => source.kind !== 'sqlite')
}

describe('the New collection dialog', () => {
  it('asks for a name and where the rows live, with Sample data chosen', async () => {
    await mounted()
    expect(text(q('[role="dialog"]'))).toContain('New collection')
    expect(name().value).toBe('')
    expect(kinds()).toEqual(['sample', 'database', 'rest'])
    expect(checked()).toEqual(['sample'])
    expect(text(storage('sample'))).toContain('Sample data')
    expect(text(storage('sample'))).toContain('Example rows you edit here.')
    expect(text(storage('database'))).toContain('Rows live in your app\'s database.')
  })

  it('says what a new collection starts with, and where the rest is added', async () => {
    await mounted()
    expect(text(q('[role="dialog"]'))).toContain('It starts with one text field, title. You add more in the Fields tab.')
  })

  it('cannot be created without a name', async () => {
    await mounted()
    expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(true)
    await type('Menu')
    expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(false)
  })

  it('does not offer Database when the project has none, and says so', async () => {
    withoutDatabase()
    await mounted()
    expect(kinds()).toEqual(['sample', 'rest'])
    expect(text(q('[data-no-database]'))).toBe('No database in this project yet')
  })

  it('has no such hint when the project has a database', async () => {
    await mounted()
    expect(q('[data-no-database]')).toBeNull()
  })

  it('picks the choice with the arrows, as a radiogroup does', async () => {
    await mounted()
    storage('sample').focus()
    storage('sample').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await settle()
    expect(checked()).toEqual(['database'])
    expect(document.activeElement).toBe(storage('database'))
    expect(qa('[data-storage]').map(option => option.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
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

  it('asks before it writes when something is unsaved: kept, nothing is made and the dialog stays; given up, it creates and shows the collection', async () => {
    const { editor, actions, closed } = await mounted({ ...made, datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }) })
    editor.reportDirty().set('Post (JSON)')
    await type('Menu')
    await create()
    expect(editor.confirmRequest?.title).toBe('Discard unsaved changes to Post (JSON)?')
    editor.confirmRequest?.answer(false)
    await settle()
    for (const name of ['datasource_create', 'entity_create']) expect(actions.named(name), name).toEqual([])
    expect(closed).toEqual([])
    expect(name().value).toBe('Menu')
    expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(false)
    await create()
    editor.confirmRequest?.answer(true)
    await settle()
    expect(actions.named('entity_create').map(call => call.input)).toEqual([{ name: 'Menu', source: 'ds_sample', fields: [{ name: 'title', type: 'text' }] }])
    expect(editor.collectionId).toBe('ent_menu')
    expect(editor.dataTab).toBe('fields')
    expect(closed).toEqual([false])
  })

  it('does not ask when nothing is unsaved', async () => {
    const { editor } = await mounted()
    await type('Menu')
    await create()
    expect(editor.confirmRequest).toBeNull()
  })

  it('makes nothing when the user cancels', async () => {
    const { actions, closed } = await mounted()
    await type('Menu')
    cancelButton().click()
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

  it('shows, with the refusal, that the source it made could not be removed', async () => {
    await mounted({
      datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }),
      entity_create: () => new Failure(422, 'invalid', 'Module "blog" already has the entity Menu (ent_menu)'),
      datasource_delete: () => new Failure(403, 'forbidden', 'The history could not be written')
    })
    await type('Menu')
    await create()
    expect(text(q('[data-artifact-error]'))).toContain('already has the entity')
    expect(text(q('[data-artifact-error]'))).toContain('Could not remove the source made for it: The history could not be written')
  })

  describe('while it creates', () => {
    /** A create that waits for `release()`: the dialog is saving until then. */
    const slow = () => {
      let release!: (answer?: unknown) => void
      const gate = new Promise<unknown>((resolve) => {
        release = resolve
      })
      const handlers = {
        datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }),
        entity_create: async () => (await gate) ?? { entityId: 'ent_menu', repositoryId: 'repo_menu', queryIds: [] }
      }
      return { release, handlers }
    }
    const escape = async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await settle()
    }
    const clickOutside = async () => {
      const overlay = q('[data-slot="overlay"]') ?? document.body
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle()
    }

    it('cannot be closed with Cancel, Esc or a click outside, and closes when it is done', async () => {
      const { release, handlers } = slow()
      const { editor, closed, isOpen } = await mounted(handlers)
      await type('Menu')
      await create()
      expect(cancelButton().hasAttribute('disabled')).toBe(true)
      cancelButton().click()
      await settle()
      expect(closed, 'after Cancel').toEqual([])
      await escape()
      expect(closed, 'after Esc').toEqual([])
      await clickOutside()
      expect(closed, 'after a click outside').toEqual([])
      const close = q('[role="dialog"] [aria-label="Close"]')
      close?.click()
      await settle()
      expect(closed, 'after the Close button').toEqual([])
      expect(isOpen.value).toBe(true)
      expect(q('[role="dialog"]')).not.toBeNull()
      release()
      await settle()
      expect(closed).toEqual([false])
      expect(editor.dataTab).toBe('fields')
    })

    it('ignores what it gets after it was closed and opened again: it is not closed, and the mode and tab stay', async () => {
      const { release, handlers } = slow()
      const { editor, closed, isOpen } = await mounted(handlers)
      const mode = editor.mode
      const tab = editor.dataTab
      await type('Menu')
      await create()
      // The screen takes the dialog away (a route change) and brings it back: it starts over.
      isOpen.value = false
      await settle()
      isOpen.value = true
      await settle()
      expect(name().value).toBe('')
      release()
      await settle()
      expect(isOpen.value).toBe(true)
      expect(closed).toEqual([])
      expect(editor.mode).toBe(mode)
      expect(editor.dataTab).toBe(tab)
      expect(q('[data-artifact-error]')).toBeNull()
    })

    it('ignores a refusal that arrives after it was opened again', async () => {
      const { release, handlers } = slow()
      const { isOpen } = await mounted({ ...handlers, datasource_delete: () => ({ changed: [], database: false }) })
      await type('Menu')
      await create()
      isOpen.value = false
      await settle()
      isOpen.value = true
      await settle()
      release(new Failure(422, 'invalid', 'Module "blog" already has the entity Menu (ent_menu)'))
      await settle()
      expect(q('[data-artifact-error]')).toBeNull()
      expect(q('[data-artifact-submit]')!.hasAttribute('disabled')).toBe(true)
    })
  })

  describe('when the database goes away while it is open', () => {
    it('falls back to Sample data when Database was chosen, and no longer offers it', async () => {
      const { design, actions } = await mounted({ ...made, datasource_create: () => ({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }) })
      await type('Menu')
      storage('database').click()
      await settle()
      expect(checked()).toEqual(['database'])
      withoutDatabase()
      await design.refresh()
      await settle()
      expect(kinds()).toEqual(['sample', 'rest'])
      expect(checked()).toEqual(['sample'])
      expect(text(q('[data-no-database]'))).toBe('No database in this project yet')
      await create()
      expect(actions.named('datasource_create').map(call => call.input)).toEqual([{ name: 'sample', kind: 'memory' }])
      expect(actions.named('entity_create').map(call => call.input)).toMatchObject([{ source: 'ds_sample' }])
    })

    it('keeps the choice of REST API', async () => {
      const { design } = await mounted()
      storage('rest').click()
      await settle()
      withoutDatabase()
      await design.refresh()
      await settle()
      expect(checked()).toEqual(['rest'])
    })
  })

  describe('on REST API', () => {
    const rest = async (props: Record<string, unknown> = {}) => {
      const view = await mounted(made, props)
      storage('rest').click()
      await settle()
      return view
    }

    it('offers the project\'s connections and a new one, and chooses the first connection', async () => {
      await rest()
      expect(checked()).toEqual(['rest'])
      expect(text(q('[data-new-collection-connection]'))).toContain('quotes')
      expect(q('[data-artifact-submit]')!.textContent).toContain('Continue')
    })

    it('says the name is optional, and proposes none from an endpoint (the next dialog proposes it from the URL)', async () => {
      await rest()
      expect(text(q('[data-form-row="Name (optional)"] label'))).toBe('Name (optional)')
      expect(name().placeholder).not.toMatch(/endpoint/i)
    })

    it('has the plain "Name" label on the other choices', async () => {
      await mounted()
      expect(q('[data-form-row="Name"]')).not.toBeNull()
      expect(q('[data-form-row="Name (optional)"]')).toBeNull()
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

    it('hands "New connection…" to the dialog that makes one and its collection', async () => {
      const { handed, closed } = await rest()
      await chooseConnection('New connection…')
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
