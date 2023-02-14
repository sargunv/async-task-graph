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
      [`no failed tasks`, ALL_TASKS, undefined],
      [`a failed task at the start`, [badFooTask, barTask, bazTask], undefined],
      [
        `a failed task in the middle`,
        [fooTask, badBarTask, bazTask],
        undefined,
      ],
      [`a failed task at the end`, [fooTask, barTask, badBazTask], undefined],
      [`the first task selected`, ALL_TASKS, [`foo`]],
      [`the second task selected`, ALL_TASKS, [`bar`]],
      [
        `the second task selected and a failed dependency`,
        [badFooTask, barTask, bazTask],
        [`bar`],
      ],
      [
        `a task that throws a non-error`,
        [fooTask, barTask, weirdBadBazTask],
        undefined,
      ],
    ])(`executes with %s`, async (_s, tasks, selectedTasks) => {
      const wfBuilder = workflowBuilder<SimpleWorkflow>()
      for (const task of tasks) wfBuilder.addTask(task)

      // eslint-disable-next-line security/detect-object-injection
      const { emitter, runWorkflow, taskOrder } = wfBuilder[executor]({
        selectedTasks: selectedTasks as SimpleTaskId[] | undefined,
      })

      expect(taskOrder).toMatchSnapshot(`taskOrder`)

      const events: { name: string; event: unknown }[] = []
      const eventFn = (name: string) => (event: unknown) => {
        events.push({ name, event })
      }

      emitter.on(`workflowStart`, eventFn(`workflowStart`))
      emitter.on(`taskStart`, eventFn(`taskStart`))
      emitter.on(`taskFinish`, eventFn(`taskFinish`))
      emitter.on(`taskThrow`, eventFn(`taskThrow`))
      emitter.on(`taskSkip`, eventFn(`taskSkip`))
      emitter.on(`workflowFinish`, eventFn(`workflowFinish`))

      const result = await runWorkflow({ hello: `world` })

      expect(events).toMatchSnapshot(`events`)

      expect(result).toMatchObject(
        events.find((e) => e.name === `workflowFinish`)!.event as object,
      )
    })
  },
)
