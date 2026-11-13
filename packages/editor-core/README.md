# @bildr/editor-core

The format-independent core of the bildr visual editor (feature P1). The hosted
editor and `@bildr/editor` both use it, so P4 can port the hosted UI into
`packages/editor` without porting this logic twice.

- **Pure TypeScript.** No Vue, no Nuxt, no document format.
- **Allowed imports:** relative files and `@bildr/codegen/design` (tokens, theme).
- **DOM:** a few browser-only helpers use it (`startScrub`, `hasTextSelection`,
  `optionValueAt`); each one says so in its doc comment.
- **Workspace only:** `private: true`, no build. Import a module by its name:
  `@bildr/editor-core/viewport`.

The hosted app's old paths (`shared/editor/<name>.ts`) re-export these modules
in one line. Its imports and its unit tests (`test/editor/*`) are unchanged.

## What is in it

| Module | What it does |
|---|---|
| `protocol` | Canvas postMessage primitives: every message except `bildr:render` (`EditorToCanvasCommon`, `CanvasToEditor`), plus `canvasKeyMessage` and `isCanvasMessage` |
| `preview` | Style patches (`StylePatch`, `applyStylePreview`, `showsPatch`), preview vs commit (`createStylePreview`), `createThrottle`, menu option previews |
| `viewport` | Zoom and pan math, frame layout and bars, `fitView`, `selectionView`, `activeMessage` |
| `measure` | Alt measurement lines between two boxes |
| `autoLayout` | The Shift+A auto-layout guess from on-canvas boxes, and the nearest gap token |
| `handles` | Resize, padding and gap handles; drags snapped to the token scale |
| `spacing` | The spacing box: which key a side reads, and which keys an edit writes |
| `scale` | Stepping through a token's scale; px sizes at the project density |
| `scrub` | Drag-to-scrub over a scale (browser only) |
| `sizeModes` | Fixed, Fit, Fill and Relative over the `w` and `h` tokens |
| `styleFields` | Style panel sections and controls, devices and breakpoints, provenance, colour swatches |
| `devices` | Device order, the Alt+digit shortcuts, `revealFrame` |
| `frames` | The visible device frames preference |
| `color` | Colour conversions (hex, RGBA, HSVA, OKLCH) and custom colour names |
| `clipboardKeys` | Which Cmd/Ctrl shortcuts the editor takes over from the browser |
| `editStack` | The component/layout breadcrumb stack |
| `names` | Component and layout name checks |
| `labelPlacement` | Where the canvas puts a box's type label |
| `measuredSizes` | The measured W/H of the selection, without stale results |

## What stays in the hosted app (porting map for P3/P4)

These modules depend on the hosted document (`#shared/document/*`: `DocNode`,
`Page`, `ComponentDefinition`, the `COMPONENTS` registry, `tree`). They can't
move until P3 has the editing operations on `.bildr` `ModelNode` documents.
Each one is ported against `ModelNode` in P3 or P4, not moved.

**`shared/editor/*`:**

| File | Why it stays |
|---|---|
| `protocol.ts` (`bildr:render`, `EditorToCanvas`) | The render payload is the hosted `Page`, `ComponentDefinition`, `Layout` and `DataRecord`. Mapping spec §6 reshapes it to `{file, components, layouts, theme, …, data}` |
| `preview.ts` (`previewTree`, `settlePreviews`) | Walks a `DocNode` tree |
| `accent.ts` | `INSTANCE_TYPE` from the hosted registry |
| `bindingDot.ts` | `{{ item.x }}` bindings over the hosted schema and usages; `.bildr` uses `$bind` |
| `clipboard.ts` | Copies and pastes `DocNode` subtrees |
| `commands.ts` | The command list over the hosted registry and collections |
| `detailPages.ts` | Hosted collections and detail pages (mapped to Queries in P5) |
| `dropTarget.ts`, `insertTools.ts`, `reorder.ts`, `gesture.ts` | Drop and insert math over `DocNode` trees and `isContainerType`. The geometry inside them could split out in P4 |
| `formSubmit.ts` | The hosted `record_create` and public endpoint; retired with collections (E2) |
| `interactionArrows.ts`, `interactionPanel.ts`, `variantBoard.ts` | Hosted component variants and interactions (`state`, `interactions`, `transition`) |
| `layers.ts`, `selection.ts`, `selectionColors.ts`, `thumbnails.ts` | Walk `DocNode` trees and the registry |
| `navigate.ts`, `sidebar.ts` | Hosted `Page` and `factory` |
| `panel.ts`, `propGroups.ts`, `propertyLabels.ts` | The hosted registry's `PropDef` and prop kinds |

**`shared/runtime/*`:** every file stays (`bindings`, `detail`, `form`,
`instances`, `interactions`, `layouts`, `list`, `loadMore`, `render`, `visitor`,
`webmcp`). Each one reads the hosted `DocNode` and `DataRecord`, or the
collections. The canvas interpreter for `ModelNode` replaces them in P4/P5.

**Render rules** shared by the generator and the canvas (elements and token
fallbacks) live in `@bildr/codegen/render`, not here. Its `KNOWN_DIVERGENCES`
lists what P2 decides.
