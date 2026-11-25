import { describe, expect, it } from 'vitest'
import { tidyClasses } from '../../src/design/classes'

describe('tidyClasses', () => {
  it('orders classes the way Tailwind sorts them: display, then layout, spacing, size, borders, colours, type, effects', () => {
    expect(tidyClasses(['min-h-screen flex-col flex'])).toBe('flex min-h-screen flex-col')
    expect(tidyClasses(['pt-6 gap-2 border-default border-t flex-col self-stretch flex']))
      .toBe('flex flex-col gap-2 self-stretch border-t border-default pt-6')
    expect(tidyClasses(['whitespace-pre-line px-2 py-0.5 bg-elevated text-xs rounded-sm self-start']))
      .toBe('self-start rounded-sm bg-elevated px-2 py-0.5 text-xs whitespace-pre-line')
  })

  it('puts classes that are not utilities first and variant classes last, breakpoints after states', () => {
    expect(tidyClasses(['ring ring-default group/post-card transition-[padding,box-shadow] duration-200 motion-reduce:duration-0 bg-default rounded-lg']))
      .toBe('group/post-card rounded-lg bg-default ring ring-default transition-[padding,box-shadow] duration-200 motion-reduce:duration-0')
    expect(tidyClasses(['md:grid-cols-3 hover:underline grid-cols-1 grid'])).toBe('grid grid-cols-1 hover:underline md:grid-cols-3')
  })

  it('drops the default direction of a stack and repeated or empty entries', () => {
    expect(tidyClasses(['flex', '', 'gap-3 flex-row items-center', 'flex'])).toBe('flex items-center gap-3')
    // A breakpoint's direction is not a default: it overrides the base one.
    expect(tidyClasses(['flex flex-col md:flex-row'])).toBe('flex flex-col md:flex-row')
  })

  it('drops the direction of an element that is a grid at every width', () => {
    expect(tidyClasses(['flex-col self-stretch grid-cols-2 grid'])).toBe('grid grid-cols-2 self-stretch')
    // A grid that becomes a stack at a breakpoint keeps it.
    expect(tidyClasses(['grid flex-col md:flex'])).toBe('grid flex-col md:flex')
  })

  it('ranks position, grid tracks and split gaps (layout L5, L6)', () => {
    expect(tidyClasses(['z-10 top-0 absolute inset-x-0 order-first'])).toBe('absolute inset-x-0 top-0 z-10 order-first')
    expect(tidyClasses(['gap-y-2 gap-x-4 content-center grid-rows-2 row-span-2 grid'])).toBe('row-span-2 grid grid-rows-2 content-center gap-x-4 gap-y-2')
    expect(tidyClasses(['overflow-y-auto overflow-x-hidden relative'])).toBe('relative overflow-x-hidden overflow-y-auto')
    expect(tidyClasses(['grid-cols-[repeat(auto-fit,minmax(min(var(--col-min,16rem),100%),1fr))] grid [--col-min:calc(var(--spacing)*48)]']))
      .toBe('grid grid-cols-[repeat(auto-fit,minmax(min(var(--col-min,16rem),100%),1fr))] [--col-min:calc(var(--spacing)*48)]')
    expect(tidyClasses(['md:gap-2 *:[grid-area:1/1] hover:p-2 grid'])).toBe('grid *:[grid-area:1/1] hover:p-2 md:gap-2')
  })

  it('keeps the order of classes it does not know', () => {
    expect(tidyClasses(['my-own b-class a-class flex'])).toBe('my-own b-class a-class flex')
  })
})
