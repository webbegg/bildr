import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import { renderPlan } from '../../src/canvas/render.ts'
import type { PlanChild, PlanElement } from '../../src/canvas/render.ts'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
import { LEGACY_LAYOUT_TREE } from '../../../codegen/test/generate/layout-legacy.fixture.ts'
import { blogModelFiles } from './fixture.ts'

/** Tag, node and classes of each element: what the layout decides on the canvas. */
const outline = (children: PlanChild[], depth = 0): string[] => children.flatMap(child => typeof child === 'string'
  ? []
  : [`${'  '.repeat(depth)}<${child.tag}${child.node ? ` ${child.node}` : ''}> ${child.class}`, ...outline(child.children, depth + 1)])

const planOf = (children: ModelNode[]) => {
  const loaded = loadModel(blogModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  const blog = loaded.model.modules.blog!
  const page = structuredClone(blog.pages.find(entry => entry.name === 'index')!)
  page.root.children = structuredClone(children)
  // Without layouts: only the page and the given tree.
  return renderPlan({ file: page, components: blog.components, layouts: [], data: {} })
}

describe('layout containers on the canvas', () => {
  it('renders a Column or a Grid as the tag it names (layout-containers T3)', () => {
    const [root] = planOf([{ id: 'n_c', type: 'Column', props: { tag: 'nav' } }, { id: 'n_g', type: 'Grid', props: { tag: 'section' } }])
    expect((root as PlanElement).children.map(child => (child as PlanElement).tag)).toEqual(['nav', 'section'])
  })

  it('resolves Fill by the parent\'s axis, as the generator does (layout-containers L3)', () => {
    const fill = { type: 'Text', props: { text: 'a' }, style: { w: 'fill' } }
    const plan = planOf([
      { id: 'n_row', type: 'Container', style: { 'direction': 'col', 'md:direction': 'row' }, children: [{ id: 'n_a', ...fill }, { id: 'n_b', ...fill, style: { w: 'fill', grow: '2' } }] },
      { id: 'n_top', ...fill }
    ])
    expect(outline(plan).join('\n')).toMatchInlineSnapshot(`
      "<section n_page> gap-6 min-h-full flex-col flex
        <div n_row> flex flex-col md:flex-row self-stretch
          <p n_a> whitespace-pre-line md:min-w-0 self-stretch md:self-auto md:grow-1 md:basis-[0%]
          <p n_b> whitespace-pre-line md:min-w-0 self-stretch md:self-auto grow-2 md:basis-[0%]
        <p n_top> whitespace-pre-line self-stretch"
    `)
  })
})

describe('legacy layout containers on the canvas (layout-containers S4)', () => {
  // Taken before the one-container model; the only deliberate change since: a child of a Container or
  // Card laid out as a row (or of a Container laid out as a grid or a block) no longer gets the vertical
  // stack's `self-stretch` (T2, log L4). Every other type keeps its type's rule, a Column set to a grid too.
  it('render the same classes as before the one-container model', () => {
    const plan = planOf([LEGACY_LAYOUT_TREE])
    expect(outline(plan).join('\n')).toMatchInlineSnapshot(`
      "<section n_page> gap-6 min-h-full flex-col flex
        <section n_legacy> flex p-4 gap-3 flex-col items-start self-stretch
          <div n_row> flex gap-3 md:gap-6 flex-row flex-wrap items-center self-stretch
            <p n_row_text> whitespace-pre-line
            <div n_row_box> flex w-full flex-col
            <div n_row_col> flex gap-2 flex-col
          <nav n_row_plain> flex flex-row justify-between self-stretch
            <p n_row_plain_text> whitespace-pre-line
          <div n_column> flex gap-3 flex-col md:flex-row items-start self-stretch
            <h3 n_column_heading> text-2xl font-semibold text-center self-stretch
            <div n_column_row> flex gap-1 flex-row self-stretch
            <UButton n_column_button> 
          <div n_grid> grid gap-6 self-stretch grid-cols-3 md:grid-cols-4
            <div n_grid_wide> flex flex-col col-span-2
            <p n_grid_text> whitespace-pre-line
          <div n_card> ring ring-default p-4 bg-default rounded-lg self-stretch overflow-hidden
            <div> flex gap-3 flex-row items-start
              <p n_card_text> whitespace-pre-line
              <div n_card_box> flex flex-col
          <div n_stack_row> flex gap-2 flex-row self-stretch
            <div n_stack_row_box> flex flex-col
          <div n_stack_grid> flex-col self-stretch grid-cols-2 grid
            <div n_stack_grid_box> flex flex-col self-stretch"
    `)
  })
})
