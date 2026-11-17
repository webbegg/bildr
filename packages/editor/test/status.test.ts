import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createStatus } from '../src/status.ts'
import { pendingPlan } from './fixtures.ts'

/** `showPlanFrom` (S6): the Data screen says whether it shows the plan while it is open, and the shell's own banner follows. */

describe('showPlanFrom', () => {
  it('says nothing is shown while no Data screen registered', () => {
    expect(createStatus().planShown.value).toBe(false)
  })

  it('follows what the registered screen says, as it changes', () => {
    const status = createStatus()
    const shown = ref(false)
    status.showPlanFrom(shown)
    expect(status.planShown.value).toBe(false)
    shown.value = true
    expect(status.planShown.value).toBe(true)
    shown.value = false
    expect(status.planShown.value).toBe(false)
  })

  it('goes back to not shown once the screen withdraws', () => {
    const status = createStatus()
    const shown = ref(true)
    const withdraw = status.showPlanFrom(shown)
    expect(status.planShown.value).toBe(true)
    withdraw()
    expect(status.planShown.value).toBe(false)
    shown.value = false
    shown.value = true
    expect(status.planShown.value).toBe(false)
  })

  it('ignores the withdraw of a screen that another has replaced (a stale token)', () => {
    const status = createStatus()
    const first = ref(true)
    const second = ref(true)
    const withdrawFirst = status.showPlanFrom(first)
    const withdrawSecond = status.showPlanFrom(second)
    withdrawFirst()
    expect(status.planShown.value).toBe(true)
    second.value = false
    expect(status.planShown.value).toBe(false)
    second.value = true
    withdrawSecond()
    expect(status.planShown.value).toBe(false)
  })

  it('leaves the plan itself alone', () => {
    const status = createStatus()
    status.pending.value = pendingPlan()
    const withdraw = status.showPlanFrom(ref(true))
    withdraw()
    expect(status.plan.value?.hash).toBe('abc123')
  })
})
