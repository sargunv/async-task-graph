import { describe, expect, it, vi } from "vitest"

import {
  makeWorkflowBuilder,
  type TaskFor,
  type WorkflowDefinition,
} from "../src/index.js"

type SimpleWorkflow = WorkflowDefinition<{
  context: { hello: string }
  returns: {
    foo: string
    bar: number
    baz: void
  }
}>

type SimpleTask = TaskFor<SimpleWorkflow>

const fooTask: SimpleTask = {
  id: `foo`,
  dependencies: [],
  run: ({ context }) => {
    return Promise.resolve(JSON.stringify(context))
  },
}

const barTask: SimpleTask = {
  id: `bar`,
  dependencies: [`foo`],
  run({ getTaskResult }) {
    const str = getTaskResult(`foo`)
    return Promise.resolve(str.length)
  },
}

const bazTask: SimpleTask = {
  id: `baz`,
  dependencies: [`bar`],
  run({ getTaskResult }) {
    getTaskResult(`bar`)
    return Promise.resolve()
  },
}

// we add tasks out of order to test topo-sort later
const ALL_TASKS = [barTask, fooTask, bazTask]

describe(`a linear workflow with no errors`, () => {
  it(`emits the correct events`, async () => {
    const wfBuilder = makeWorkflowBuilder<{
      context: { hello: string }
      returns: {
        foo: string
        bar: number
        baz: void
      }
    }>()

    for (const task of ALL_TASKS) wfBuilder.addTask(task)

    const workflow = wfBuilder.buildSerialWorkflow()

    expect(workflow.taskOrder).toEqual([`foo`, `bar`, `baz`])

    const { emitter, runWorkflow } = workflow

    const workflowStartFn = vi.fn()
    const taskStartFn = vi.fn()
    const taskFinishFn = vi.fn()
    const taskSkipFn = vi.fn()
    const taskThrowFn = vi.fn()
    const workflowFinishFn = vi.fn()

    emitter.on(`workflowStart`, workflowStartFn)
    emitter.on(`taskStart`, taskStartFn)
    emitter.on(`taskFinish`, taskFinishFn)
    emitter.on(`taskSkip`, taskSkipFn)
    emitter.on(`taskThrow`, taskThrowFn)
    emitter.on(`workflowFinish`, workflowFinishFn)

    const result = await runWorkflow({ hello: `world` })

    expect(workflowStartFn).toHaveBeenCalledWith({
      taskOrder: [`foo`, `bar`, `baz`],
      context: { hello: `world` },
    })

    expect(taskStartFn).toHaveBeenCalledTimes(3)
    expect(taskStartFn).toHaveBeenNthCalledWith(1, { id: `foo` })
    expect(taskStartFn).toHaveBeenNthCalledWith(2, { id: `bar` })
    expect(taskStartFn).toHaveBeenNthCalledWith(3, { id: `baz` })

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

    expect(workflowFinishFn).toHaveBeenCalledWith({
      tasksFinished: [`foo`, `bar`, `baz`],
      tasksErrored: [],
      tasksSkipped: [],
    })

    expect(result).toEqual({
      tasksFinished: [`foo`, `bar`, `baz`],
      tasksErrored: [],
      tasksSkipped: [],
    })
  })
})
