import { apiFieldPaths } from '@bildr/codegen/edit'
import type { Model, Value } from '@bildr/codegen/model'
import { apiAutoArgs, apiChoices, apiMissingArgs, apiUseRows } from './apiPageUse.ts'
import type { ApiParam } from './apiPageUse.ts'
import { pageOf } from './nodeInteractions.ts'
import { freeAlias } from './pageNames.ts'
import { stateChoices, statePropExpect } from './stateBinding.ts'

/**
 * The data a page's text can show but the page doesn't use yet: its module's stores and every API query. The Insert variable menu
 * (EditorVariablePicker) lists them next to the names the page already reads, so one place offers all the data; picking a field adds the
 * page's use (`page_use_add` with `use`) and then inserts `{path}`. A store offers its fields a text shows (as the binding dot does); an
 * API query its answer's fields, or a list's `length`. A query whose required parameters the page's route doesn't give lists them in
 * `missing`: the picker asks for them before it adds the use.
 */
export interface PageDataOffer {
  /** The store's label, or "<API> · <query>". */
  label: string
  source: 'store' | 'api'
  /** What `page_use_add` takes besides the page: the name the page will read it under, and the store or the API query. */
  use: { as: string, state: string } | { as: string, api: { datasource: string, query: string }, args?: Record<string, Value> }
  /** What `{…}` reads once the use is added: `alias.field`. */
  paths: string[]
  /** The required parameters the page can't give by itself. */
  missing: ApiParam[]
}

/** What a Text's text takes: the same rule the binding dot offers a store's fields by. */
const TEXT_EXPECT = statePropExpect('Text', 'text')!

/** The stores and API queries page `pageId` doesn't use yet, stores first; nothing for a layout, a component or an unknown page. */
export function pageDataOffers(model: Model | null | undefined, pageId: string): PageDataOffer[] {
  const page = model ? pageOf(model, pageId) : undefined
  if (!model || !page) return []
  const stores = new Map<string, PageDataOffer>()
  for (const choice of stateChoices(model, { file: page.id, kind: 'page' }, TEXT_EXPECT)) {
    if (choice.used) continue
    const offer = stores.get(choice.state) ?? { label: choice.stateLabel, source: 'store' as const, use: { as: choice.alias, state: choice.state }, paths: [], missing: [] }
    offer.paths.push(choice.path)
    stores.set(choice.state, offer)
  }
  const apis = apiChoices(model)
    .filter(choice => !page.uses?.apis?.some(use => use.datasource === choice.datasource && use.query === choice.query))
    .flatMap((choice): PageDataOffer[] => {
      const rows = apiUseRows(model, choice)
      if (!rows) return []
      const as = freeAlias(page, choice.query, 'api')
      const args = apiAutoArgs(page, choice.params)
      const fields = rows.many ? ['length'] : apiFieldPaths(rows.models, rows.model)
      return [{
        label: choice.label,
        source: 'api',
        use: { as, api: { datasource: choice.datasource, query: choice.query }, ...(Object.keys(args).length ? { args } : {}) },
        paths: fields.map(field => `${as}.${field}`),
        missing: apiMissingArgs(choice.params, args)
      }]
    })
  return [...stores.values(), ...apis].filter(offer => offer.paths.length)
}
