import pLimit from "p-limit"

import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { typedEmitter } from "./event-emitter.js"
import type { WorkflowEvents } from "./event-types.js"
import { processTask } from "./process-task.js"
import { validateTaskGraph } from "./task-graph.js"
import { taskTracker } from "./task-tracker.js"

export const workflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const tasks = new Map<TaskId<W>, TaskFor<W>>()

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
      Object.freeze(task)
      if (tasks.has(task.id))
        throw new Error(`Task with id ${task.id} registered twice`)
      if ((task.dependencies as string[]).includes(task.id))
        throw new Error(`Task with id ${task.id} depends on itself`)
      tasks.set(task.id, task)
    },

    build: (
      workflowExecutor: (
        input: Parameters<WorkflowExecutor<W>>[0],
      ) => Promise<void>,
      options: { selectedTasks?: TaskId<W>[] } = {},
    ) => {
      const { taskOrder } = validateTaskGraph(tasks, options.selectedTasks)
      Object.freeze(taskOrder)

      const emitter = typedEmitter<WorkflowEvents<W>>()

      const runWorkflow = async (context: W[`context`]) => {
        Object.freeze(context)

        emitter.emit(`workflowStart`, { context })
        const tracker = taskTracker<W>(emitter)

        await workflowExecutor({
          taskOrder,
          getTask: (id: TaskId<W>) => tasks.get(id),
          runTask: (id: TaskId<W>) =>
            processTask(id, { tracker, context, tasks }),
        })

        const summary = tracker.getSummary()
        emitter.emit(`workflowFinish`, summary)
        return summary
      }

      return { taskOrder, emitter, runWorkflow }
    },
  }
}

export type WorkflowExecutor<W extends UnknownWorkflowDefinition> = (input: {
  taskOrder: TaskId<W>[]
  getTask: (id: TaskId<W>) => TaskFor<W> | undefined
  runTask: (id: TaskId<W>) => Promise<void>
}) => Promise<void>

const serialExecutorImpl = async <W extends UnknownWorkflowDefinition>({
  taskOrder,
  runTask,
}: Parameters<WorkflowExecutor<W>>[0]) => {
  for (const id of taskOrder) await runTask(id)
}
export const serialExecutor = (_opts: {} = {}) => serialExecutorImpl

export const concurrentExecutor =
  (opts: { limit?: number } = {}) =>
  async <W extends UnknownWorkflowDefinition>({
    taskOrder,
    getTask,
    runTask,
  }: Parameters<WorkflowExecutor<W>>[0]) => {
    const promises = new Map<TaskId<W>, Promise<void>>()

    const depPromises = (id: TaskId<W>) =>
      getTask(id)!.dependencies.map((dep) => promises.get(dep))

    const waitForDepsThenRun = async (id: TaskId<W>) => {
      await Promise.all(depPromises(id))
      await runTask(id)
    }

    const limitFn = pLimit(opts.limit ?? Number.POSITIVE_INFINITY)

    for (const id of taskOrder) {
      const promise = limitFn(() => waitForDepsThenRun(id))
      promises.set(id, promise)
    }

    await Promise.all(promises.values())
  }

export const stagedExecutor =
  (opts: { limit?: number } = {}) =>
  async <W extends UnknownWorkflowDefinition>({
    taskOrder,
    getTask,
    runTask,
  }: Parameters<WorkflowExecutor<W>>[0]) => {
    const stages: TaskId<W>[][] = []
    const heights = new Map<TaskId<W>, number>()

    const markHeight = (id: TaskId<W>, height: number) => {
      heights.set(id, height)
      const stage = stages[height] || (stages[height] = [])
      stage.push(id)
    }

    for (const id of taskOrder) {
      const deps = getTask(id)!.dependencies
      const height =
        deps.length > 0
          ? Math.max(...deps.map((dep) => heights.get(dep)!)) + 1
          : 0
      markHeight(id, height)
    }

    for (const stage of stages) {
      const limitFn = pLimit(opts.limit ?? Number.POSITIVE_INFINITY)
      await Promise.all(stage.map((id) => limitFn(() => runTask(id))))
    }
  }
