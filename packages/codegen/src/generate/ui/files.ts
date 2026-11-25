import { apiQueryOf, apiRowsOf } from '../../edit/api-uses.ts'
import { valueFormats } from '../../edit/formats.ts'
import { VALUE_TYPES } from '../../model/field-types.ts'
import type { Model } from '../../model/load.ts'
import type { ComponentFile, LayoutFile, PageFile, PropertyDef, QueryFile, Value } from '../../model/schemas.ts'
import type { GeneratedFile } from '../../sync/plan.ts'
import type { ModuleContext } from '../context.ts'
import { entityNames } from '../context.ts'
import { apiComposableName, composableOf, stateComposableOf, useNames } from '../names.ts'
import { corePaths } from '../paths.ts'
import { pascal, tsString } from '../text.ts'
import type { Env } from './env.ts'
import { actionById, apiRoot, entityOf, expression, fail, isObject, keyedById, loadingOf, newEnv, plainRoot, refRoot, settledOf, use } from './env.ts'
import { sfc } from './markup.ts'
import { fillTemplate, findNode, render, SLOT_FILL } from './nodes.ts'
import { bindProperties, nodeIndex, variantsOf } from './variants.ts'

/** The script lines of the composables the template uses outside a page's declarations. */
export const composableLines = (env: Env) => [
  ...(env.needs.has('site') ? ['const { site } = useAppConfig()'] : []),
  ...(env.needs.has('toast') ? ['const toast = useToast()'] : [])
]

/** A guarded page's 404 (`guarded`): once its data has settled without the record, Nuxt's error page shows the empty text. */
export const notFoundLines = (env: Env) => {
  const page = env.notFound.page
  if (!page) return []
  return [
    `// The ${page.subject} doesn't exist: Nuxt's error page, a 404.`,
    'watchEffect(() => {',
    `  if (${page.condition}) showError({ status: 404, message: ${tsString(page.message)} })`,
    '})'
  ]
}

export const handlerLines = (env: Env) => env.handlers.flatMap(lines => ['', ...lines])

export const siteRoot = (env: Env) => plainRoot('site', () => env.needs.add('site'))

export const layoutFile = (model: Model, layout: LayoutFile): GeneratedFile => {
  const source = model.paths[layout.id] ?? `.bildr/layouts/${layout.name}.json`
  const env = newEnv(model, source)
  env.formats = valueFormats(model, layout.id)
  env.roots.set('site', siteRoot(env))
  // Layout variables: the page's values (route meta) over the defaults, read as `layout.<name>`.
  const variables = layout.variables ?? []
  env.roots.set('layout', refRoot('layout', () => env.needs.add('layout')))
  bindProperties(env, variables, nodeIndex(layout.root), variable => `layout.${variable.name}`)
  const slots = new Map(layout.slots.map(slot => [slot.nodeId, slot.name]))
  const template = render(env, layout.root, '  ', { slots })
  const defaults = variables.filter(variable => variable.default !== undefined).map(variable => `${variable.name}: ${expression(env, undefined, variable.default, 'script')}`)
  const types = variables.map(variable => `${variable.name}${variable.default === undefined ? '?' : ''}: ${propertyType(env, variable)}`)
  const layoutLines = env.needs.has('layout')
    ? ['const route = useRoute()', `const layout = computed(() => ({ ${[...defaults, '...route.meta.layoutValues'].join(', ')} }) as { ${types.join(', ')} })`]
    : []
  const script = [...composableLines(env), ...layoutLines, ...env.variantLines, ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return { path: corePaths.layout(layout.name), owner: 'managed', source, content: sfc(source, script, template) }
}

export const PROPERTY_TYPES: Record<string, string> = { text: 'string', textarea: 'string', number: 'number', boolean: 'boolean', image: 'string', link: 'string', icon: 'string', field: 'string' }

/** The TS type of a plain property or layout variable: a select is the union of its options. */
export const propertyType = (env: Env, property: PropertyDef) => property.kind === 'select'
  ? (property.options ?? fail(env, undefined, `select property ${property.name} needs options`)).map(option => tsString(option)).join(' | ')
  : PROPERTY_TYPES[property.kind] ?? fail(env, undefined, `${property.kind} properties can't be generated yet`)

export const componentFile = (context: ModuleContext, component: ComponentFile): GeneratedFile => {
  const source = context.source(component.id)
  const env = newEnv(context.model, source, context)
  env.formats = valueFormats(context.model, component.id)
  const imports: string[] = []
  const props: string[] = []
  const defaults: string[] = []
  // Slot properties are slots, not props: the node they name renders a <slot> around its children.
  env.componentSlots = new Map(component.properties.filter(property => property.kind === 'slot').map(property => [property.nodeId ?? fail(env, undefined, `slot property ${property.name} needs a nodeId`), property.name]))
  for (const property of component.properties) {
    if (property.kind === 'slot') continue
    env.roots.set(property.name, plainRoot(`props.${property.name}`, () => env.needs.add('props')))
    let type: string
    if (property.kind === 'entity') {
      const entity = entityOf(env, undefined, property.entity ?? fail(env, undefined, `property ${property.name} needs an entity`))
      imports.push(`import type { ${entity.name} } from '#${context.name}/domain/${entityNames(entity).file}'`)
      type = property.pick?.length ? `Pick<${entity.name}, ${property.pick.map(name => tsString(name)).join(' | ')}>` : entity.name
      if (property.many) type = `${type}[]`
    } else {
      type = propertyType(env, property)
    }
    props.push(`  ${property.name}${property.required ? '' : '?'}: ${type}`)
    if (property.default !== undefined) defaults.push(`${property.name}: ${expression(env, undefined, property.default, 'script')}`)
    // vue/require-default-prop: an optional prop states that it has no default (a boolean's is false).
    else if (!property.required && property.kind !== 'boolean') defaults.push(`${property.name}: undefined`)
  }

  const nodes = nodeIndex(component.root)
  const variantLine = variantsOf(env, component, nodes)
  bindProperties(env, component.properties, nodes, property => property.name)

  const template = render(env, component.root, '  ')
  // The variants an instance picks: a state is the editor's preview of hover or pressed, which the pointer shows.
  const picked = component.variants.filter(variant => !variant.state)
  if (picked.length) {
    props.push(`  variant?: ${['default', ...picked.map(variant => variant.name)].map(name => tsString(name)).join(' | ')}`)
    defaults.push('variant: \'default\'')
  }
  const declare = env.needs.has('props') ? 'const props = ' : ''
  const define = !props.length
    ? []
    : defaults.length
      ? [`${declare}withDefaults(defineProps<{\n${props.join('\n')}\n}>(), { ${defaults.join(', ')} })`]
      : [`${declare}defineProps<{\n${props.join('\n')}\n}>()`]
  const script = [...imports, ...(imports.length ? [''] : []), ...define, ...(variantLine ? ['', variantLine] : []), ...composableLines(env), ...env.variantLines, ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return {
    path: context.paths.component(component.name),
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
}

/** `/posts/:slug` → `posts/[slug].vue`, `/` → `index.vue`. */
export const pagePath = (path: string) => {
  const parts = path.split('/').filter(Boolean).map(part => part.startsWith(':') ? `[${part.slice(1)}]` : part)
  return `${parts.length ? parts.join('/') : 'index'}.vue`
}

export const queryNames = (env: Env, query: QueryFile) => {
  const entity = entityOf(env, undefined, query.from)
  return { composable: composableOf(query.name), one: query.result === 'one' ? entityNames(entity).variable : undefined }
}

export const pageFile = (context: ModuleContext, page: PageFile): GeneratedFile => {
  const source = context.source(page.id)
  const env = newEnv(context.model, source, context)
  env.formats = valueFormats(context.model, page.id)
  const uses = page.uses ?? {}
  const { actions: actionAliases, state: stateAliases } = env.aliases

  const states = (uses.state ?? []).map(entry => ({ ...entry, file: context.module.state.find(state => state.id === entry.state) ?? fail(env, undefined, `unknown state ${entry.state}`) }))
  for (const { as, state } of states) {
    stateAliases.set(state, as)
    env.roots.set(as, refRoot(as, () => use(env, `state:${as}`, 'value')))
  }
  const queries = (uses.queries ?? []).map(entry => ({ ...entry, file: context.module.queries.find(query => query.id === entry.query) ?? fail(env, undefined, `unknown query ${entry.query}`) }))
  for (const { as, file } of queries) {
    const one = queryNames(env, file).one
    env.roots.set(as, refRoot(as, () => use(env, `query:${as}`, 'data'), one ? env.optional : undefined, () => {
      use(env, `query:${as}`, 'loading')
      return [useNames(as).loading]
    }))
  }
  const apis = (uses.apis ?? []).map((entry) => {
    const found = apiQueryOf(context.model.datasources, entry) ?? fail(env, undefined, `unknown API query ${entry.query} of ${entry.datasource}`)
    return { ...entry, ...found }
  })
  for (const { as, source, query } of apis) {
    const rows = apiRowsOf(source, query)
    env.roots.set(as, apiRoot(env, as, rows.many, keyedById(rows.models.find(model => model.name === rows.model))))
  }
  const actions = (uses.actions ?? []).map(entry => ({ ...entry, file: actionById(env, undefined, entry.action) }))
  for (const { as, action } of actions) {
    actionAliases.set(action, as)
    env.roots.set(as, {
      resolve: (members, ctx) => {
        const [member, ...rest] = members
        if ((member !== 'pending' && member !== 'error') || rest.length) return fail(env, undefined, `${as}.${members.join('.')}: actions expose pending and error`)
        use(env, `action:${as}`, member)
        return `${as}${pascal(member)}${ctx === 'script' ? '.value' : ''}`
      }
    })
  }
  const computedEntries = (uses.computed ?? []) as Array<{ as: string, if?: Value, then?: Value, else?: Value }>
  /** The computed value whose line is being written, and the computed values each reads: they are declared before it. */
  let writing: string | undefined
  const reads = new Map<string, Set<string>>()
  for (const entry of computedEntries) {
    if (entry.if === undefined || entry.then === undefined || entry.else === undefined) fail(env, undefined, `computed ${entry.as} needs if, then and else`)
    env.roots.set(entry.as, refRoot(entry.as, () => {
      use(env, `computed:${entry.as}`, 'value')
      if (writing !== undefined) reads.set(writing, (reads.get(writing) ?? new Set<string>()).add(entry.as))
    }, undefined, () => [...loadingOf(env, entry.then), ...loadingOf(env, entry.else)], () => [...settledOf(env, entry.then), ...settledOf(env, entry.else)]))
  }

  // The template first: it decides which declarations the script needs.
  const layout = page.layout ? context.model.layouts.find(entry => entry.id === page.layout) ?? fail(env, undefined, `unknown layout ${page.layout}`) : undefined
  // SlotFills at the page root fill its layout's slots: the page renders the layout itself (`layout: false`).
  const fills = (page.root.children ?? []).filter(child => child.type === SLOT_FILL)
  let template: string[]
  if (!fills.length) {
    template = render(env, page.root, '  ', { pageRoot: true })
  } else {
    const shell = layout ?? fail(env, fills[0], 'a SlotFill sits under an Instance or at the root of a page with a layout')
    const body = render(env, page.root, '      ', { pageRoot: true })
    const filled = fills.flatMap((fill) => {
      const slot = shell.slots.find(entry => entry.id === fill.props?.slot) ?? fail(env, fill, `layout ${shell.name} has no slot ${String(fill.props?.slot)}`)
      if (slot.name === 'children') fail(env, fill, 'the page\'s own content fills the children slot')
      return fillTemplate(env, fill, slot.name, findNode(shell.root, slot.nodeId), '    ')
    })
    template = [`  <NuxtLayout name="${shell.name}">`, '    <template #default>', ...body, '    </template>', ...filled, '  </NuxtLayout>']
  }
  const seo = Object.entries(page.seo ?? {}).filter(([, value]) => value !== undefined)
  const seoLine = seo.length
    ? `useSeoMeta({ ${seo.map(([key, value]) => `${key}: ${typeof value === 'string' ? tsString(value) : `() => ${expression(env, undefined, value, 'script')}`}`).join(', ')} })`
    : undefined
  // A computed value the template binds is declared, and so is one only another computed value reads: writing a line can use more.
  const written = new Map<string, string>()
  const writeComputed = () => {
    for (let more = true; more;) {
      more = false
      for (const entry of computedEntries) {
        if (written.has(entry.as) || !env.used.has(`computed:${entry.as}`)) continue
        writing = entry.as
        written.set(entry.as, `const ${entry.as} = computed(() => ${expression(env, undefined, entry.if, 'script')} ? ${expression(env, undefined, entry.then, 'script')} : ${expression(env, undefined, entry.else, 'script')})`)
        writing = undefined
        more = true
      }
    }
  }
  // The call of each API query the page reads: its arguments are read here, before the declarations, so what they read is declared too.
  // A use reads only the uses above it, so the last is written first; a computed value an argument reads is written by the next round.
  const calls = new Map<string, string>()
  const writeCalls = () => {
    for (const { as, query, source, args } of [...apis].reverse()) {
      if (calls.has(as) || !env.used.has(`api:${as}`)) continue
      const given = query.params.flatMap(param => args?.[param.name] === undefined ? [] : [{ name: param.name, value: args[param.name]!, type: param.type }])
      // A route value is text: a number parameter gets it converted (one that isn't a number is NaN, which the use-case refuses: the page shows the error line).
      const object = given.map(({ name, value, type }) => {
        const code = expression(env, undefined, value, 'script')
        return `${name}: ${isObject(value) && typeof value.$route === 'string' && (type === 'integer' || type === 'number') ? `Number(${code})` : code}`
      }).join(', ')
      // A literal stays constant; anything the page computes is read again when it changes.
      calls.set(as, `${apiComposableName(source.name, query.name)}(${!given.length ? '' : given.some(({ value }) => isObject(value)) ? `() => ({ ${object} })` : `{ ${object} }`})`)
    }
  }
  for (let size = -1; size !== calls.size + written.size;) {
    size = calls.size + written.size
    writeCalls()
    writeComputed()
  }
  // In dependency order: what a line reads is declared above it.
  const computedLines: string[] = []
  const placed = new Set<string>()
  const place = (as: string) => {
    if (placed.has(as) || !written.has(as)) return
    placed.add(as)
    for (const dependency of reads.get(as) ?? []) place(dependency)
    computedLines.push(written.get(as)!)
  }
  computedEntries.forEach(entry => place(entry.as))

  const declarations: string[] = []
  for (const { as, file } of states) {
    const parts = env.used.get(`state:${as}`)
    if (!parts) continue
    const names = [parts.has('value') && (as === file.name ? file.name : `${file.name}: ${as}`), parts.has('set') && `set: ${useNames(as).set}`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = ${stateComposableOf(context.name, file.name)}()`)
  }
  for (const { as, file, args } of queries) {
    const parts = env.used.get(`query:${as}`)
    if (!parts) continue
    const { composable, one } = queryNames(env, file)
    const data = one ? (as === one ? one : `${one}: ${as}`) : `data: ${as}`
    const names = [parts.has('data') && data, parts.has('loading') && `isLoading: ${useNames(as).loading}`].filter(Boolean)
    const argList = file.params.map((param) => {
      const value = args?.[param.name]
      if (value === undefined) return undefined
      const code = expression(env, undefined, value, 'script')
      return param.reactive && typeof value === 'object' ? `() => ${code}` : code
    })
    while (argList.length && argList[argList.length - 1] === undefined) argList.pop()
    declarations.push(`const { ${names.join(', ')} } = ${composable}(${argList.map(arg => arg ?? 'undefined').join(', ')})`)
  }
  for (const { as } of apis) {
    const parts = env.used.get(`api:${as}`)
    if (!parts) continue
    const names = [parts.has('data') && `data: ${as}`, parts.has('status') && `status: ${useNames(as).status}`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = ${calls.get(as)!}`)
  }
  for (const { as, file } of actions) {
    const parts = env.used.get(`action:${as}`)
    if (!parts) continue
    const names = [parts.has('execute') && `execute: ${as}`, parts.has('pending') && `pending: ${useNames(as).pending}`, parts.has('error') && `error: ${useNames(as).error}`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = ${composableOf(file.name)}()`)
  }

  const formLines: string[] = []
  if (env.needs.has('form') && env.form) {
    const initial = env.form.fields.map((field) => {
      const value = field.default ?? (field.type === 'boolean' ? false : VALUE_TYPES[field.type].ts === 'number' ? 0 : '')
      return `${field.name}: ${expression(env, undefined, value as Value, 'script')}`
    })
    formLines.push(`const form = reactive({ ${initial.join(', ')} })`)
  }

  const imports: string[] = []
  const meta = [`name: ${tsString(page.name)}`]
  if (layout) meta.push(`layout: ${fills.length ? 'false' : tsString(layout.name)}`)
  const layoutValues = Object.entries(page.layoutValues ?? {}).map(([id, value]) => {
    const variable = layout?.variables?.find(entry => entry.id === id) ?? fail(env, undefined, `layout ${layout?.name ?? '(none)'} has no variable ${id}`)
    return `${variable.name}: ${expression(env, undefined, value, 'script')}`
  })
  if (layoutValues.length) meta.push(`layoutValues: { ${layoutValues.join(', ')} }`)
  const validators = (page.params ?? []).filter(param => param.validate).map((param) => {
    const entity = context.module.entities.find(entry => entry.fields.some(field => field.id === param.validate!.field)) ?? fail(env, undefined, `unknown field ${param.validate!.field}`)
    const field = entity.fields.find(entry => entry.id === param.validate!.field)!
    const schema = field.unique ? `${entity.name}${pascal(field.name)}Schema` : `${entity.name}Schema`
    imports.push(`import { ${schema} } from '#${context.name}/domain/${entityNames(entity).file}'`)
    return `'${param.name}' in route.params && ${schema}${field.unique ? '' : `.shape.${field.name}`}.safeParse(route.params.${param.name}).success`
  })
  const metaLine = validators.length
    ? `definePageMeta({\n${[...meta, `validate: route => ${validators.join(' && ')}`].map(line => `  ${line}`).join(',\n')}\n})`
    : `definePageMeta({ ${meta.join(', ')} })`

  const setup = [
    ...(env.needs.has('route') ? [`const route = useRoute(${tsString(page.name)})`] : []),
    ...composableLines(env),
    ...declarations,
    ...computedLines,
    ...formLines,
    ...notFoundLines(env),
    // Last: unhead calls the getters at once, so what they read must be declared.
    ...(seoLine ? [seoLine] : [])
  ]
  const script = [
    ...[...new Set(imports)],
    ...(imports.length ? [''] : []),
    metaLine,
    ...(setup.length ? ['', ...setup] : []),
    ...handlerLines(env)
  ]
  return {
    path: context.paths.page(pagePath(page.path)),
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
}
