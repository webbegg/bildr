import { apiSourcePreview, collectionCreate, collectionDelete, collectionUpdate, fieldAdd, fieldMove, fieldRemove, fieldUpdate, publicRecordCreate, recordCreate, recordDelete, recordGet, recordList, recordUpdate } from './data'
import type { ActionDef } from './define'
import { editorGetContext, editorNavigate, editorSetContext } from './editor'
import { nodeDelete, nodeDuplicate, nodeInsert, nodeMove, nodeMoveMany, nodeUpdateProps, nodeUpdateStyle, nodeWrap } from './node'
import { pageAdd, pageDelete, pageRename } from './page'
import { themeGet, themeUpdate } from './theme'
import { componentsList, historyGet, historyRedo, historyUndo, projectCreate, projectGet, projectList, projectPublish, projectPublishedInfo, projectRename } from './project'

/** The static action registry: the one list the UI, HTTP and MCP all expose. */
export const ACTIONS = [
  projectList,
  projectCreate,
  projectGet,
  projectRename,
  componentsList,
  pageAdd,
  pageRename,
  pageDelete,
  nodeInsert,
  nodeUpdateProps,
  nodeUpdateStyle,
  nodeMove,
  nodeMoveMany,
  nodeDelete,
  nodeDuplicate,
  nodeWrap,
  themeGet,
  themeUpdate,
  apiSourcePreview,
  collectionCreate,
  collectionUpdate,
  collectionDelete,
  fieldAdd,
  fieldUpdate,
  fieldMove,
  fieldRemove,
  recordList,
  recordGet,
  recordCreate,
  publicRecordCreate,
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
