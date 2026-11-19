import type { Model, PageFile, StateFile } from '@bildr/codegen/model'

/**
 * The one place the editor reads a model's State (B6): every State, one by id, the ones of a page's module, a page's use of one, the
 * State behind a name the page reads it under, and how a State and its field are named. Behind the Data tree, the Interactions'
 * pickers, the binding menu, the List's condition and the canvas's preview, so none of them walks `model.modules` for a State itself.
 *
 * A leaf on purpose: it imports types only, so any of those modules can use it without making a cycle with another.
 */

/** A State's name for a person: its label, and its name when it has none. Never its id. */
export const stateLabel = (state: Pick<StateFile, 'name'> & { label?: string }): string => state.label || state.name

/** Every State of the model, module by module. */
export const allStates = (model: Model): StateFile[] => Object.values(model.modules).flatMap(mod => mod.state)

/** The State `id`, in whichever module it is. */
export const stateById = (model: Model, id: string): StateFile | undefined => allStates(model).find(state => state.id === id)

/** The States of the module a page is in: the ones a step or a binding on that page can name. */
export const statesOfPage = (model: Model, page: Pick<PageFile, 'id'>): StateFile[] => Object.values(model.modules).find(mod => mod.pages.some(entry => entry.id === page.id))?.state ?? []

/** The page's use of State `id` (the name it reads it under), when it has one. */
export const useOfState = (page: Pick<PageFile, 'uses'> | undefined, id: string): NonNullable<NonNullable<PageFile['uses']>['state']>[number] | undefined => page?.uses?.state?.find(use => use.state === id)

/** The State the page reads under the name `alias`, when it does. */
export const stateOfAlias = (model: Model, page: Pick<PageFile, 'uses'> | undefined, alias: string): StateFile | undefined => {
  const use = page?.uses?.state?.find(entry => entry.as === alias)
  return use ? stateById(model, use.state) : undefined
}

/** How a State's field is named: the field with its State, "showDrafts · Blog preferences", or the field alone when `withState` is false. */
export const stateFieldText = (field: string, state: Pick<StateFile, 'name'> & { label?: string }, withState = true): string => (withState ? `${field} · ${stateLabel(state)}` : field)
