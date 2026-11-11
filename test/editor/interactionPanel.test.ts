import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, Project } from '#shared/document/schema'
import { EVENT_LABELS, findInteraction, interactionLabel, interactionTargets, previewPageFor, transitionCurve, transitionSummary, variantLabel, withTransitionType } from '#shared/editor/interactionPanel'

const node = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({ id: `n_${Math.random().toString(36).slice(2, 8)}`, type, props, style: {}, children })

const def = {
  id: 'cmp_btn',
  name: 'Button',
  root: node('Container'),
  properties: [],
  variants: [
    { id: 'var_ph', name: 'Primary · Hover', overrides: {}, state: { of: '', kind: 'hover' } },
    { id: 'var_on', name: 'On', overrides: {} },
    { id: 'var_off', name: 'Off', overrides: {} }
  ]
} as unknown as ComponentDefinition

describe('labels', () => {
  it('names the events as Framer does', () => {
    expect(EVENT_LABELS).toEqual({ click: 'Click', mouseenter: 'Mouse enter', mouseleave: 'Mouse leave', appear: 'Appear' })
  })

  it('names variants, the primary "Primary"', () => {
    expect(variantLabel(def, '')).toBe('Primary')
    expect(variantLabel(def, 'var_on')).toBe('On')
    expect(variantLabel(def, 'var_gone')).toBe('Missing variant')
  })

  it('reads an interaction as "Click → Variant"', () => {
    expect(interactionLabel(def, { id: 'ix_1', on: 'click', to: 'var_on' })).toBe('Click → On')
    expect(interactionLabel(def, { id: 'ix_2', on: 'mouseleave', to: '' })).toBe('Mouse leave → Primary')
  })
})

describe('findInteraction', () => {
  const withInteractions = {
    ...def,
    interactions: [{ id: 'ix_1', on: 'click', to: 'var_on' }],
    variants: [...def.variants.slice(0, 2), { ...def.variants[2]!, interactions: [{ id: 'ix_2', on: 'appear', to: '', delay: 1 }] }]
  } as ComponentDefinition

  it('finds an interaction and the variant it belongs to (\'\' the primary)', () => {
    expect(findInteraction(withInteractions, 'ix_1')).toEqual({ owner: '', interaction: { id: 'ix_1', on: 'click', to: 'var_on' } })
    expect(findInteraction(withInteractions, 'ix_2')).toEqual({ owner: 'var_off', interaction: { id: 'ix_2', on: 'appear', to: '', delay: 1 } })
    expect(findInteraction(withInteractions, 'ix_gone')).toBeUndefined()
  })
})

describe('interactionTargets', () => {
  it('offers the base variants other than the one the interaction starts from, never a state', () => {
    expect(interactionTargets(def, '')).toEqual([{ id: 'var_on', label: 'On' }, { id: 'var_off', label: 'Off' }])
    expect(interactionTargets(def, 'var_on')).toEqual([{ id: '', label: 'Primary' }, { id: 'var_off', label: 'Off' }])
    expect(interactionTargets(def, 'var_ph')).toEqual([{ id: '', label: 'Primary' }, { id: 'var_on', label: 'On' }, { id: 'var_off', label: 'Off' }])
  })
})

describe('transitionSummary', () => {
  it('summarises each type', () => {
    expect(transitionSummary({ type: 'ease', duration: 0.5 }, false)).toBe('Ease 0.5s')
    expect(transitionSummary({ type: 'ease' }, false)).toBe('Ease 0.3s')
    expect(transitionSummary({ type: 'spring', stiffness: 200 }, false)).toBe('Spring')
    expect(transitionSummary({ type: 'instant' }, true)).toBe('Instant')
  })

  it('is "Inherit" for a variant without one, and the default for a component without one', () => {
    expect(transitionSummary(undefined, true)).toBe('Inherit')
    expect(transitionSummary(undefined, false)).toBe('Ease 0.3s')
  })
})

describe('withTransitionType', () => {
  it('starts a type from its defaults', () => {
    expect(withTransitionType(undefined, 'ease')).toEqual({ type: 'ease', duration: 0.3, easing: 'ease' })
    expect(withTransitionType({ type: 'ease', duration: 1 }, 'spring')).toEqual({ type: 'spring', stiffness: 300, damping: 30 })
    expect(withTransitionType({ type: 'spring', stiffness: 100 }, 'instant')).toEqual({ type: 'instant' })
  })

  it('keeps the values of the same type', () => {
    expect(withTransitionType({ type: 'spring', stiffness: 100, damping: 5 }, 'spring')).toEqual({ type: 'spring', stiffness: 100, damping: 5 })
  })
})

describe('transitionCurve', () => {
  it('draws an easing as its cubic-bezier from bottom left to top right', () => {
    expect(transitionCurve({ type: 'ease', easing: 'linear' }, 100, 40)).toBe('M 0 40 C 0 40 100 0 100 0')
    expect(transitionCurve({ type: 'ease', easing: 'ease-in-out' }, 100, 40)).toBe('M 0 40 C 42 40 58 0 100 0')
    expect(transitionCurve({ type: 'ease' }, 100, 40)).toBe('M 0 40 C 25 36 25 0 100 0')
  })

  it('draws instant as a step at the start', () => {
    expect(transitionCurve({ type: 'instant' }, 100, 40)).toBe('M 0 40 L 0 0 L 100 0')
  })

  it('draws a spring through its samples, an overshoot reaching the top', () => {
    const d = transitionCurve({ type: 'spring', stiffness: 300, damping: 10 }, 100, 40)
    const points = d.replace(/^M /, '').split(' L ').map(p => p.split(' ').map(Number))
    expect(points[0]).toEqual([0, 40])
    expect(points.at(-1)![0]).toBe(100)
    expect(Math.min(...points.map(p => p[1]!))).toBe(0)
    // The end (1) is below the overshoot's peak.
    expect(points.at(-1)![1]).toBeGreaterThan(0)
  })
})

describe('previewPageFor', () => {
  const project = (pages: unknown[], components: unknown[] = [], layouts: unknown[] = []) => ({ pages, components, layouts }) as unknown as Project
  const instance = (component: string) => node('Instance', { component })

  it('is the first page with an instance', () => {
    const p = project([
      { id: 'pg_a', slug: '', name: 'Home', root: node('Container') },
      { id: 'pg_b', slug: 'b', name: 'B', root: node('Container', {}, [instance('cmp_btn')]) }
    ])
    expect(previewPageFor(p, 'cmp_btn')?.id).toBe('pg_b')
  })

  it('follows instances inside another component, or a layout, to a page using it', () => {
    const viaCard = project(
      [{ id: 'pg_a', slug: '', name: 'Home', root: node('Container', {}, [instance('cmp_card')]) }],
      [{ id: 'cmp_card', name: 'Card', root: node('Container', {}, [instance('cmp_btn')]), properties: [], variants: [] }]
    )
    expect(previewPageFor(viaCard, 'cmp_btn')?.id).toBe('pg_a')
    const viaLayout = project(
      [{ id: 'pg_a', slug: '', name: 'Home', root: node('Container') }, { id: 'pg_b', slug: 'b', name: 'B', layoutId: 'lay_1', root: node('Container') }],
      [],
      [{ id: 'lay_1', name: 'Site', root: node('Container', {}, [instance('cmp_btn')]) }]
    )
    expect(previewPageFor(viaLayout, 'cmp_btn')?.id).toBe('pg_b')
  })

  it('is null when no page shows the component', () => {
    const cyclic = project(
      [{ id: 'pg_a', slug: '', name: 'Home', root: node('Container') }],
      [{ id: 'cmp_btn', name: 'Button', root: node('Container'), properties: [], variants: [] }, { id: 'cmp_card', name: 'Card', root: node('Container', {}, [instance('cmp_btn')]), properties: [], variants: [] }]
    )
    expect(previewPageFor(cyclic, 'cmp_btn')).toBeNull()
  })
})
