/**
 * Boots the module suite's project (lib.mjs `boot`) and keeps it running, so scripts can be run against it
 * without a boot each time:
 *
 *   node e2e/module/serve.mjs            # prints the two env lines, then waits (Ctrl-C stops it)
 *   E2E_MODULE_URL=… E2E_MODULE_DIR=… node e2e/module/shell.mjs
 */
import { boot } from './lib.mjs'

const project = await boot({ keep: process.env.E2E_KEEP === '1' })
console.log(`E2E_MODULE_URL=${project.base}/__bildr?token=${project.token}`)
console.log(`E2E_MODULE_DIR=${project.root}`)
console.log(`log ${project.log}`)
const stop = async () => {
  await project.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise(() => {})
