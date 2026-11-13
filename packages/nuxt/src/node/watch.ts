import { lstatSync, readdirSync, watch } from 'node:fs'
import type { Dirent, FSWatcher } from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface ModelWatcher {
  close: () => void
}

/** Never watched: the cache bildr writes to (health, pending migration, staging). */
const IGNORED = new Set(['.cache'])

const isFolder = (path: string) => {
  try {
    // lstat: a symlinked folder is not followed (the model loader skips it too).
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Watches the `.bildr/` folder `dir` with one plain watch per folder,
 * reporting each changed path relative to `dir` (POSIX separators).
 *
 * Not `fs.watch(dir, { recursive: true })`: on Linux, Node's recursive
 * watch stops reporting a file once it has been replaced by a rename, which
 * is how every save is written (atomic writes), so live regeneration went
 * silent after the second save of the same model file. A plain folder watch
 * sees the rename into the folder every time.
 *
 * Folders that appear later (created, moved in, or removed and created
 * again) get their own watch, and the files already in them are reported,
 * so a folder copied in at once still regenerates. Only an error on `dir`
 * itself reaches `onError`; a subfolder whose watch fails is dropped.
 */
export const watchModel = (dir: string, handlers: { onChange: (file: string) => void, onError: (error: Error) => void }): ModelWatcher => {
  const watchers = new Map<string, FSWatcher>()
  let closed = false
  const report = (path: string) => {
    if (!closed) handlers.onChange(relative(dir, path).split(sep).join('/'))
  }
  /** Stops watching `folder` and everything under it. */
  const forget = (folder: string) => {
    for (const [path, watcher] of watchers) {
      if (path === folder || path.startsWith(folder + sep)) {
        watcher.close()
        watchers.delete(path)
      }
    }
  }
  /** Watches `folder` and its subfolders; `announce` reports the files found (a folder that just appeared). */
  const add = (folder: string, announce: boolean) => {
    if (closed || watchers.has(folder) || !isFolder(folder)) return
    let watcher: FSWatcher
    try {
      watcher = watch(folder, (event, name) => {
        if (closed) return
        if (name === null) return report(folder)
        if (folder === dir && IGNORED.has(String(name))) return
        const path = join(folder, String(name))
        // Something was created, removed or moved here: a folder needs a fresh watch (an old one may watch a deleted folder).
        if (event === 'rename') {
          forget(path)
          add(path, true)
        }
        report(path)
      })
    } catch (error) {
      if (folder === dir) throw error
      return
    }
    watcher.on('error', (error: Error) => {
      if (folder === dir) handlers.onError(error)
      else forget(folder)
    })
    watchers.set(folder, watcher)
    let entries: Dirent[]
    try {
      entries = readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(folder, entry.name)
      if (folder === dir && IGNORED.has(entry.name)) continue
      if (entry.isDirectory()) add(path, announce)
      else if (announce && entry.isFile()) report(path)
    }
  }
  add(dir, false)
  return {
    close: () => {
      closed = true
      forget(dir)
    }
  }
}
