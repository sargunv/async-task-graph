import type { EventSource } from "./event-emitter.js"
import type { WorkflowEvents, WorkflowFinishArgs } from "./event-types.js"

export interface UnknownWorkflowDefinition {
  context: unknown
  returns: Record<string, unknown>
}

export type TaskFor<W extends UnknownWorkflowDefinition> = Task<
  W,
  TaskId<W>,
  TaskId<W>
>

export type TaskId<W extends UnknownWorkflowDefinition> = string &
  keyof W[`returns`]

export type TaskResult<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W> = TaskId<W>,
> = W[`returns`][Id]

export interface Task<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W>,
  DepId extends TaskId<W>,
> {
  id: Id
  dependencies: DepId[]
  run: (_: TaskRunContext<W, DepId>) => Promise<TaskResult<W, Id>>
}

export interface TaskRunContext<
  W extends UnknownWorkflowDefinition,
  DepId extends TaskId<W>,
> {
  getTaskResult: <D extends DepId>(id: D) => TaskResult<W, D>
  context: W[`context`]
}

export interface Workflow<W extends UnknownWorkflowDefinition> {
  taskOrder: TaskId<W>[]
  emitter: EventSource<WorkflowEvents<W>>
  runWorkflow: (context: W[`context`]) => Promise<WorkflowFinishArgs<W>>
}
