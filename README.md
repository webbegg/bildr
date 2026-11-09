# bildr

A visual app builder where everything you can do in the editor, an agent can do too. Apps are a JSON document (`Project → Page[] → Node tree`). The editor and the published app render that document with the same runtime, and every change goes through one set of shared actions. The UI, the HTTP API and MCP all call those same actions.

> [!WARNING]
> `/mcp` and `/api/actions` have **no authentication**. Anyone who can reach the server can read and change every project. Run bildr for local development only, and do not expose it on a network.

## Run it

```bash
pnpm install
pnpm dev
```

- Editor: <http://localhost:3000/> lists your projects. Open one to edit it at `/editor/<projectId>`.
- Published apps: `/p/<project-slug>` and `/p/<project-slug>/<page-slug>`. They show the last published version.
- Data is stored under `.data/`.

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

WebMCP is still a draft, so this support is exploratory. To try it:

1. Use Chrome 149 or later and open `chrome://flags/#enable-webmcp-testing`. Set it to **Enabled** and relaunch Chrome.
2. Open a published app, for example <http://localhost:3000/p/landing>. WebMCP needs a secure context, and `localhost` counts as one.
3. Use a WebMCP inspector extension or an in-browser agent to list the page's tools. You should see the three tools above.

## MVP walkthrough (S8)

This walkthrough goes from an empty project to a published app that an agent built and you tweaked.

1. **The agent builds a landing page while you watch.**
   - Start bildr with `pnpm dev`.
   - Create an empty project: open <http://localhost:3000/>, create a project named `Landing`, and keep its editor open.
   - Connect your agent with `claude mcp add --transport http bildr http://localhost:3000/mcp`.
   - Give the agent a prompt such as:

     > In the bildr project "Landing", add a page named "Pricing". On the Home page, add a Column with a Heading "Build apps with agents", a Text that describes the product in one sentence, and a Button "See pricing" that links to the pricing page.

   - The editor shows each change within about a second, without a reload.
2. **You tweak it in the editor.** Click the heading on the canvas, change its text in the properties panel on the right, and press Enter or leave the field. Undo and redo work with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.
3. **Publish.** Click **Publish** in the editor toolbar.
4. **Open the published app.** Go to `/p/landing`. It shows the published Home page, and the button opens `/p/landing/pricing`. In a WebMCP-enabled Chrome (see above), the page lists `list_pages`, `navigate_to_page` and `get_page_content`.

## Checks

```bash
pnpm test
pnpm lint
pnpm typecheck
```
