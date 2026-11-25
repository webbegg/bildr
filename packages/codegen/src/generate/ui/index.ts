import type { Model } from '../../model/load.ts'
import type { GeneratedFile } from '../../sync/plan.ts'
import { moduleContext } from '../context.ts'
import { componentFile, layoutFile, pageFile } from './files.ts'

/**
 * The UI of the app (T7c): layouts, pages and components, rendered from the
 * model's node trees into SFCs that use Nuxt UI, the token registry's
 * classes and the generated composables. One renderer for the three kinds,
 * so a node looks the same wherever it sits. Pure and deterministic.
 *
 * - `env.ts`: what a file's `$bind` paths refer to, and model values as TS expressions;
 * - `markup.ts`: tags, attributes, escaping and the SFC shell;
 * - `style.ts`: a node's classes, class maps and inline style;
 * - `nodes.ts`: the template of each node type;
 * - `interactions.ts`: events and their script handlers;
 * - `variants.ts`: component variants, states and property bindings;
 * - `files.ts`: the layout, component and page files, with their scripts.
 */
export const generateUi = (model: Model): GeneratedFile[] => {
  const files: GeneratedFile[] = model.layouts.map(layout => layoutFile(model, layout))
  for (const name of Object.keys(model.modules).sort()) {
    const context = moduleContext(model, name)
    for (const component of context.module.components) files.push(componentFile(context, component))
    for (const page of context.module.pages) files.push(pageFile(context, page))
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
