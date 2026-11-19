import { describe, expect, it } from 'vitest'
import type { ComponentFile, Model } from '@bildr/codegen/model'
import { TRANSITION_EASINGS as MODEL_EASINGS, VARIANT_EVENTS as MODEL_EVENTS } from '../../../codegen/src/model/schemas.ts'
import { previewPageFor } from '../../src/editor/layouts.ts'
import { cssTransition, EVENT_LABELS, findInteraction, interactionKey, interactionLabel, interactionRows, interactionTargets, parseInteractionKey, springCurve, TRANSITION_EASINGS, transitionCurve, transitionSummary, variantLabel, VARIANT_EVENTS, withTransitionType } from '../../src/shared/interactionPanel.ts'

/** Ported from the hosted `interactionPanel.test.ts`: an interaction is `<variant>:<index>` and goes to one variant (`do: [{ kind: 'setVariant', to, delay? }]`). */

const def = {
  id: 'cmp_btn',
  name: 'Button',
  root: { id: 'n_root', type: 'Container' },
  properties: [],
  variants: [
    { id: 'var_ph', name: 'Primary · Hover', overrides: {}, state: { of: '', kind: 'hover' } },
    { id: 'var_on', name: 'On', overrides: {} },
    { id: 'var_off', name: 'Off', overrides: {} }
  ]
} as unknown as ComponentFile

const go = (on: string, to: string, delay?: number) => ({ on, do: [{ kind: 'setVariant', to, ...(delay ? { delay } : {}) }] })

describe('labels', () => {
  it('names the events as Framer does, one per event of the model', () => {
    expect(EVENT_LABELS).toEqual({ click: 'Click', change: 'Change', submit: 'Submit', mouseenter: 'Mouse enter', mouseleave: 'Mouse leave', appear: 'Appear' })
    expect([...VARIANT_EVENTS]).toEqual([...MODEL_EVENTS])
    expect([...TRANSITION_EASINGS]).toEqual([...MODEL_EASINGS])
  })

  it('names variants, the primary "Primary"', () => {
    expect(variantLabel(def, '')).toBe('Primary')
    expect(variantLabel(def, 'var_on')).toBe('On')
    expect(variantLabel(def, 'var_gone')).toBe('Missing variant')
  })

  it('reads an interaction as "Click → Variant"', () => {
    expect(interactionLabel(def, { on: 'click', to: 'var_on' })).toBe('Click → On')
    expect(interactionLabel(def, { on: 'mouseleave', to: '' })).toBe('Mouse leave → Primary')
  })
})

describe('interaction keys', () => {
  it('writes the variant and the index, the primary as an empty variant', () => {
    expect(interactionKey(null, 0)).toBe(':0')
    expect(interactionKey('var_off', 2)).toBe('var_off:2')
    expect(parseInteractionKey('var_off:2')).toEqual({ variantId: 'var_off', index: 2 })
    expect(parseInteractionKey(':0')).toEqual({ variantId: '', index: 0 })
    expect(parseInteractionKey('nonsense')).toBeNull()
    expect(parseInteractionKey('var_off:x')).toBeNull()
  })
})

describe('interactionRows and findInteraction', () => {
  const withInteractions = {
    ...def,
    interactions: [go('click', 'var_on')],
    variants: [...def.variants.slice(0, 2), { ...def.variants[2]!, interactions: [go('appear', '', 1), go('mouseenter', 'var_on')] }]
  } as unknown as ComponentFile

  it('lists the interactions of a variant (the component\'s own for the primary) as rows keyed by variant and index', () => {
    expect(interactionRows(withInteractions, '')).toEqual([{ key: ':0', owner: '', index: 0, on: 'click', to: 'var_on' }])
    expect(interactionRows(withInteractions, 'var_off')).toEqual([
      { key: 'var_off:0', owner: 'var_off', index: 0, on: 'appear', to: '', delay: 1 },
      { key: 'var_off:1', owner: 'var_off', index: 1, on: 'mouseenter', to: 'var_on' }
    ])
    expect(interactionRows(withInteractions, 'var_on')).toEqual([])
    expect(interactionRows(withInteractions, 'var_gone')).toEqual([])
  })

  it('finds the interaction a key names, and the variant it belongs to (\'\' the primary)', () => {
    expect(findInteraction(withInteractions, ':0')).toMatchObject({ owner: '', on: 'click', to: 'var_on' })
    expect(findInteraction(withInteractions, 'var_off:1')).toMatchObject({ owner: 'var_off', on: 'mouseenter' })
    expect(findInteraction(withInteractions, 'var_off:2')).toBeUndefined()
    expect(findInteraction(withInteractions, 'var_gone:0')).toBeUndefined()
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

describe('cssTransition', () => {
  it('is the CSS transition the preview swatch runs with: an ease\'s duration and easing', () => {
    expect(cssTransition({ type: 'ease', duration: 0.5, easing: 'ease-out' }, ['left'])).toBe('left 500ms ease-out')
    expect(cssTransition({ type: 'ease' }, ['left', 'top'])).toBe('left 300ms ease, top 300ms ease')
  })

  it('follows a spring\'s samples with linear(), settling when the spring does', () => {
    const curve = springCurve(300, 30)
    expect(curve.points[0]).toBe(0)
    expect(curve.points.at(-1)).toBe(1)
    expect(cssTransition({ type: 'spring' }, ['left'])).toBe(`left ${Math.round(curve.duration * 1000)}ms linear(${curve.points.join(', ')})`)
  })

  it('has none for an instant transition, or no properties', () => {
    expect(cssTransition({ type: 'instant' }, ['left'])).toBeUndefined()
    expect(cssTransition({ type: 'ease' }, [])).toBeUndefined()
  })
})

describe('previewPageFor', () => {
  const node = (id: string, type: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({ id, type, props, children })
  const instance = (id: string, component: string) => node(id, 'Instance', { component })
  const model = (pages: unknown[], components: unknown[] = [], layouts: unknown[] = []) => ({ modules: { app: { pages, components } }, layouts }) as unknown as Model

  it('is the first page with an instance', () => {
    const shown = model([
      { id: 'pg_a', name: 'home', path: '/', root: node('r1', 'Container') },
      { id: 'pg_b', name: 'b', path: '/b', root: node('r2', 'Container', {}, [instance('i1', 'cmp_btn')]) }
    ])
    expect(previewPageFor(shown, 'cmp_btn')?.id).toBe('pg_b')
  })

  it('follows instances inside another component, or a layout, to a page using it', () => {
    const viaCard = model(
      [{ id: 'pg_a', name: 'home', path: '/', root: node('r1', 'Container', {}, [instance('i1', 'cmp_card')]) }],
      [{ id: 'cmp_card', name: 'Card', root: node('c1', 'Container', {}, [instance('i2', 'cmp_btn')]), properties: [], variants: [] }]
    )
    expect(previewPageFor(viaCard, 'cmp_btn')?.id).toBe('pg_a')
    const viaLayout = model(
      [{ id: 'pg_a', name: 'home', path: '/', root: node('r1', 'Container') }, { id: 'pg_b', name: 'b', path: '/b', layout: 'lay_1', root: node('r2', 'Container') }],
      [],
      [{ id: 'lay_1', name: 'site', root: node('l1', 'Container', {}, [instance('i3', 'cmp_btn')]), slots: [] }]
    )
    expect(previewPageFor(viaLayout, 'cmp_btn')?.id).toBe('pg_b')
  })

  it('is null when no page shows the component', () => {
    const cyclic = model(
      [{ id: 'pg_a', name: 'home', path: '/', root: node('r1', 'Container') }],
      [{ id: 'cmp_btn', name: 'Button', root: node('b1', 'Container'), properties: [], variants: [] }, { id: 'cmp_card', name: 'Card', root: node('c1', 'Container', {}, [instance('i2', 'cmp_btn')]), properties: [], variants: [] }]
    )
    expect(previewPageFor(cyclic, 'cmp_btn')).toBeNull()
  })
})
