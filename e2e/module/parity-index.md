# Editor UI parity: hosted editor vs module editor (S1, U8)

> **Historical note.** The hosted multi-project app is retired, and `e2e/module/parity.mjs`, the script that made these pairs, is gone with it. The hosted editor can be rebuilt from git history (before the commit that retired it) if a pair has to be redone. The screenshots were never kept in the repository. This file is the record of the differences that were accepted.

Made by `e2e/module/parity.mjs` (branch `test/editor-ui-e2e`, on `c9ceb7c`), which copied this file next to the screenshots. For each flow, the hosted editor (`pnpm dev --port 3200`) and the module editor (`/__bildr` on a created blog project) in the same state, in a 1400×850 Chromium.
Each flow has `<flow>-hosted.png`, `<flow>-module.png` and `<flow>-pair.png` (hosted left, module right).

Both sides got the same content through each one's actions: a Column (padding 4, gap 2) with a Heading "Welcome to the blog", a Text and a Button "Read more"; a Card with a Heading "Latte", made into a component "Latte card" with a "Hover" variant; for Data, the Post collection with rows.

## Differences that hold on every pair (by design, not bugs)

| Where | Hosted | Module |
| --- | --- | --- |
| Left of the shell | none | none: the nav rail is gone (S1), the top bar's view menu (Canvas, Design system, Data, Code, Checks, Settings) is the only navigation, so the canvas stage has the full width. The fit-zoom figures measured with the 208 px rail (81% / 26% / 57% hosted against 81% / 18% / 39% module) predate that |
| Toolbar, centre | project name and `/slug` | project name only ("Blog") |
| Toolbar, right | Publish button (blue, purple in a component) | no Publish (the app is the project's own `nuxt dev`); an "agent" sparkles icon instead |
| Bottom of the canvas | a perf chip ("42 ms") | none |
| Page names | the page's name ("Home") | its route path ("/parity-…", "/posts/new"); the blog's other pages are in the list too |
| Theme | green primary, Public Sans | the blog theme: indigo primary, Inter (the chrome's font is the same) |
| Names of components, variants | "Latte card", "Hover" | PascalCase / camelCase ("LatteCard", "hover") |

## Differences per flow

- **canvas-default**: same Pages tab, same frame bar ("Mobile 390 Primary"), same floating bar. Only the shell differences above.
- **layers-selected**: same layer rows, breadcrumb, "Editing Mobile", Content and Appearance sections. Module adds an **Advanced › Show (On/Off)** section for the node's `visible` prop, which the hosted inspector doesn't have (hosted has Styles › Visible only): Log L13 call, accepted.
- **inspector-column**: same Size / Layout / Styles / Typography sections and the collapsed Typography. Same Advanced › Show difference.
- **node-menu**: identical items, shortcuts and order (Add to agent … Delete). No difference.
- **quick-actions**: identical palette with "Text" typed (one Insert › Text result). The module's page list behind it shows the layout badge ("main") on pages that use a layout, which the hosted project has none of.
- **insert-panel**: same panel and footer text. The module also lists the blog's components (PostCard, Tip) with thumbnails and a **Layouts** section (the blog's `main` layout) because the project has them; the layout tile shows an icon, not a render.
- **assets**: same Assets tab: Components with usage counts, Layouts, the Design system row. The lists differ by content (module: LatteCard, PostCard, Tip and the `main` layout with 3 pages; hosted: Latte card, and the "No layouts yet" empty state).
- **frames**: same Desktop / Tablet / Mobile bars, ranges ("1024+", "1023—768", "Primary") and Layers device rows. Fit zoom differs (shell).
- **component-view**: same breadcrumb (page › component, "1 instance", variant select, Board toggle, Done), purple context, board with Primary and the variant, "+ Variant" and "+ Hover / Pressed" tiles. Module: the "+ Variant" tile and the "+ Hover / Pressed" tiles are solid-outline boxes where hosted's are dashed, the Hover / Pressed tiles are the frame's width in hosted and button-sized in the module, and the board is laid out smaller (39% against 57%, shell).
- **design-system**: same style guide and Colours / Custom colours / Typography / Radius / Spacing controls. Left: hosted has "Save current as theme" and saved themes (default, Stone); the module lists the 5 bundled presets (Default, Ocean, Forest, Sunset, Mono) and cannot save (theme-library save dropped). Font, radius and density values differ by theme (Inter and 6px against Public Sans and 4px).
- **settings**: the module shows the name, a read-only **Variables** table of the data sources' env vars (set or not) and the MCP line. Hosted also has Slug, Publishing, editable Variables, WebMCP and the Danger zone: all dropped with the multi-project app.
- **data**: same two-column shell: Collections / Fields tabs, table toolbar (sort, filter, search), Collection panel (Name, Plural, Fields …) and Detail page section. Module: an "App data" badge and refresh in the toolbar, an "App list" toggle, Create action and "Stored in" rows, a Synced section with the REST connection (quotes), "All model files" (was "Raw model files"; the JSON tab edits the item's file, S3). Hosted: record checkboxes, a "+" add-record button, a "New item…" quick-add row, Public read / create toggles, "Create detail page" (records are read-only in the module; there is no create-detail action). The module's table shows 37 rows because the e2e scripts had made rows in the app's database.

## Fixed or accepted

Nothing in this folder needed a fix: every difference above is the module's data model or a dropped hosted multi-project feature (feature doc: U-E1, U7 and U8 drops), or a call already logged (L13). No pair showed a spacing, colour, type or icon difference in the shared components. Open items found by the e2e and not by this review are in the U8 report.
