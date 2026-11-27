// codegen-architecture T2: a Form validates in the page with the schema its action's route validates with (its contract's body).
import { describe, expect, it } from 'vitest'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const NEW_POST = 'layers/blog/app/pages/posts/new.vue'

describe('a generated Form', () => {
  it('is a UForm over the form state, validated with its action contract\'s body, the fields it edits only', () => {
    const page = generated(project().files)[NEW_POST]!
    expect(page).toContain('import { createPostContract } from \'#blog/contracts/create-post\'\n')
    expect(page).toContain('const form = reactive({ title: \'\', slug: \'\', body: \'\', published: false })\n')
    expect(page).toContain('const formSchema = createPostContract.body.pick({ title: true, slug: true, body: true, published: true })\n')
    expect(page).toContain('<UForm :schema="formSchema" :state="form" novalidate class="flex max-w-xl flex-col gap-4 self-stretch" @submit="onFormSubmit">')
    expect(page).toContain('    </UForm>\n')
    expect(page).not.toContain('<form')
    expect(page).not.toContain('@submit.prevent')
  })

  it('still names each field, so the schema\'s message shows under it', () => {
    const page = generated(project().files)[NEW_POST]!
    expect(page).toContain('<UFormField label="Slug" name="slug" required class="self-stretch">')
  })

  it('a read-only field it shows is not checked: the body the schema comes from has no such field', () => {
    const p = project()
    const path = '.bildr/modules/blog/entities/post.json'
    const entity = p.json(path)
    const fields = entity.fields.map((field: { name: string }) => field.name === 'title' ? { ...field, readonly: true } : field)
    expect(generated({ ...p.files, [path]: JSON.stringify({ ...entity, fields }) })[NEW_POST]).toContain('const formSchema = createPostContract.body.pick({ slug: true, body: true, published: true })\n')
  })

  it('a choice not made yet starts as none of its options, typed as one of them (what UForm\'s state takes)', () => {
    const p = project()
    const path = '.bildr/modules/blog/entities/post.json'
    const entity = p.json(path)
    const fields = entity.fields.map(({ min: _min, max: _max, ...field }: { name: string, min?: number, max?: number }) => field.name === 'title' ? { ...field, type: 'select', options: ['news', 'it\'s late'] } : { ...field, min: _min, max: _max })
    expect(generated({ ...p.files, [path]: JSON.stringify({ ...entity, fields }) })[NEW_POST])
      .toContain('const form = reactive({ title: undefined as \'news\' | \'it\\\'s late\' | undefined, slug: \'\', body: \'\', published: false })\n')
  })

  it('a page with no Form declares no form schema', () => {
    const files = generated(project().files)
    expect(files['layers/blog/app/pages/index.vue']).not.toContain('formSchema')
  })
})
