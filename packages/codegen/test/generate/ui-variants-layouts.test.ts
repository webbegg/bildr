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
    expect(code).toContain('<div class="flex px-2" :class="badgeBgClasses[props.tone]">')
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

  it('keeps a Text\'s line breaks when the text of any variant has one', () => {
    const unbound = (text: string) => (component: Json) => {
      component.properties = component.properties.filter((property: Json) => property.name !== 'label')
      loud()(component)
      component.variants[0].overrides.n_badge_text.props.text = text
    }
    expect(badgeOut(unbound('LOUD'))).toContain('<p>{{ ({ default: \'Badge\', loud: \'LOUD\' })[props.variant] }}</p>')
    expect(badgeOut(unbound('LO\nUD'))).toContain('<p class="whitespace-pre-line">{{ ({ default: \'Badge\', loud: \'LO\\nUD\' })[props.variant] }}</p>')
  })

  it('resolves a Fill child per variant where a variant turns its parent\'s axis (layout-containers L3)', () => {
    const code = badgeOut((component) => {
      component.root.children[0].style = { w: 'fill' }
      component.variants = [{ id: 'var_stacked', name: 'stacked', overrides: { n_badge: { style: { direction: 'col' } } } }]
    })
    expect(code).toContain('const badgeTextVariants = {\n  default: \'min-w-0 grow-1 basis-[0%]\',\n  stacked: \'self-stretch\'\n} as const')
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
    // States are the editor's previews of hover and pressed: CSS shows them, so they are no variant the component takes (codegen-architecture T2).
    expect(code).not.toContain('variant?:')
    expect(code).not.toContain('badgeVariants')
    expect(code).not.toContain('group-')
    expect(code).toContain('<div class="flex px-2 transition-[padding-left,padding-right] duration-200 ease-[ease-out] hover:px-3 active:px-4 motion-reduce:duration-0" :class="badgeBgClasses[props.tone]">')
    expect(code).not.toContain('useVariantState')
  })

  // CSS reads a transition from the style it goes to: under hover:, the hover state's own timing animates the way in.
  it('animates the way into a state with the state\'s own transition, and pressed restates the base\'s over it', () => {
    const code = badgeOut((component) => {
      component.variants.push(
        { id: 'var_hover', name: 'hovered', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' }, transition: { type: 'ease', duration: 0.5, easing: 'linear' } },
        { id: 'var_pressed', name: 'pressed', overrides: { n_badge: { style: { px: '4' } } }, state: { of: '', kind: 'pressed' } }
      )
      component.transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    })
    const root = /<div class="([^"]*)" :class="badgeBgClasses\[props.tone\]">/.exec(code)?.[1]?.split(' ') ?? []
    expect(root).toEqual(expect.arrayContaining(['duration-200', 'ease-[ease-out]', 'motion-reduce:duration-0', 'hover:duration-500', 'hover:ease-linear', 'hover:motion-reduce:duration-0', 'active:duration-200', 'active:ease-[ease-out]', 'active:motion-reduce:duration-0']))
    // A state with the base's timing adds none.
    const same = badgeOut((component) => {
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' }, transition: { type: 'ease', duration: 0.2, easing: 'ease-out' } })
      component.transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    })
    expect(same).not.toContain('hover:duration')
    // An instant state: no time on the way in, on a descendant too (its group prefix).
    const instant = badgeOut((component) => {
      component.root.children[0].style = { color: 'muted' }
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { style: { color: 'primary' } } }, state: { of: '', kind: 'hover' }, transition: { type: 'instant' } })
    })
    expect(instant).toContain('group-hover/badge:duration-0')
  })

  it('renders hover and pressed states on a descendant with group classes from the root', () => {
    const code = badgeOut((component) => {
      component.root.children[0].style = { color: 'muted' }
      component.variants.push(
        { id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { style: { color: 'primary' } } }, state: { of: '', kind: 'hover' } },
        { id: 'var_pressed', name: 'pressed', overrides: { n_badge_text: { style: { color: 'error' } } }, state: { of: '', kind: 'pressed' } }
      )
    })
    expect(code).toMatch(/<p class="[^"]* text-muted [^"]*group-hover\/badge:text-primary group-active\/badge:text-error [^"]*">/)
    expect(code).toContain('<div class="group/badge flex')
  })

  it('gives the golden PostCard root plain hover: classes and its title group-hover/post-card: ones', () => {
    const code = out(() => {}, 'components/blog/PostCard.vue')
    expect(code).toContain('  variant?: \'default\' | \'compact\'\n')
    expect(code).toContain('const cardVariants = {\n  default: \'p-5 hover:shadow-md\',\n  compact: \'p-3\'\n} as const')
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
    // A click on a root with no control inside: a button to the keyboard and to assistive technology (the composable hears Enter and Space).
    expect(code).toContain('<div ref="variantRoot" role="button" tabindex="0" class="flex transition-[padding-left,padding-right,padding-top,padding-bottom] duration-300 ease-[ease] motion-reduce:duration-0" :class="[badgeVariants[variant], badgeBgClasses[props.tone]]" v-on="on">')
    expect(code).toContain('({ default: \'Badge\', loud: \'LOUD\' })[variant]')
  })

  it('leaves a clickable root with a control inside to that control: its click bubbles to the root', () => {
    // The golden Tip: its toggle is a UButton, which the keyboard already reaches.
    const tip = out(() => {}, 'components/blog/Tip.vue')
    expect(tip).toContain('v-on="on"')
    expect(tip).not.toContain('role="button"')
    // Hover only: no click, no button.
    const hovered = badgeOut((component) => {
      loud()(component)
      component.interactions = [{ on: 'mouseenter', do: [{ kind: 'setVariant', to: 'var_loud' }] }]
    })
    expect(hovered).toContain('v-on="on"')
    expect(hovered).not.toContain('tabindex')
  })

  it('makes the root a button when a variant hides its only control', () => {
    const TIP = '.bildr/modules/blog/components/tip.json'
    const tip = out((files) => {
      const collapsed = (files[TIP]!.variants as Json[]).find(variant => variant.id === 'var_collapsed')!
      ;(collapsed.overrides as Record<string, Json>).n_tip_toggle = { props: { hidden: true } }
    }, 'components/blog/Tip.vue')
    expect(tip).toMatch(/role="button" tabindex="0"[^>]*v-on="on"/)
  })

  // prefers-reduced-motion: reduce makes every animated element instant, whatever its variant's timing (Tailwind's `motion-reduce:` variant: no bildr runtime).
  it('makes every transition instant under prefers-reduced-motion', () => {
    const animated = (code: string) => [...code.matchAll(/class="([^"]*\btransition-\[[^"]*)"/g)].map(match => match[1]!.split(' '))
    const timed = badgeOut((component) => {
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' } })
      component.transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    })
    expect(animated(timed)).toHaveLength(1)
    const golden = out(() => {}, 'components/blog/PostCard.vue')
    expect(animated(golden)).toHaveLength(3)
    for (const classes of [...animated(timed), ...animated(golden)]) expect(classes).toContain('motion-reduce:duration-0')
  })

  it('uses the composable for a state it can\'t express in CSS (a prop override)', () => {
    const code = badgeOut((component) => {
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { props: { text: 'Hi' } } }, state: { of: '', kind: 'hover' } })
    })
    // The composable shows the state, so it knows every variant name; the component takes none (it has only the default).
    expect(code).toContain('const { variant, on } = useVariantState<\'default\' | \'hovered\'>(\'default\', {\n  states: { default: { hover: \'hovered\' } }\n})')
    expect(code).not.toContain('variant?:')
    const based = badgeOut((component) => {
      loud()(component)
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { props: { text: 'Hi' } } }, state: { of: '', kind: 'hover' } })
    })
    // Nothing reads a prop: no unused `props` binding.
    const unread = badgeOut((component) => {
      component.properties = [{ id: 'prop_note', name: 'note', kind: 'text' }]
      component.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge_text: { props: { text: 'Hi' } } }, state: { of: '', kind: 'hover' } })
    })
    expect(unread).toContain('withDefaults(defineProps<')
    expect(unread).not.toContain('const props =')
    expect(based).toContain('  variant?: \'default\' | \'loud\'\n')
    expect(based).toContain('useVariantState<\'default\' | \'loud\' | \'hovered\'>(() => props.variant, {')
  })

  it('drops the state of a non-default variant from the prop, the maps, the texts and the v-ifs; its base keeps its hover: classes', () => {
    const files = (edit: (files: Record<string, Json>) => void) => generateUi(load(edit))
    const generated = files((all) => {
      loud({ overrides: { n_badge: { style: { py: '1' }, unset: ['px'] }, n_badge_text: { props: { text: 'LOUD', visible: false } } } })(all[BADGE]!)
      all[BADGE]!.variants.push({ id: 'var_loud_hover', name: 'loudHover', overrides: { n_badge: { style: { py: '2' } } }, state: { of: 'var_loud', kind: 'hover' } })
      all[IDX]!.root.children.push({ id: 'n_b', type: 'Instance', props: { component: 'cmp_badge', variant: 'var_loud_hover' } })
    })
    const code = generated.find(file => file.path.endsWith('components/blog/Badge.vue'))!.content
    expect(code).toContain('  variant?: \'default\' | \'loud\'\n')
    expect(code).toContain('const badgeVariants = {\n  default: \'px-2\',\n  loud: \'py-1 hover:py-2\'\n} as const')
    expect(code).not.toContain('loudHover')
    expect(code).not.toContain('useVariantState')
    expect(generated.find(file => file.path.endsWith('pages/index.vue'))!.content).toContain('<BlogBadge variant="loud" class="self-stretch" />')
  })

  it('sets an instance to a state\'s base variant: the pointer shows the state', () => {
    const page = out((files) => {
      files[BADGE]!.variants.push({ id: 'var_hover', name: 'hovered', overrides: { n_badge: { style: { px: '3' } } }, state: { of: '', kind: 'hover' } })
      files[IDX]!.root.children.push({ id: 'n_b', type: 'Instance', props: { component: 'cmp_badge', variant: 'var_hover' } })
    }, 'pages/index.vue')
    expect(page).toContain('<BlogBadge class="self-stretch" />')
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
    expect(out(padded('desktop'), 'pages/index.vue')).toContain('<div class="flex flex-col self-stretch p-8 max-md:p-4" />')
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
