import { describe, it, expect, vi } from "vitest"
import {
  buildSerialWorkflow,
  taskFnForWorkflow,
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

const newTask = taskFnForWorkflow<Test>()

describe("simple workflow: foo -> bar -> baz", () => {
  it("works", async () => {
    // Build the workflow
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

    const { emitter, runWorkflow } = buildSerialWorkflow<Test>(
      { foo, baz, bar },
      { hello: "world" },
    )

    // Set up mocks to listen for workflow events
    const workflowStartMock = vi.fn()
    const workflowFinishMock = vi.fn()
    const noCallMock = vi.fn()
    emitter.on("workflowStart", ({ taskOrder }) => workflowStartMock(taskOrder))
    emitter.on("workflowThrow", noCallMock)
    emitter.on("taskThrow", noCallMock)
    emitter.on("taskSkip", noCallMock)

    // Set up a promise so that we can wait for the workflow to complete
    const workflowCompletion = new Promise<void>((resolve) => {
      emitter.on("workflowFinish", (args) => {
        workflowFinishMock(args)
        return resolve()
      })
    })

    // Kick off the workflow and wait for it to finish running
    runWorkflow()
    await workflowCompletion

    const expectedTaskOrder = ["foo", "bar", "baz"]
    const expectedTaskResults = [
      { id: "foo", result: JSON.stringify({ hello: "world" }) },
      { id: "bar", result: 17 },
      { id: "baz", result: undefined }
    ]

    expect(workflowStartMock).toHaveBeenCalledWith(expectedTaskOrder)
    expect(workflowFinishMock).toHaveBeenCalledWith({
      completed: true,
      erroredTasks: [],
      skippedTasks: [],
      finishedTasks: expectedTaskResults,
    })
    expect(noCallMock).not.toHaveBeenCalled()
  })
})
