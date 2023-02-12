import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
  Workflow,
} from "./core-types.js"
import { typedEmitter } from "./event-emitter.js"
import type { WorkflowEvents } from "./event-types.js"
import { runTask } from "./run-task.js"
import { validateTaskGraph } from "./task-graph.js"
import { taskTracker } from "./task-tracker.js"

export const workflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const registry = new Map<TaskId<W>, TaskFor<W>>()

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
      if (registry.has(task.id))
        throw new Error(`Task with id ${task.id} registered twice`)
      if ((task.dependencies as string[]).includes(task.id))
        throw new Error(`Task with id ${task.id} depends on itself`)
      registry.set(task.id, task)
    },

    serialWorkflow: (
      options?: Parameters<typeof serialWorkflow>[1],
    ): Workflow<W> => {
      return serialWorkflow(registry, options)
    },
  }
}

const serialWorkflow = <W extends UnknownWorkflowDefinition>(
  tasks: Map<TaskId<W>, TaskFor<W>>,
  options: { selectedTasks?: TaskId<W>[] } = {},
) => {
  const { taskOrder } = validateTaskGraph(tasks, options.selectedTasks)
  Object.freeze(taskOrder)

  const emitter = typedEmitter<WorkflowEvents<W>>()

  const run = async (context: W[`context`]) => {
    Object.freeze(context)

    emitter.emit(`workflowStart`, { taskOrder, context })

    const tracker = taskTracker<W>(emitter)
    for (const id of taskOrder) await runTask(id, { tracker, context, tasks })

    const summary = tracker.getSummary()
    emitter.emit(`workflowFinish`, summary)
    return summary
  }

  return { taskOrder, emitter, run }
}
