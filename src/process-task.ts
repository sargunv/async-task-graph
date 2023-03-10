import type {
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { WorkflowError } from "./errors.js"
import { taskTracker } from "./task-tracker.js"

export const processTask = async <W extends UnknownWorkflowDefinition>(
  id: TaskId<W>,
  state: {
    tracker: ReturnType<typeof taskTracker<W>>
    context: W[`context`]
    tasks: Map<TaskId<W>, TaskFor<W>>
  },
) => {
  const { tracker, context, tasks } = state

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
      if (error instanceof WorkflowError) throw error
      tracker.error(id, error)
    }
  }
}
