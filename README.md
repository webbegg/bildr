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

## Design system

Every project has its own design system, built on the Tailwind and Nuxt UI theme.

- **Theme** (`theme_get` / `theme_update`): the semantic colors `primary`, `secondary`, `success`, `info`, `warning`, `error` and `neutral`. Each is a Tailwind palette name (such as `indigo`) or a `#rrggbb` hex, with shades generated. The theme also sets the font, the base radius and the spacing density. Edit it in the editor's **Design** mode; the canvas and a token preview update as you edit.
- **Style tokens:** a node's `style` stores one token per property, for example `{ "mt": "10", "bg": "primary", "rounded": "lg" }`. It renders as Tailwind classes (`mt-10 bg-primary rounded-lg`), in the editor and in the published HTML. The allowed keys and values live in `shared/design/tokens.ts`. `components_list` returns them, and the action schemas list them as enums.
- **Responsive tokens:** layout tokens (Spacing, Size, Typography, Layout) also take a mobile-first breakpoint prefix `sm:`, `md:` or `lg:`. For example, `{ "cols": "1", "md:cols": "3" }` renders as `grid-cols-1 md:grid-cols-3`. Colours, borders and shadows have no breakpoint variants. In the editor, the device toggle (Mobile 390 / Tablet 768 / Desktop 1280) resizes the canvas, and the style panel edits that device's breakpoint: Mobile edits the base, Tablet `md:` and Desktop `lg:`. The panel also shows the values a device inherits from smaller ones.
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
- Actions: `connection_create` (`{ name, baseUrl, headers? }`), `connection_update`, `connection_delete` (refused while collections use the connection, unless `force: true`, which deletes them too in one undo step), and `endpoint_test` (`{ connectionId, method, path, id?, itemsPath?, itemPath?, confirm? }`). `endpoint_test` is read-only and not in the history. It sends `GET` only, or another method with `confirm: true`, and returns the status, the items, the proposed fields and a mapped sample.

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

- `GET` works only for `publicRead` collections. It returns `{ total, records }` with the declared fields only, at most 100 records per page. Query parameters: `limit`, `offset`, `sort`, `dir` (`asc` or `desc`) and `filter[<field>]=<value>`.
- `POST` with JSON `{ "values": { "<field>": <value> } }` works only for `publicCreate` collections that are internal, or connection collections with a `create` endpoint (the record goes to that endpoint, through the published connection). It answers `201 { id }`. There is no public update or delete, for any collection; other methods (HEAD included) answer `405`.
- There is no same-origin check, because published apps may be embedded anywhere. **Any website can post to a `publicCreate` collection.** The collection flags and these limits are the only protection:
  - Only declared fields are kept, and each value must fit its field type. Fields are never required.
  - A request body can be at most 16 KB (counted while it streams in), and a record at most 10 KB.
  - A collection holds at most 5,000 records.
  - Each IP address gets 10 writes and 120 reads per minute per project. The counters live in memory, so they reset on restart and are not shared between processes.
  - `X-Forwarded-For` is ignored, because any client can send it. Behind a reverse proxy, all visitors share the proxy's one budget.
- Errors are generic. The details only go to the server log.
- `/api/published/<project-slug>`, which the published app loads, leaves out the connections, and the URL, headers, items path, endpoints, id path and field paths of API and connection collections. The public `GET` resolves them on the server from the stored snapshot and the current variables. Its `env` holds the public variables only.

## Action HTTP API

- `GET /api/actions` lists every action with its description and JSON input schema.
- `POST /api/actions/:name` runs an action with a JSON body. For example:

```bash
curl -X POST localhost:3000/api/actions/project_create \
  -H 'content-type: application/json' -d '{"name":"Landing"}'
```

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
- `get_page_content` (read-only) returns the current page as a text outline, one line per element, with links shown as `→ target`.
- `list_records` (read-only) `{ collection, limit?, filter?, sort? }` lists records of a `publicRead` collection through the public `GET` endpoint. `filter` is an object of field values to match, and `sort` is a field key, prefixed with `-` for descending (for example `"-price"`). The tool description lists the readable collections and their fields. It is registered only when at least one collection is `publicRead`.
- `submit_form` `{ collection, values }` adds a record to an internal `publicCreate` collection through the public `POST` endpoint, and returns its result (`{ "id": "…" }`) or its generic error. It is registered only when at least one collection qualifies.

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

## Checks

```bash
pnpm test
pnpm lint
pnpm typecheck
```
