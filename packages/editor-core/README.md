# @bildr/editor-core

The format-independent core of the bildr visual editor (feature P1): the
geometry, canvas protocol, style panel and colour logic that `@bildr/editor`
(the editor SPA) and its canvas build on. It was shared with the hosted editor
until that app was retired; `@bildr/editor` is now its only consumer.

- **Pure TypeScript.** No Vue, no Nuxt, no document format.
- **Allowed imports:** relative files and `@bildr/codegen/design` (tokens, theme).
- **DOM:** a few browser-only helpers use it (`startScrub`, `hasTextSelection`,
  `optionValueAt`); each one says so in its doc comment.
- **Workspace only:** `private: true`, no build. Import a module by its name:
  `@bildr/editor-core/viewport`.
- **Tests:** `test/<module>.test.ts` next to the sources, run by the root
  `pnpm test` (Node, no DOM). `test/design/` and `test/env/` hold the tests of
  the `@bildr/codegen/design` token registry and theme model and of
  `@bildr/codegen/env`, which had no package tests when the hosted app's
  `test/` folder was removed; they can move to `packages/codegen/test/`.

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

**Render rules** shared by the generator and the canvas (elements and token
fallbacks) live in `@bildr/codegen/render`, not here. Its `KNOWN_DIVERGENCES`
lists what P2 decides.
