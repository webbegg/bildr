# bildr

A visual app builder where everything you can do in the editor, an agent can do too. Apps are a JSON document (`Project → Page[] → Node tree`). The editor and the published app render that document with the same runtime, and every change goes through one set of shared actions. The UI, the HTTP API and MCP all call those same actions.

> [!WARNING]
> `/mcp` and `/api/actions` have **no authentication**. Anyone who can reach the server can read and change every project. Run bildr for local development only, and do not expose it on a network. This goes for `nuxt dev` in particular: in dev mode, error responses include stack traces.

## Run it

```bash
pnpm install
pnpm dev
```

- Editor: <http://localhost:3000/> lists your projects. Open one to edit it at `/editor/<projectId>`.
- Published apps: `/p/<project-slug>` and `/p/<project-slug>/<page-slug>`. They show the last published version.
- Data is stored under `.data/`.

## Nodes

A node is `{ id, type, name?, locked?, props, style, children }`. Both `name` and `locked` are optional, so documents saved without them stay valid.

- `name` is a layer name (at most 100 characters) shown in the layers, the canvas label and the inspector in place of the type, component or slot name. `node_rename { pageId | componentId | layoutId, nodeId, name }` sets it; an empty string or `null` removes it. One undo step, "Rename layer".
- `locked: true` locks a node and everything inside it on the canvas: it cannot be selected or moved there, but it still can from the layers and through actions. `node_set_locked { pageId | componentId | layoutId, nodeId | nodeIds, locked }` locks or unlocks one node or several, as one undo step; unlocking removes the flag.

## Design system

Every project has its own design system, built on the Tailwind and Nuxt UI theme.

- **Theme** (`theme_get` / `theme_update`): the semantic colors `primary`, `secondary`, `success`, `info`, `warning`, `error` and `neutral`. Each is a Tailwind palette name (such as `indigo`) or a `#rrggbb` hex, with shades generated. The theme also sets the font, the base radius and the spacing density. Edit it in the editor's **Design** view (the view menu, ⌘K "Design system", or Assets › Design system): the controls on the right, and a live style guide in the centre (palettes, type, buttons, inputs, cards, badges, radius and spacing) rendered like the published app.
- **Custom colours** (`theme.custom`): named colours of the project's own, name → `#rgb`, `#rrggbb` or `#rrggbbaa` (at most 50). Names are lowercase with dashes (`brand`, `ink-2`) and cannot be a colour token such as `primary` or `muted`. `theme_update { custom: { brand: "#ff6600" } }` adds or changes one, and `{ custom: { brand: null } }` removes it. A removal is refused while a style still uses the colour, and the error names where. Colour style keys take the name, for example `{ "bg": "brand" }`, rendered through the CSS variable `--bildr-color-brand`. The Design view lists them under Custom colours, where you can add, rename, edit or remove one.
- **Theme library:** themes saved by name and shared by every project, listed in the Design view's left sidebar. Applying one copies it into the project; nothing stays linked. At most 100 themes, with names of 1–64 characters, unique ignoring case. Library changes are not undoable and never change a project.
  - `theme_library_list`
  - `theme_library_save` (`{ name, projectId }`): saves that project's current theme
  - `theme_library_update` (`{ themeId, projectId?, name? }`): replaces the stored theme with the project's, renames it, or both
  - `theme_library_duplicate` (`{ themeId, name? }`): by default named "<name> copy"
  - `theme_library_delete` (`{ themeId }`)
  - `theme_apply` (`{ projectId, themeId }`): copies the theme into the project as one undo step, "Apply theme <name>"
- **Style tokens:** a node's `style` stores one token per property, for example `{ "mt": "10", "bg": "primary", "rounded": "lg" }`. It renders as Tailwind classes (`mt-10 bg-primary rounded-lg`), in the editor and in the published HTML. The allowed keys and values live in `shared/design/tokens.ts`. `components_list` returns them, and the action schemas list them as enums.
- **Raw colours:** the colour keys `bg`, `color` and `borderColor` also take a `#rgb`, `#rrggbb` or `#rrggbbaa` hex, or a custom colour name, for example `{ "bg": "#ff6600", "color": "brand" }`. These render as an inline style instead of a class. `node_update_style` checks a name against the project theme.
- **Colours in the editor:** the colour picker has a Tokens tab (the theme's swatches, then its custom colours) and a Custom tab (a saturation and brightness area, hue and alpha sliders, hex and alpha fields, and an eyedropper in browsers that have one), which writes a raw hex. "Create colour from this" names the colour, adds it to the theme and uses it by name. With elements selected, the **Selection colours** section lists every colour their subtrees use, with a usage count. Picking another colour for one swaps it everywhere in them, as one undo step (one `node_update_style` with `updates`). In a component variant it is one `component_variant_set_override` with `overrides`, also one undo step.
- **Binding dot:** a dot before a panel row's label (on hover; filled in blue, with the property's name, when bound) opens the row's binding menu. On a style row: Pick token, and Detach to raw value (a colour token becomes its hex). In the component or layout view: Bind to property (or variable) and Create property (or variable), which binds the style key at the edited breakpoint. Bind lists only the properties whose default and instance (or page) values all fit the style key. A key bound at its base shows as bound (inherited) at the other breakpoints. On a prop row: Create or Bind to a property or variable, and Insert env variable on text props.
- **Responsive tokens:** layout tokens (Spacing, Size, Typography, Layout) also take a mobile-first breakpoint prefix `sm:`, `md:` or `lg:`. For example, `{ "cols": "1", "md:cols": "3" }` renders as `grid-cols-1 md:grid-cols-3`. Colours, borders and shadows have no breakpoint variants. In the editor, the device toggle (Mobile 390 / Tablet 768 / Desktop 1280) resizes the canvas, and the style panel edits that device's breakpoint: Mobile edits the base, Tablet `md:` and Desktop `lg:`. The panel also shows the values a device inherits from smaller ones.
- **Inserting nodes:** `node_insert { pageId | componentId | layoutId, parentId?, index?, type, props?, style?, children?, exact? }` adds a node with the component's default props and style, plus the given ones. With `exact: true`, the node and every child get exactly the given props and style, without the defaults, so a node copied in the editor pastes unchanged (with new ids). The type, prop, style and tree checks are the same either way. To insert several nodes at once, pass `nodes: [{ type, props?, style?, children? }, …]` instead of `type`, `props`, `style` and `children`. They go in order from `index` (default: the end), as one undo step, all or nothing, and `exact` applies to each. The result adds `nodeIds`, in the `nodes` order.
- **Styling several nodes:** `node_update_style { pageId | componentId | layoutId, nodeId | nodeIds, style }` sets the same tokens on one node or several. `node_update_style { pageId | componentId | layoutId, updates: [{ nodeId, style }, …] }` gives each node its own tokens instead. Both run as one undo step, all or nothing, with the same checks. `updates` cannot be combined with `nodeId`, `nodeIds` or `style`.
- **Copy and paste in the editor:** Cmd/Ctrl+C copies the whole top-level selection, and Cmd/Ctrl+V pastes all of it as one undo step. The clip is also written to the system clipboard as JSON (`kind: "bildr/node"`, with `nodes`, `sourceIds` and `copiedAt`), and the single-node fields older editors read. A paste uses the system clipboard's clip when it was copied later than this tab's (for example, in another tab). The editor takes Cmd/Ctrl+C and V only while the canvas or the Layers tree has focus and no text is selected. With nothing selected, the canvas leaves Cmd/Ctrl+R and L to the browser.
- Every allowed class is generated when the app is built (`app/assets/css/tokens.css`, produced by `pnpm tokens:css`). The theme is applied as CSS variables, so the same classes follow each project's theme without rebuilding CSS.

## Data

Apps can show and collect data. As with everything else, each step is an action, so an agent can do it over MCP too.

### Collections and records

- A **collection** has a name, a slug and typed fields (`text`, `number`, `boolean`, `date`, `image`). Its schema is part of the project document, so it is undoable and published with the snapshot. Two flags, both off by default, open it to published apps: `publicRead` and `publicCreate`.
- **Records** are live data, stored per collection outside the document. They are not undone and not frozen at publish. Values are checked against the field types.
- Manage both in the editor's **Data** mode: collections, fields, and a records table where you can add, edit and delete.
- Actions:
  - schema: `collection_create`, `collection_update`, `collection_delete`, `field_add`, `field_update`, `field_move`, `field_remove`
  - connections: `connection_create`, `connection_update`, `connection_delete`, `endpoint_test` (see [Remote connections](#remote-connections))
  - records: `record_list` (filter by field equality, sort, limit, offset), `record_get`, `record_create`, `record_update`, `record_delete`

### API sources

A collection can also read its records live from a JSON endpoint, for example <https://rickandmortyapi.com/api/character>.

1. In the Data mode, choose **From API** and paste the URL. `api_source_preview` fetches it server-side and finds the items array (`results`, `data`, `items`, or the root array).
2. Review the proposed fields: key, label, type and path (nested objects are flattened one level, so `origin.name` becomes `originName`). Rename, retype or remove fields; the preview updates as you edit.
3. Save. The collection keeps the URL, the items path and the field mapping.

API collections are **read-only**: record writes are refused, and they cannot take public submissions. bildr fetches them on the server, for the canvas, for published apps and for agents. The fetch is limited:

- http and https only, on ports 80, 443, 8080 or 8443
- private, loopback and link-local addresses are refused after DNS resolution (an SSRF guard)
- a 5 s timeout, a 1 MB response cap, and a 60 s cache

A source can also send up to 10 request **headers** (`{ name, value }`), for example `Authorization`. The URL and the header values may use `{{ env.NAME }}` variables, public or secret (see [Environment variables](#environment-variables)). bildr resolves them on the server at each fetch, then runs the URL and SSRF checks on the resolved URL. Headers are dropped when a redirect leaves the first URL's origin. Do not put secrets such as API keys literally in the URL or a header: the source is stored in the project document, and agents and the editor can read it. Use a secret variable instead, such as `Bearer {{ env.API_KEY }}`. (Published apps get neither the URL nor the headers; see below.)

### Remote connections

A **connection** is a remote JSON API that collections read and write through: a name, an absolute http(s) base URL and up to 10 headers sent with every request. The base URL and the header values may use `{{ env.NAME }}`, secrets included. Connections are part of the project document, so they are undoable.

A **connection collection** has the source `{ type: 'connection', connectionId, idPath?, endpoints }`. Each endpoint is optional: `list`, `get`, `create`, `update` and `delete`, each `{ method, path }` with `itemsPath` (list) or `itemPath` (the others) saying where the items or the item are in the response. `idPath` says where the record id is in an item (default `id`).

- Methods are `GET`, `POST`, `PUT`, `PATCH` and `DELETE`. `list` and `get` must use `GET` ("List and Get endpoints use GET"); projects saved before this rule read them as `GET`. Paths are relative to the base URL (such as `/posts/{id}`) and may use `{id}` (the URL-encoded record id) and `{{ env.NAME }}`.
- **Origin lock.** bildr resolves the variables on the server, then builds the URL on the base URL. A path that is absolute, starts with `//`, contains `\`, `://` or a `.`/`..` segment, or ends up on another origin is refused before any request. So a connection's secrets only ever go to the resolved base URL's origin. The SSRF guard runs on every resolved URL and redirect hop, and a redirect to another origin drops the headers. A write (any method but `GET`) that a `307` or `308` sends to another origin fails with "The API redirected a write to another site", and nothing is sent there; same-origin redirects keep working.
- `record_list` uses `list` (cached 60 s like API sources), `record_get` uses `get` (or `list` filtered by id), and `record_create`, `record_update` and `record_delete` use theirs. Create and update send the values as JSON, each at its field's `path` (dot paths nest) or its key. A `PUT` update sends the whole record, read first; other methods send the changed values. Writes are never cached, and each one clears the collection's cached list. A record is at most 10 KB, as in internal collections, for editors, agents and published forms alike (a published form gets `413`).
- A missing endpoint fails with an error such as "This collection has no Update endpoint". Errors never show secret values (`•••`).
- Writes go to an external system, so they cannot be undone.
- Actions: `connection_create` (`{ name, baseUrl, headers? }`), `connection_update`, `connection_delete` (refused while collections use the connection, unless `force: true`, which deletes them too in one undo step), and `endpoint_test` (`{ connectionId, method, path, id?, itemsPath?, itemPath?, confirm?, paging? }`). `endpoint_test` is read-only and not in the history. It sends `GET` only, or another method with `confirm: true`, and returns the status, the items, the proposed fields, a mapped sample and the proposed `paging` (see below).

### Paging

A connection's `list` endpoint and an API source can have an optional `paging`, which says how the API splits its items over requests. Without it, a list is one request, as before.

- `{ type: 'page', param = 'page', start = 1, sizeParam?, size? }`: numbered pages; `start` is the first page's number (0 or 1). With a `sizeParam`, `size` is sent too.
- `{ type: 'offset', param = 'offset', sizeParam = 'limit', size }`: item offsets, `size` items a page.
- `{ type: 'cursor', param, cursorPath }`: the next page's cursor is at `cursorPath` in the response and is sent as `param`.
- `{ type: 'next', nextPath? }`: the next page's URL is at `nextPath` (for example `info.next`), or in the `Link` header's `rel="next"` when there is no `nextPath`.

Each can also have a `totalPath`, where the total item count is (for example `info.count`). Parameter names are query-safe tokens (letters, digits, `_`, `.`, `-`, `~`, and `[...]` as in `page[size]`), `size` is 1 to 500, and the paths follow the items-path rules.

- `record_list` with `offset` and `limit` reads only the pages that hold those items: `page` and `offset` jump straight to them, `cursor` and `next` walk the pages in order. A filter or sort applies to the pages read from the start.
- **Resumable paging.** For `cursor` and `next`, bildr remembers for 60 s where each page it reached is (its URL or cursor), per collection, URL and headers. A later call starts at the nearest page it knows at or before its `offset`, so each call (or each Load more) reaches up to 20 pages further. A write forgets these positions with the cached pages; with none known, a call walks from the first page.
- **Caps:** at most 20 pages fetched (pages still in the cache are free) and 1,000 items per call. Past either, the result is cut (truncated, not refused) and `hasMore` is `true`.
- **Rate limits.** A `GET` answered HTTP 429 with a `Retry-After` of at most 5 s (seconds or an HTTP date) waits and is retried once. Otherwise it fails with "The API is rate limiting requests; try again in N s". Writes are never retried.
- Paged results are `{ records, total, hasMore }`. `total` is the API's total when there is a `totalPath`, otherwise the number of items known so far, and `hasMore` says whether more follow. Unpaged lists keep `{ records, total }`.
- Each page is cached for 60 s like a list, keyed by its URL and headers. A write drops every cached page of its collection.
- **Next URLs** (from `nextPath` or the `Link` header) are resolved against the URL of the page that gave them, and must stay on the connection's base-URL origin, or for an API source the source URL's origin. Then the SSRF guard runs on them as on any URL. A next URL on another origin (another host, scheme or port, a `//host` URL or a `user@host` trick) stops paging with "The API's next page is on another site", and nothing is sent there. Cursors and page numbers go into the query encoded, so they cannot change the path. A redirect to another origin still drops the headers.
- `record_get` without a `get` endpoint scans the list pages, within the caps. Public reads fill their `limit` (at most 100) across pages, within the caps.
- **Detection.** `api_source_preview` and `endpoint_test` (list responses) propose a `paging` from common shapes: `info.next` (with `info.count`), `next`, `links.next`, `meta.next_cursor`, `next_cursor`, `page`/`per_page`/`total`, `skip`/`offset` with `limit`, `meta.total`, and a `Link` header. It is `null` when none is found; the user or agent confirms it. With a paging (the proposed one, or one passed as `paging`), a `GET` test fetches page one with it, reads page two once and returns `pageTwo`: `{ count, sample }`, or `{ error }` when it cannot be read. When the paging has a `totalPath`, `pagingTotal` is the API's total item count (`total` stays the item count of the response).

### Environment variables

Each project has one set of variables, stored outside the project document. They are not in `project_get`, not in the undo history and not in change events, and changing them is not undoable. Names use capital letters, digits and `_` (such as `API_KEY`), values are strings of up to 4 KB, and a project can have at most 100 variables.

- Actions: `env_list`, `env_set` (`{ name, value?, secret? }`, creates or updates) and `env_delete`.
- **Public** variables resolve wherever a string binds, as `{{ env.NAME }}`: texts, labels, links, image `src`, and theme colours (a variable holding `#rrggbb`; anything else falls back to the default colour). Publishing copies the public variables into the snapshot, so a change shows up on the next publish.
- **Secret** variables are write-only. `env_list` returns `{ name, secret: true, set: true }` without the value, and turning a secret public needs a new value. They resolve only on the server, in an API source's URL and headers. Error messages and logs show `•••` instead of their values.
- An API source that uses an unknown variable fails with an error that names the variable.

**Trust model.** Secrets are write-only for display, not out of reach. Anyone who can edit a project, including agents over `/mcp`, can send a secret to a host of their choosing by referencing it in an API source URL or header. The editor, `/api/actions` and `/mcp` are unauthenticated and meant for local development only. A secret never appears anywhere visitors can see: not in the published snapshot, `/api/published`, public reads or their errors. When you turn a public variable secret, republish, because the last snapshot still holds its old public value.

### Lists and bindings

A **List** is a container bound to a collection, with the props `collection`, `limit`, `sortField`, `sortDir`, `filterField` and `filterValue`. It renders its children once per record. Any string prop inside it can use `{{ item.<field> }}` bindings, for example a Text `{{ item.name }}`, an Image `src` of `{{ item.image }}`, or a Link `to` of `/menu/{{ item.slug }}`. In the canvas, a List shows the collection's current records, or placeholder rows while it is empty.

### Forms and Button actions

- A **Form** is a container with the props `collection` (an internal collection), `successMessage` and `redirectTo`. Each Input inside it has a `field` prop naming the collection field it fills.
- A Button's `action` prop is `link` (the default; it opens `to`), `submit` (it submits the enclosing Form) or `toast` (it shows `message`).
- On submit, the Form creates a record, then shows the success message or navigates to `redirectTo`. In the editor, the record is created with `record_create`. On a published app, it goes to the public endpoint below.

### Public endpoints for published apps

Published apps read and write data through `/api/public/<project-slug>/<collection-slug>`. They follow the **published** snapshot, so a flag change takes effect when you publish.

- `GET` works only for `publicRead` collections. It returns `{ total, records }` (plus `hasMore` for [paged](#paging) collections) with the declared fields only, at most 100 records per page. Query parameters: `limit`, `offset`, `sort`, `dir` (`asc` or `desc`) and `filter[<field>]=<value>`.
- `POST` with JSON `{ "values": { "<field>": <value> } }` works only for `publicCreate` collections that are internal, or connection collections with a `create` endpoint (the record goes to that endpoint, through the published connection). It answers `201 { id }`. There is no public update or delete, for any collection; other methods (HEAD included) answer `405`.
- There is no same-origin check, because published apps may be embedded anywhere. **Any website can post to a `publicCreate` collection.** The collection flags and these limits are the only protection:
  - Only declared fields are kept, and each value must fit its field type. Fields are never required.
  - A request body can be at most 16 KB (counted while it streams in), and a record at most 10 KB.
  - A collection holds at most 5,000 records.
  - Each IP address gets 10 writes and 120 reads per minute per project. The counters live in memory, so they reset on restart and are not shared between processes.
  - `X-Forwarded-For` is ignored, because any client can send it. Behind a reverse proxy, all visitors share the proxy's one budget.
- Errors are generic. The details only go to the server log.
- `/api/published/<project-slug>`, which the published app loads, leaves out the connections, and the URL, headers, items path, endpoints, id path and field paths of API and connection collections. The public `GET` resolves them on the server from the stored snapshot and the current variables. Its `env` holds the public variables only.

## Components

A **component** is a reusable piece of a page, stored in the project's `components`. Its definition is a node tree with ids of its own (the primary variant), typed **properties**, and **variants**. An `Instance` node on a page shows the definition, so editing the definition updates every instance. Instances are resolved when they render and never copied into the page.

- `component_create { pageId, nodeId | nodeIds, name? }` turns a selection into a component. The node becomes the definition (several siblings are wrapped in a Container), and an instance takes its place. `/` in the name makes folders, for example `Cards/Product`. Component names are unique ignoring case: a name another component has (`card` when `Card` exists) is refused as `invalid` with `A component named "Card" already exists`. Without a name, the component is named after the node (its layer name or type; `Component` for several), numbered when taken (`Card 2`). Returns `{ componentId, nodeId }`, where `nodeId` is the instance.
- `component_rename { componentId, name }`, refused for another component's name in the same way (a component may change its own name's case).
- `component_delete { componentId, force? }` is refused while instances use the component, on pages, in other components or in layouts. The error lists them, for example `"Card" is used by 1 instance: page "Home" (n_…)`. With `force: true`, the instances are deleted too and returned as `deletedInstances`.
- `component_property_add { componentId, name, kind, default?, bindings? }` adds a property and returns its `propertyId`. `kind` is a prop kind (`text`, `number`, `boolean`, `select`, …) or `slot`. Each binding `{ nodeId, prop }` names a definition node prop that the property drives, and the kinds must match. A binding `{ nodeId, prop, target: "style" }` drives a style key instead, for example `{ "nodeId": "n_title", "prop": "color", "target": "style" }`; the property must be `text` or `select`, and its values must be values of that key (a token, or for colour keys also a hex or custom colour). Definition strings can also use `{{ prop.NAME }}`. A slot binds one container with `prop: "children"`; its children are the default content.
- `component_property_update { componentId, propertyId, name?, default?, bindings? }` (a `default` of `null` removes it) and `component_property_remove` (instance values and slot content for it go too).
- `component_variant_add { componentId, name }` returns a `variantId`. `component_variant_set_override { componentId, variantId, nodeId, props?, style?, unset? }` overrides props and tokens of one definition node. `unset` lists style keys to remove in the variant, e.g. `["bg"]`: they render as absent even where the primary sets them. A variant stores only what differs from the primary, so a `null` value, or the primary's own value, removes that override (or that removal). For several nodes at once, give `overrides: [{ nodeId, props?, style?, unset? }]` instead of `nodeId`, `props`, `style` and `unset`: the batch is one undo step, all or nothing. Giving both forms is refused. In the document, a variant's `overrides` maps a definition node id to `{ props?, style?, unset? }`; `unset` is optional, so variants saved before it are unchanged. `component_variant_rename { componentId, variantId, name }`. `component_variant_delete` moves its instances back to the primary.
- Insert an instance with `node_insert { type: "Instance", props: { component } }`. `instance_set_values { pageId | componentId | layoutId, nodeId, values?, variant? }` sets property values, keyed by property id, and the variant. Values are checked against the property, and `null` removes one so the default applies.
- `instance_set_slot { pageId | componentId | layoutId, nodeId, slot, filled, nodeIds? }` with `filled: true` gives a slot its own content and returns its `fillId`. Add content with `node_insert { parentId: fillId }`, or pass `nodeIds` to move nodes in. With `filled: false`, the default content shows again.
- To edit a definition, give the node actions (`node_insert`, `node_update_props`, `node_update_style`, `node_move`, `node_move_many`, `node_delete`, `node_duplicate`, `node_wrap`) a `componentId` in place of `pageId` (or a `layoutId` to edit a layout, see Layouts). Exactly one of them is required.
- `components_list { projectId }` adds `userComponents`, the project's components with their properties and variants.

Each action is one undo step.

In the editor:

- **Create:** select elements, then press ⌥⌘K (Ctrl+Alt+K), right-click › Create component, use ⌘K › Create component, or "+" in Assets › Components. The "New component" dialog opens with a name from the selection (the layer's name or type; "Component" for several) selected for typing. Create is disabled while the name is empty or already used (ignoring case); Enter creates it. The selection becomes an instance and the new component opens on top of the page.
- **Assets › Components** lists the components by folder, with how many instances each has. The chevron lists where they are, and each entry jumps there. Drag a row onto the canvas or the layers to insert an instance. Delete lists where the component is used and asks, in a dialog, before deleting its instances too. A disabled "+" says why in its tooltip.
- **Instances** show a purple component icon in Layers, a purple pill and a purple canvas selection when selected, and a "Component" tag in the panel head. Slot fills are a lighter purple.
- **Insert:** the Insert panel (`I`) and ⌘K list the project's components above the built-in ones.
- **Component view:** click a component in Assets, use Edit on an instance in the panel, use right-click › Edit component, or use ⌘K › the component name. The canvas, the layers and the panel then edit the definition. The toolbar shows a breadcrumb, `Home › Card › Button`, with how many instances the edits reach, and the chrome's accent turns purple (the breadcrumb, the canvas selection and handles, the active frame, the selected layer and Publish). Editing an instance's component from inside another component adds a level; Assets and ⌘K replace the levels. A crumb goes back to its level; Done, or Escape with nothing selected, goes up one level and selects the instance you came from. Picking a page goes back to it.
- **Properties:** in the component view, select an element and use "+" on Properties to turn one of its props into a property, or a container's children into a slot. Property rows are labelled by what they set: Text, Number, Toggle, Option, `Style · <key>` or Slot. On an instance, the Component section sets each property and turns each slot's own content on or off.
- **Variants:** in the component view, the Variants section lists Primary (tagged) and the variants, one row each. "+" adds one; a row's menu renames or deletes it (after a confirm: instances using it fall back to Primary). Click a variant, or pick it next to the breadcrumb, to show it on the canvas. Prop and style edits then override that variant only. Overridden props turn blue, and the variant's overrides section lists them for the selected element; a token the variant removes is listed with an empty value. Paste style there replaces the element's whole style in the variant, removing the primary's tokens the copy lacks, and edits over several elements (a style change, a colour swap, Paste style) are one undo step. Reset one (or "−" for all) to go back to the primary's value; the override is removed. Click Primary to edit the definition again. Structure edits (insert, move, delete) always change every variant. On an instance, the Variant field picks the variant; reset goes back to Primary.

## Layouts

A **layout** is a page frame shared by pages, stored in the project's `layouts`: `{ id, name, root, slots, variables }`. Its `root` is a `Page` node tree with ids of its own. A page that uses it (`layoutId`) renders inside it, resolved when it renders and never copied into the page.

- **Slots** `{ id, name, nodeId }` each bind one container node of the layout. The `children` slot, exactly one per layout, shows the page content. A named slot shows its node's children by default; a page can give it its own content with a `SlotFill` at the page root. A slot cannot share its node with another slot or sit inside another slot's node.
- **Variables** have the shape of component properties (`{ id, name, kind, default?, bindings }`, never a slot). Each page sets its values in `layoutValues`, keyed by variable id, and the default applies otherwise. Bindings drive layout node props, or with `target: "style"` a style key of a layout node (as for component properties), and layout strings can use `{{ layout.NAME }}`.

Actions:

- `layout_create { name? }` makes a layout with a Page root holding one Container, the `children` slot. Returns `{ layoutId, slotNodeId }`. `layout_rename { layoutId, name }`. Layout names are unique ignoring case, as component names; without a name, `layout_create` names it `Layout` (`Layout 2`, …).
- `layout_delete { layoutId }` detaches the pages that use it: they keep their content and lose their layout values and their own slot content. Returns `detachedPages`; one undo brings everything back.
- `layout_slot_add { layoutId, name, nodeId }` returns a `slotId`. `layout_slot_update { layoutId, slotId, name?, nodeId? }`. `layout_slot_remove` removes the pages' content for the slot too; the `children` slot cannot be removed.
- `layout_variable_add { layoutId, name, kind, default?, bindings? }` returns a `variableId`. `layout_variable_update { layoutId, variableId, name?, default?, bindings? }` (a `default` of `null` removes it). `layout_variable_remove` removes the pages' values for it too.
- `page_set_layout { pageId, layoutId }` (`null` for none). Changing or removing the layout drops the page's values and own slot content. `page_set_layout_values { pageId, values }` sets values, checked against the variable; `null` removes one.
- `page_set_slot { pageId, slot, filled, nodeIds? }` with `filled: true` gives a named slot the page's own content and returns its `fillId`. Add content with `node_insert { pageId, parentId: fillId }`, or pass `nodeIds` to move page nodes in. With `filled: false`, the layout's default shows again.
- Edit the layout tree with the node actions and `layoutId` in place of `pageId`. An edit that leaves a slot or variable bound to a missing node is refused.

Each action is one undo step.

In the editor:

- **Assets › Layouts** lists the layouts with how many pages use each. "+" opens the "New layout" dialog, then the new layout. Delete names the pages that will detach and asks first, in a dialog.
- **Layout view:** click a layout in Assets, or use Edit next to the page's Layout. The canvas, the layers and the panel then edit the layout tree, with the breadcrumb `Home › Site layout` and the purple accent. Done, Escape with nothing selected, or picking a page goes back. In the panel, "+" on Slots makes the selected container a named slot, and "+" on Variables turns one of the selected element's props into a variable. The layout root lists every slot and variable.
- **Page settings** (select the page root): Layout picks the page's layout (a switch that drops the page's values or own slot content asks first), then a field per variable sets the page's value (reset goes back to the default), and each named slot has an "Own content" switch.

## Action HTTP API

- `GET /api/actions` lists every action with its description and JSON input schema.
- `POST /api/actions/:name` runs an action with a JSON body. For example:

```bash
curl -X POST localhost:3000/api/actions/project_create \
  -H 'content-type: application/json' -d '{"name":"Landing"}'
```

### Deleting a project

`project_delete { projectId, confirm }` deletes a project and everything stored for it: the document and its history, the records of every collection, the environment variables, the editor context and the published snapshot. **This cannot be undone.** `confirm` must be the project slug, so a misfired call does nothing; any other value is refused with "Type the project slug to confirm". Afterwards `/p/<project-slug>`, `/api/published/<project-slug>` and the public endpoints answer 404.

The published snapshot is deleted first and the document last, so a crash part-way never serves an app whose data is gone, and running the delete again finishes the job. In the UI, delete from the `…` menu on the projects list or from the Danger zone in Settings; both ask you to type the slug.

An open editor picks up changes from any surface within about a second. It receives them over `GET /api/projects/:projectId/events` (SSE), and polls `GET /api/projects/:projectId/version` if the stream fails.

## Connect an agent (MCP)

bildr serves MCP over Streamable HTTP at `/mcp`. Every action except the editor's internal ones is exposed as a tool.

```bash
claude mcp add --transport http bildr http://localhost:3000/mcp
```

Open the project in the editor so you can watch the agent work. The agent can call `editor_get_context` to see the page and node you have selected, and `editor_navigate` to show you a page.

## WebMCP on published apps

Published apps (`/p/<project-slug>`) register [WebMCP](https://github.com/webmachinelearning/webmcp) tools, so an agent running in the browser can use the app. bildr looks for `document.modelContext` first, then `navigator.modelContext` (older drafts). If neither exists, nothing happens. The tools:

- `list_pages` (read-only) lists every page with its `name`, `slug` and `url`.
- `navigate_to_page` `{ slug }` shows another page. An unknown slug returns an error that lists the valid slugs.
- `get_page_content` (read-only) returns the current page as a text outline, one line per element, with links shown as `→ target`. Component instances appear as they render (their definition, values and slot content).

- `list_records` (read-only) `{ collection, limit?, filter?, sort? }` lists records of a `publicRead` collection through the public `GET` endpoint. `filter` is an object of field values to match, and `sort` is a field key, prefixed with `-` for descending (for example `"-price"`). The tool description lists the readable collections and their fields. It is registered only when at least one collection is `publicRead`.
- `submit_form` `{ collection, values }` adds a record to an internal `publicCreate` collection through the public `POST` endpoint, and returns its result (`{ "id": "…" }`) or its generic error. It is registered only when at least one collection qualifies.

WebMCP is for visitors of the published app, so it has no editing tools: the component actions are on HTTP and MCP only.

WebMCP is still a draft, so this support is exploratory. To try it:

1. Use Chrome 149 or later and open `chrome://flags/#enable-webmcp-testing`. Set it to **Enabled** and relaunch Chrome.
2. Open a published app, for example <http://localhost:3000/p/landing>. WebMCP needs a secure context, and `localhost` counts as one.
3. Use a WebMCP inspector extension or an in-browser agent to list the page's tools. You should see the three page tools above, plus the data tools if the app has public collections.

## MVP walkthrough (S8)

This walkthrough goes from an empty project to a published app that an agent built and you tweaked.

1. **The agent builds a landing page while you watch.**
   - Start bildr with `pnpm dev`.
   - Create an empty project: open <http://localhost:3000/>, create a project named `Landing`, and keep its editor open.
   - Connect your agent with `claude mcp add --transport http bildr http://localhost:3000/mcp`.
   - Give the agent a prompt such as:

     > In the bildr project "Landing", add a page named "Pricing". On the Home page, add a Column with a Heading "Build apps with agents", a Text that describes the product in one sentence, and a Button "See pricing" that links to the pricing page. Use a violet primary color with a 0.75rem radius, and give the column a soft primary background (`bg: primary-50`), large padding and rounded corners.

   - The editor shows each change within about a second, without a reload.
2. **You tweak it in the editor.** Click the heading on the canvas, change its text in the properties panel on the right, and press Enter or leave the field. Undo and redo work with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.
3. **Publish.** Click **Publish** in the editor toolbar.
4. **Open the published app.** Go to `/p/landing`. It shows the published Home page with the project's theme, the elements carry the design-system classes (for example `bg-primary-50 p-10 rounded-2xl`), and the button opens `/p/landing/pricing`. In a WebMCP-enabled Chrome (see above), the page lists `list_pages`, `navigate_to_page` and `get_page_content`.
5. **Optional: add data.** Ask the agent for a café menu and a contact form, for example:

   > In "Landing", create a collection "Menu" with the fields name (text) and price (number), add three drinks, and turn on publicRead. Create a collection "Messages" with email and message (text) and turn on publicCreate. On the Home page, add a List of Menu sorted by price, with a Row showing `{{ item.name }}` and `{{ item.price }}`. Below it, add a Form for Messages with an email Input, a message Input and a submit Button. Publish.

   Instead of the Menu collection, you can use an API source: in the Data mode, choose **From API** with <https://rickandmortyapi.com/api/character>, and list `{{ item.name }}` with an Image of `{{ item.image }}`. On `/p/landing`, the List shows one row per record and sending the form stores a message: it appears in the editor's Data mode, and `record_list` returns it. With WebMCP, `list_records { "collection": "menu" }` returns the drinks and `submit_form` stores a message.

## Browser tests

`e2e/` holds a browser regression suite. It drives the editor, the Data and Settings views and published apps in a headless Chromium. It adds no dependency: it loads a `playwright-core` and a Chromium that are already on your machine.

Prerequisites:

- bildr running with `pnpm dev`. The suite never starts or stops the server.
- A `playwright-core` and a Chromium binary.
- Internet access: `remote.mjs` and `kit.mjs` call `https://jsonplaceholder.typicode.com`, which fakes writes.

Environment variables:

| Variable | Default |
| --- | --- |
| `BILDR_URL` | `http://localhost:3000` |
| `PLAYWRIGHT_CORE` | `~/.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs` |
| `CHROMIUM` | `~/.cache/ms-playwright/chromium-1194/chrome-linux/chrome` |

If either binary is missing, the suite stops and names the variable to set.

Run every script with `node e2e/all.mjs` (or `pnpm e2e`). It prints one PASS or FAIL line per check, then the counts per script, and exits 1 on any failure. Each script also runs on its own:

- `node e2e/shell.mjs`: the projects page and the editor shell.
- `node e2e/design.mjs`: the theme, responsive styles and publishing.
- `node e2e/data.mjs`: collections, the records table, Lists, Forms and WebMCP.
- `node e2e/remote.mjs`: variables, a remote connection and its endpoints.
- `node e2e/kit.mjs`: the editor widget kit on each screen.
- `node e2e/panel-p1.mjs`: the style panel's collapsed sections, measured sizes, panel order and two-line menu items.
- `node e2e/colors-p1.mjs`: the binding dot, the colour picker, custom colours and Selection colours.
- `node e2e/menu-p1.mjs`: the node menu, rename, lock, copy and paste, and the canvas keys. It grants the browser context clipboard access.

Each script creates its own `e2e …` projects and deletes them with `project_delete` when it ends, even when a check fails. Screenshots go to `e2e/.shots/`, which git ignores.

## Checks

```bash
pnpm test
pnpm lint
pnpm typecheck
```
