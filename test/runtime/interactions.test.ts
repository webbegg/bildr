import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentDefinition, DocNode } from '#shared/document/schema'
import { animatedProperties, createInteractionMachine, cssTransition, DEFAULT_TRANSITION, hasInteractivity, initialMachineState, nextVariant, renderedVariant, rootElementType, springCurve, springEasing, transitionFor } from '#shared/runtime/interactions'
import { resolveInstance } from '#shared/runtime/instances'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

/**
 * A button: Primary (the root) with a Hover and a Pressed state, a base
 * variant "On" with its own Hover; Primary clicks to On, On leaves back.
 */
function button(): ComponentDefinition {
  return {
    id: 'btn',
    name: 'Button',
    root: n('root', 'Container', {}, [n('label', 'Text', { text: 'Go' })], { bg: 'primary', p: '2' }),
    properties: [],
    interactions: [{ id: 'i-click', on: 'click', to: 'on' }],
    variants: [
      { id: 'hover', name: 'Primary · Hover', state: { of: '', kind: 'hover' }, overrides: { root: { style: { bg: 'secondary' } } } },
      { id: 'pressed', name: 'Primary · Pressed', state: { of: '', kind: 'pressed' }, overrides: { root: { style: { bg: 'error' } } } },
      { id: 'on', name: 'On', overrides: { root: { style: { p: '4' } }, label: { props: { text: 'On' } } }, interactions: [{ id: 'i-leave', on: 'mouseleave', to: '' }] },
      { id: 'on-hover', name: 'On · Hover', state: { of: 'on', kind: 'hover' }, overrides: { root: { style: { bg: 'success' } } } }
    ]
  }
}

describe('renderedVariant', () => {
  it('shows pressed over hover over the current variant', () => {
    const def = button()
    expect(renderedVariant(def, '', { hover: false, pressed: false })).toBe('')
    expect(renderedVariant(def, '', { hover: true, pressed: false })).toBe('hover')
    expect(renderedVariant(def, '', { hover: true, pressed: true })).toBe('pressed')
    expect(renderedVariant(def, '', { hover: false, pressed: true })).toBe('pressed')
  })

  it('uses the states of the current base variant, and the base when it has none', () => {
    const def = button()
    expect(renderedVariant(def, 'on', { hover: true, pressed: false })).toBe('on-hover')
    // On has no Pressed state: pressing it shows its Hover, then itself.
    expect(renderedVariant(def, 'on', { hover: true, pressed: true })).toBe('on-hover')
    expect(renderedVariant(def, 'on', { hover: false, pressed: true })).toBe('on')
  })

  it('falls back to the primary for an unknown current variant', () => {
    expect(renderedVariant(button(), 'gone', { hover: true, pressed: false })).toBe('hover')
  })
})

describe('nextVariant', () => {
  it('switches on an interaction of the current variant', () => {
    expect(nextVariant(button(), '', '', 'click')).toEqual({ to: 'on', delay: 0 })
    expect(nextVariant(button(), '', 'on', 'mouseleave')).toEqual({ to: '', delay: 0 })
  })

  it('returns null when nothing listens to the event', () => {
    expect(nextVariant(button(), '', '', 'mouseleave')).toBeNull()
    expect(nextVariant(button(), '', 'on', 'click')).toBeNull()
  })

  it('starts from the set variant when the current one is gone', () => {
    expect(nextVariant(button(), 'on', 'gone', 'mouseleave')).toEqual({ to: '', delay: 0 })
  })

  it('prefers an interaction of the shown state over its base', () => {
    const def = button()
    def.variants[0]!.interactions = [{ id: 'i-hover-click', on: 'click', to: 'on', delay: 0.5 }]
    def.interactions = [{ id: 'i-click', on: 'click', to: '' }]
    expect(nextVariant(def, '', '', 'click', 'hover')).toEqual({ to: 'on', delay: 0.5 })
    expect(nextVariant(def, '', '', 'click', '')).toEqual({ to: '', delay: 0 })
  })
})

describe('createInteractionMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function machine(def = button(), set = '') {
    const state = initialMachineState(set)
    const m = createInteractionMachine({ component: () => def, setVariant: () => set }, state)
    return { state, m, rendered: () => renderedVariant(def, state.current, state) }
  }

  it('applies hover and pressed while the pointer is over or pressing, and returns afterwards', () => {
    const { m, rendered } = machine()
    m.hover(true)
    expect(rendered()).toBe('hover')
    m.press(true)
    expect(rendered()).toBe('pressed')
    m.press(false)
    expect(rendered()).toBe('hover')
    m.hover(false)
    expect(rendered()).toBe('')
  })

  it('switches on click and back on mouse leave', () => {
    const { m, state, rendered } = machine()
    m.hover(true)
    m.dispatch('mouseenter')
    m.dispatch('click')
    expect(state.current).toBe('on')
    expect(rendered()).toBe('on-hover')
    m.hover(false)
    m.dispatch('mouseleave')
    expect(state.current).toBe('')
    expect(rendered()).toBe('')
  })

  it('records the change a transition animates', () => {
    const { m, state } = machine()
    m.hover(true)
    expect(state.change).toEqual({ from: '', to: 'hover' })
    m.dispatch('click')
    expect(state.change).toEqual({ from: 'hover', to: 'on-hover' })
  })

  it('waits for the delay before switching', () => {
    const def = button()
    def.interactions = [{ id: 'i-click', on: 'click', to: 'on', delay: 1.5 }]
    const { m, state } = machine(def)
    m.dispatch('click')
    expect(state.current).toBe('')
    vi.advanceTimersByTime(1499)
    expect(state.current).toBe('')
    vi.advanceTimersByTime(1)
    expect(state.current).toBe('on')
  })

  it('cancels a pending switch when another one is scheduled, or on dispose', () => {
    const def = button()
    def.interactions = [{ id: 'a', on: 'click', to: 'on', delay: 1 }, { id: 'b', on: 'mouseenter', to: 'on', delay: 2 }]
    const { m, state } = machine(def)
    m.dispatch('click')
    m.dispatch('mouseenter')
    vi.advanceTimersByTime(1000)
    expect(state.current).toBe('')
    m.dispose()
    vi.advanceTimersByTime(5000)
    expect(state.current).toBe('')
  })

  it('fires appear once', () => {
    const def = button()
    def.interactions = [{ id: 'a', on: 'appear', to: 'on' }]
    def.variants[2]!.interactions = [{ id: 'b', on: 'appear', to: '' }]
    const { m, state } = machine(def)
    m.appear()
    expect(state.current).toBe('on')
    m.appear()
    expect(state.current).toBe('on')
  })

  it('starts from the set variant and goes back to it on reset', () => {
    let set = 'on'
    const state = initialMachineState(set)
    const m = createInteractionMachine({ component: () => button(), setVariant: () => set }, state)
    expect(state.current).toBe('on')
    m.dispatch('mouseleave')
    expect(state.current).toBe('')
    set = 'on'
    m.reset()
    expect(state.current).toBe('on')
  })
})

describe('dispatch', () => {
  it('tells whether an interaction handled the event', () => {
    const state = initialMachineState('')
    const m = createInteractionMachine({ component: () => button(), setVariant: () => '' }, state)
    expect(m.dispatch('mouseenter')).toBe(false)
    expect(m.dispatch('click')).toBe(true)
  })
})

describe('rootElementType', () => {
  it('follows instance roots to the element a component renders', () => {
    const inner: ComponentDefinition = { id: 'inner', name: 'Inner', root: n('b', 'Button', { label: 'Go' }), properties: [], variants: [] }
    const outer: ComponentDefinition = { id: 'outer', name: 'Outer', root: n('i', 'Instance', { component: 'inner' }), properties: [], variants: [] }
    const components = [inner, outer, button()]
    expect(rootElementType(outer, components)).toBe('Button')
    expect(rootElementType(button(), components)).toBe('Container')
    expect(rootElementType({ ...outer, root: n('i', 'Instance', { component: 'gone' }) }, components)).toBe('Instance')
  })

  it('stops on a cycle', () => {
    const a: ComponentDefinition = { id: 'a', name: 'A', root: n('i', 'Instance', { component: 'b' }), properties: [], variants: [] }
    const b: ComponentDefinition = { id: 'b', name: 'B', root: n('j', 'Instance', { component: 'a' }), properties: [], variants: [] }
    expect(rootElementType(a, [a, b])).toBe('Instance')
  })
})

describe('hasInteractivity', () => {
  it('is true only with states or interactions', () => {
    expect(hasInteractivity(button())).toBe(true)
    expect(hasInteractivity({ ...button(), interactions: undefined, variants: [{ id: 'v', name: 'V', overrides: {} }] })).toBe(false)
    expect(hasInteractivity({ ...button(), interactions: undefined, variants: [{ id: 'v', name: 'V', overrides: {}, interactions: [{ id: 'x', on: 'click', to: '' }] }] })).toBe(true)
  })
})

describe('transitionFor', () => {
  it('uses the target variant\'s transition, else the component\'s, else the default', () => {
    const def = button()
    expect(transitionFor(def, '', 'on')).toEqual(DEFAULT_TRANSITION)
    def.transition = { type: 'ease', duration: 0.5 }
    expect(transitionFor(def, '', 'on')).toEqual({ type: 'ease', duration: 0.5 })
    def.variants[2]!.transition = { type: 'spring', stiffness: 200, damping: 20 }
    expect(transitionFor(def, '', 'on')).toEqual({ type: 'spring', stiffness: 200, damping: 20 })
    expect(transitionFor(def, 'on', '')).toEqual({ type: 'ease', duration: 0.5 })
  })

  it('uses a state\'s transition both into and out of it', () => {
    const def = button()
    def.transition = { type: 'ease', duration: 0.5 }
    def.variants[0]!.transition = { type: 'instant' }
    expect(transitionFor(def, '', 'hover')).toEqual({ type: 'instant' })
    expect(transitionFor(def, 'hover', '')).toEqual({ type: 'instant' })
  })

  it('is instant with reduced motion', () => {
    expect(transitionFor(button(), '', 'on', { reducedMotion: true })).toEqual({ type: 'instant' })
  })
})

describe('cssTransition', () => {
  it('lists the properties with the duration and easing of an ease', () => {
    expect(cssTransition({ type: 'ease', duration: 0.25, easing: 'ease-out' }, ['background-color', 'padding'])).toBe('background-color 250ms ease-out, padding 250ms ease-out')
  })

  it('defaults an ease to 0.3 s ease', () => {
    expect(cssTransition({ type: 'ease' }, ['color'])).toBe('color 300ms ease')
  })

  it('is none for an instant transition or no properties', () => {
    expect(cssTransition({ type: 'instant' }, ['color'])).toBeUndefined()
    expect(cssTransition({ type: 'ease' }, [])).toBeUndefined()
  })

  it('drives a spring with its settle time and a linear() curve, or a cubic-bezier without linear()', () => {
    const linear = cssTransition({ type: 'spring', stiffness: 300, damping: 30 }, ['opacity'])!
    expect(linear).toMatch(/^opacity \d+ms linear\(0, .+, 1\)$/)
    const bezier = cssTransition({ type: 'spring', stiffness: 300, damping: 30 }, ['opacity'], { linear: false })!
    expect(bezier).toMatch(/^opacity \d+ms cubic-bezier\([\d., -]+\)$/)
  })
})

describe('springCurve', () => {
  it('settles at 1, overshooting only when underdamped', () => {
    const bouncy = springCurve(400, 10)
    expect(bouncy.points.at(0)).toBe(0)
    expect(bouncy.points.at(-1)).toBe(1)
    expect(Math.max(...bouncy.points)).toBeGreaterThan(1.05)
    const critical = springCurve(100, 20)
    expect(Math.max(...critical.points)).toBeLessThanOrEqual(1)
  })

  it('takes longer with a softer spring', () => {
    expect(springCurve(50, 10).duration).toBeGreaterThan(springCurve(500, 40).duration)
    expect(springCurve(300, 30).duration).toBeGreaterThan(0.1)
    expect(springCurve(300, 30).duration).toBeLessThan(2)
  })

  it('makes a linear() easing of its samples', () => {
    expect(springEasing(springCurve(300, 30))).toMatch(/^linear\(0, (?:\d+(?:\.\d+)?, )+1\)$/)
  })
})

describe('animatedProperties', () => {
  it('maps the style keys any variant changes on a node to CSS properties', () => {
    const def = button()
    def.variants[2]!.overrides.root!.unset = ['shadow']
    expect(animatedProperties(def, 'root').sort()).toEqual(['background-color', 'box-shadow', 'padding'])
    expect(animatedProperties(def, 'label')).toEqual([])
  })

  it('skips keys that do not animate, like display, and maps breakpoint keys to their base', () => {
    const def = button()
    def.variants[2]!.overrides.label = { style: { 'display': 'hidden', 'md:text': 'lg', 'rounded': 'md' } }
    expect(animatedProperties(def, 'label').sort()).toEqual(['border-radius', 'font-size', 'line-height'])
  })
})

describe('resolveInstance with states', () => {
  it('renders a state over its base variant\'s overrides', () => {
    const def = button()
    const tree = resolveInstance(n('i', 'Instance', { component: 'btn', variant: 'on-hover' }), [def])!
    expect(tree.style).toEqual({ bg: 'success', p: '4' })
    expect(tree.children[0]!.props.text).toBe('On')
  })

  it('lets a state remove a token its base sets, and set one its base removes', () => {
    const def = button()
    def.variants[2]!.overrides.root = { style: { p: '4' }, unset: ['bg'] }
    def.variants[3]!.overrides.root = { style: { bg: 'success' }, unset: ['p'] }
    const tree = resolveInstance(n('i', 'Instance', { component: 'btn', variant: 'on-hover' }), [def])!
    expect(tree.style).toEqual({ bg: 'success' })
  })
})
