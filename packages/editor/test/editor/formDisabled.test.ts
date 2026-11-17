import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountWithApp } from '../helpers.ts'
import EditorButton from '../../src/components/kit/EditorButton.vue'
import EditorInput from '../../src/components/kit/EditorInput.vue'
import EditorSelect from '../../src/components/kit/EditorSelect.vue'
import { provideDisabled } from '../../src/components/kit/formDisabled.ts'
import { setupHarness } from '../design/harness.ts'

/** The kit's controls disable with the form they are in (`kit/formDisabled.ts`), and with their own `disabled` otherwise. */

setupHarness()

/** One of each control, tagged by the group it is in. */
const controls = (group: string, disabled?: boolean) => [
  h(EditorButton, { 'label': 'Go', disabled, 'data-control': `${group}-button` }),
  h(EditorInput, { 'modelValue': 'x', disabled, 'data-control': `${group}-input` }),
  h(EditorSelect, { 'items': ['a', 'b'], 'modelValue': 'a', disabled, 'data-control': `${group}-select` })
]
const off = (id: string) => {
  const element = document.body.querySelector<HTMLElement>(`[data-control="${id}"]`)
  if (!element) throw new Error(`no control ${id}`)
  return element.matches(':disabled')
}
const KINDS = ['button', 'input', 'select']

describe('the kit\'s disabled controls', () => {
  it('follow only their own `disabled` with no form around them', async () => {
    await mountWithApp(defineComponent({ render: () => h('div', [...controls('free'), ...controls('own', true)]) }))
    for (const kind of KINDS) {
      expect(off(`free-${kind}`), `${kind} with no form and no disabled`).toBe(false)
      expect(off(`own-${kind}`), `${kind} with disabled`).toBe(true)
    }
  })

  it('are disabled by the form around them while it is saving, and a control outside the form is not', async () => {
    const saving = ref(true)
    const Form = defineComponent({
      setup() {
        provideDisabled(saving)
        return () => h('form', controls('inside'))
      }
    })
    await mountWithApp(defineComponent({ render: () => h('div', [h(Form), ...controls('outside')]) }))
    for (const kind of KINDS) {
      expect(off(`inside-${kind}`), `${kind} in the saving form`).toBe(true)
      expect(off(`outside-${kind}`), `${kind} outside the form`).toBe(false)
    }
  })
})
