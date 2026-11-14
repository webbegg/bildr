// Covers P2b (mapping §3): property kinds, bindings, variant states/interactions/transitions,
// layout variables and layoutValues, breakpointBase and locked are checked as model problems.
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from './fixture'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const CARD = '.bildr/modules/blog/components/post-card.json'
const BADGE = '.bildr/modules/blog/components/badge.json'
const IDX = '.bildr/modules/blog/pages/index.json'
const LAYOUT = '.bildr/layouts/main.json'
const PROJECT = '.bildr/bildr.json'

/** A small component with one node of each kind the tests bind. */
export const badge = (): Json => ({
  id: 'cmp_badge',
  name: 'Badge',
  properties: [
    { id: 'prop_label', name: 'label', kind: 'text', bindings: [{ nodeId: 'n_badge_text', prop: 'text' }] },
    { id: 'prop_tone', name: 'tone', kind: 'select', options: ['muted', 'primary'], default: 'muted', bindings: [{ nodeId: 'n_badge', prop: 'bg', target: 'style' }] }
  ],
  variants: [],
  root: { id: 'n_badge', type: 'Row', style: { px: '2', bg: 'muted' }, children: [{ id: 'n_badge_text', type: 'Text', props: { text: 'Badge' } }] }
})

const problems = (edit: (files: Record<string, Json>) => void) => {
  const raw = fixtureModelFiles()
  const files: Record<string, Json> = Object.fromEntries(Object.entries(raw).map(([path, text]) => [path, JSON.parse(text)]))
  files[BADGE] = badge()
  edit(files)
  const result = loadModel(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)])))
  return result.ok ? [] : result.problems.map(problem => `${problem.path}: ${problem.message}`)
}

const instance = (values: Json, extra: Json = {}) => (files: Record<string, Json>) => {
  files[IDX]!.root.children.push({ id: 'n_b', type: 'Instance', props: { component: 'cmp_badge', values, ...extra } })
}

describe('loadModel: component property kinds', () => {
  it('accepts the badge with its text and select properties', () => {
    expect(problems(() => {})).toEqual([])
  })

  it('a select needs options, and its default and instance values must be one of them', () => {
    expect(problems((files) => {
      delete files[BADGE]!.properties[1].options
    })).toContainEqual(`${BADGE}: properties.1.options: A select property needs its options`)
    expect(problems((files) => {
      files[BADGE]!.properties[1].default = 'loud'
    })).toContainEqual(`${BADGE}: properties.1.default: "loud" is not one of the options of tone (muted, primary)`)
    expect(problems(instance({ prop_tone: 'loud' }))).toContainEqual(`${IDX}: root.children.4.props.values.prop_tone: "loud" is not one of the options of tone (muted, primary)`)
  })

  it('an icon property takes an icon name', () => {
    expect(problems((files) => {
      files[BADGE]!.properties.push({ id: 'prop_icon', name: 'icon', kind: 'icon', default: 'send' })
    })).toContainEqual(`${BADGE}: properties.2.default: An icon is a name like "i-lucide-send"`)
  })

  it('a field property takes a known field id', () => {
    expect(problems((files) => {
      files[BADGE]!.properties.push({ id: 'prop_field', name: 'field', kind: 'field', default: 'fld_nope' })
    })).toContainEqual(`${BADGE}: properties.2.default: Unknown field "fld_nope"`)
  })

  it('a list of entities (many) is bound, never a literal', () => {
    const many = (files: Record<string, Json>) => {
      files[BADGE]!.properties.push({ id: 'prop_posts', name: 'posts', kind: 'entity', entity: 'ent_post', many: true })
    }
    expect(problems((files) => {
      many(files)
      instance({ prop_posts: 'x' })(files)
    })).toContainEqual(`${IDX}: root.children.4.props.values.prop_posts: posts is a list of entities: bind it with $bind`)
  })

  it('a property is required or optional, not both', () => {
    expect(problems((files) => {
      Object.assign(files[BADGE]!.properties[0], { required: true, optional: true })
    })).toContainEqual(`${BADGE}: properties.0.optional: A property is either required or optional`)
  })
})

describe('loadModel: property bindings', () => {
  it('a binding names a node of the component and a prop it can take', () => {
    expect(problems((files) => {
      files[BADGE]!.properties[0].bindings[0].nodeId = 'n_nope'
    })).toContainEqual(`${BADGE}: properties.0.bindings.0.nodeId: Unknown node "n_nope"`)
    expect(problems((files) => {
      files[BADGE]!.properties[0].bindings[0].prop = 'level'
    })).toContainEqual(`${BADGE}: properties.0.bindings.0.prop: A property can't drive "level": it shapes the generated markup`)
  })

  it('a style binding names a token of the project base, from a text or select property', () => {
    expect(problems((files) => {
      files[BADGE]!.properties[1].bindings[0].prop = 'glow'
    })).toContainEqual(`${BADGE}: properties.1.bindings.0.prop: Unknown style token "glow"`)
    expect(problems((files) => {
      files[BADGE]!.properties.push({ id: 'prop_n', name: 'n', kind: 'number', bindings: [{ nodeId: 'n_badge', prop: 'p', target: 'style' }] })
    })).toContainEqual(`${BADGE}: properties.2.bindings.0: n (kind number) can't drive the style "p": use a text or select property`)
    expect(problems((files) => {
      files[BADGE]!.properties[1].options = ['muted', 'glow']
    })).toContainEqual(`${BADGE}: properties.1.options.1: "glow" is not a value of the style "bg" tone drives`)
  })

  it('a slot property names its node with nodeId, never bindings', () => {
    expect(problems((files) => {
      files[CARD]!.properties.find((property: Json) => property.kind === 'slot').bindings = [{ nodeId: 'n_actions', prop: 'children' }]
    })).toContainEqual(`${CARD}: properties.3.bindings: A slot property names its node with nodeId`)
  })

  it('a style a property drives is not also overridden by a variant', () => {
    expect(problems((files) => {
      files[BADGE]!.variants.push({ id: 'var_loud', name: 'loud', overrides: { n_badge: { style: { bg: 'primary' } } } })
    })).toContainEqual(`${BADGE}: variants.0.overrides.n_badge.style.bg: tone drives "bg" of n_badge: a variant can't override it too`)
  })
})

describe('loadModel: variants, states, interactions and transitions', () => {
  const variant = (extra: Json) => (files: Record<string, Json>) => {
    files[BADGE]!.variants.push({ id: 'var_loud', name: 'loud', overrides: {}, ...extra })
  }

  it('accepts unset, prop overrides, a hover state, interactions and transitions', () => {
    expect(problems((files) => {
      variant({ overrides: { n_badge: { unset: ['px'] }, n_badge_text: { props: { text: 'LOUD' } } }, transition: { type: 'spring', stiffness: 200 } })(files)
      files[BADGE]!.variants.push({ id: 'var_hover', name: 'hover', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' } })
      files[BADGE]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: 'var_loud', delay: 0.5 }] }]
      files[BADGE]!.transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    })).toEqual([])
  })

  it('unset names a style key of the project base, once, and not one the override sets', () => {
    expect(problems(variant({ overrides: { n_badge: { unset: ['glow'] } } }))).toContainEqual(`${BADGE}: variants.0.overrides.n_badge.unset.0: Unknown style token "glow"`)
    expect(problems(variant({ overrides: { n_badge: { style: { px: '4' }, unset: ['px'] } } }))).toContainEqual(`${BADGE}: variants.0.overrides.n_badge.unset.0: Variant loud both overrides and removes "px" on n_badge`)
  })

  it('an override style is a token of the project, and a prop override a value the node takes', () => {
    expect(problems(variant({ overrides: { n_badge: { style: { px: 'huge' } } } }))).toContainEqual(expect.stringMatching(/^.*badge\.json: variants\.0\.overrides\.n_badge\.style\.px: /))
    expect(problems(variant({ overrides: { n_badge_text: { props: { level: 3 } } } }))).toContainEqual(`${BADGE}: variants.0.overrides.n_badge_text.props.level: A variant can't override "level": it shapes the generated markup`)
    expect(problems(variant({ overrides: { n_nope: { style: { px: '4' } } } }))).toContainEqual(`${BADGE}: variants.0.overrides.n_nope: Variant loud overrides the missing node "n_nope"`)
  })

  it('a state is of an existing variant that is no state, one per kind', () => {
    expect(problems(variant({ state: { of: 'var_nope', kind: 'hover' } }))).toContainEqual(`${BADGE}: variants.0.state.of: State loud is a state of the missing variant "var_nope"`)
    expect(problems((files) => {
      variant({ state: { of: '', kind: 'hover' } })(files)
      files[BADGE]!.variants.push({ id: 'var_hover_2', name: 'hover2', overrides: {}, state: { of: '', kind: 'hover' } })
    })).toContainEqual(`${BADGE}: variants.1.state.kind: The primary variant already has a hover state`)
  })

  it('an interaction goes to an existing variant that is no state', () => {
    expect(problems((files) => {
      files[BADGE]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: 'var_nope' }] }]
    })).toContainEqual(`${BADGE}: interactions.0.do.0.to: An interaction goes to the missing variant "var_nope"`)
    expect(problems((files) => {
      variant({ state: { of: '', kind: 'pressed' } })(files)
      files[BADGE]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: 'var_loud' }] }]
    })).toContainEqual(`${BADGE}: interactions.0.do.0.to: An interaction can't go to the state loud: states show from the pointer`)
    expect(problems((files) => {
      files[BADGE]!.interactions = [{ on: 'submit', do: [{ kind: 'setVariant', to: '' }] }]
    })).toContainEqual(expect.stringMatching(/badge\.json: interactions\.0\.on: /))
  })

  it('an instance sets a variant of its component', () => {
    expect(problems(instance({}, { variant: 'var_nope' }))).toContainEqual(`${IDX}: root.children.4.props.variant: Component Badge has no variant "var_nope"`)
  })
})

describe('loadModel: layout variables and layoutValues', () => {
  const title = (files: Record<string, Json>) => {
    files[LAYOUT]!.variables = [{ id: 'prop_title', name: 'title', kind: 'text', default: 'Blog' }]
  }

  it('accepts a page setting its layout\'s variable that the layout reads', () => {
    expect(problems((files) => {
      title(files)
      files[LAYOUT]!.root.children[0].children[0].children[0].props.text = { $bind: 'layout.title' }
      files[IDX]!.layoutValues = { prop_title: 'Posts' }
    })).toEqual([])
  })

  it('a page sets only variables of its layout, with static values of their kind', () => {
    expect(problems((files) => {
      title(files)
      files[IDX]!.layoutValues = { prop_nope: 'x' }
    })).toContainEqual(`${IDX}: layoutValues.prop_nope: Layout main has no variable "prop_nope"`)
    expect(problems((files) => {
      title(files)
      files[IDX]!.layoutValues = { prop_title: { $bind: 'site.name' } }
    })).toContainEqual(`${IDX}: layoutValues.prop_title: Layout values are static (definePageMeta is compiled ahead of the page)`)
    expect(problems((files) => {
      title(files)
      files[IDX]!.layoutValues = { prop_title: 3 }
    })).toContainEqual(`${IDX}: layoutValues.prop_title: title must be a string`)
    expect(problems((files) => {
      title(files)
      delete files[IDX]!.layout
      files[IDX]!.layoutValues = { prop_title: 'x' }
    })).toContainEqual(`${IDX}: layoutValues: A page without a layout has no layout values`)
  })

  it('a layout variable is no slot, entity or field', () => {
    expect(problems((files) => {
      files[LAYOUT]!.variables = [{ id: 'prop_x', name: 'x', kind: 'slot', nodeId: 'n_main' }]
    })).toContainEqual(`${LAYOUT}: variables.0.kind: A layout variable is text, textarea, number, boolean, select, image, link or icon`)
  })

  it('$bind layout.* is for layouts, and names one of its variables', () => {
    expect(problems((files) => {
      files[IDX]!.root.children[0].children[0].props.text = { $bind: 'layout.title' }
    })).toContainEqual(`${IDX}: root.children.0.children.0.props.text.$bind: "layout" values are read in layouts only`)
    expect(problems((files) => {
      title(files)
      files[LAYOUT]!.root.children[0].children[0].children[0].props.text = { $bind: 'layout.subtitle' }
    })).toContainEqual(`${LAYOUT}: root.children.0.children.0.children.0.props.text.$bind: Layout main has no variable "subtitle"`)
  })
})

describe('loadModel: breakpointBase and locked', () => {
  it('breakpointBase is mobile or desktop, and an unset key follows it', () => {
    expect(problems((files) => {
      files[PROJECT]!.breakpointBase = 'tablet'
    })).toContainEqual(expect.stringMatching(/^\.bildr\/bildr\.json: breakpointBase: /))
    expect(problems((files) => {
      files[PROJECT]!.breakpointBase = 'desktop'
      files[BADGE]!.variants.push({ id: 'var_loud', name: 'loud', overrides: { n_badge: { unset: ['md:px'] } } })
    })).toContainEqual(expect.stringMatching(/variants\.0\.overrides\.n_badge\.unset\.0: Breakpoint "md" in style token "md:px" is for mobile-first projects/))
  })

  it('a node may be locked (editor metadata)', () => {
    expect(problems((files) => {
      files[IDX]!.root.children[0].locked = true
    })).toEqual([])
  })
})
