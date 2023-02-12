import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
  Workflow,
} from "./core-types.js"
import { typedEmitter } from "./event-emitter.js"
import { WorkflowEvents } from "./event-types.js"
import { validateTaskGraph } from "./task-graph.js"
import { taskTracker } from "./task-tracker.js"

type TaskRegistry<W extends UnknownWorkflowDefinition> = {
  [Id in TaskId<W>]: Task<W, Id, TaskId<W>>
}

export const workflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const registry: Partial<TaskRegistry<W>> = {}

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
      if (registry[task.id])
        throw new Error(`Task with id ${task.id} registered twice`)

      if ((task.dependencies as string[]).includes(task.id))
        throw new Error(`Task with id ${task.id} depends on itself`)

      registry[task.id] = task
    },

    serialWorkflow: (
      options?: Parameters<typeof serialWorkflow>[1],
    ): Workflow<W> => {
      return serialWorkflow(
        new Map(Object.entries(registry as TaskRegistry<W>)),
        options,
      )
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

    for (const id of taskOrder) {
      const erroredDependencies = []
      const skippedDependencies = []

      for (const dep of tasks.get(id)!.dependencies) {
        if (tracker.isErrored(dep)) erroredDependencies.push(dep)
        if (tracker.isSkipped(dep)) skippedDependencies.push(dep)
      }

      if (erroredDependencies.length > 0 || skippedDependencies.length > 0) {
        tracker.skip(id, erroredDependencies, skippedDependencies)
      } else {
        tracker.start(id)

        try {
          const result = await tasks.get(id)!.run({
            getTaskResult: tracker.getResult,
            context,
          })
          tracker.finish(id, result)
        } catch (error) {
          if (error instanceof Error) tracker.error(id, error)
          else tracker.error(id, new Error(String(error)))
        }
      }
    }

    const summary = tracker.getSummary()
    emitter.emit(`workflowFinish`, summary)
    return summary
  }

  return {
    taskOrder,
    emitter,
    run,
  }
}
