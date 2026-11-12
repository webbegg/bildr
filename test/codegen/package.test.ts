import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, loadModel, serializeModel } from '@bildr/codegen/model'

// The bildr app consumes the model through the workspace package, not by path.
describe('@bildr/codegen/model', () => {
  it('resolves from the app through the package exports', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(typeof loadModel).toBe('function')
    expect(typeof serializeModel).toBe('function')
  })
})
