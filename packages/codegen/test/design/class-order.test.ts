import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import { ESLint } from 'eslint'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tidyClasses } from '../../src/design/classes'
import { STYLE_TOKENS, styleClasses } from '../../src/design/tokens'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

/**
 * The classes of the generated SFCs are in Tailwind's official order (`tidyClasses`): the order
 * eslint-plugin-better-tailwindcss and prettier-plugin-tailwindcss enforce, so a project that adds either
 * gets no churn. The repo's own eslint and the editor's Tailwind entry point do the check.
 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const classOrderLinter = async () => new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: await createConfigForNuxt({ features: { standalone: true } }).append({
    files: ['**/*.vue'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    rules: { 'better-tailwindcss/enforce-consistent-class-order': ['error', { order: 'official' }] },
    settings: { 'better-tailwindcss': { entryPoint: 'packages/editor/src/main.css' } }
  }).toConfigs(),
  ruleFilter: ({ ruleId }) => ruleId === 'better-tailwindcss/enforce-consistent-class-order'
})

const problemsOf = async (files: Array<{ path: string, content: string }>) => {
  const eslint = await classOrderLinter()
  return (await Promise.all(files.map(entry => eslint.lintText(entry.content, { filePath: `${repoRoot}fixtures/codegen/blog/${entry.path}` }))))
    .flat()
    .flatMap(report => report.messages.map(message => `${file(report.filePath)}:${message.line} ${message.message}`))
}

describe('class order of the generated SFCs', () => {
  it('matches Tailwind\'s official order on the golden fixture', async () => {
    const result = loadModel(fixtureModelFiles())
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    expect(await problemsOf(generate(result.model).filter(file => file.path.endsWith('.vue')))).toEqual([])
  }, 60_000)

  it('matches it for every style token, in any order and with breakpoint and state variants', async () => {
    // One class per token value (the first two values), the whole set reversed and interleaved, with a
    // breakpoint and a hover copy of a slice: every pair of bildr classes meets in some list.
    const classes = STYLE_TOKENS.flatMap(token => token.values.slice(0, 2).map(value => styleClasses({ [token.key]: value }))).filter(Boolean)
    const lists = [
      [...classes].reverse(),
      classes.filter((_, index) => index % 2).concat(classes.filter((_, index) => !(index % 2))),
      [...classes.slice(0, 40).map(name => `md:${name}`), ...classes.slice(20, 60).map(name => `hover:${name}`), ...classes.slice(40).reverse()],
      [
        ...classes.slice(0, 30).map(name => `max-md:${name}`), ...classes.slice(10, 40).map(name => `group-hover/card:${name}`),
        ...classes.slice(30, 50).map(name => `active:${name}`), 'motion-reduce:duration-0', 'duration-200', ...classes.slice(50, 70).map(name => `lg:${name}`), 'group/card'
      ]
    ]
    // A class list per element: Tailwind sorts conflicting values of one property by name, so each list keeps one value per token.
    const perToken = (list: string[]) => [...new Map(list.map(name => [name.replace(/-[^-]*$/, ''), name])).values()]
    const content = `<template>\n${lists.map(list => `  <div class="${tidyClasses(perToken(list))}" />`).join('\n')}\n</template>\n`
    expect(await problemsOf([{ path: 'layers/blog/app/components/blog/Probe.vue', content }])).toEqual([])
  }, 60_000)
})

const file = (path: string) => path.slice(path.indexOf('layers/'))
