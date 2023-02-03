import { describe, it, expect, vi } from "vitest"
import {
  workflowDefinition
} from "./workflow"
import { z } from 'zod';

describe("zod workflow", () => {
  it("works?", () => {
    const workflow = workflowDefinition({
      context: z.object({
        hello: z.string()
      }),
      tasks: {
        foo: z.string(),
        bar: z.number(),
        baz: z.void()
      }
    })

    workflow.addTask({
      id: "foo",
      dependencies: [],
      run: async ({ context }) => JSON.stringify(context),
    })

    workflow.addTask({
      id: "bar",
      dependencies: ["foo"],
      async run({ getTaskResult }) {
        const str = getTaskResult("foo")
        return str.length
      },
    })

    workflow.addTask({
      id: "baz",
      dependencies: ["bar"],
      async run({ getTaskResult }) {
        getTaskResult("bar")
      },
    })

    const emitter = workflow.executeSerially({ hello: 'world' })

    emitter.on("workflowStart", ({ taskOrder }) => {
      expect(taskOrder).toEqual(["foo", "bar", "baz"])
    })

    emitter.on(
      "workflowFinish",
      ({ completed, erroredTasks, skippedTasks, finishedTasks }) => {
        expect(completed).toBe(true)
        expect(erroredTasks).toEqual([])
        expect(skippedTasks).toEqual([])
        // This seems incorrect ---v
        expect(finishedTasks.sort()).toEqual(["foo", "bar", "baz"].sort())
      },
    )

    const noCallMock = vi.fn()
    emitter.on("workflowThrow", noCallMock)
    emitter.on("taskThrow", noCallMock)
    emitter.on("taskSkip", noCallMock)
    expect(noCallMock).not.toHaveBeenCalled()
  })
})
