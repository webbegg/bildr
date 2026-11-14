import type { z } from 'zod'
import { applyEdit, EDIT_INPUTS, isReadOnlyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { writeChangeSet } from '../node/editor-io.ts'
import { readModelFiles } from '../node/project.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionDef } from './define.ts'
import { changed, historyReady } from './history.ts'

/**
 * The visual editor's operations (P3a, V2/V5): one action per edit of
 * `@bildr/codegen/edit`, taking its input schema. An action reads the model
 * files, runs the edit and writes its change set (only model files, the
 * whole model valid, atomic writes); the module's `.bildr/` watcher then
 * regenerates the app. The result is the edit's own plus `changed`, the
 * files it wrote or deleted.
 */

const TREE = 'file is the artifact id of a page, component or layout (pg_*, cmp_*, lay_*), nodeId a node of its tree.'

const DESCRIPTIONS: Record<EditName, string> = {
  node_insert: `Insert a node (with optional children) into a container of a tree, at index (default: the end of the root). ${TREE} A palette type gets its default props and style (see catalog_get) under the given ones; exact: true keeps only the given ones (a paste). With nodes, inserts several in order. A new node id is n_<type>_<k>. A Form with an action makes the page use that action (same edit). Returns nodeId (and nodeIds with nodes).`,
  node_update_props: `Set props of a node; null removes one. Only the props its type takes (catalog_get nodeTypes[].props). Setting a Form's action also makes its page use that action, in the same edit (a Form needs an action that takes an entity; any other is refused and nothing changes). ${TREE}`,
  node_update_style: `Set style tokens of a node, e.g. { "mt": "10", "bg": "primary" }; null removes one. breakpoint (one of the project's breakpointBase: sm/md/lg for mobile-first, max-lg/max-md/max-sm for desktop-first) prefixes every key, e.g. breakpoint "md" with { "p": "16" } sets "md:p". With nodeIds the same tokens go to each; with updates each node gets its own. ${TREE}`,
  node_rename: `Give a node a layer name; empty or null removes it. ${TREE}`,
  node_set_locked: `Lock (true) or unlock (false) nodes on the canvas; the generator ignores it. ${TREE}`,
  node_move: `Move a node into a container at index (its index after the move). ${TREE}`,
  node_move_many: `Run several moves in order, all or nothing. ${TREE}`,
  node_delete: `Delete nodes with their children (never the root). In a component or layout, the variant overrides and property bindings on them go too. ${TREE}`,
  node_duplicate: `Duplicate nodes right after themselves, with fresh ids. Returns nodeId and nodeIds (the copies). ${TREE}`,
  node_wrap: `Wrap sibling nodes in a new container (Container by default; Row, Column, Card or Grid) where the first was. Returns the container nodeId. ${TREE}`,
  page_create: 'Create a page file in a module (default: the project\'s defaultModule): name is kebab-cased into its route name, the id is pg_<name>, path defaults to /<name>, layout is optional. The page starts with an empty Page root. Returns pageId, filePath and nodeId (the root).',
  page_update: 'Rename (kebab-case) or re-path a page; its file keeps its path.',
  page_delete: 'Delete a page file. Refused while links (to: { page }) or navigate steps target it, and for the last page.',
  component_create: `Turn a node (or, with nodeIds, siblings wrapped in a Container) into a component file of the tree's module (layouts: the defaultModule), with fresh node ids; an Instance of it takes its place. name is PascalCased (default: the layer name or type), unique ignoring case; the id is cmp_<name>. Refused when the nodes bind names from around them (a List's item, the page's data): a component sees only its own properties. Returns componentId, nodeId (the instance) and filePath. ${TREE}`,
  component_rename: 'Rename a component (PascalCased, unique in its module ignoring case); its file keeps its path.',
  component_duplicate: 'Copy a component into a new file right after it, with new property and variant ids (no instances). name defaults to "<Name>Copy". Returns componentId and filePath.',
  component_delete: 'Delete a component file. Refused while instances use it, unless force: true, which deletes them too. Returns deletedInstances.',
  component_property_add: 'Add a property to a component: name (camelCased), kind (text, textarea, number, boolean, select, image, link, icon, entity, field, slot), and optionally label, description, options (select), entity/pick/many (entity), required or optional, placeholder, default, nodeId (slot) and bindings (the node props, or with target "style" the style keys, it drives). The id is prop_<name>, the key of instance values. Returns propertyId.',
  component_property_update: 'Change a component property: name, label, description, options, default, required, optional, placeholder, entity, pick, many, nodeId or bindings (null removes one), and index (its position). Renaming it rewrites the component\'s $bind/$template paths that read it. To change its kind, remove and add it.',
  component_property_remove: 'Remove a component property, with the instance values for it and their content for a slot property. Refused while the component\'s nodes still bind it.',
  component_variant_add: 'Add a variant (name camelCased; the id is var_<name>); it looks like the primary until component_variant_set_override changes it. Returns variantId.',
  component_variant_rename: 'Rename a variant of a component (camelCased); instances keep it (they use its id).',
  component_variant_delete: 'Delete a variant with its hover/pressed states and the interactions that go to them; instances using any of them go back to the primary.',
  component_variant_set_override: 'Override props and style tokens of component nodes in a variant, or remove primary tokens there (unset). Sparse: a null, or the primary\'s own value, resets an override. One node (nodeId with props, style, unset) or several (overrides).',
  component_state_add: 'Add a hover or pressed state to a variant (baseVariant; "" for the primary): a variant instances show by themselves while hovered or pressed in that base. Named "<base>Hover"/"<base>Pressed" by default. Returns variantId.',
  component_interaction_add: 'Add an interaction to a variant of a component (variant; "" or none for the primary): on click, mouseenter, mouseleave or appear, an instance switches to variant to after delay seconds. Returns its index in that variant\'s interactions.',
  component_interaction_update: 'Change the event, target variant or delay (null removes it) of the interaction at index of a variant ("" or none for the primary).',
  component_interaction_remove: 'Remove the interaction at index of a variant ("" or none for the primary).',
  component_transition_set: 'Set how instances animate style changes between variants: without variant, the component\'s (every variant\'s default); with variant, that variant\'s own. { type: instant | ease (duration, easing) | spring (stiffness, damping) }; null removes it.',
  instance_set_values: `Set property values of a component instance (property id → value, checked against the property; null removes one, so its default applies) and/or its variant (a variant id; "" or null for the primary). ${TREE}`,
  instance_set_slot: `Fill (filled: true, optionally moving nodeIds in) or clear a slot of a component instance: a SlotFill child holds the instance's own content for the slot property. Returns fillId (null when cleared); add content with node_insert { parentId: fillId }. ${TREE}`,
  instance_detach: `Detach a component instance: the tree it renders (variant, values, defaults and slot content applied) takes its place as plain nodes with fresh ids; slot content keeps its ids. Returns the new nodeId. ${TREE}`,
  instance_replace: `Replace a component instance with an instance of another component: it keeps its id and style, the values of same-named properties of the same kind, the same-named variant and slot content. all: true replaces every instance of the old component. A component containing itself is refused. ${TREE}`,
  layout_create: 'Create a layout file (.bildr/layouts/<name>.json): a flex column root holding one Container, the children slot, where each page using it shows its own content. name is kebab-cased (default "layout", numbered when taken); the id is lay_<name>. Add regions with node_insert { file: layoutId }. Returns layoutId, slotNodeId and filePath.',
  layout_create_from_selection: 'Turn top-level layers of a page without a layout (e.g. a header and a footer) into a new layout around a children slot, with fresh ids; the page keeps its other content and gets the layout. Returns layoutId, slotNodeId and filePath.',
  layout_rename: 'Rename a layout (kebab-cased, unique); its file keeps its path.',
  layout_duplicate: 'Copy a layout into a new file right after it (tree, slots, variables with new ids); pages keep theirs. name defaults to "<name>-copy". Returns layoutId and filePath.',
  layout_delete: 'Delete a layout file. Refused while pages use it (give them another layout, or none, with page_set_layout).',
  layout_slot_add: 'Add a named slot to a layout: a container node of the layout (not its root, another slot\'s, nor inside or around one) whose children are the default content pages may replace (page_set_slot). name is camelCased. Returns slotId.',
  layout_slot_update: 'Rename a named slot or bind it to another container node of the layout.',
  layout_slot_remove: 'Remove a named slot (never children) with the pages\' content for it.',
  layout_variable_add: 'Add a variable to a layout, which pages set with page_set_layout_values and the layout reads with { "$bind": "layout.<name>" } or drives through bindings: name (camelCased), kind (text, textarea, number, boolean, select, image, link, icon), label, description, options, default, optional, placeholder, bindings. The id is prop_<name>. Returns variableId.',
  layout_variable_update: 'Change a layout variable (null removes a field; index moves it).',
  layout_variable_remove: 'Remove a layout variable with the pages\' values for it. Refused while the layout still reads it.',
  page_set_layout: 'Set the layout a page renders in (a layout id) or null for none. Changing it drops the page\'s layout values and its content for named slots.',
  page_set_layout_values: 'Set a page\'s static values for its layout\'s variables (variable id → value; null removes one, so the default applies), generated into definePageMeta.',
  page_set_slot: 'Fill (filled: true, optionally moving page nodes in) or clear a named slot of the page\'s layout: a SlotFill at the page root holds the page\'s content for it. Returns fillId; add content with node_insert { file: page, parentId: fillId }.',
  theme_get: 'Read the theme (.bildr/theme.json: semantic colours, custom colours, font, radius, spacing) and the options each field takes.',
  theme_update: 'Change part of the theme: colours (a Tailwind palette name or a #rrggbb hex), font, radius, spacing; custom adds or changes named colours (name → hex) or removes one (null), refused while a style uses it. Colour style keys (bg, color, borderColor) take a custom colour by name.',
  theme_presets_list: 'List the bundled theme presets (id, name, theme) theme_apply copies.',
  theme_apply: 'Copy a bundled preset (theme_presets_list) into the theme: its colours, font, radius and spacing replace the project\'s; the project\'s custom colours stay.',
  project_update: 'Rename the project (.bildr/bildr.json name) or set its description (null removes it).',
  catalog_get: 'What the palette and agents insert: every node type (label, description, whether it holds children, the props it takes and the defaults node_insert gives it), the style tokens (key, group, values, whether they take breakpoint prefixes, colour tokens), the project\'s breakpoint base and prefixes, the theme colours, and the components and layouts.',
  datasource_create: 'Create a data source file (.bildr/datasources/<name>.json; the id is ds_<name>): kind rest (a JSON API: defaults.baseUrl, auth { type: bearer | header, secret?, header? }), memory (rows in the server process, seeded from fixtures, never persisted; no settings) or sqlite (the app database, at most one: adding it turns the database layer on; add the returned packageJson dependencies to package.json). Every setting gets an env var (NUXT_DATASOURCES_<NAME>_<SETTING> unless env names one); the auth secret is an env var only, never a value in the model (the user sets it in .env; see env_status). Returns datasourceId, filePath and database.',
  datasource_update: 'Rename a data source or change its defaults, env vars (null removes one) or auth (null for none). Secrets stay env vars. A memory source has no settings.',
  datasource_delete: 'Delete a data source file. Refused while repositories use it (delete their entities first). Deleting the last sqlite source turns the app database off. Returns database: whether the project still has one.',
  entity_create: 'Create an entity in a module (default: defaultModule) over a data source, in one step: the entity (ent_<name>, fields minted fld_<name>), its repository (repo_<name>; sqlite and memory: list, get, create, update, delete; rest: the operations given in endpoints), the queries q_<plural> (all rows) and q_<name>_by_id (one row, by its id param) when expose (default true), the action act_create_<name> (POST /<plural>) when it can create, and for a memory source its fixtures file (empty rows to fill in). fields: [{ name, type (text, integer, number, boolean, datetime, date, image, uuid), required?, remote? (REST key) }]; sqlite and memory entities get a uuid id, a REST entity with an "id" field keeps the API\'s key. Get REST fields and endpoints from datasource_preview. Returns entityId, repositoryId, queryIds, actionId and fixturesPath.',
  entity_update: 'Rename an entity (PascalCase) or its plural (camelCase), or turn expose (the list route and client collection) on or off; off is refused while queries read it.',
  entity_delete: 'Delete an entity with its repository, queries, actions and fixtures. Refused while pages, components, other actions or relations use any of them, listing them. Returns deleted (the ids).',
  entity_field_add: 'Add a field to an entity (name camelCased, type, required?, unique?, nullable?, remote? for REST, index?). The id is fld_<name>. The entity\'s create actions take it in their input. A required field is refused while fixtures rows lack it.',
  entity_field_update: 'Change a field: name (refused while queries, actions, repositories or pages use it by name), type (refused while its default, the fixtures rows or query conditions hold values the new type can\'t take), required, unique, nullable, remote (REST key). Renaming updates create-action inputs, the REST field map and the fixtures rows.',
  entity_field_move: 'Move a field of an entity to index (its position after the move).',
  query_create_for_list: 'Create the query for a list (id q_<page>_<as>, name <page><As>) over an entity of the page\'s module and have the page read it as "as" (default: the entity\'s plural, or the first free name — "posts", "posts2" — when the page already uses it): all the entity\'s rows, no ordering or limit yet (query_update). With nodeId (a List of the page), the List\'s items become those rows, and its item name the entity\'s name unless it has a name of its own. The entity needs an exposed list. Returns queryId and as.',
  query_update: 'Change a query: label, where ({ op: eq|ne|lt|lte|gt|gte|in|like, field, value }; value a literal or { "$param": name }), orderBy (most significant first) and limit (a whole number or { "$param": name }); null removes the condition, the ordering or the limit. With page and as (the use being edited), a query several uses read is copied for this use as q_<page>_<as> and the page repointed, so the other uses keep theirs; a query one use reads, or an edit without page and as, changes it in place. Returns queryId and forked.',
  page_use_add: 'Make a page read a query (query, with args: its parameters\' values, a literal or { "$route": name } / { "$bind": path }) or run an action (action), under the name "as" its bindings use. Both must be in the page\'s module; the name must be free on the page and not one the page script uses (site, layout, route, form, props, toast).',
  page_use_update: 'Change the arguments a page gives the query it reads as "as" (name → value or expression; null removes one, so the default applies).',
  page_use_remove: 'Stop a page reading a query or running an action. Refused while the page still binds the name (a $bind, a $template, a computed value) or a node runs the action.',
  entity_field_remove: 'Remove a field from an entity. Refused while queries, actions, repositories, forms or pages use it (listing them), and for the key "id" or the last field. Create-action inputs, the REST field map and fixtures rows drop it.'
}

const editAction = (name: EditName): ActionDef => defineAction({
  name,
  description: DESCRIPTIONS[name],
  input: EDIT_INPUTS[name] as z.ZodType,
  readOnly: isReadOnlyEdit(name),
  run: (input, ctx) => {
    const files = readModelFiles(ctx.root)
    const outcome = applyEdit(files, name, input)
    if (!outcome.ok) throw new ActionError(outcome.code, outcome.message, outcome.problems)
    if (isReadOnlyEdit(name)) return outcome.result
    if (outcome.changes.length) historyReady(ctx)
    const written = writeChangeSet(ctx.root, outcome.changes)
    if (!written.ok) throw new ActionError(written.reason === 'disk' ? 'write_failed' : 'forbidden', written.message)
    // One undoable step and one `model` event (P3b).
    changed(ctx, name, files, outcome.changes)
    return { ...outcome.result, changed: outcome.changes.map(change => change.path) }
  }
})

export const EDIT_ACTIONS: readonly ActionDef[] = (Object.keys(DESCRIPTIONS) as EditName[]).map(editAction)
