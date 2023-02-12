import { describe, it } from "vitest"

import { makeTaskFunction, WorkflowDefinition } from "../../src/index.js"

type NumTaskId = `num-${number}`
type StrTaskId = `str-${number}`

type DynamicWorkflow = WorkflowDefinition<{
  context: number
  returns: Record<NumTaskId, number> & Record<StrTaskId, string>
}>

const newDynamicTask = makeTaskFunction<DynamicWorkflow>()

describe("a dynamic workflow definition", () => {
  it("allows correctly typed tasks", () => {
    newDynamicTask({
      id: "num-1",
      dependencies: [],
      run: ({ context }) => {
        return Promise.resolve(1 + context)
      },
    })

    newDynamicTask({
      id: "num-2",
      dependencies: [],
      run: ({ context }) => {
        return Promise.resolve(2 + context)
      },
    })

    const newStrTask = (index: number) => {
      return newDynamicTask({
        id: `str-${index}`,
        dependencies: [`num-${index}`],
        run: ({ getTaskResult }) => {
          const num = getTaskResult(`num-${index}`)
          return Promise.resolve(num.toString())
        },
      })
    }

    newStrTask(1)
    newStrTask(2)
  })

  it("disallows tasks with invalid id", () => {
    newDynamicTask({
      // @ts-expect-error
      id: "fake-1",
      dependencies: [],
      run: ({ context }) => {
        return Promise.resolve(1 + context)
      },
    })
  })

  it("disallows tasks with invalid dependency", () => {
    newDynamicTask({
      id: "num-1",
      // @ts-expect-error
      dependencies: ["fake-1"],
      run: ({ context }) => {
        return Promise.resolve(1 + context)
      },
    })
  })

  it("disallows tasks returning the incorrect type", () => {
    newDynamicTask({
      id: "str-1",
      dependencies: [],
      // @ts-expect-error
      run: () => Promise.resolve(1),
    })
  })

  it("disallows requesting the result of a non-dependency", () => {
    newDynamicTask({
      id: "str-1",
      dependencies: [],
      run: ({ getTaskResult }) => {
        // @ts-expect-error
        getTaskResult("num-1")
        return Promise.resolve("")
      },
    })
  })

  it("narrows the result type of a dependency", () => {
    newDynamicTask({
      id: "num-1",
      dependencies: ["str-1"],
      run: ({ getTaskResult }) => {
        const str: string = getTaskResult("str-1")
        return Promise.resolve(str.length)
      },
    })
  })
})
