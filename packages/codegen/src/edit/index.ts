import type { z } from 'zod'
import { runEdit } from './core.ts'
import type { EditDef, EditOutcome } from './core.ts'
import { nodeDelete, nodeDuplicate, nodeInsert, nodeMove, nodeMoveMany, nodeRename, nodeSetLocked, nodeUpdateProps, nodeUpdateStyle, nodeWrap } from './nodes.ts'
import { pageCreate, pageDelete, pageUpdate } from './pages.ts'
import {
  componentCreate, componentDelete, componentDuplicate, componentInteractionAdd, componentInteractionRemove, componentInteractionUpdate, componentPropertyAdd,
  componentPropertyRemove, componentPropertyUpdate, componentRename, componentStateAdd, componentTransitionSet, componentVariantAdd, componentVariantDelete,
  componentVariantRename, componentVariantSetOverride
} from './components.ts'
import { instanceDetach, instanceReplace, instanceSetSlot, instanceSetValues } from './instances.ts'
import {
  layoutCreate, layoutCreateFromSelection, layoutDelete, layoutDuplicate, layoutRename, layoutSlotAdd, layoutSlotRemove, layoutSlotUpdate, layoutVariableAdd,
  layoutVariableRemove, layoutVariableUpdate, pageSetLayout, pageSetLayoutValues, pageSetSlot
} from './layouts.ts'
import { catalogGet, projectUpdate, themeApply, themeGet, themePresetsList, themeUpdate } from './theme.ts'
import { datasourceCreate, datasourceDelete, datasourceUpdate } from './datasources.ts'
import { apiActionDelete, apiActionRename, apiActionSet, apiCreate, apiModelDelete, apiModelRename, apiModelSet, apiQueryDelete, apiQueryRename, apiQuerySet, apiUpdate } from './api.ts'
import { actionCreate, actionDelete, actionRename, actionUpdate } from './actions.ts'
import { pageUseAdd, pageUseRemove, pageUseUpdate, queryCreate, queryCreateForList, queryDelete, queryRename, queryUpdate } from './queries.ts'
import { nodeInteractionAdd, nodeInteractionRemove, nodeInteractionUpdate } from './interactions.ts'
import { nodeInsertA2ui } from './a2ui.ts'
import { pageComputedRemove, pageComputedSet } from './computed.ts'
import { stateCreate, stateDelete, stateRename, stateUpdate } from './state.ts'
import { entityCreate, entityDelete, entityFieldAdd, entityFieldMove, entityFieldRemove, entityFieldUpdate, entityUpdate } from './entities.ts'
import { fixtureRowCreate, fixtureRowsDelete, fixtureRowUpdate } from './fixtures.ts'

/**
 * `@bildr/codegen/edit`: the visual editor's operations on the `.bildr/`
 * model (P3a; adapted from the hosted `shared/document/operations.ts`).
 *
 * One entry point: `applyEdit(files, name, input)` takes the model files
 * (path → text, as `readModelFiles` gives them), runs one edit on a copy of
 * the loaded model and returns the change set to write: only the files the
 * edit changed, in canonical form, with `content: null` for a file to delete.
 * It never touches disk. The whole model must load afterwards, or the
 * problems come back instead of a change set. `EDIT_INPUTS` holds each
 * edit's input schema (the module's actions take them as they are).
 */

export const EDITS = {
  node_insert: nodeInsert,
  node_update_props: nodeUpdateProps,
  node_update_style: nodeUpdateStyle,
  node_rename: nodeRename,
  node_set_locked: nodeSetLocked,
  node_move: nodeMove,
  node_move_many: nodeMoveMany,
  node_delete: nodeDelete,
  node_duplicate: nodeDuplicate,
  node_wrap: nodeWrap,
  page_create: pageCreate,
  page_update: pageUpdate,
  page_delete: pageDelete,
  component_create: componentCreate,
  component_rename: componentRename,
  component_duplicate: componentDuplicate,
  component_delete: componentDelete,
  component_property_add: componentPropertyAdd,
  component_property_update: componentPropertyUpdate,
  component_property_remove: componentPropertyRemove,
  component_variant_add: componentVariantAdd,
  component_variant_rename: componentVariantRename,
  component_variant_delete: componentVariantDelete,
  component_variant_set_override: componentVariantSetOverride,
  component_state_add: componentStateAdd,
  component_interaction_add: componentInteractionAdd,
  component_interaction_update: componentInteractionUpdate,
  component_interaction_remove: componentInteractionRemove,
  component_transition_set: componentTransitionSet,
  instance_set_values: instanceSetValues,
  instance_set_slot: instanceSetSlot,
  instance_detach: instanceDetach,
  instance_replace: instanceReplace,
  layout_create: layoutCreate,
  layout_create_from_selection: layoutCreateFromSelection,
  layout_rename: layoutRename,
  layout_duplicate: layoutDuplicate,
  layout_delete: layoutDelete,
  layout_slot_add: layoutSlotAdd,
  layout_slot_update: layoutSlotUpdate,
  layout_slot_remove: layoutSlotRemove,
  layout_variable_add: layoutVariableAdd,
  layout_variable_update: layoutVariableUpdate,
  layout_variable_remove: layoutVariableRemove,
  page_set_layout: pageSetLayout,
  page_set_layout_values: pageSetLayoutValues,
  page_set_slot: pageSetSlot,
  theme_get: themeGet,
  theme_update: themeUpdate,
  theme_presets_list: themePresetsList,
  theme_apply: themeApply,
  project_update: projectUpdate,
  catalog_get: catalogGet,
  // Data (P3c): data sources, entities with their repository, queries, create action and fixtures, fields.
  datasource_create: datasourceCreate,
  datasource_update: datasourceUpdate,
  datasource_delete: datasourceDelete,
  // API data sources (simple data): a base URL, models, queries and actions; deleted with datasource_delete.
  api_create: apiCreate,
  api_update: apiUpdate,
  api_model_set: apiModelSet,
  api_model_rename: apiModelRename,
  api_model_delete: apiModelDelete,
  api_query_set: apiQuerySet,
  api_query_rename: apiQueryRename,
  api_query_delete: apiQueryDelete,
  api_action_set: apiActionSet,
  api_action_rename: apiActionRename,
  api_action_delete: apiActionDelete,
  entity_create: entityCreate,
  entity_update: entityUpdate,
  entity_delete: entityDelete,
  entity_field_add: entityFieldAdd,
  entity_field_update: entityFieldUpdate,
  entity_field_move: entityFieldMove,
  entity_field_remove: entityFieldRemove,
  // Queries and page uses (P5): a list's source, its sort, filter and limit, what a page reads and runs.
  query_create_for_list: queryCreateForList,
  query_update: queryUpdate,
  // Queries and actions of their own (D10a): the Data workspace's Queries and Actions sections.
  query_create: queryCreate,
  query_rename: queryRename,
  query_delete: queryDelete,
  action_create: actionCreate,
  action_update: actionUpdate,
  action_rename: actionRename,
  action_delete: actionDelete,
  // State (B1): the Data workspace's State section.
  state_create: stateCreate,
  state_update: stateUpdate,
  state_rename: stateRename,
  state_delete: stateDelete,
  // Sample data (D4): the rows of an entity's fixtures file.
  fixture_row_create: fixtureRowCreate,
  fixture_row_update: fixtureRowUpdate,
  fixture_rows_delete: fixtureRowsDelete,
  page_use_add: pageUseAdd,
  page_use_update: pageUseUpdate,
  page_use_remove: pageUseRemove,
  // Interactions on any node (B1): when <event> → steps.
  node_interaction_add: nodeInteractionAdd,
  node_interaction_update: nodeInteractionUpdate,
  node_interaction_remove: nodeInteractionRemove,
  // Computed values (B1): "if … then … else …", a List's source.
  page_computed_set: pageComputedSet,
  page_computed_remove: pageComputedRemove,
  // A2UI (spike): an agent's A2UI v1.0 surface inserted as nodes.
  node_insert_a2ui: nodeInsertA2ui
} satisfies Record<string, EditDef>

export type EditName = keyof typeof EDITS
export type EditInput<N extends EditName> = z.input<(typeof EDITS)[N]['input']>

export const EDIT_NAMES = Object.keys(EDITS) as EditName[]

/** Each edit's input schema, by name. */
export const EDIT_INPUTS: { [N in EditName]: (typeof EDITS)[N]['input'] } = Object.fromEntries(EDIT_NAMES.map(name => [name, EDITS[name].input])) as never

/** Whether the edit only reads the model. */
export const isReadOnlyEdit = (name: EditName): boolean => (EDITS[name] as EditDef).readOnly === true

/** Runs edit `name` with `input` on the model `files` (see the module comment). */
export const applyEdit = (files: Record<string, string>, name: EditName, input: unknown): EditOutcome => {
  const def = Object.hasOwn(EDITS, name) ? EDITS[name] as EditDef : undefined
  if (!def) return { ok: false, code: 'invalid_input', message: `Unknown edit "${String(name)}"` }
  return runEdit(files, def, input)
}

export { mintId } from './core.ts'
// The names a page's script declares or gets from Vue and Nuxt: the editor offers none of them as the name of a use (B7).
export { pageNodeNames, RESERVED as RESERVED_PAGE_NAMES } from './queries.ts'
export { AUTO_IMPORTED_FUNCTION_NAMES } from './reserved-names.ts'
export { bindingPaths, bindingScope, entityFieldNames, queryBehind } from './scope.ts'
export type { ScopeName } from './scope.ts'
export { apiQueryUsesOf, apiReadsOf, computedUsesOf, describeUse, describeUses, entityUsesOf, fieldUsesIndex, fieldUsesOf, idUses, stateFieldUsesIndex, stateFieldUsesOf, usesOf } from './usage.ts'
export type { ApiRead, ArtifactUse, UseKind, UseVia } from './usage.ts'
export { apiFieldPaths } from './api-uses.ts'
export { apiParamAcceptsStateField } from './page-uses.ts'
export type { ApiUse } from './api-uses.ts'
export { fixtureRowKey } from './fixtures.ts'
export { datasourceEnvVars } from './datasources.ts'
export { isApiSource } from './api.ts'
export type { ApiSource } from './api.ts'
export type { DataSourceEnvVar } from './datasources.ts'
export { detectItems, inferApiModels, inferFields, isUnder, remoteUrl } from './remote.ts'
export type { InferredField, RemoteUrl } from './remote.ts'
export type { ApiField, ApiModel } from '../model/schemas.ts'
export type { EditErrorCode, EditOutcome, FileChange } from './core.ts'
export { PALETTE } from './palette.ts'
export { THEME_PRESETS } from './theme.ts'
export type { ThemePreset } from './theme.ts'
export type { PaletteEntry } from './palette.ts'
