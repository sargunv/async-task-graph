import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { typedEmitter } from "./event-emitter.js"
import type { WorkflowEvents } from "./event-types.js"
import { runTask } from "./run-task.js"
import { validateTaskGraph } from "./task-graph.js"
import { TaskTracker, taskTracker } from "./task-tracker.js"

export type WorkflowExecutor<W extends UnknownWorkflowDefinition> = (input: {
  tasks: Map<TaskId<W>, TaskFor<W>>
  taskOrder: TaskId<W>[]
  context: W[`context`]
  tracker: TaskTracker<W>
}) => Promise<void>

export const workflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const tasks = new Map<TaskId<W>, TaskFor<W>>()

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
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

        await workflowExecutor({ tasks, taskOrder, context, tracker })

        const summary = tracker.getSummary()
        emitter.emit(`workflowFinish`, summary)
        return summary
      }

      return { taskOrder, emitter, runWorkflow }
    },
  }
}

export const serialExecutor = async <W extends UnknownWorkflowDefinition>({
  taskOrder,
  tracker,
  context,
  tasks,
}: Parameters<WorkflowExecutor<W>>[0]) => {
  for (const id of taskOrder) await runTask(id, { tracker, context, tasks })
}

export const concurrentExecutor = async <W extends UnknownWorkflowDefinition>({
  taskOrder,
  tracker,
  context,
  tasks,
}: Parameters<WorkflowExecutor<W>>[0]) => {
  const promises = new Map<TaskId<W>, Promise<void>>()

  for (const id of taskOrder) {
    const promise = (async () => {
      await Promise.all(
        tasks.get(id)!.dependencies.map((dep) => promises.get(dep)),
      )
      return await runTask(id, { tracker, context, tasks })
    })()
    promises.set(id, promise)
  }

  await Promise.all(promises.values())
}
