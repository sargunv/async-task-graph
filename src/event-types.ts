import type { TaskId, UnknownWorkflowDefinition } from "./core-types.js"

/**
 * Emitted when a task begins execution. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskStartArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
}

/**
 * Emitted when a task finishes execution. Can be emitted multiple times, up to
 * once per task. If a task throws or is skipped, this event will not be emitted.
 */
export interface TaskFinishArgs<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W> = TaskId<W>,
> {
  id: Id
  result: W[`returns`][Id]
}

/**
 * Emitted when a task throws an error. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskThrowArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
  error: Error
}

/**
 * Emitted when a task is skipped because its dependencies were skipped or
 * threw errors. Can be emitted multiple times, up to once per task.
 */
export interface TaskSkipArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
  erroredDependencies: TaskId<W>[]
  skippedDependencies: TaskId<W>[]
}

/**
 * Emitted when a workflow begins execution. Can be emitted only once.
 */
export interface WorkflowStartArgs<W extends UnknownWorkflowDefinition> {
  context: W[`context`]
  taskOrder: TaskId<W>[]
}

/**
 * Emitted when a workflow finishes execution. Can be emitted only once.
 */
export interface WorkflowFinishArgs<W extends UnknownWorkflowDefinition> {
  tasksFinished: TaskId<W>[]
  tasksErrored: TaskId<W>[]
  tasksSkipped: TaskId<W>[]
}
