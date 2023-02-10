import { Graph } from "graph-data-structure"

import { typedEmitter } from "./events.js"

interface UnknownWorkflowDefinition {
  context: unknown
  returns: Record<string, unknown>
}

export type WorkflowDefinition<W extends UnknownWorkflowDefinition> = W

export const makeTaskFunction =
  <W extends UnknownWorkflowDefinition>() =>
  <Id extends TaskId<W>, DepId extends Exclude<TaskId<W>, Id>>(
    task: Task<W, Id, DepId>,
  ) =>
    task

export const makeWorkflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const tasks: Partial<{
    [Id in TaskId<W>]: Task<W, Id, TaskId<W>>
  }> = {}

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
      if (tasks[task.id])
        throw new Error(`Task with id ${task.id} already registered`)

      if (task.dependencies.includes(task.id as any))
        throw new Error(`Task with id ${task.id} depends on itself`)

      tasks[task.id] = task
    },

    buildSerialWorkflow: (options: { selectedTasks?: TaskId<W>[] } = {}) => {
      // type cast: assume all tasks are registered
      const taskList = Object.values(tasks) as TaskFor<W>[]

      // sanity check dependencies in case TS was ignored
      for (const task of taskList) {
        for (const dep of task.dependencies) {
          if (!(dep in tasks)) {
            throw new Error(
              `Task ${task.id} has unregistered dependency ${dep}`,
            )
          }
        }
      }

      // construct a graph so we can detect cycles and topo-sort

      const graph = Graph()

      for (const task of taskList) {
        graph.addNode(task.id)
        for (const dep of task.dependencies) {
          // missing nodes are added implicitly so order doesn't matter
          graph.addEdge(task.id, dep)
        }
      }

      if (graph.hasCycle()) throw new Error(`Task graph has a cycle`)

      const taskOrder: TaskId<W>[] = graph
        .topologicalSort(options.selectedTasks, true)
        .reverse()

      // done with validation, now we can return the execution tools

      const taskMap = new Map(Object.entries(tasks))

      const emitter = typedEmitter<{
        workflowStart: WorkflowStartArgs<W>
        taskStart: TaskStartArgs<W>
        taskFinish: TaskFinishArgs<W>
        taskThrow: TaskThrowArgs<W>
        taskSkip: TaskSkipArgs<W>
        workflowFinish: WorkflowFinishArgs<W>
      }>()

      const runWorkflow = async (context: W[`context`]) => {
        emitter.emit(`workflowStart`, { taskOrder, context })

        const taskFinishEvents = new Map<TaskId<W>, TaskFinishArgs<W>>()
        const tasksSkipped = new Set<TaskId<W>>()
        const tasksErrored = new Set<TaskId<W>>()

        const getTaskResult = (id: TaskId<W>) => {
          if (taskFinishEvents.has(id)) {
            return taskFinishEvents.get(id)!.result
          } else {
            // type checker should prevent this
            throw new Error(
              `Requested result for task ${id} before it finished`,
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
                // @ts-expect-error
                getTaskResult,
                context,
              })

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

        const ret = {
          tasksFinished: [...taskFinishEvents.keys()],
          tasksErrored: [...tasksErrored],
          tasksSkipped: [...tasksSkipped],
        }

        emitter.emit(`workflowFinish`, ret)
        return ret
      }

      return {
        taskOrder,
        emitter,
        runWorkflow,
      }
    },
  }
}

type TaskFor<W extends UnknownWorkflowDefinition> = Task<
  W,
  TaskId<W>,
  TaskId<W>
>

type TaskId<W extends UnknownWorkflowDefinition> = string & keyof W[`returns`]

// TS says this needs to be exported because it's named in the type of makeTaskFunction
export interface Task<
  W extends UnknownWorkflowDefinition,
  Id extends TaskId<W>,
  DepId extends TaskId<W>,
> {
  id: Id
  dependencies: DepId[]
  run: (_: TaskRunContext<W, DepId>) => Promise<W[`returns`][Id]>
}

/**
 * The workflow-related context passed to a task when it is run. It provides a
 * way to get the results of other tasks in the graph.
 */
interface TaskRunContext<
  WD extends UnknownWorkflowDefinition,
  DepId extends TaskId<WD>,
> {
  getTaskResult: <D extends DepId>(id: D) => WD[`returns`][D]
  context: WD[`context`]
}

/**
 * Emitted when a task begins execution. Can be emitted multiple times, up to
 * once per task.
 */
interface TaskStartArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
}

/**
 * Emitted when a task finishes execution. Can be emitted multiple times, up to
 * once per task. If a task throws or is skipped, this event will not be emitted.
 */
interface TaskFinishArgs<
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
interface TaskThrowArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
  error: Error
}

/**
 * Emitted when a task is skipped because its dependencies were skipped or
 * threw errors. Can be emitted multiple times, up to once per task.
 */
interface TaskSkipArgs<W extends UnknownWorkflowDefinition> {
  id: TaskId<W>
  erroredDependencies: TaskId<W>[]
  skippedDependencies: TaskId<W>[]
}

/**
 * Emitted when a workflow begins execution. Can be emitted only once.
 */
interface WorkflowStartArgs<W extends UnknownWorkflowDefinition> {
  context: W[`context`]
  taskOrder: TaskId<W>[]
}

/**
 * Emitted when a workflow finishes execution. Can be emitted only once.
 */
interface WorkflowFinishArgs<W extends UnknownWorkflowDefinition> {
  tasksFinished: TaskId<W>[]
  tasksErrored: TaskId<W>[]
  tasksSkipped: TaskId<W>[]
}
