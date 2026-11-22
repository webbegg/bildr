// Select inputs: a select field's sample value is chosen from its options, in the grid's cell and in the record panel.
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { NO_CHOICE, choiceValue, selectChoices } from '../../src/shared/dataGrid.ts'
import type { DataField } from '../../src/shared/dataModel.ts'
import DataPanelValue from '../../src/components/data/panel/DataPanelValue.vue'
import DataRowsTable from '../../src/components/data/table/DataRowsTable.vue'

vi.mock('../../src/editor/useEditor.ts', () => ({ useEditor: () => ({ dataCollection: null }) }))
vi.mock('../../src/editor/useDirtyReport.ts', () => ({ useDirtyReport: () => undefined }))

const stage = (required = false): DataField => ({ id: 'fld_stage', name: 'stage', label: 'Stage', type: 'select', options: ['lead', 'won'], required })

/** The kit select, as a plain element: its items, and a choice made by emitting it. */
const EditorSelect = {
  props: ['items', 'modelValue'],
  emits: ['update:modelValue', 'update:open'],
  template: '<div data-select-stub :data-items="JSON.stringify(items)" :data-value="modelValue" />'
}
const stubs = { EditorSelect, EditorSwitch: true, EditorInput: true, DataTableCell: true, EditorButton: true, UTooltip: true, Tooltip: true, UIcon: true, Icon: true }

describe('the choices of a select cell', () => {
  it('are its options, with None first for an optional field', () => {
    expect(selectChoices(stage(true))).toEqual([{ label: 'lead', value: 'lead' }, { label: 'won', value: 'won' }])
    expect(selectChoices(stage())[0]).toEqual({ label: 'None', value: NO_CHOICE })
  })

  it('save the option chosen, and None as no value', () => {
    expect(choiceValue('won')).toBe('won')
    expect(choiceValue(NO_CHOICE)).toBeNull()
  })
})

describe('a select field in the record panel', () => {
  it('is a dropdown of its options, saved when one is chosen', async () => {
    const save = vi.fn(async () => undefined)
    const wrapper = mount(DataPanelValue, { props: { field: stage(), modelValue: 'lead', save }, global: { stubs } })
    const select = wrapper.getComponent(EditorSelect)
    expect(select.props('modelValue')).toBe('lead')
    expect(select.props('items')).toEqual(selectChoices(stage()))
    select.vm.$emit('update:modelValue', 'won')
    expect(save).toHaveBeenCalledWith('won')
    select.vm.$emit('update:modelValue', NO_CHOICE)
    expect(save).toHaveBeenLastCalledWith(null)
  })
})

describe('a select cell in the sample-data grid', () => {
  it('edits as a dropdown of its options and saves the one chosen', async () => {
    const save = vi.fn(async () => undefined)
    const row = { id: 'r1', stage: 'lead' }
    const wrapper = mount(DataRowsTable, { props: { fields: [stage()], rows: [row], loaded: [row], editable: true, save }, global: { stubs }, attachTo: document.body })
    await wrapper.get('[data-cell="0-0"]').trigger('dblclick')
    const select = wrapper.getComponent(EditorSelect)
    expect(select.props('modelValue')).toBe('lead')
    expect(wrapper.find('[data-cell-input]').exists()).toBe(false)
    select.vm.$emit('update:modelValue', 'won')
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('r1', expect.objectContaining({ name: 'stage' }), 'won', row))
    wrapper.unmount()
  })

  it('gives the cell back when the dropdown closes without a choice', async () => {
    const save = vi.fn(async () => undefined)
    const row = { id: 'r1', stage: 'lead' }
    const wrapper = mount(DataRowsTable, { props: { fields: [stage()], rows: [row], loaded: [row], editable: true, save }, global: { stubs }, attachTo: document.body })
    await wrapper.get('[data-cell="0-0"]').trigger('dblclick')
    wrapper.getComponent(EditorSelect).vm.$emit('update:open', false)
    await vi.waitFor(() => expect(wrapper.findComponent(EditorSelect).exists()).toBe(false))
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
