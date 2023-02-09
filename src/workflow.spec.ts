import { describe, expect, it, vi } from "vitest"

import { makeWorkflowBuilder } from "./index.js"

describe(`a linear workflow with no errors`, () => {
  it(`works`, async () => {
    const wfBuilder = makeWorkflowBuilder<{
      context: { hello: string }
      returns: {
        foo: string
        bar: number
        baz: void
      }
    }>()

    // we add tasks out of order to test topo-sort later

    wfBuilder.addTask({
      id: `bar`,
      dependencies: [`foo`],
      run({ getTaskResult }) {
        const str = getTaskResult(`foo`)
        return Promise.resolve(str.length)
      },
    })

    wfBuilder.addTask({
      id: `foo`,
      dependencies: [],
      run: ({ context }) => {
        return Promise.resolve(JSON.stringify(context))
      },
    })

    wfBuilder.addTask({
      id: `baz`,
      dependencies: [`bar`],
      run({ getTaskResult }) {
        getTaskResult(`bar`)
        return Promise.resolve()
      },
    })

    const workflow = wfBuilder.buildSerialWorkflow({ hello: `world` })

    expect(workflow.taskOrder).toEqual([`foo`, `bar`, `baz`])

    const { emitter, runWorkflow } = workflow

    const taskFinishFn = vi.fn()
    const taskSkipFn = vi.fn()
    const taskThrowFn = vi.fn()

    emitter.on(`taskFinish`, taskFinishFn)
    emitter.on(`taskSkip`, taskSkipFn)
    emitter.on(`taskThrow`, taskThrowFn)

    const result = await runWorkflow()

    expect(taskFinishFn).toHaveBeenCalledTimes(3)
    expect(taskFinishFn).toHaveBeenNthCalledWith(1, {
      id: `foo`,
      result: `{"hello":"world"}`,
    })
    expect(taskFinishFn).toHaveBeenNthCalledWith(2, {
      id: `bar`,
      result: 17,
    })
    expect(taskFinishFn).toHaveBeenNthCalledWith(3, {
      id: `baz`,
      result: undefined,
    })

    expect(taskSkipFn).not.toHaveBeenCalled()
    expect(taskThrowFn).not.toHaveBeenCalled()

    const { tasksFinished, tasksErrored, tasksSkipped } = result

    expect(tasksFinished.length).toEqual(3)
    expect(tasksFinished).toContain(`foo`)
    expect(tasksFinished).toContain(`bar`)
    expect(tasksFinished).toContain(`baz`)
    expect(tasksErrored).toEqual([])
    expect(tasksSkipped).toEqual([])
  })
})
