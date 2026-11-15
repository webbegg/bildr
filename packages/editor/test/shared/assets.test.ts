import { describe, expect, it } from 'vitest'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { componentDeleteConfirm, componentFolders, componentUsages, PRIMARY_VARIANT, replaceChoiceHint, replaceChoices, replaceProblem, variantItems } from '../../src/shared/componentEditor.ts'
import { layoutChoiceHint, layoutDeleteConfirm, layoutEntries, layoutItems, layoutValue, NO_LAYOUT, variableField } from '../../src/shared/layoutEditor.ts'

/** Ported from the hosted `componentEditor.test.ts` and `layoutEditor.test.ts` (the Assets lists, confirms, replace choices), over the model's files. */

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}) })
const component = (id: string, name: string, root: ModelNode, variants: unknown[] = []) => ({ id, name, properties: [], variants, root }) as unknown as ComponentFile
const page = (id: string, name: string, root: ModelNode, layout?: string) => ({ id, name, path: `/${name}`, root, ...(layout ? { layout } : {}) }) as unknown as PageFile

/** Badge in Card (a component), Card on two pages (twice on one) and in the layout; Folder/Logo in a folder. */
const model = (): Model => ({
  modules: {
    app: {
      components: [
        component('cmp_badge', 'Badge', n('b', 'Text')),
        component('cmp_card', 'Card', n('c', 'Card', {}, [n('ci', 'Instance', { component: 'cmp_badge' })]), [{ id: 'var_a', name: 'a', overrides: { c: { props: { x: 1 }, style: { p: '4' }, unset: ['bg'] } } }, { id: 'var_b', name: 'b', overrides: {} }]),
        component('cmp_logo', 'Folder/Logo', n('l', 'Text'))
      ],
      pages: [
        page('pg_home', 'home', n('r1', 'Page', {}, [n('i1', 'Instance', { component: 'cmp_card' }), n('i2', 'Instance', { component: 'cmp_card' }, [n('nested', 'Instance', { component: 'cmp_card' })])]), 'lay_site'),
        page('pg_about', 'about', n('r2', 'Page', {}, [n('i3', 'Instance', { component: 'cmp_card' })]))
      ]
    }
  },
  layouts: [{ id: 'lay_site', name: 'site', root: n('lr', 'Page', {}, [n('li', 'Instance', { component: 'cmp_card' })]), slots: [{ id: 'children', name: 'Content', nodeId: 'lr' }, { id: 'footer', name: 'Footer', nodeId: 'lr' }], variables: [{ id: 'prop_tagline', name: 'tagline', kind: 'text', label: 'Tagline', default: 'Hi' }] }, { id: 'lay_empty', name: 'empty', root: n('er', 'Page'), slots: [{ id: 'children', name: 'Content', nodeId: 'er' }] }] as unknown as LayoutFile[]
}) as unknown as Model

describe('componentUsages', () => {
  it('lists the instances on pages, in other components and in layouts, in document order, without the ones nested in another instance of it', () => {
    const usages = componentUsages(model(), 'cmp_card')
    expect(usages.map(usage => `${usage.kind}:${usage.file}:${usage.nodeId}`)).toEqual(['page:pg_home:i1', 'page:pg_home:i2', 'page:pg_about:i3', 'layout:lay_site:li'])
    expect(usages.map(usage => usage.where)).toEqual(['page "home"', 'page "home"', 'page "about"', 'layout "site"'])
    expect(componentUsages(model(), 'cmp_badge')).toEqual([{ file: 'cmp_card', kind: 'component', nodeId: 'ci', where: 'component "Card"' }])
    expect(componentUsages(model(), 'cmp_logo')).toEqual([])
  })
})

describe('componentFolders', () => {
  it('groups by the folder before the last slash, outside folders first, filtered by the query', () => {
    const folders = componentFolders(model(), '')
    expect(folders.map(folder => [folder.name, folder.entries.map(entry => entry.label)])).toEqual([['', ['Badge', 'Card']], ['Folder', ['Logo']]])
    expect(componentFolders(model(), 'ard').flatMap(folder => folder.entries.map(entry => entry.def.id))).toEqual(['cmp_card'])
    expect(componentFolders(model(), 'zzz')).toEqual([])
  })
})

describe('componentDeleteConfirm', () => {
  it('says no instance uses it, or names where and counts the instances', () => {
    expect(componentDeleteConfirm({ name: 'Logo' }, [])).toMatchObject({ title: 'Delete "Logo"?', description: 'No instance uses it. Undo brings it back.', items: [], confirmLabel: 'Delete component', danger: true })
    const confirm = componentDeleteConfirm({ name: 'Card' }, componentUsages(model(), 'cmp_card'))
    expect(confirm.description).toBe('Used by 4 instances. Deleting the component deletes them too; undo brings everything back.')
    expect(confirm.items).toEqual(['page "home" (2 instances)', 'page "about"', 'layout "site"'])
    expect(confirm.confirmLabel).toBe('Delete with 4 instances')
  })
})

describe('replace choices', () => {
  it('disables the current component and the ones that would make a component contain itself', () => {
    const m = model()
    // Instances of Badge sit in Card: Card (and Badge) cannot replace them there.
    expect(replaceProblem(m, ['cmp_card'], 'cmp_card')).toBe('"Card" cannot contain itself: replacing would create a cycle')
    expect(replaceProblem(m, ['cmp_badge'], 'cmp_card')).toBe('"Card" contains "Badge": replacing would create a cycle')
    expect(replaceProblem(m, ['cmp_card'], 'cmp_logo')).toBeUndefined()
    expect(replaceProblem(m, [], 'cmp_card')).toBeUndefined()
    const choices = replaceChoices(m, 'cmp_badge', ['cmp_card'])
    expect(choices.map(choice => [choice.def.id, choice.disabled, choice.reason])).toEqual([
      ['cmp_badge', true, 'The current component'],
      ['cmp_card', true, '"Card" cannot contain itself: replacing would create a cycle'],
      ['cmp_logo', false, '']
    ])
    expect(replaceChoiceHint({ usages: 2, reason: '' })).toBe('2 instances')
    expect(replaceChoiceHint({ usages: 1, reason: 'The current component' })).toBe('1 instance · The current component')
  })
})

describe('variantItems', () => {
  it('lists the primary, then each variant described by what it overrides', () => {
    const [card] = model().modules.app!.components.filter(entry => entry.id === 'cmp_card')
    expect(variantItems(card!)).toEqual([
      { label: 'Primary', value: PRIMARY_VARIANT, description: 'The component as defined' },
      { label: 'a', value: 'var_a', description: '3 overrides' },
      { label: 'b', value: 'var_b', description: 'Same as Primary' }
    ])
  })
})

describe('layouts', () => {
  it('lists the layouts with the pages using each, filtered by the query', () => {
    expect(layoutEntries(model(), '').map(entry => [entry.layout.id, entry.pages.map(p => p.name)])).toEqual([['lay_site', ['home']], ['lay_empty', []]])
    expect(layoutEntries(model(), 'emp').map(entry => entry.layout.id)).toEqual(['lay_empty'])
  })

  it('confirms a delete by naming the pages that lose the layout', () => {
    expect(layoutDeleteConfirm({ name: 'site' }, [{ name: 'home' }])).toMatchObject({ title: 'Delete "site"?', description: 'Used by 1 page. It keeps its content and loses the layout; undo brings it back.', items: ['home'], confirmLabel: 'Delete layout', danger: true })
    expect(layoutDeleteConfirm({ name: 'empty' }, []).description).toBe('No page uses it. Undo brings it back.')
  })

  it('offers None and each layout with its page count, and describes what a page can set in it', () => {
    expect(layoutItems(model())).toEqual([{ label: 'None', value: NO_LAYOUT }, { label: 'site', value: 'lay_site', pages: 1 }, { label: 'empty', value: 'lay_empty', pages: 0 }])
    const [site, empty] = model().layouts
    expect(layoutChoiceHint(site!, 1)).toBe('1 page · 1 slot, 1 variable')
    expect(layoutChoiceHint(empty!, 0)).toBe('No pages · No slots or variables')
  })

  it('reads a variable as a field with its default, and the page\'s own value over it', () => {
    const [site] = model().layouts
    const [tagline] = site!.variables!
    expect(variableField(site!, tagline!)).toEqual({ name: 'prop_tagline', label: 'Tagline', kind: 'text', description: 'Tagline, a variable of layout site', default: 'Hi' })
    expect(layoutValue({ layoutValues: { prop_tagline: 'Hello' } }, tagline!)).toBe('Hello')
    expect(layoutValue({}, tagline!)).toBeUndefined()
  })
})
