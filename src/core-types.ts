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

export interface Task<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W>,
  DepId extends TaskId<W>,
> {
  id: Id
  dependencies: DepId[]
  run: (_: TaskRunContext<W, DepId>) => Promise<W[`returns`][Id]>
}

export interface TaskRunContext<
  WD extends UnknownWorkflowDefinition,
  DepId extends TaskId<WD>,
> {
  getTaskResult: <D extends DepId>(id: D) => WD[`returns`][D]
  context: WD[`context`]
}
