import type {
  TaskId,
  TaskResult,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { EventSink } from "./event-emitter.js"
import { TaskEvents } from "./event-types.js"

export const taskTracker = <W extends UnknownWorkflowDefinition>(
  emitter: EventSink<TaskEvents<W>>,
) => {
  const tasksFinished = new Map<TaskId<W>, TaskResult<W>>()
  const tasksErrored = new Set<TaskId<W>>()
  const tasksSkipped = new Set<TaskId<W>>()

  return {
    isFinished: (id: TaskId<W>) => tasksFinished.has(id),
    isErrored: (id: TaskId<W>) => tasksErrored.has(id),
    isSkipped: (id: TaskId<W>) => tasksSkipped.has(id),
    getResult: <Id extends TaskId<W>>(id: Id) => {
      if (tasksErrored.has(id))
        throw new Error(`Requested result for errored task ${id}`)
      if (tasksSkipped.has(id))
        throw new Error(`Requested result for skipped task ${id}`)
      if (!tasksFinished.has(id))
        throw new Error(`Requested result for task ${id} before it finished`)
      return tasksFinished.get(id) as TaskResult<W, Id>
    },
    start: (id: TaskId<W>) => emitter.emit(`taskStart`, { id }),
    finish: <Id extends TaskId<W>>(id: Id, result: TaskResult<W, Id>) => {
      emitter.emit(`taskFinish`, { id, result })
      return tasksFinished.set(id, result)
    },
    error: (id: TaskId<W>, error: unknown) => {
      emitter.emit(`taskThrow`, {
        id,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return tasksErrored.add(id)
    },
    skip: (
      id: TaskId<W>,
      erroredDependencies: TaskId<W>[],
      skippedDependencies: TaskId<W>[],
    ) => {
      emitter.emit(`taskSkip`, { id, erroredDependencies, skippedDependencies })
      return tasksSkipped.add(id)
    },
    getSummary: () => ({
      tasksFinished: [...tasksFinished.keys()],
      tasksErrored: [...tasksErrored],
      tasksSkipped: [...tasksSkipped],
    }),
  }
}
