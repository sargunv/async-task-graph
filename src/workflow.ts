import { Graph } from "graph-data-structure"
import { z } from "zod"

import { typedEmitter } from "./events"

export function workflowDefinition<
  T extends { context: any; tasks: Record<string, any> } = {
    context: z.ZodAny
    tasks: Record<string, z.ZodAny>
  },
>(_def: T) {
  let tasks = {}

  return {
    addTask: <Id extends TaskId<T>, DepId extends ValidDeps<T, Id>>(
      t: Task<T, Id, DepId>,
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ;(tasks as any)[t.id] = t
    },
    executeSerially: (
      context: z.TypeOf<T["context"]>,
      options: { selectedTasks?: Array<keyof T["tasks"]> } = {},
    ) => {
      // TODO: Run Zod schema validation checks here, before executing the workflow
      return executeWorkflowSerially<T>(tasks as any, context, options as any)
    },
  }
}

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
    context: z.ZodAny
    tasks: Record<string, z.ZodAny>
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
  run: (_: TaskRunContext<W, DepId>) => Promise<z.TypeOf<W["tasks"][Id]>>
}

/**
 * The workflow-related context passed to a task when it is run. It provides a
 * way to get the results of other tasks in the graph.
 */
export interface TaskRunContext<
  W extends WorkflowDefinition,
  DepId extends TaskId<W>,
> {
  getTaskResult: <D extends DepId>(id: D) => z.TypeOf<W["tasks"][D]>
  context: z.TypeOf<W["context"]>
}

/**
 * Emitted when a workflow begins execution, right after the task graph is
 * topo-sorted.
 */
export interface WorkflowStartArgs<W extends WorkflowDefinition> {
  taskOrder: Array<keyof W["tasks"]>
}

/**
 * Emitted when a task begins execution. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskStartArgs<W extends WorkflowDefinition> {
  id: keyof W["tasks"]
}

/**
 * Emitted when a task finishes execution. Can be emitted multiple times, up to
 * once per task. If a task throws or is skipped, this event will not be emitted.
 */
export interface TaskFinishArgs<W extends WorkflowDefinition> {
  id: keyof W["tasks"]
  result: Array<keyof W["tasks"]>
}

/**
 * Emitted when a task throws an error. Can be emitted multiple times, up to
 * once per task.
 */
export interface TaskThrowArgs<W extends WorkflowDefinition> {
  id: keyof W["tasks"]
  error: Error
}

/**
 * Emitted when a task is skipped because its dependencies were skipped or
 * threw errors. Can be emitted multiple times, up to once per task.
 */
export interface TaskSkipArgs<W extends WorkflowDefinition> {
  id: keyof W["tasks"]
  erroredDependencies: Array<keyof W["tasks"]>
  skippedDependencies: Array<keyof W["tasks"]>
}

/**
 * Emitted when a workflow finishes execution. This event is emitted once.
 */
export type WorkflowFinishArgs<W extends WorkflowDefinition> = {
  finishedTasks: TaskFinishArgs<W>[]
} & (
  | {
      erroredTasks: TaskThrowArgs<W>[]
      skippedTasks: TaskSkipArgs<W>[]
      completed: false
    }
  | { erroredTasks: []; skippedTasks: []; completed: true }
)

/**
 * This function executes a task graph one task at a time, in topological order.
 * It returns an event emitter than can be used to observe task execution.
 */
const executeWorkflowSerially = <W extends WorkflowDefinition>(
  tasks: { [Id in TaskId<W>]: Task<W, Id, ValidDeps<W, Id>> },
  context: z.TypeOf<W["context"]>,
  options: { selectedTasks?: TaskId<W>[] } = {},
) => {
  const emitter = typedEmitter<{
    workflowStart: WorkflowStartArgs<W>
    taskStart: TaskStartArgs<W>
    taskFinish: TaskFinishArgs<W>
    taskThrow: TaskThrowArgs<W>
    taskSkip: TaskSkipArgs<W>
    workflowFinish: WorkflowFinishArgs<W>
    workflowThrow: { error: Error }
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
    const taskThrowEvents = new Map<TaskId<W>, TaskThrowArgs<W>>()

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
        const erroredDependencies = []
        const skippedDependencies = []

        for (const dep of taskMap.get(id)!.dependencies) {
          if (taskThrowEvents.has(dep)) {
            erroredDependencies.push(dep)
          } else if (taskSkipEvents.has(dep)) {
            skippedDependencies.push(dep)
          }
        }

        if (erroredDependencies.length > 0 || skippedDependencies.length > 0) {
          taskSkipEvents.set(id, {
            id,
            erroredDependencies,
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
              taskThrowEvents.set(id, { id, error })
            } else {
              taskThrowEvents.set(id, { id, error: new Error(String(error)) })
            }
            emitter.emit("taskThrow", taskThrowEvents.get(id)!)
          }
        }
      }
    }

    handleAllTasks()
      .then(() => {
        const completed =
          taskSkipEvents.size === 0 && taskThrowEvents.size === 0
        emitter.emit(
          "workflowFinish",
          // technically a bit redundant but the type checker appreciates it 🥺
          completed
            ? {
                completed,
                finishedTasks: [...taskFinishEvents.values()],
                erroredTasks: [],
                skippedTasks: [],
              }
            : {
                completed,
                finishedTasks: [...taskFinishEvents.values()],
                erroredTasks: [...taskThrowEvents.values()],
                skippedTasks: [...taskSkipEvents.values()],
              },
        )
        return
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          return emitter.emit("workflowThrow", { error })
        } else {
          return emitter.emit("workflowThrow", {
            error: new Error(String(error)),
          })
        }
      })
  })

  return emitter
}
