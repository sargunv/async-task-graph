import { assertType, describe, it } from "vitest"

import { ALL_TASKS, newSimpleTask } from "./helpers.js"

describe(`a simple workflow definition`, () => {
  it(`allows correctly typed tasks`, () => {
    newSimpleTask({
      id: `foo`,
      dependencies: [],
      run: ({ context }) => {
        return Promise.resolve(JSON.stringify(context))
      },
    })

    newSimpleTask({
      id: `bar`,
      dependencies: [`foo`],
      run: ({ getTaskResult }) => {
        const str = getTaskResult(`foo`)
        return Promise.resolve(str.length)
      },
    })

    newSimpleTask({
      id: `baz`,
      dependencies: [`bar`],
      run: ({ getTaskResult }) => {
        getTaskResult(`bar`)
        return Promise.resolve()
      },
    })
  })

  it(`disallows tasks with invalid id`, () => {
    newSimpleTask({
      // @ts-expect-error
      id: `fake`,
      dependencies: [],
      run: () => Promise.resolve(),
    })
  })

  it(`disallows tasks with invalid dependency`, () => {
    newSimpleTask({
      id: `foo`,
      // @ts-expect-error
      dependencies: [`fake`],
      run: () => Promise.resolve(``),
    })
  })

  it(`disallows tasks with self dependency`, () => {
    newSimpleTask({
      id: `foo`,
      // @ts-expect-error
      dependencies: [`foo`],
      run: () => Promise.resolve(``),
    })
  })

  it(`disallows tasks returning the incorrect type`, () => {
    newSimpleTask({
      id: `foo`,
      dependencies: [],
      // @ts-expect-error
      run: () => Promise.resolve(1),
    })
  })

  it(`disallows requesting the result of a non-dependency`, () => {
    newSimpleTask({
      id: `foo`,
      dependencies: [],
      run: ({ getTaskResult }) => {
        // @ts-expect-error
        getTaskResult(`bar`)
        return Promise.resolve(``)
      },
    })
  })

  it(`narrows the result type of a dependency`, () => {
    newSimpleTask({
      id: `bar`,
      dependencies: [`foo`],
      run: ({ getTaskResult }) => {
        const str: string = getTaskResult(`foo`)
        return Promise.resolve(str.length)
      },
    })
  })

  // it(`narrows the result type in task finish events`, () => {
  //   const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
  //   for (const task of [fooTask, barTask, bazTask]) wfBuilder.addTask(task)
  //   const { emitter } = wfBuilder.buildSerialWorkflow()
  //   emitter.on(`taskFinish`, (args) => {
  //     if (args.id === `foo`) {
  //       const _str: string = args.result
  //     } else if (args.id === `bar`) {
  //       const _num: number = args.result
  //     } else if (args.id === `baz`) {
  //       const _void: void = args.result
  //     }
  //   })
  // })

  it(`allows easily inferring the union type of all task ids`, () => {
    assertType<`foo` | `bar` | `baz`>(ALL_TASKS[`hello`.length % 3].id)
  })
})
