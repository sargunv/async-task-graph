import { Task, TaskId, UnknownWorkflowDefinition } from "./core-types.js"

export type {
  Task,
  TaskFor,
  TaskId,
  TaskResult,
  TaskRunContext,
  UnknownWorkflowDefinition,
  Workflow,
} from "./core-types.js"
export { WorkflowError } from "./errors.js"
export type { EventEmitter, EventSink, EventSource } from "./event-emitter.js"
export type {
  TaskEvents,
  TaskFinishArgs,
  TaskSkipArgs,
  TaskStartArgs,
  TaskThrowArgs,
  WorkflowEvents,
  WorkflowFinishArgs,
  WorkflowStartArgs,
} from "./event-types.js"
export {
  concurrentExecutor,
  serialExecutor,
  workflowBuilder,
  type WorkflowExecutor,
} from "./workflow.js"

// type inference helpers below

export type WorkflowDefinition<W extends UnknownWorkflowDefinition> = W

export const makeTaskFunction =
  <W extends UnknownWorkflowDefinition>() =>
  <Id extends TaskId<W>, DepId extends TaskId<W>>(task: Task<W, Id, DepId>) =>
    task
