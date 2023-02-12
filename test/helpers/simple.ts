import { makeTaskFunction, type WorkflowDefinition } from "../../src/index.js"

export type SimpleWorkflow = WorkflowDefinition<{
  context: { hello: string }
  returns: {
    foo: string
    bar: number
    baz: void
  }
}>

export const newSimpleTask = makeTaskFunction<SimpleWorkflow>()

export const fooTask = newSimpleTask({
  id: `foo`,
  dependencies: [],
  run: ({ context }) => {
    return Promise.resolve(JSON.stringify(context))
  },
})

export const badFooTask = newSimpleTask({
  ...fooTask,
  run: () => {
    throw new Error(`foo error`)
  },
})

export const barTask = newSimpleTask({
  id: `bar`,
  dependencies: [`foo`],
  run: ({ getTaskResult }) => {
    const str = getTaskResult(`foo`)
    return Promise.resolve(str.length)
  },
})

export const badBarTask = newSimpleTask({
  ...barTask,
  run: () => {
    throw new Error(`bar error`)
  },
})

export const bazTask = newSimpleTask({
  id: `baz`,
  dependencies: [`bar`],
  run: ({ getTaskResult }) => {
    getTaskResult(`bar`)
    return Promise.resolve()
  },
})

export const badBazTask = newSimpleTask({
  ...bazTask,
  run: () => {
    throw new Error(`baz error`)
  },
})

export const ALL_TASKS = [fooTask, barTask, bazTask]

export type SimpleTaskId = (typeof ALL_TASKS)[number][`id`]
