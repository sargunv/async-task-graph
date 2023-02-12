import { Task, TaskId, UnknownWorkflowDefinition } from "./core-types.js"

export { workflowBuilder } from "./workflow.js"

export type WorkflowDefinition<W extends UnknownWorkflowDefinition> = W

export const makeTaskFunction =
  <W extends UnknownWorkflowDefinition>() =>
  <Id extends TaskId<W>, DepId extends TaskId<W>>(task: Task<W, Id, DepId>) =>
    task
