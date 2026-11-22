import { describe, expect, it } from 'vitest'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import type { ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'

const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

const pageOf = (model: Model, name: string) => model.modules.blog!.pages.find(page => page.name === name)!
const generated = (model: Model, suffix: string) => generateUi(model).find(file => file.path.endsWith(suffix))!.content

/** The index page with one extra node in its root (a vertical stack). */
const indexWith = (node: ModelNode) => {
  const model = fixtureModel()
  pageOf(model, 'index').root.children!.push(node)
  return generated(model, 'pages/index.vue')
}
const text = (id: string, value = 'a'): ModelNode => ({ id, type: 'Text', props: { text: value } })

// E3 ("the canvas wins"): the generator renders what the canvas renders, through the shared
// rules of @bildr/codegen/render (formerly the KNOWN_DIVERGENCES entries named per test).
describe('generateUi follows the canvas render rules', () => {
  it('lays containers out as flex columns and stretches them across a vertical stack (container-direction, stack-self-stretch)', () => {
    const page = indexWith({ id: 'n_x', type: 'Container', children: [{ id: 'n_y', type: 'Container', props: { tag: 'section' }, style: { self: 'start' } }] })
    expect(page).toContain('    <div class="flex flex-col self-stretch">\n      <section class="flex flex-col self-start" />')
  })

  it('lays a Row out as a flex row that wraps with `wrap`, whose children follow its items (row-direction-wrap)', () => {
    const page = indexWith({ id: 'n_x', type: 'Row', props: { wrap: true }, children: [{ id: 'n_y', type: 'Container' }] })
    expect(page).toContain('    <div class="flex flex-row flex-wrap self-stretch">\n      <div class="flex flex-col" />')
  })

  it('makes a page fill its frame (page-min-height)', () => {
    expect(generated(fixtureModel(), 'pages/index.vue')).toContain('<section class="gap-6 min-h-full flex-col flex">')
  })

  it('renders a Heading with the typography of its level, its own tokens first (heading-tokens, heading-levels)', () => {
    expect(indexWith({ id: 'n_x', type: 'Heading', props: { level: 5, text: 'x' } })).toContain('<h5 class="text-lg font-semibold">x</h5>')
    expect(indexWith({ id: 'n_x', type: 'Heading', props: { level: 1, text: 'x' }, style: { text: '5xl' } })).toContain('<h1 class="text-5xl font-bold tracking-tight">x</h1>')
    expect(() => indexWith({ id: 'n_x', type: 'Heading', props: { level: 7, text: 'x' } })).toThrow(/heading level must be 1–6/)
  })

  it('shows a List\'s first `loadMore` records and a Load more button that shows the next ones (list-load-more)', () => {
    const page = indexWith({
      id: 'n_more', type: 'List', props: { items: { $bind: 'all' }, as: 'post', loadMore: 4 },
      children: [{ id: 'n_title', type: 'Text', props: { text: { $bind: 'post.title' } } }]
    })
    expect(page).toContain('const shownMore = ref(4)')
    expect(page).toContain('<p v-for="post in all.slice(0, shownMore)" :key="post.id" class="whitespace-pre-line">{{ post.title }}</p>')
    expect(page).toContain('<div v-if="all.length > shownMore" class="col-span-full flex w-full basis-full flex-col items-center gap-2 self-stretch">')
    expect(page).toContain('<UButton label="Load more" @click="shownMore += 4" />')
  })

  it('keeps the line breaks of a Text (text-line-breaks)', () => {
    expect(indexWith({ ...text('n_x'), style: { text: 'sm' } })).toContain('<p class="whitespace-pre-line text-sm">a</p>')
  })

  it('emits a Text with a line break as a string expression, because Vue condenses a newline in template text to a space', () => {
    expect(indexWith(text('n_x', 'one\ntwo'))).toContain('<p class="whitespace-pre-line">{{ \'one\\ntwo\' }}</p>')
    // The literal can't end the interpolation or open a tag, whatever the text holds.
    expect(indexWith(text('n_x', 'a}}<b>&\n\'q\'\\'))).toContain('{{ \'a\\u007d\\u007d\\u003cb\\u003e\\u0026\\n\\\'q\\\'\\\\\' }}')
    // A template keeps its static parts' breaks and its bindings.
    const page = indexWith({ id: 'n_x', type: 'Text', props: { text: { $template: 'a\nb {featured.length}' } } })
    expect(page).toMatch(/<p class="whitespace-pre-line">\{\{ 'a\\nb ' \}\}\{\{ featured\.length \}\}<\/p>/)
  })

  it('leaves a single-line Text as plain template text', () => {
    expect(indexWith(text('n_x', 'one two'))).toContain('<p class="whitespace-pre-line">one two</p>')
  })

  it('renders a Link as ULink with the canvas classes, `href` in a new tab and an icon (link-element)', () => {
    const page = indexWith({ id: 'n_x', type: 'Link', props: { href: 'https://nuxt.com', text: 'Nuxt', icon: 'i-lucide-external-link' } })
    expect(page).toContain([
      '    <ULink to="https://nuxt.com" target="_blank" class="underline-offset-4 hover:underline items-center gap-1 inline-flex">',
      '      <UIcon name="i-lucide-external-link" class="size-[1em] shrink-0" />',
      '      Nuxt',
      '    </ULink>'
    ].join('\n'))
    expect(indexWith({ id: 'n_x', type: 'Link', props: { to: { page: 'pg_new_post' }, text: 'New' } })).toContain('<ULink to="/posts/new" class="underline-offset-4 hover:underline">New</ULink>')
    expect(() => indexWith({ id: 'n_x', type: 'Link', props: { href: 'javascript:alert(1)', text: 'x' } })).toThrow(/href must be an http\(s\), mailto: or tel: URL/)
  })

  it('passes a Button\'s color, variant, size, icons and href through to UButton (button-props)', () => {
    const page = indexWith({ id: 'n_x', type: 'Button', props: { text: 'Go', color: 'neutral', variant: 'ghost', size: 'lg', icon: 'i-lucide-send', trailingIcon: 'i-lucide-arrow-right' } })
    expect(page).toContain('<UButton label="Go" color="neutral" variant="ghost" size="lg" icon="i-lucide-send" trailing-icon="i-lucide-arrow-right" />')
    expect(indexWith({ id: 'n_x', type: 'Button', props: { text: 'Docs', href: 'https://nuxt.com' } })).toContain('<UButton label="Docs" to="https://nuxt.com" target="_blank" />')
    expect(() => indexWith({ id: 'n_x', type: 'Button', props: { text: 'x', color: 'pink' } })).toThrow(/Button color must be one of primary/)
  })

  it('shows a toast step with Nuxt UI\'s useToast, alone or after an action succeeds (button-props: action toast)', () => {
    const page = indexWith({ id: 'n_x', type: 'Button', props: { text: 'Hi' }, interactions: [{ on: 'click', do: [{ kind: 'toast', title: 'Hello', color: 'success' }] }] })
    expect(page).toContain('<UButton label="Hi" @click="toast.add({ title: \'Hello\', color: \'success\' })" />')
    expect(page).toContain('const toast = useToast()')

    const model = fixtureModel()
    const detail = pageOf(model, 'posts-slug')
    const find = (node: ModelNode): ModelNode | undefined => node.type === 'Button' ? node : node.children?.map(find).find(Boolean)
    const button = find(detail.root)!
    button.interactions = [{ on: 'click', do: [
      { kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } },
      { kind: 'toast', when: 'success', title: { $template: 'Published {post.title}' } }
    ] }]
    const code = generated(model, 'posts/[slug].vue')
    expect(code).toContain([
      // A one-record query may be empty: the handler checks it once, so the action gets a defined id.
      'const onPublishClick = async () => {',
      '  if (!post.value) return',
      '  if (await publish(post.value.id)) toast.add({ title: `Published ${post.value.title}` })',
      '}'
    ].join('\n'))
  })

  it('takes an Input\'s placeholder and type from its props, beside its field\'s attributes (input-props)', () => {
    const model = fixtureModel()
    const form = pageOf(model, 'posts-new').root.children!.find(node => node.type === 'Form')!
    const title = form.children!.find(node => node.props?.field === 'fld_title')!
    title.props = { ...title.props, placeholder: 'A catchy title', inputType: 'email' }
    expect(generated(model, 'posts/new.vue')).toContain('<UInput v-model="form.title" name="title" required maxlength="120" type="email" placeholder="A catchy title" class="w-full" />')
    title.props = { ...title.props, inputType: 'date' }
    expect(() => generated(model, 'posts/new.vue')).toThrow(/inputType must be one of/)
  })

  it('gives a SaaS field its browser input: email, url and tel for text types, a number with a step for money and a percent (field types S3)', () => {
    const model = fixtureModel()
    const title = model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.find(field => field.id === 'fld_title')!
    const inputOf = (type: typeof title.type) => {
      title.type = type
      return generated(model, 'posts/new.vue').match(/<UInput v-model[^>]*name="title"[^>]*>/)?.[0]
    }
    expect(inputOf('email')).toContain('type="email"')
    expect(inputOf('url')).toContain('type="url"')
    expect(inputOf('phone')).toContain('type="tel"')
    expect(inputOf('color')).not.toContain('type=')
    expect(inputOf('money')).toMatch(/v-model\.number="form\.title".*type="number" step="0\.01"/)
    expect(inputOf('percent')).toMatch(/type="number" step="any"/)
  })

  it('gives a select field a dropdown of its options, with the Input\'s placeholder (select inputs)', () => {
    const model = fixtureModel()
    const title = model.modules.blog!.entities.find(entity => entity.id === 'ent_post')!.fields.find(field => field.id === 'fld_title')!
    Object.assign(title, { type: 'select', options: ['draft', 'it\'s live'], min: undefined, max: undefined })
    const form = pageOf(model, 'posts-new').root.children!.find(node => node.type === 'Form')!
    const input = form.children!.find(node => node.props?.field === 'fld_title')!
    input.props = { ...input.props, placeholder: 'Pick one' }
    expect(generated(model, 'posts/new.vue')).toContain('<USelect v-model="form.title" name="title" required :items="[\'draft\', \'it\\\'s live\']" placeholder="Pick one" class="w-full" />')
    input.props = { ...input.props, multiline: true }
    expect(() => generated(model, 'posts/new.vue')).toThrow(/a select field's input is a dropdown: it has no multiline or inputType/)
  })

  it('lays a List out by its `layout` (list-layout)', () => {
    const list = (layout?: string): ModelNode => ({ id: 'n_x', type: 'List', props: { items: { $bind: 'quotes' }, as: 'q', ...(layout ? { layout } : {}) }, children: [{ id: 'n_y', type: 'Container' }] })
    expect(indexWith(list())).toContain('    <div class="flex flex-col self-stretch">\n      <div v-for="q in quotes" :key="q.id" class="flex flex-col self-stretch" />')
    expect(indexWith(list('row'))).toContain('    <div class="flex flex-row flex-wrap self-stretch">\n      <div v-for="q in quotes" :key="q.id" class="flex flex-col" />')
    expect(indexWith(list('grid'))).toContain('    <div class="grid self-stretch">\n      <div v-for="q in quotes" :key="q.id" class="flex flex-col" />')
  })

  it('renders Column, Grid, Image and Card (generator-missing-types)', () => {
    expect(indexWith({ id: 'n_x', type: 'Column', children: [text('n_y')] })).toContain('    <div class="flex flex-col self-stretch">\n      <p class="whitespace-pre-line">a</p>')
    expect(indexWith({ id: 'n_x', type: 'Grid', style: { 'cols': '1', 'md:cols': '3' }, children: [{ id: 'n_y', type: 'Container' }] }))
      .toContain('    <div class="grid self-stretch grid-cols-1 md:grid-cols-3">\n      <div class="flex flex-col" />')
    // A URL, not a module: bound, so Vue's asset transform never turns `/uploads/…` into a build-time import
    // (an upload the build can't find would fail it).
    expect(indexWith({ id: 'n_x', type: 'Image', props: { src: '/uploads/a.png', alt: 'A cat' } })).toContain('<img :src="\'/uploads/a.png\'" alt="A cat" class="block max-w-full">')
    expect(indexWith({ id: 'n_x', type: 'Image', props: { src: { $bind: 'preferences.avatar' } } })).toContain('<img :src="preferences.avatar" class="block max-w-full">')
    expect(indexWith({ id: 'n_x', type: 'Card', style: { gap: '2', p: '4' }, children: [text('n_y')] })).toContain([
      '    <div class="ring ring-default p-4 bg-default rounded-lg self-stretch overflow-hidden">',
      '      <div class="flex gap-2 flex-col">',
      '        <p class="whitespace-pre-line">a</p>',
      '      </div>',
      '    </div>'
    ].join('\n'))
  })

  it('fills a component\'s slot properties from an Instance\'s SlotFills (generator-missing-types: SlotFill)', () => {
    // The fixture's PostCard has an `actions` slot property on its n_actions Row.
    const model = fixtureModel()
    const card = model.modules.blog!.components.find(component => component.name === 'PostCard')!
    expect(card.properties.find(property => property.kind === 'slot')).toMatchObject({ name: 'actions', nodeId: 'n_actions' })
    const find = (node: ModelNode, type: string): ModelNode | undefined => node.type === type ? node : node.children?.map(child => find(child, type)).find(Boolean)
    card.root.children!.find(node => node.id === 'n_actions')!.children = [text('n_none', 'No actions')]
    const instance = find(pageOf(model, 'index').root, 'Instance')!
    instance.children = [{ id: 'n_fill', type: 'SlotFill', props: { slot: 'prop_actions' }, children: [text('n_more', 'More')] }]
    const component = generated(model, 'components/blog/PostCard.vue')
    expect(component).toContain('<slot name="actions">\n')
    expect(component).toContain('No actions</p>\n        </slot>')
    expect(component).not.toContain('actions?:')
    expect(generated(model, 'pages/index.vue')).toContain([
      '      <BlogPostCard v-for="post in posts.slice(0, shownList)" :key="post.id" :post="post">',
      '        <template #actions>',
      '          <p class="whitespace-pre-line">More</p>',
      '        </template>',
      '      </BlogPostCard>'
    ].join('\n'))
    instance.children = [text('n_stray')]
    expect(() => generated(model, 'pages/index.vue')).toThrow(/an Instance holds only SlotFills/)
    instance.children = [{ id: 'n_fill', type: 'SlotFill', props: { slot: 'prop_nope' } }]
    expect(() => generated(model, 'pages/index.vue')).toThrow(/component PostCard has no slot property prop_nope/)
  })

  it('fills layout slots from SlotFills at a page root through NuxtLayout (generator-missing-types: SlotFill)', () => {
    const model = fixtureModel()
    const index = pageOf(model, 'index')
    index.root.children!.push({ id: 'n_fill', type: 'SlotFill', props: { slot: 'footer' }, children: [text('n_note', 'Thanks for reading')] })
    const page = generated(model, 'pages/index.vue')
    expect(page).toContain('definePageMeta({ name: \'index\', layout: false, layoutValues: { title: \'Posts\' } })')
    expect(page).toMatch(/<template>\n {2}<NuxtLayout name="main">\n {4}<template #default>\n {6}<section /)
    expect(page).toContain('    <template #footer>\n      <p class="whitespace-pre-line">Thanks for reading</p>\n    </template>\n  </NuxtLayout>\n</template>')
    expect(page).not.toContain('Thanks for reading</p>\n    </section>')
    expect(() => indexWith({ id: 'n_x', type: 'Container', children: [{ id: 'n_y', type: 'SlotFill', props: { slot: 'footer' } }] }))
      .toThrow(/a SlotFill sits under an Instance or at the root of a page with a layout/)
    expect(() => indexWith({ id: 'n_x', type: 'SlotFill', props: { slot: 'aside' } })).toThrow(/layout main has no slot aside/)
  })
})
