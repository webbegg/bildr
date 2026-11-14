/* eslint-disable @typescript-eslint/no-explicit-any, @stylistic/max-statements-per-line -- a fuzz harness: it walks loose model shapes and builds plausible (often invalid) inputs on purpose */
import { expect, it } from 'vitest'
import { applyEdit, EDIT_NAMES, EDIT_INPUTS } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { loadModel } from '../../src/model/load'
import { generate } from '../../src/generate/index'
import { fixtureModelFiles } from '../model/fixture'
import { applyChanges } from './helpers'

let seed = 12345
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!
const walk = (n: any, out: any[] = []) => { out.push(n); for (const c of n.children ?? []) walk(c, out); return out }

const trees = (m: any) => {
  const t: { id: string, root: any }[] = []
  for (const mod of Object.values(m.modules) as any[]) {
    for (const p of mod.pages) t.push({ id: p.id, root: p.root })
    for (const c of mod.components) t.push({ id: c.id, root: c.root })
  }
  for (const l of m.layouts ?? []) t.push({ id: l.id, root: l.root })
  return t
}
const NAMES = ['card', 'Hero', 'about', 'post', 'item', 'title', 'nav bar', 'x']
const TYPES = ['Text', 'Container', 'Button', 'Image', 'Column', 'Grid', 'Card', 'Link', 'Input', 'List']

const inputFor = (name: EditName, m: any): unknown => {
  const ts = trees(m); const t = pick(ts); const nodes = walk(t.root); const n = pick(nodes)
  const comps = (Object.values(m.modules) as any[]).flatMap((x: any) => x.components)
  const pages = (Object.values(m.modules) as any[]).flatMap((x: any) => x.pages)
  const c = comps.length ? pick(comps) : { id: 'cmp_none', properties: [], variants: [], root: { id: 'n' } }
  const prop = c.properties.length ? pick(c.properties).id : 'prop_x'
  const variant = c.variants.length ? pick(c.variants).id : 'var_x'
  const lay = (m.layouts ?? []).length ? pick(m.layouts) : { id: 'lay_x', slots: [], variables: [] }
  const pg = pick(pages)
  const sib = (() => { const parent = nodes.find(p => (p.children ?? []).includes(n)); return parent ? parent.children.slice(0, 1 + Math.floor(rnd() * parent.children.length)).map((x: any) => x.id) : [n.id] })()
  const containers = nodes.filter(x => ['Container', 'Column', 'Grid', 'Card', 'Page', 'SlotFill', 'List'].includes(x.type))
  const inst = (() => { for (const tt of ts) for (const x of walk(tt.root)) if (x.type === 'Instance' && rnd() < 0.6) return { file: tt.id, nodeId: x.id }; return { file: t.id, nodeId: n.id } })()
  switch (name) {
    case 'node_insert': return { file: t.id, parentId: pick(containers.length ? containers : [t.root]).id, type: pick(TYPES), ...(rnd() < 0.3 ? { props: { text: pick(['hi', { $bind: 'post.title' }]) } } : {}) }
    case 'node_update_props': return { file: t.id, nodeId: n.id, props: pick([{ text: 'Hello' }, { text: { $bind: 'post.title' } }, { visible: true }, { src: 'https://x.y/a.png' }, { text: null }, { as: 'thing' }]) }
    case 'node_update_style': return { file: t.id, nodeId: n.id, breakpoint: pick(['base', 'md', 'lg']), style: pick([{ padding: 'md' }, { gap: 'sm' }, { color: 'primary' }]) }
    case 'node_rename': return { file: t.id, nodeId: n.id, name: pick([...NAMES, null]) }
    case 'node_set_locked': return { file: t.id, nodeId: n.id, locked: rnd() < 0.5 }
    case 'node_move': return { file: t.id, nodeId: n.id, parentId: pick(containers.length ? containers : [t.root]).id, index: 0 }
    case 'node_move_many': return { file: t.id, moves: [{ nodeId: n.id, parentId: pick(containers.length ? containers : [t.root]).id, index: 0 }] }
    case 'node_delete': case 'node_duplicate': return { file: t.id, nodeIds: sib }
    case 'node_wrap': return { file: t.id, nodeIds: sib, type: pick(['Container', 'Column', 'Grid', 'Card']) }
    case 'page_create': return { name: pick(NAMES), ...(rnd() < 0.3 && lay.id !== 'lay_x' ? { layout: lay.id } : {}) }
    case 'page_update': return { page: pg.id, ...(rnd() < 0.5 ? { name: pick(NAMES) } : { path: pick(['/a', '/posts/[slug]', '/', '/about']) }) }
    case 'page_delete': return { page: pg.id }
    case 'component_create': return { file: t.id, nodeIds: sib, ...(rnd() < 0.5 ? { name: pick(NAMES) } : {}) }
    case 'component_rename': case 'component_duplicate': return { component: c.id, name: pick(NAMES) }
    case 'component_delete': return { component: c.id, force: rnd() < 0.5 }
    case 'component_property_add': return { component: c.id, name: pick(NAMES), kind: pick(['text', 'number', 'boolean', 'image', 'slot']), ...(rnd() < 0.3 ? { nodeId: pick(walk(c.root)).id } : {}) }
    case 'component_property_update': return { component: c.id, property: prop, ...pick([{ name: pick(NAMES) }, { label: 'L' }, { index: 0 }, { default: 'd' }, { required: true }]) }
    case 'component_property_remove': return { component: c.id, property: prop }
    case 'component_variant_add': return { component: c.id, name: pick(NAMES) }
    case 'component_variant_rename': return { component: c.id, variant, name: pick(NAMES) }
    case 'component_variant_delete': return { component: c.id, variant }
    case 'component_variant_set_override': return { component: c.id, variant, nodeId: pick(walk(c.root)).id, ...pick([{ style: { padding: 'lg' } }, { props: { text: 'V' } }, { props: { text: { $bind: 'post.title' } } }]) }
    case 'component_state_add': return { component: c.id, baseVariant: pick(['', variant]), kind: pick(['hover', 'pressed']) }
    case 'component_interaction_add': return { component: c.id, variant: pick(['', variant]), on: pick(['hover', 'press', 'click', 'load']), to: variant }
    case 'component_interaction_update': return { component: c.id, variant: pick(['', variant]), index: 0, to: variant }
    case 'component_interaction_remove': return { component: c.id, variant: pick(['', variant]), index: 0 }
    case 'component_transition_set': return { component: c.id, variant: pick(['', variant]), transition: pick([null, { type: 'ease', duration: 0.2, easing: 'ease-out' }]) }
    case 'instance_set_values': return { ...inst, values: { [prop]: pick(['v', 1, true, null]) }, ...(rnd() < 0.3 ? { variant } : {}) }
    case 'instance_set_slot': return { ...inst, slot: prop, filled: rnd() < 0.6 }
    case 'instance_detach': return inst
    case 'instance_replace': return { ...inst, component: c.id, all: rnd() < 0.3 }
    case 'layout_create': return { name: pick(NAMES) }
    case 'layout_create_from_selection': return { page: pg.id, nodeIds: (pg.root.children ?? []).slice(0, 1).map((x: any) => x.id).concat([]).filter(Boolean).length ? [pg.root.children[0].id] : ['n_x'], name: pick(NAMES) }
    case 'layout_rename': case 'layout_duplicate': return { layout: lay.id, name: pick(NAMES) }
    case 'layout_delete': return { layout: lay.id }
    case 'layout_slot_add': { const ln = (lay as any).root ? walk((lay as any).root) : [{ id: 'n_x' }]; return { layout: lay.id, name: pick(NAMES), nodeId: pick(ln).id } }
    case 'layout_slot_update': return { layout: lay.id, slot: lay.slots.length ? pick(lay.slots as any[]).id : 'children', name: pick(NAMES) }
    case 'layout_slot_remove': return { layout: lay.id, slot: lay.slots.length ? pick(lay.slots as any[]).id : 'children' }
    case 'layout_variable_add': return { layout: lay.id, name: pick(NAMES), kind: pick(['text', 'boolean', 'image']) }
    case 'layout_variable_update': return { layout: lay.id, variable: (lay.variables ?? []).length ? pick(lay.variables as any[]).id : 'prop_x', name: pick(NAMES) }
    case 'layout_variable_remove': return { layout: lay.id, variable: (lay.variables ?? []).length ? pick(lay.variables as any[]).id : 'prop_x' }
    case 'page_set_layout': return { page: pg.id, layout: rnd() < 0.3 ? null : lay.id }
    case 'page_set_layout_values': return { page: pg.id, values: { [(lay.variables ?? [])[0]?.id ?? 'prop_x']: 'v' } }
    case 'page_set_slot': return { page: pg.id, slot: lay.slots.length ? pick(lay.slots as any[]).id : 'children', filled: rnd() < 0.6, ...(rnd() < 0.4 ? { nodeIds: [pick(walk(pg.root)).id] } : {}) }
    case 'theme_update': return pick([{ radius: 'md' }, { colors: { primary: 'blue' } }, {}])
    case 'theme_apply': return { preset: pick(['default', 'nope']) }
    case 'project_update': return { name: pick(['Blog', ' x ']), description: pick([null, 'd']) }
    default: return {}
  }
}

/** Seeded random edit sequences (V2/V6): every accepted edit leaves a model that loads and generates. */
it('accepted edits keep the model generatable (seeded fuzz)', () => {
  const base = fixtureModelFiles()
  const stats = { accepted: 0, refused: 0 }
  const bad: string[] = []
  for (let s = 0; s < 150; s++) {
    let files = base
    const steps: unknown[] = []
    const len = 1 + Math.floor(rnd() * 5)
    for (let i = 0; i < len; i++) {
      const loaded = loadModel(files); if (!loaded.ok) { bad.push('preload ' + JSON.stringify(steps)); break }
      const name = pick(EDIT_NAMES.filter(n => !['theme_get', 'theme_presets_list', 'catalog_get'].includes(n)))
      const input = inputFor(name, loaded.model)
      void EDIT_INPUTS[name]
      let o
      try { o = applyEdit(files, name, input) } catch (e) { bad.push(`THROW ${name} ${JSON.stringify(input)} ${(e as Error).message} after ${JSON.stringify(steps)}`); break }
      steps.push([name, input])
      if (!o.ok) {
        stats.refused++
        continue
      }
      stats.accepted++
      files = applyChanges(files, o.changes)
      const m = loadModel(files)
      if (!m.ok) { bad.push(`LOAD ${JSON.stringify(m.problems).slice(0, 300)} steps ${JSON.stringify(steps)}`); break }
      try { generate(m.model) } catch (e) { bad.push(`GEN ${(e as Error).message} steps ${JSON.stringify(steps)}`); break }
    }
  }
  expect(bad.slice(0, 5)).toEqual([])
  // The sequences exercise both outcomes.
  expect(stats.accepted).toBeGreaterThan(100)
  expect(stats.refused).toBeGreaterThan(50)
}, 120000)
