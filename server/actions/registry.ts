import { componentCreate, componentDelete, componentPropertyAdd, componentPropertyRemove, componentPropertyUpdate, componentRename, componentVariantAdd, componentVariantDelete, componentVariantSetOverride, instanceSetSlot, instanceSetValues } from './component'
import { connectionCreate, connectionDelete, connectionUpdate, endpointTest } from './connection'
import { apiSourcePreview, collectionCreate, collectionDelete, collectionUpdate, fieldAdd, fieldMove, fieldRemove, fieldUpdate, publicRecordCreate, recordCreate, recordDelete, recordGet, recordList, recordUpdate } from './data'
import type { ActionDef } from './define'
import { editorGetContext, editorNavigate, editorSetContext } from './editor'
import { envDelete, envList, envSet } from './env'
import { nodeDelete, nodeDuplicate, nodeInsert, nodeMove, nodeMoveMany, nodeUpdateProps, nodeUpdateStyle, nodeWrap } from './node'
import { pageAdd, pageDelete, pageRename } from './page'
import { themeGet, themeUpdate } from './theme'
import { componentsList, historyGet, historyRedo, historyUndo, projectCreate, projectDelete, projectGet, projectList, projectPublish, projectPublishedInfo, projectRename } from './project'

/** The static action registry: the one list the UI, HTTP and MCP all expose. */
export const ACTIONS = [
  projectList,
  projectCreate,
  projectGet,
  projectRename,
  projectDelete,
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
  componentCreate,
  componentRename,
  componentDelete,
  componentPropertyAdd,
  componentPropertyUpdate,
  componentPropertyRemove,
  componentVariantAdd,
  componentVariantDelete,
  componentVariantSetOverride,
  instanceSetValues,
  instanceSetSlot,
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
  connectionCreate,
  connectionUpdate,
  connectionDelete,
  endpointTest,
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
  envList,
  envSet,
  envDelete,
  editorSetContext,
  editorGetContext,
  editorNavigate
] as ActionDef[]
