import type { Model } from '@bildr/codegen/model'
import { isCanvasKind, nameOfItem } from '../shared/items.ts'
import type { Item, ItemKind } from '../shared/items.ts'
import { dataItemKey } from './dataTabs.ts'
import type { Editor, EditorToast, EditorView } from './useEditor.ts'
import { canvasStart, openView } from './views.ts'

/**
 * The one way an item is opened (`shared/items.ts`), whoever asks: a "Used in" link (`openUse`) and a link of the Checks screen
 * (`openTarget`). A page, a component or a layout opens on the Canvas, a collection, a connection, a query or an action in the Data workspace.
 *
 * - **With an editor** (the Data and Design screens) it is the editor that opens it: choosing the item, or the Canvas or the Data view, which opens
 *   the other screen when the item is not on this one (`views.ts`). Every move goes through `leaveData`, so unsaved edits in the Data workspace are asked about
 *   first, and the move is not made when the user keeps them.
 * - **With none** (the Checks screen) the Data workspace is pushed on its item, and the Design screen is opened on the page, component or layout.
 * - **An item that is gone** (the link is older than the last change: it was deleted) is not opened: the screen that would show it is, so the user lands
 *   somewhere real instead of on a blank screen, with a message. Whether it is gone is read from the editor's model, or the one the screen was given.
 *
 * Resolves whether the move was made (false when the user kept their unsaved edits).
 */

export type Push = (to: { path: string, query: Record<string, string> }) => unknown
type Notify = (toast: EditorToast) => void

export type OpenContext
  = | { editor: Editor, push?: Push, model?: undefined, notify?: Notify }
    | { editor: null, push: Push, model: Model | null, notify: Notify }

/** Where an item is shown. */
const viewOf = (kind: ItemKind): EditorView => isCanvasKind(kind) ? 'build' : 'data'

/** Opens `item` in `editor`: chooses it, which shows its view (a view of the other screen opens that screen). */
function openIn(editor: Editor, item: Item): void {
  switch (item.kind) {
    case 'collection':
      editor.collectionId = item.id
      editor.connectionId = null
      editor.mode = 'data'
      break
    case 'connection':
      editor.connectionId = item.id
      editor.mode = 'data'
      break
    case 'query':
      editor.queryId = item.id
      editor.mode = 'data'
      break
    case 'action':
      editor.actionId = item.id
      editor.mode = 'data'
      break
    case 'page':
      editor.mode = 'build'
      editor.sidebarPanel = 'pages'
      editor.selectPage(item.id)
      break
    case 'component':
      editor.sidebarPanel = 'assets'
      editor.editComponent(item.id)
      break
    case 'layout':
      editor.sidebarPanel = 'assets'
      editor.editLayout(item.id)
      break
  }
}

/** Opens `item` from a screen with no editor: its screen, started on it. `item` is only its kind's screen when `home`. */
function openFrom(item: Item, push: Push, home: boolean): void {
  if (isCanvasKind(item.kind)) openView('build', home ? {} : canvasStart(item.kind, item.id))
  else void push({ path: '/data', query: home ? {} : { item: dataItemKey(item) } })
}

const GONE: Record<ItemKind, string> = {
  collection: 'That collection no longer exists',
  connection: 'That connection no longer exists',
  query: 'That query no longer exists',
  action: 'That action no longer exists',
  page: 'That page no longer exists',
  component: 'That component no longer exists',
  layout: 'That layout no longer exists'
}

export function openItem(item: Item, context: OpenContext): Promise<boolean> {
  const { editor } = context
  const model = editor?.model ?? context.model ?? null
  const gone = !!model && nameOfItem(model, item) === undefined
  const notify = context.notify ?? editor?.notify

  const move = () => {
    if (gone) notify?.({ title: GONE[item.kind], description: 'It was renamed or deleted after this link was made.', color: 'warning', icon: 'i-lucide-circle-alert' })
    if (editor) {
      // The screen it would have been on: no item is chosen.
      if (gone) editor.mode = viewOf(item.kind)
      else openIn(editor, item)
    } else {
      openFrom(item, context.push, gone)
    }
  }
  if (!editor) {
    move()
    return Promise.resolve(true)
  }
  // Staying on the screen that would show it changes nothing: nothing to ask about.
  return editor.leaveData(move, !gone || editor.mode !== viewOf(item.kind))
}
