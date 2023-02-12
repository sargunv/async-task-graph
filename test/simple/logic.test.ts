import { describe, expect, it, vi } from "vitest"

import { makeWorkflowBuilder } from "../../src/index.js"
import {
  ALL_TASKS,
  barTask,
  bazTask,
  fooTask,
  SimpleWorkflow,
} from "../helpers/simple.js"

describe(`a linear workflow with no errors`, () => {
  it(`topo-sorts the tasks before execution`, () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of ALL_TASKS) wfBuilder.addTask(task)
    const { taskOrder } = wfBuilder.buildSerialWorkflow()

    expect(taskOrder).toEqual([`foo`, `bar`, `baz`])
  })

  it(`emits the workflow lifecycle events for a completed workflow`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of ALL_TASKS) wfBuilder.addTask(task)
    const { emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

    const workflowStartFn = vi.fn()
    const workflowFinishFn = vi.fn()

    emitter.on(`workflowStart`, workflowStartFn)
    emitter.on(`workflowFinish`, workflowFinishFn)

    await runWorkflow({ hello: `world` })

    expect(workflowStartFn).toHaveBeenCalledWith({
      taskOrder: [`foo`, `bar`, `baz`],
      context: { hello: `world` },
    })

    expect(workflowFinishFn).toHaveBeenCalledWith({
      tasksFinished: [`foo`, `bar`, `baz`],
      tasksErrored: [],
      tasksSkipped: [],
    })
  })

  it(`emits the workflow lifecycle events for a failed workflow`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of [fooTask, bazTask]) wfBuilder.addTask(task)

    wfBuilder.addTask({
      ...barTask,
      run: () => {
        throw new Error(`bar error`)
      },
    })

    const { emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

    const workflowStartFn = vi.fn()
    const workflowFinishFn = vi.fn()

    emitter.on(`workflowStart`, workflowStartFn)
    emitter.on(`workflowFinish`, workflowFinishFn)

    await runWorkflow({ hello: `world` })

    expect(workflowStartFn).toHaveBeenCalledWith({
      taskOrder: [`foo`, `bar`, `baz`],
      context: { hello: `world` },
    })

    expect(workflowFinishFn).toHaveBeenCalledWith({
      tasksFinished: [`foo`],
      tasksErrored: [`bar`],
      tasksSkipped: [`baz`],
    })
  })

  it(`emits the task lifecycle events for completed tasks`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of ALL_TASKS) wfBuilder.addTask(task)
    const { emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

    const taskStartFn = vi.fn()
    const taskFinishFn = vi.fn()
    const taskThrowFn = vi.fn()
    const taskSkipFn = vi.fn()

    emitter.on(`taskStart`, taskStartFn)
    emitter.on(`taskFinish`, taskFinishFn)
    emitter.on(`taskThrow`, taskThrowFn)
    emitter.on(`taskSkip`, taskSkipFn)

    await runWorkflow({ hello: `world` })

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

    expect(taskThrowFn).not.toHaveBeenCalled()
    expect(taskSkipFn).not.toHaveBeenCalled()
  })

  it(`emits the task lifecycle events for failed tasks`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of [fooTask, bazTask]) wfBuilder.addTask(task)

    wfBuilder.addTask({
      ...barTask,
      run: () => {
        throw new Error(`bar error`)
      },
    })

    const { emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

    const taskStartFn = vi.fn()
    const taskFinishFn = vi.fn()
    const taskThrowFn = vi.fn()
    const taskSkipFn = vi.fn()

    emitter.on(`taskStart`, taskStartFn)
    emitter.on(`taskFinish`, taskFinishFn)
    emitter.on(`taskSkip`, taskSkipFn)
    emitter.on(`taskThrow`, taskThrowFn)

    await runWorkflow({ hello: `world` })

    expect(taskStartFn).toHaveBeenCalledTimes(2)
    expect(taskStartFn).toHaveBeenNthCalledWith(1, { id: `foo` })
    expect(taskStartFn).toHaveBeenNthCalledWith(2, { id: `bar` })

    expect(taskFinishFn).toHaveBeenCalledTimes(1)
    expect(taskFinishFn).toHaveBeenNthCalledWith(1, {
      id: `foo`,
      result: `{"hello":"world"}`,
    })

    expect(taskThrowFn).toHaveBeenCalledTimes(1)
    expect(taskThrowFn).toHaveBeenNthCalledWith(1, {
      id: `bar`,
      error: new Error(`bar error`),
    })

    expect(taskSkipFn).toHaveBeenCalledTimes(1)
    expect(taskSkipFn).toHaveBeenNthCalledWith(1, {
      id: `baz`,
      erroredDependencies: [`bar`],
      skippedDependencies: [],
    })
  })

  it(`returns the workflow execution details on completion`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of ALL_TASKS) wfBuilder.addTask(task)
    const workflow = wfBuilder.buildSerialWorkflow()
    const result = await workflow.runWorkflow({ hello: `world` })

    expect(result).toEqual({
      tasksFinished: [`foo`, `bar`, `baz`],
      tasksErrored: [],
      tasksSkipped: [],
    })
  })

  it(`returns the workflow execution details on failure`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of [fooTask, bazTask]) wfBuilder.addTask(task)

    wfBuilder.addTask({
      ...barTask,
      run: () => {
        throw new Error(`bar error`)
      },
    })

    const workflow = wfBuilder.buildSerialWorkflow()
    const result = await workflow.runWorkflow({ hello: `world` })

    expect(result).toEqual({
      tasksFinished: [`foo`],
      tasksErrored: [`bar`],
      tasksSkipped: [`baz`],
    })
  })

  it(`selects and executes a sub-graph, including dependencies`, async () => {
    const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()
    for (const task of ALL_TASKS) wfBuilder.addTask(task)
    const { emitter, runWorkflow } = wfBuilder.buildSerialWorkflow({
      selectedTasks: [`bar`],
    })

    const taskStartFn = vi.fn()
    const taskFinishFn = vi.fn()
    const taskThrowFn = vi.fn()
    const taskSkipFn = vi.fn()

    emitter.on(`taskStart`, taskStartFn)
    emitter.on(`taskFinish`, taskFinishFn)
    emitter.on(`taskThrow`, taskThrowFn)
    emitter.on(`taskSkip`, taskSkipFn)

    const result = await runWorkflow({ hello: `world` })

    expect(taskStartFn).toHaveBeenCalledTimes(2)
    expect(taskStartFn).toHaveBeenNthCalledWith(1, { id: `foo` })
    expect(taskStartFn).toHaveBeenNthCalledWith(2, { id: `bar` })

    expect(taskFinishFn).toHaveBeenCalledTimes(2)
    expect(taskFinishFn).toHaveBeenNthCalledWith(1, {
      id: `foo`,
      result: `{"hello":"world"}`,
    })
    expect(taskFinishFn).toHaveBeenNthCalledWith(2, {
      id: `bar`,
      result: 17,
    })

    expect(taskThrowFn).not.toHaveBeenCalled()
    expect(taskSkipFn).not.toHaveBeenCalled()

    expect(result).toEqual({
      tasksFinished: [`foo`, `bar`],
      tasksErrored: [],
      tasksSkipped: [],
    })
  })
})
