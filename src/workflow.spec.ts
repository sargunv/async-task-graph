import { emit } from "process"
import { describe, it, assert, expect, vi } from "vitest"
import {
  executeWorkflowSerially,
  taskFnForRegistry,
  WorkflowDefinition,
} from "./workflow"

type Test = WorkflowDefinition<{
  context: object
  tasks: {
    foo: string
    bar: number
    baz: void
  }
}>

const newTask = taskFnForRegistry<Test>()

describe("simple workflow", () => {
  it("works", () => {
    const foo = newTask({
      id: "foo",
      dependencies: [],
      run: async ({ context }) => JSON.stringify(context),
    })

    const bar = newTask({
      id: "bar",
      dependencies: ["foo"],
      async run({ getTaskResult }) {
        const str = getTaskResult("foo")
        return str.length
      },
    })

    const baz = newTask({
      id: "baz",
      dependencies: ["bar"],
      async run({ getTaskResult }) {
        getTaskResult("bar")
      },
    })

    const emitter = executeWorkflowSerially<Test>(
      { foo, baz, bar },
      { hello: "world" },
    )

    emitter.on("workflowStart", ({ taskOrder }) => {
      expect(taskOrder).toEqual(["foo", "bar", "baz"])
    })

    emitter.on(
      "workflowFinish",
      ({ completed, failedTasks, skippedTasks, finishedTasks }) => {
        expect(completed).toBe(true)
        expect(failedTasks).toEqual([])
        expect(skippedTasks).toEqual([])
        expect(finishedTasks.sort()).toEqual(["foo", "bar", "baz"].sort())
      },
    )

    const noCallMock = vi.fn()
    emitter.on("workflowError", noCallMock)
    emitter.on("taskFail", noCallMock)
    emitter.on("taskSkip", noCallMock)
    expect(noCallMock).not.toHaveBeenCalled()
  })
})
