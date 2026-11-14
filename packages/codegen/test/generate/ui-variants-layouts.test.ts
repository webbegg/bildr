// Covers P2b (mapping §3): what the generator emits for property kinds and bindings, variant
// overrides, states, interactions and transitions, layout variables, breakpointBase and locked.
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const BADGE = '.bildr/modules/blog/components/badge.json'
const IDX = '.bildr/modules/blog/pages/index.json'
const LAYOUT = '.bildr/layouts/main.json'
const PROJECT = '.bildr/bildr.json'

const badge = (): Json => ({
  id: 'cmp_badge',
  name: 'Badge',
  properties: [
    { id: 'prop_label', name: 'label', kind: 'text', bindings: [{ nodeId: 'n_badge_text', prop: 'text' }] },
    { id: 'prop_tone', name: 'tone', kind: 'select', options: ['muted', 'primary'], default: 'muted', bindings: [{ nodeId: 'n_badge', prop: 'bg', target: 'style' }] }
  ],
  variants: [],
  root: { id: 'n_badge', type: 'Row', style: { px: '2', bg: 'muted' }, children: [{ id: 'n_badge_text', type: 'Text', props: { text: 'Badge' } }] }
})

const load = (edit: (files: Record<string, Json>) => void = () => {}) => {
  const files: Record<string, Json> = Object.fromEntries(Object.entries(fixtureModelFiles()).map(([path, text]) => [path, JSON.parse(text)]))
  files[BADGE] = badge()
  edit(files)
  const result = loadModel(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)])))
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}
const out = (edit: (files: Record<string, Json>) => void, suffix: string) =>
  generateUi(load(edit)).find(file => file.path.endsWith(suffix))!.content
const badgeOut = (edit: (badge: Json, files: Record<string, Json>) => void = () => {}) => out(files => edit(files[BADGE]!, files), 'components/blog/Badge.vue')

describe('generateUi: property kinds', () => {
  it('types textarea, icon, field, select (its options) and a list of entities', () => {
    const code = badgeOut((component) => {
      component.properties.push(
        { id: 'prop_bio', name: 'bio', kind: 'textarea', default: '' },
        { id: 'prop_icon', name: 'icon', kind: 'icon', default: 'i-lucide-star' },
        { id: 'prop_field', name: 'field', kind: 'field', default: 'fld_title' },
        { id: 'prop_posts', name: 'posts', kind: 'entity', entity: 'ent_post', pick: ['title'], many: true, required: true }
      )
    })
    expect(code).toContain([
      'const props = withDefaults(defineProps<{',
      '  label?: string',
      '  tone?: \'muted\' | \'primary\'',
      '  bio?: string',
      '  icon?: string',
      '  field?: string',
      '  posts: Pick<Post, \'title\'>[]',
      '}>(), { label: undefined, tone: \'muted\', bio: \'\', icon: \'i-lucide-star\', field: \'fld_title\' })'
    ].join('\n'))
  })

  it('gives an optional prop without a default an explicit undefined default, booleans excepted (vue/require-default-prop)', () => {
    const code = badgeOut((component) => {
      component.properties.push({ id: 'prop_on', name: 'on', kind: 'boolean' })
    })
    expect(code).toContain('}>(), { label: undefined, tone: \'muted\' })')
    expect(code).toContain('  on?: boolean\n')
  })
})

describe('generateUi: property bindings', () => {
  it('binds a prop to the property, the node\'s own value as fallback', () => {
    expect(badgeOut()).toContain('<p class="whitespace-pre-line">{{ props.label ?? \'Badge\' }}</p>')
  })

  it('binds a style key through a class map of the values it can take', () => {
    const code = badgeOut()
    expect(code).toContain('const badgeBgClasses = {\n  muted: \'bg-muted\',\n  primary: \'bg-primary\'\n} as const')
    expect(code).toContain('<div class="flex px-2 flex-row" :class="badgeBgClasses[props.tone]">')
  })

  it('sets an instance value of a property', () => {
    const page = out((files) => {
      files[IDX]!.root.children.push({ id: 'n_b', type: 'Instance', props: { component: 'cmp_badge', values: { prop_label: 'New', prop_tone: 'primary' } } })
    }, 'pages/index.vue')
    expect(page).toContain('<BlogBadge label="New" tone="primary" class="self-stretch" />')
  })
})

describe('generateUi: variants', () => {
  const loud = (extra: Json = {}) => (component: Json) => {
    component.variants.push({ id: 'var_loud', name: 'loud', overrides: { n_badge: { style: { py: '1' }, unset: ['px'] }, n_badge_text: { props: { text: 'LOUD' } } }, ...extra })
  }

  it('overrides any prop per variant and removes unset style keys', () => {
    const code = badgeOut(loud())
    expect(code).toContain('{{ props.label ?? ({ default: \'Badge\', loud: \'LOUD\' })[props.variant] }}')
    expect(code).toContain('const badgeVariants = {\n  default: \'px-2\',\n  loud: \'py-1\'\n} as const')
  })

  it('sets the variant of an instance by name', () => {
    const page = out((files) => {
      loud()(files[BADGE]!)
      files[IDX]!.root.children.push({ id: 'n_b', type: 'Instance', props: { component: 'cmp_badge', variant: 'var_loud', values: {} } })
    }, 'pages/index.vue')
    expect(page).toContain('<BlogBadge variant="loud" class="self-stretch" />')
  })

  // The root carries the group class, so a group variant on it would need an ancestor: it gets plain hover:/active:.
  it('renders hover and pressed states on the root with hover:/active: classes and animates them with the transition', () => {
    const code = badgeOut((component) => {
      component.variants.push(
        { id: 'var_hover', name: 'hovered', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' } },
        { id: 'var_pressed', name: 'pressed', overrides: { n_badge: { style: { px: '4' } } }, state: { of: '', kind: 'pressed' } }
      )
      component.transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    })
    expect(code).toContain([
      'const badgeVariants = {',
      '  default: \'px-2 hover:px-3 active:px-4\',',
      '  hovered: \'px-3\',',
      '  pressed: \'px-4\'',
      '} as const'
    ].join('\n'))
    expect(code).not.toContain('group-')
    expect(code).toContain('<div class="flex transition-[padding-left,padding-right] duration-200 ease-[ease-out] flex-row" :class="[badgeVariants[props.variant], badgeBgClasses[props.tone]]">')
    expect(code).not.toContain('useVariantState')
  })

  it('renders hover and pressed states on a descendant with group classes from the root', () => {
    const code = badgeOut((component) => {
      component.root.children[0].style = { color: 'muted' }
      component.variants.push(
        { id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { style: { color: 'primary' } } }, state: { of: '', kind: 'hover' } },
        { id: 'var_pressed', name: 'pressed', overrides: { n_badge_text: { style: { color: 'error' } } }, state: { of: '', kind: 'pressed' } }
      )
    })
    expect(code).toContain('  default: \'text-muted group-hover/badge:text-primary group-active/badge:text-error\',')
    expect(code).toContain('<div class="flex group/badge')
  })

  it('gives the golden PostCard root plain hover: classes and its title group-hover/post-card: ones', () => {
    const code = out(() => {}, 'components/blog/PostCard.vue')
    expect(code).toContain('const cardVariants = {\n  default: \'p-5 hover:shadow-md\',')
    expect(code).not.toMatch(/cardVariants = \{[^}]*group-hover/)
    expect(code).toContain('const titleVariants = {\n  default: \'group-hover/post-card:text-primary\',')
    expect(code).toContain('group/post-card')
  })

  it('switches variants on interactions with the core useVariantState composable', () => {
    const code = badgeOut((component) => {
      loud({ interactions: [{ on: 'mouseleave', do: [{ kind: 'setVariant', to: '', delay: 0.5 }] }] })(component)
      component.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: 'var_loud' }] }, { on: 'appear', do: [{ kind: 'setVariant', to: 'var_loud', delay: 1 }] }]
    })
    expect(code).toContain([
      '}>(), { label: undefined, tone: \'muted\', variant: \'default\' })',
      '',
      'const { variant, on } = useVariantState(() => props.variant, {',
      '  interactions: {',
      '    default: [{ on: \'click\', to: \'loud\' }, { on: \'appear\', to: \'loud\', delay: 1 }],',
      '    loud: [{ on: \'mouseleave\', to: \'default\', delay: 0.5 }]',
      '  }',
      '}, \'variantRoot\')'
    ].join('\n'))
    expect(code).toContain('<div ref="variantRoot" class="flex transition-[padding-left,padding-right,padding-top,padding-bottom] duration-300 ease-[ease] flex-row" :class="[badgeVariants[variant], badgeBgClasses[props.tone]]" v-on="on">')
    expect(code).toContain('({ default: \'Badge\', loud: \'LOUD\' })[variant]')
  })

  it('uses the composable for a state it can\'t express in CSS (a prop override)', () => {
    const code = badgeOut((component) => {
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { props: { text: 'Hi' } } }, state: { of: '', kind: 'hover' } })
    })
    expect(code).toContain('const { variant, on } = useVariantState(() => props.variant, {\n  states: { default: { hover: \'hovered\' } }\n})')
  })
})

describe('generateUi: layout variables', () => {
  const titled = (files: Record<string, Json>) => {
    files[LAYOUT]!.variables = [{ id: 'prop_title', name: 'title', kind: 'text', default: 'Blog' }, { id: 'prop_tagline', name: 'tagline', kind: 'text' }]
    files[LAYOUT]!.root.children[0].children[0].children[0].props.text = { $bind: 'layout.title' }
    files[IDX]!.layoutValues = { prop_title: 'Posts' }
  }

  it('reads the page\'s values from the route meta, over the defaults', () => {
    const layout = out(titled, 'layouts/main.vue')
    expect(layout).toContain('const route = useRoute()\nconst layout = computed(() => ({ title: \'Blog\', ...route.meta.layoutValues }) as { title: string, tagline?: string })')
    expect(layout).toContain('{{ layout.title }}</ULink>')
  })

  it('sets them with definePageMeta', () => {
    expect(out(titled, 'pages/index.vue')).toContain('definePageMeta({ name: \'index\', layout: \'main\', layoutValues: { title: \'Posts\' } })')
  })
})

describe('generateUi: breakpointBase', () => {
  /** The fixture's mobile-first keys, rewritten for a desktop-first project. */
  const desktop = (node: Json): void => {
    for (const [key, value] of Object.entries(node.style ?? {})) {
      if (/^(sm|md|lg):/.test(key)) {
        Reflect.deleteProperty(node.style, key)
        node.style[key.replace(/^\w+:/, '')] = value
      }
    }
    node.children?.forEach(desktop)
  }
  const padded = (base: string) => (files: Record<string, Json>) => {
    files[PROJECT]!.breakpointBase = base
    if (base === 'desktop') desktop(files[IDX]!.root)
    files[IDX]!.root.children.push({ id: 'n_x', type: 'Container', style: { 'p': '8', 'max-md:p': '4' } })
  }

  it('a desktop-first project generates max-width breakpoint classes', () => {
    expect(out(padded('desktop'), 'pages/index.vue')).toContain('<div class="flex p-8 max-md:p-4 flex-col self-stretch" />')
  })

  it('a mobile-first project refuses them', () => {
    expect(() => out(padded('mobile'), 'pages/index.vue')).toThrow(/Breakpoint "max-md" in style token "max-md:p" is for desktop-first projects/)
  })
})

describe('generate: locked nodes', () => {
  it('ignores locked: the output is identical with and without it', () => {
    const plain = generate(load())
    const locked = generate(load((files) => {
      files[IDX]!.root.locked = true
      files[IDX]!.root.children[0].locked = true
      files[LAYOUT]!.root.children[0].locked = false
    }))
    expect(locked).toEqual(plain)
  })
})
