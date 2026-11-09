import { collectionCreate, collectionDelete, collectionUpdate, fieldAdd, fieldRemove, fieldUpdate, recordCreate, recordDelete, recordGet, recordList, recordUpdate } from './data'
import type { ActionDef } from './define'
import { editorGetContext, editorNavigate, editorSetContext } from './editor'
import { nodeDelete, nodeDuplicate, nodeInsert, nodeMove, nodeUpdateProps, nodeUpdateStyle } from './node'
import { pageAdd, pageDelete, pageRename } from './page'
import { themeGet, themeUpdate } from './theme'
import { componentsList, historyGet, historyRedo, historyUndo, projectCreate, projectGet, projectList, projectPublish, projectPublishedInfo } from './project'

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
  themeGet,
  themeUpdate,
  collectionCreate,
  collectionUpdate,
  collectionDelete,
  fieldAdd,
  fieldUpdate,
  fieldRemove,
  recordList,
  recordGet,
  recordCreate,
  recordUpdate,
  recordDelete,
  historyGet,
  historyUndo,
  historyRedo,
  projectPublish,
  projectPublishedInfo,
  editorSetContext,
  editorGetContext,
  editorNavigate
] as ActionDef[]
