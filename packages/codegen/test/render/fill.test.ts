import { describe, expect, it } from 'vitest'
import { styleClasses } from '../../src/design/tokens.ts'
import { fillStyle } from '../../src/render/rules.ts'

const row = { type: 'Container', style: { direction: 'row' } }
const col = { type: 'Container', style: { direction: 'col' } }
const grid = { type: 'Container', style: { display: 'grid', cols: '2' } }
const block = { type: 'Container', style: { display: 'block' } }

describe('Fill resolved by the parent\'s axis (layout-containers L3)', () => {
  it('grows along a stack\'s main axis and stretches across its cross axis', () => {
    expect(fillStyle({ w: 'fill' }, row)).toEqual({ grow: '1', basis: '0', minW: '0' })
    expect(fillStyle({ h: 'fill' }, row)).toEqual({ self: 'stretch' })
    expect(fillStyle({ h: 'fill' }, col)).toEqual({ grow: '1', basis: '0', minH: '0' })
    expect(fillStyle({ w: 'fill', h: 'fill', p: '4' }, col)).toEqual({ p: '4', self: 'stretch', grow: '1', basis: '0', minH: '0' })
  })

  it('fills a grid cell and a block parent; without a parent it is 100%', () => {
    expect(fillStyle({ w: 'fill', h: 'fill' }, grid)).toEqual({ w: 'full', self: 'stretch' })
    expect(fillStyle({ w: 'fill', h: 'fill' }, block)).toEqual({ w: 'full', h: 'full' })
    expect(fillStyle({ w: 'fill' }, undefined)).toEqual({ w: 'full' })
  })

  it('reads the parent\'s type when its tokens don\'t say: a Row, a Column, a Grid, a Card\'s stack', () => {
    expect(fillStyle({ w: 'fill' }, { type: 'Row' })).toEqual({ grow: '1', basis: '0', minW: '0' })
    expect(fillStyle({ w: 'fill' }, { type: 'Column' })).toEqual({ self: 'stretch' })
    expect(fillStyle({ w: 'fill' }, { type: 'Grid' })).toEqual({ w: 'full' })
    expect(fillStyle({ h: 'fill' }, { type: 'Card' })).toEqual({ grow: '1', basis: '0', minH: '0' })
    expect(fillStyle({ w: 'fill' }, { type: 'Container', style: { direction: 'row-reverse' } })).toEqual({ grow: '1', basis: '0', minW: '0' })
  })

  it('follows a parent that changes axis at a breakpoint, undoing what no longer applies', () => {
    // Stack vertically below md: a column on mobile, a row from md.
    const columns = { type: 'Container', style: { 'direction': 'col', 'md:direction': 'row' } }
    expect(fillStyle({ w: 'fill' }, columns)).toEqual({ 'self': 'stretch', 'md:self': 'auto', 'md:grow': '1', 'md:basis': '0', 'md:minW': '0' })
    // A Container stacks vertically unless its direction says otherwise.
    expect(fillStyle({ w: 'fill' }, { type: 'Container', style: { 'display': 'grid', 'lg:display': 'flex' } })).toEqual({ 'w': 'full', 'lg:w': 'auto', 'lg:self': 'stretch' })
    expect(fillStyle({ w: 'fill' }, { type: 'Container', style: { 'display': 'grid', 'lg:display': 'flex', 'direction': 'row' } })).toEqual({ 'w': 'full', 'lg:w': 'auto', 'lg:grow': '1', 'lg:basis': '0', 'lg:minW': '0' })
  })

  it('applies Fill only where the node is Fill, and stops it where a breakpoint sets a size', () => {
    expect(fillStyle({ 'w': '64', 'md:w': 'fill' }, row)).toEqual({ 'w': '64', 'md:w': 'auto', 'md:grow': '1', 'md:basis': '0', 'md:minW': '0' })
    expect(fillStyle({ 'w': 'fill', 'md:w': '64' }, row)).toEqual({ 'md:w': '64', 'grow': '1', 'basis': '0', 'minW': '0', 'md:grow': '0', 'md:basis': 'auto' })
    expect(fillStyle({ 'w': 'fill', 'md:w': '64' }, grid)).toEqual({ 'w': 'full', 'md:w': '64' })
  })

  it('cascades on a desktop-first project', () => {
    const columns = { type: 'Container', style: { 'direction': 'row', 'max-md:direction': 'col' } }
    expect(fillStyle({ w: 'fill' }, columns, 'desktop')).toEqual({ 'grow': '1', 'basis': '0', 'minW': '0', 'max-md:grow': '0', 'max-md:basis': 'auto', 'max-md:self': 'stretch' })
  })

  it('leaves a token the node sets itself to it: a grow weight, an Align self, a min width', () => {
    expect(fillStyle({ w: 'fill', grow: '2' }, row)).toEqual({ grow: '2', basis: '0', minW: '0' })
    // Only from where it sets it: below, Fill still writes it.
    expect(fillStyle({ 'h': 'fill', 'md:self': 'center' }, row)).toEqual({ 'md:self': 'center', 'self': 'stretch' })
    expect(fillStyle({ 'w': 'fill', 'md:grow': '2' }, row)).toEqual({ 'md:grow': '2', 'grow': '1', 'basis': '0', 'minW': '0' })
    expect(fillStyle({ 'w': 'fill', 'max-md:grow': '2' }, row, 'desktop')).toEqual({ 'max-md:grow': '2', 'grow': '1', 'basis': '0', 'minW': '0' })
    expect(fillStyle({ w: 'fill', minW: '32' }, row)).toEqual({ minW: '32', grow: '1', basis: '0' })
  })

  it('returns a style without Fill as it is', () => {
    const style = { w: 'full', p: '4' }
    expect(fillStyle(style, row)).toBe(style)
  })

  it('renders an unresolved Fill (a bound size, a component\'s root) as 100%', () => {
    expect(styleClasses({ 'w': 'fill', 'md:h': 'fill' })).toBe('w-full md:h-full')
    expect(styleClasses(fillStyle({ w: 'fill' }, row))).toBe('min-w-0 grow-1 basis-[0%]')
  })
})
