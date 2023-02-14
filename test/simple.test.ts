import { describe, expect, it, vi } from "vitest"

import { workflowBuilder } from "../src/index.js"
import {
  ALL_TASKS,
  badBarTask,
  badBazTask,
  badFooTask,
  barTask,
  bazTask,
  fooTask,
  SimpleTaskId,
  SimpleWorkflow,
  undeclaredBazTask,
  weirdBadBazTask,
} from "./helpers/simple.js"

describe(`a workflow builder`, () => {
  it.each([
    { tasks: [fooTask, barTask, bazTask] },
    { tasks: [fooTask, bazTask, barTask] },
    { tasks: [barTask, fooTask, bazTask] },
    { tasks: [barTask, bazTask, fooTask] },
    { tasks: [bazTask, fooTask, barTask] },
    { tasks: [bazTask, barTask, fooTask] },
  ])(`topo-sorts the tasks before execution (input %#)`, ({ tasks }) => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    for (const task of tasks) wfBuilder.addTask(task)
    const { taskOrder } = wfBuilder.serialWorkflow()
    expect(taskOrder).toEqual([`foo`, `bar`, `baz`])
  })

  it(`throws when the graph has a cycle`, () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    wfBuilder.addTask({
      id: `foo`,
      dependencies: [`baz`],
      run: () => Promise.resolve(``),
    })
    wfBuilder.addTask(barTask)
    wfBuilder.addTask(bazTask)

    expect(() =>
      wfBuilder.concurrentWorkflow(),
    ).toThrowErrorMatchingInlineSnapshot(`"Task graph has a cycle"`)
  })

  it(`throws when a required task is not registered`, () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    wfBuilder.addTask(barTask)
    wfBuilder.addTask(bazTask)

    expect(() =>
      wfBuilder.concurrentWorkflow(),
    ).toThrowErrorMatchingInlineSnapshot(`"Task foo is not registered"`)
  })

  it(`throws when a task is registered twice`, () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    wfBuilder.addTask(fooTask)

    expect(() => wfBuilder.addTask(fooTask)).toThrowErrorMatchingInlineSnapshot(
      `"Task with id foo registered twice"`,
    )
  })

  it(`throws when a task depends on itself`, () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()

    expect(() =>
      wfBuilder.addTask({
        id: `foo`,
        dependencies: [`foo`],
        run: () => Promise.resolve(``),
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"Task with id foo depends on itself"`)
  })
})

describe(`a task with undeclared dependencies`, () => {
  it(`errors when the dependency was skipped`, async () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    for (const task of [badFooTask, barTask, undeclaredBazTask])
      wfBuilder.addTask(task)

    const { emitter, runWorkflow } = wfBuilder.serialWorkflow()

    const throwFn = vi.fn()
    emitter.on(`taskThrow`, throwFn)

    await expect(() =>
      runWorkflow({ hello: `world` }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Requested result for skipped task bar. Did you remember to declare it as a dependency?"`,
    )
  })

  it(`errors when the dependency errored`, async () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    for (const task of [fooTask, badBarTask, undeclaredBazTask])
      wfBuilder.addTask(task)

    const { emitter, runWorkflow } = wfBuilder.serialWorkflow()

    const throwFn = vi.fn()
    emitter.on(`taskThrow`, throwFn)

    await expect(() =>
      runWorkflow({ hello: `world` }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Requested result for errored task bar. Did you remember to declare it as a dependency?"`,
    )
  })

  it(`errors when the dependency never ran`, async () => {
    const wfBuilder = workflowBuilder<SimpleWorkflow>()
    for (const task of [undeclaredBazTask, fooTask, barTask])
      wfBuilder.addTask(task)

    const { emitter, runWorkflow } = wfBuilder.serialWorkflow()

    const throwFn = vi.fn()
    emitter.on(`taskThrow`, throwFn)

    await expect(() =>
      runWorkflow({ hello: `world` }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Requested result for task bar before it finished. Did you remember to declare it as a dependency?"`,
    )
  })
})

describe.each([`serial`, `concurrent`] as const)(
  `a linear %s workflow`,
  (type) => {
    const executor = `${type}Workflow` as const
    it.each([
      {
        description: `no failed tasks`,
        tasks: ALL_TASKS,
        context: { hello: `world` },
        taskOrder: [`foo`, `bar`, `baz`],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        taskStartEvents: [{ id: `foo` }, { id: `bar` }, { id: `baz` }],
        taskFinishEvents: [
          { id: `foo`, result: `{"hello":"world"}` },
          { id: `bar`, result: 17 },
          { id: `baz`, result: undefined },
        ],
        taskThrowEvents: [],
        taskSkipEvents: [],
        workflowFinishEvent: {
          tasksFinished: [`foo`, `bar`, `baz`],
          tasksErrored: [],
          tasksSkipped: [],
        },
      },
      {
        description: `a failed task at the start`,
        tasks: [badFooTask, barTask, bazTask],
        context: { hello: `world` },
        taskOrder: [`foo`, `bar`, `baz`],
        taskStartEvents: [{ id: `foo` }],
        taskFinishEvents: [],
        taskThrowEvents: [{ id: `foo`, error: new Error(`foo error`) }],
        taskSkipEvents: [
          {
            id: `bar`,
            erroredDependencies: [`foo`],
            skippedDependencies: [],
          },
          {
            id: `baz`,
            erroredDependencies: [],
            skippedDependencies: [`bar`],
          },
        ],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        workflowFinishEvent: {
          tasksFinished: [],
          tasksErrored: [`foo`],
          tasksSkipped: [`bar`, `baz`],
        },
      },
      {
        description: `a failed task in the middle`,
        tasks: [fooTask, badBarTask, bazTask],
        context: { hello: `world` },
        taskOrder: [`foo`, `bar`, `baz`],
        taskStartEvents: [{ id: `foo` }, { id: `bar` }],
        taskFinishEvents: [{ id: `foo`, result: `{"hello":"world"}` }],
        taskThrowEvents: [{ id: `bar`, error: new Error(`bar error`) }],
        taskSkipEvents: [
          {
            id: `baz`,
            erroredDependencies: [`bar`],
            skippedDependencies: [],
          },
        ],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        workflowFinishEvent: {
          tasksFinished: [`foo`],
          tasksErrored: [`bar`],
          tasksSkipped: [`baz`],
        },
      },
      {
        description: `a failed task at the end`,
        tasks: [fooTask, barTask, badBazTask],
        context: { hello: `world` },
        taskOrder: [`foo`, `bar`, `baz`],
        taskStartEvents: [{ id: `foo` }, { id: `bar` }, { id: `baz` }],
        taskFinishEvents: [
          { id: `foo`, result: `{"hello":"world"}` },
          { id: `bar`, result: 17 },
        ],
        taskThrowEvents: [{ id: `baz`, error: new Error(`baz error`) }],
        taskSkipEvents: [],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        workflowFinishEvent: {
          tasksFinished: [`foo`, `bar`],
          tasksErrored: [`baz`],
          tasksSkipped: [],
        },
      },
      {
        description: `the first task selected`,
        tasks: ALL_TASKS,
        context: { hello: `world` },
        selectedTasks: [`foo`],
        taskOrder: [`foo`],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        taskStartEvents: [{ id: `foo` }],
        taskFinishEvents: [{ id: `foo`, result: `{"hello":"world"}` }],
        taskThrowEvents: [],
        taskSkipEvents: [],
        workflowFinishEvent: {
          tasksFinished: [`foo`],
          tasksErrored: [],
          tasksSkipped: [],
        },
      },
      {
        description: `the second task selected`,
        tasks: ALL_TASKS,
        context: { hello: `world` },
        selectedTasks: [`bar`],
        taskOrder: [`foo`, `bar`],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        taskStartEvents: [{ id: `foo` }, { id: `bar` }],
        taskFinishEvents: [
          { id: `foo`, result: `{"hello":"world"}` },
          { id: `bar`, result: 17 },
        ],
        taskThrowEvents: [],
        taskSkipEvents: [],
        workflowFinishEvent: {
          tasksFinished: [`foo`, `bar`],
          tasksErrored: [],
          tasksSkipped: [],
        },
      },
      {
        description: `the second task selected and a failed task at the start`,
        tasks: [badFooTask, barTask, bazTask],
        context: { hello: `world` },
        selectedTasks: [`bar`],
        taskOrder: [`foo`, `bar`],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        taskStartEvents: [{ id: `foo` }],
        taskFinishEvents: [],
        taskThrowEvents: [{ id: `foo`, error: new Error(`foo error`) }],
        taskSkipEvents: [
          {
            id: `bar`,
            erroredDependencies: [`foo`],
            skippedDependencies: [],
          },
        ],
        workflowFinishEvent: {
          tasksFinished: [],
          tasksErrored: [`foo`],
          tasksSkipped: [`bar`],
        },
      },
      {
        description: `a task that throws a non-error`,
        tasks: [fooTask, barTask, weirdBadBazTask],
        context: { hello: `world` },
        taskOrder: [`foo`, `bar`, `baz`],
        taskStartEvents: [{ id: `foo` }, { id: `bar` }, { id: `baz` }],
        taskFinishEvents: [
          { id: `foo`, result: `{"hello":"world"}` },
          { id: `bar`, result: 17 },
        ],
        taskThrowEvents: [
          { id: `baz`, error: new Error(`unknown error: weird baz error`) },
        ],
        taskSkipEvents: [],
        workflowStartEvent: {
          context: { hello: `world` },
        },
        workflowFinishEvent: {
          tasksFinished: [`foo`, `bar`],
          tasksErrored: [`baz`],
          tasksSkipped: [],
        },
      },
    ])(
      `executes with $description`,
      async ({
        tasks,
        context,
        workflowStartEvent,
        taskStartEvents,
        taskFinishEvents,
        taskThrowEvents,
        taskSkipEvents,
        workflowFinishEvent,
        selectedTasks,
      }) => {
        const wfBuilder = workflowBuilder<SimpleWorkflow>()
        for (const task of tasks) wfBuilder.addTask(task)

        // eslint-disable-next-line security/detect-object-injection
        const { emitter, runWorkflow, taskOrder } = wfBuilder[executor]({
          selectedTasks: selectedTasks as SimpleTaskId[] | undefined,
        })

        expect(taskOrder).toEqual(taskOrder)

        const workflowStartFn = vi.fn()
        const taskStartFn = vi.fn()
        const taskFinishFn = vi.fn()
        const taskThrowFn = vi.fn()
        const taskSkipFn = vi.fn()
        const workflowFinishFn = vi.fn()

        emitter.on(`workflowStart`, workflowStartFn)
        emitter.on(`taskStart`, taskStartFn)
        emitter.on(`taskFinish`, taskFinishFn)
        emitter.on(`taskThrow`, taskThrowFn)
        emitter.on(`taskSkip`, taskSkipFn)
        emitter.on(`workflowFinish`, workflowFinishFn)

        const result = await runWorkflow(context)

        expect(workflowStartFn).toHaveBeenCalledOnce()
        expect(workflowStartFn).toHaveBeenCalledWith(workflowStartEvent)

        expect(taskStartFn).toHaveBeenCalledTimes(taskStartEvents.length)
        for (const [i, event] of taskStartEvents.entries())
          expect(taskStartFn).toHaveBeenNthCalledWith(i + 1, event)

        expect(taskFinishFn).toHaveBeenCalledTimes(taskFinishEvents.length)
        for (const [i, event] of taskFinishEvents.entries())
          expect(taskFinishFn).toHaveBeenNthCalledWith(i + 1, event)

        expect(taskThrowFn).toHaveBeenCalledTimes(taskThrowEvents.length)
        for (const [i, event] of taskThrowEvents.entries())
          expect(taskThrowFn).toHaveBeenNthCalledWith(i + 1, event)

        expect(taskSkipFn).toHaveBeenCalledTimes(taskSkipEvents.length)
        for (const [i, event] of taskSkipEvents.entries())
          expect(taskSkipFn).toHaveBeenNthCalledWith(i + 1, event)

        expect(workflowFinishFn).toHaveBeenCalledOnce()
        expect(workflowFinishFn).toHaveBeenCalledWith(workflowFinishEvent)
        expect(result).toEqual(workflowFinishEvent)
      },
    )
  },
)
