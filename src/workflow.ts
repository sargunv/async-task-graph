import { Graph } from "graph-data-structure"

import { typedEmitter } from "./events"

/**
 * This is a helper type to create a strongly typed workflow definition.
 *
 * You define a workflow as a set of tasks with return types, and provide
 * a type for a context object that is passed to each task when it is run.
 *
 * I was hoping to infer or decentralize the return type definitions, but
 * that just lead to circular type definitions as TypeScript is not able to
 * partially fulfill a generic type to resolve the circular dependency.
 */
export type WorkflowDefinition<
  T extends { context: unknown; tasks: Record<string, unknown> } = {
    context: unknown
    tasks: Record<string, unknown>
  },
> = T

export type TaskId<W extends WorkflowDefinition> = string & keyof W["tasks"]

/**
 * The valid dependencies for a task are all the other ids in the graph, except
 * for the task itself.
 */
export type ValidDeps<
  W extends WorkflowDefinition,
  Id extends TaskId<W>,
> = Exclude<TaskId<W>, Id>

/**
 * A task is an async function that may depend on other tasks in the task graph.
 */
export interface Task<
  W extends WorkflowDefinition,
  Id extends TaskId<W>,
  DepId extends ValidDeps<W, Id>,
> {
  id: Id
  dependencies: DepId[]
  run: (_: TaskRunContext<W, DepId>) => Promise<W["tasks"][Id]>
}

/**
 * The workflow-related context passed to a task when it is run. It provides a
 * way to get the results of other tasks in the graph.
 */
export interface TaskRunContext<
  W extends WorkflowDefinition,
  DepId extends TaskId<W>,
> {
  getTaskResult: <D extends DepId>(id: D) => W["tasks"][D]
  context: W["context"]
}

/**
 * Helper function to return a strongly typed function that helps in writing
 * correct tasks for a given task graph, with strong inferred types.
 */
export const taskFnForRegistry =
  <W extends WorkflowDefinition>() =>
  <Id extends TaskId<W>, DepId extends ValidDeps<W, Id>>(
    t: Task<W, Id, DepId>,
  ) =>
    t

/**
 * Emitted when a workflow begins execution, right after the task graph is
 * topo-sorted.
 */
export interface WorkflowStartArgs<W extends WorkflowDefinition> {
  taskOrder: TaskId<W>[]
}

/**
 * Emitted when a task begins execution. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskStartArgs<W extends WorkflowDefinition> {
  id: TaskId<W>
}

/**
 * Emitted when a task finishes execution. Can be emitted multiple times, up to
 * once per task. If a task fails or is skipped, this event will not be emitted.
 */
export interface TaskFinishArgs<
  W extends WorkflowDefinition,
  Id extends TaskId<W> = TaskId<W>,
> {
  id: Id
  result: W["tasks"][Id]
}

/**
 * Emitted when a task fails execution. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskFailArgs<W extends WorkflowDefinition> {
  id: TaskId<W>
  error: Error
}

/**
 * Emitted when a task is skipped because its dependencies were skipped or
 * failed execution. Can be emitted multiple times, up to once per task.
 */
export interface TaskSkipArgs<W extends WorkflowDefinition> {
  id: TaskId<W>
  failedDependencies: TaskId<W>[]
  skippedDependencies: TaskId<W>[]
}

/**
 * Emitted when a workflow finishes execution. This event is emitted once.
 */
export type WorkflowFinishArgs<W extends WorkflowDefinition> = {
  finishedTasks: TaskFinishArgs<W>[]
} & (
  | {
      failedTasks: TaskFailArgs<W>[]
      skippedTasks: TaskSkipArgs<W>[]
      completed: false
    }
  | { failedTasks: []; skippedTasks: []; completed: true }
)

/**
 * This function executes a task graph one task at a time, in topological order.
 * It returns an event emitter than can be used to observe task execution.
 */
export const executeWorkflowSerially = <W extends WorkflowDefinition>(
  tasks: { [Id in TaskId<W>]: Task<W, Id, ValidDeps<W, Id>> },
  context: W["context"],
  options: { selectedTasks?: TaskId<W>[] } = {},
) => {
  const emitter = typedEmitter<{
    workflowStart: WorkflowStartArgs<W>
    taskStart: TaskStartArgs<W>
    taskFinish: TaskFinishArgs<W>
    taskFail: TaskFailArgs<W>
    taskSkip: TaskSkipArgs<W>
    workflowFinish: WorkflowFinishArgs<W>
    workflowError: { error: unknown }
  }>()

  const graph = Graph()

  for (const task of Object.values(tasks) as Task<
    W,
    TaskId<W>,
    ValidDeps<W, TaskId<W>>
  >[]) {
    // sanity check in case TS was ignored
    if (!(task.id in tasks)) {
      throw new Error(`Task ${task.id} is not in the task registry`)
    }

    graph.addNode(task.id)
    for (const dep of task.dependencies) {
      // sanity check in case TS was ignored
      if (!(dep in tasks)) {
        throw new Error(
          `Task ${task.id} has unknown dependency ${dep as string}`,
        )
      }

      // we might add edges before nodes, but this library will add nodes
      // implicitly when adding edges
      graph.addEdge(dep, task.id)
    }
  }

  if (graph.hasCycle()) {
    throw new Error("Task graph has a cycle")
  }

  const taskOrder = graph.topologicalSort(
    options.selectedTasks,
    true,
  ) as TaskId<W>[]

  const taskMap = new Map<
    TaskId<W>,
    Task<W, TaskId<W>, ValidDeps<W, TaskId<W>>>
  >(Object.entries(tasks))

  // we need to return the emitter before we start emitting events, so we
  // defer processing to the next tick
  process.nextTick(() => {
    emitter.emit("workflowStart", { taskOrder })

    const taskFinishEvents = new Map<TaskId<W>, TaskFinishArgs<W>>()
    const taskSkipEvents = new Map<TaskId<W>, TaskSkipArgs<W>>()
    const taskFailEvents = new Map<TaskId<W>, TaskFailArgs<W>>()

    const getTaskResult = (id: TaskId<W>) => {
      if (taskFinishEvents.has(id)) {
        return taskFinishEvents.get(id)!.result
      } else {
        // type checker should prevent this
        throw new Error(`Requested result for task ${id} before it finished.`)
      }
    }

    const handleAllTasks = async () => {
      for (const id of taskOrder) {
        const failedDependencies = []
        const skippedDependencies = []

        for (const dep of taskMap.get(id)!.dependencies) {
          if (taskFailEvents.has(dep)) {
            failedDependencies.push(dep)
          } else if (taskSkipEvents.has(dep)) {
            skippedDependencies.push(dep)
          }
        }

        if (failedDependencies.length > 0 || skippedDependencies.length > 0) {
          taskSkipEvents.set(id, {
            id,
            failedDependencies,
            skippedDependencies,
          })
          emitter.emit("taskSkip", taskSkipEvents.get(id)!)
        } else {
          emitter.emit("taskStart", { id })

          try {
            const result = await taskMap.get(id)!.run({
              // @ts-ignore because we've created a super strict type for a good DX when writing tasks
              getTaskResult,
              context,
            })
            taskFinishEvents.set(id, { id, result })
            emitter.emit("taskFinish", taskFinishEvents.get(id)!)
          } catch (error) {
            if (error instanceof Error) {
              taskFailEvents.set(id, { id, error })
            } else {
              taskFailEvents.set(id, { id, error: new Error(String(error)) })
            }
            emitter.emit("taskFail", taskFailEvents.get(id)!)
          }
        }
      }
    }

    handleAllTasks()
      .then(() => {
        const completed = taskSkipEvents.size === 0 && taskFailEvents.size === 0
        emitter.emit(
          "workflowFinish",
          // technically a bit redundant but the type checker appreciates it 🥺
          completed
            ? {
                completed,
                finishedTasks: [...taskFinishEvents.values()],
                failedTasks: [],
                skippedTasks: [],
              }
            : {
                completed,
                finishedTasks: [...taskFinishEvents.values()],
                failedTasks: [...taskFailEvents.values()],
                skippedTasks: [...taskSkipEvents.values()],
              },
        )
        return
      })
      .catch((error: unknown) => emitter.emit("workflowError", { error }))
  })

  return emitter
}
