import { Graph } from "graph-data-structure"
import { z } from "zod"

import { typedEmitter } from "./events.js"

interface UnknownWorkflowDefinition {
  context: unknown
  returns: Record<string, z.ZodType<unknown>>
}

type UnknownTask<W extends UnknownWorkflowDefinition> = Task<
  W,
  TaskId<W>,
  ValidDeps<W, TaskId<W>>
>

export const makeWorkflowBuilder = <W extends UnknownWorkflowDefinition>(
  definition: W,
) => {
  const tasks: Partial<{
    [Id in TaskId<W>]: Task<W, Id, ValidDeps<W, Id>>
  }> = {}

  return {
    addTask: <Id extends TaskId<W>, DepId extends ValidDeps<W, Id>>(
      task: Task<W, Id, DepId>,
    ) => {
      if (tasks[task.id])
        throw new Error(`Task with id ${task.id} already registered`)

      if (task.dependencies.includes(task.id as any))
        throw new Error(`Task with id ${task.id} depends on itself`)

      tasks[task.id] = task
    },

    buildSerialWorkflow: (options: { selectedTasks?: TaskId<W>[] } = {}) => {
      // we already checked that IDs are correct and unique in addTask
      // so we only need check lengths for set equality
      if (
        Object.keys(tasks).length !== Object.keys(definition.returns).length
      ) {
        throw new Error(
          `Attempted to build workflow without registering all tasks in definition`,
        )
      }

      const taskList = Object.values(tasks) as UnknownTask<W>[]

      // sanity check dependencies in case TS was ignored
      for (const task of taskList) {
        for (const dep of task.dependencies) {
          if (!(dep in tasks)) {
            throw new Error(
              `Task ${task.id} has unregistered dependency ${dep as string}`,
            )
          }
        }
      }

      const graph = Graph()

      for (const task of taskList) {
        graph.addNode(task.id)
        for (const dep of task.dependencies) {
          // missing nodes are added implicitly so order doesn't matter
          graph.addEdge(task.id, dep)
        }
      }

      if (graph.hasCycle()) throw new Error(`Task graph has a cycle`)

      // done with validation, now we can return the execution tools

      const taskOrder: TaskId<W>[] = graph
        .topologicalSort(options.selectedTasks, true)
        .reverse()

      const taskMap = new Map<TaskId<W>, UnknownTask<W>>(Object.entries(tasks))

      const emitter = typedEmitter<{
        taskStart: TaskStartArgs<W>
        taskFinish: TaskFinishArgs<W>
        taskThrow: TaskThrowArgs<W>
        taskSkip: TaskSkipArgs<W>
      }>()

      const runWorkflow = async () => {
        const validators = new Map<TaskId<W>, z.ZodType<unknown>>(
          Object.entries(definition.returns),
        )
        const taskFinishEvents = new Map<TaskId<W>, TaskFinishArgs<W>>()
        const tasksSkipped = new Set<TaskId<W>>()
        const tasksErrored = new Set<TaskId<W>>()

        const getTaskResult = (id: TaskId<W>) => {
          if (taskFinishEvents.has(id)) {
            return taskFinishEvents.get(id)!.result
          } else {
            // type checker should prevent this
            throw new Error(
              `Requested result for task ${id} before it finished.`,
            )
          }
        }

        for (const id of taskOrder) {
          const erroredDependencies = []
          const skippedDependencies = []

          for (const dep of taskMap.get(id)!.dependencies) {
            if (tasksErrored.has(dep)) erroredDependencies.push(dep)
            else if (tasksSkipped.has(dep)) skippedDependencies.push(dep)
          }

          if (
            erroredDependencies.length > 0 ||
            skippedDependencies.length > 0
          ) {
            const event = {
              id,
              erroredDependencies,
              skippedDependencies,
            }
            tasksSkipped.add(id)
            emitter.emit(`taskSkip`, event)
          } else {
            emitter.emit(`taskStart`, { id })

            try {
              const result = await taskMap.get(id)!.run({
                getTaskResult,
                context: definition.context,
              })

              validators.get(id)!.parse(result)

              const event = { id, result }
              taskFinishEvents.set(id, event)
              emitter.emit(`taskFinish`, event)
            } catch (error) {
              tasksErrored.add(id)

              if (error instanceof Error) {
                emitter.emit(`taskThrow`, { id, error })
              } else {
                emitter.emit(`taskThrow`, {
                  id,
                  error: new Error(String(error)),
                })
              }
            }
          }
        }

        return {
          tasksFinished: [...taskFinishEvents.keys()],
          tasksErrored: [...tasksErrored],
          tasksSkipped: [...tasksSkipped],
        }
      }

      return {
        taskOrder: [...taskOrder], // copy to prevent mutation
        emitter,
        runWorkflow,
      }
    },
  }
}

export type TaskId<W extends UnknownWorkflowDefinition> = string &
  keyof W[`returns`]

/**
 * The valid dependencies for a task are all the other ids in the graph, except
 * for the task itself.
 */
export type ValidDeps<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W>,
> = Exclude<TaskId<W>, Id>

/**
 * A task is an async function that may depend on other tasks in the task graph.
 */
export interface Task<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W>,
  DepId extends ValidDeps<W, Id>,
> {
  id: Id
  dependencies: DepId[]
  run: (_: TaskRunContext<W, DepId>) => Promise<z.infer<W[`returns`][Id]>>
}

/**
 * The workflow-related context passed to a task when it is run. It provides a
 * way to get the results of other tasks in the graph.
 */
export interface TaskRunContext<
  WD extends UnknownWorkflowDefinition,
  DepId extends TaskId<WD>,
> {
  getTaskResult: <D extends DepId>(id: D) => z.infer<WD[`returns`][D]>
  context: WD[`context`]
}

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
  result: z.infer<W[`returns`][Id]>
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
