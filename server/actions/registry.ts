import type { ActionDef } from './define'
import { nodeDelete, nodeDuplicate, nodeInsert, nodeMove, nodeUpdateProps, nodeUpdateStyle } from './node'
import { pageAdd, pageDelete, pageRename } from './page'
import { componentsList, historyGet, historyRedo, historyUndo, projectCreate, projectGet, projectList } from './project'

/** The static action registry: the one list the UI, HTTP and MCP all expose. */
export const ACTIONS = [
  projectList,
  projectCreate,
  projectGet,
  componentsList,
  pageAdd,
  pageRename,
  pageDelete,
  nodeInsert,
  nodeUpdateProps,
  nodeUpdateStyle,
  nodeMove,
  nodeDelete,
  nodeDuplicate,
  historyGet,
  historyUndo,
  historyRedo
] as ActionDef[]
