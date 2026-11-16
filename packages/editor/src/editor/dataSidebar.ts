/**
 * The last Import from API request each editor's Data tree answered, so a request made before it mounts (⌘K from the
 * Canvas) still opens the dialog. (The tree's Collections / Fields tabs are gone: the selected item's tabs are
 * `dataTab`, in `editor/dataView.ts`.)
 */
export const answeredImports = new WeakMap<object, number>()
