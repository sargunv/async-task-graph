import { Graph } from "graph-data-structure"

import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { typedEmitter } from "./event-emitter.js"
import {
  TaskFinishArgs,
  TaskSkipArgs,
  TaskStartArgs,
  TaskThrowArgs,
  WorkflowFinishArgs,
  WorkflowStartArgs,
} from "./event-types.js"

type TaskRegistry<W extends UnknownWorkflowDefinition> = {
  [Id in TaskId<W>]: Task<W, Id, TaskId<W>>
}

export const makeWorkflowBuilder = <W extends UnknownWorkflowDefinition>() => {
  const registry: Partial<TaskRegistry<W>> = {}

  return {
    addTask: <Id extends TaskId<W>, DepId extends TaskId<W>>(
      task: Task<W, Id, DepId>,
    ) => {
      if (registry[task.id])
        throw new Error(`Task with id ${task.id} registered twice`)

      if ((task.dependencies as string[]).includes(task.id))
        throw new Error(`Task with id ${task.id} depends on itself`)

      registry[task.id] = task
    },

    buildSerialWorkflow: buildSerialWorkflowFn(registry as TaskRegistry<W>),
  }
}

const buildTaskGraph = <W extends UnknownWorkflowDefinition>(
  tasks: Map<TaskId<W>, TaskFor<W>>,
) => {
  for (const task of tasks.values()) {
    for (const dep of task.dependencies) {
      if (!tasks.has(dep))
        throw new Error(`Task ${task.id} has unregistered dependency ${dep}`)
    }
  }

  const graph = Graph()

  for (const task of tasks.values()) {
    graph.addNode(task.id)
    for (const dep of task.dependencies) {
      // missing nodes are added implicitly so order doesn't matter
      graph.addEdge(task.id, dep)
    }
  }

  if (graph.hasCycle()) throw new Error(`Task graph has a cycle`)

  return graph
}

interface TaskEvents<W extends UnknownWorkflowDefinition> {
  taskStart: TaskStartArgs<W>
  taskFinish: TaskFinishArgs<W>
  taskThrow: TaskThrowArgs<W>
  taskSkip: TaskSkipArgs<W>
}

const buildSerialWorkflowFn =
  <W extends UnknownWorkflowDefinition>(taskRegistry: TaskRegistry<W>) =>
  (options: { selectedTasks?: TaskId<W>[] } = {}) => {
    const tasks = new Map(Object.entries(taskRegistry))
    const graph = buildTaskGraph(tasks)

    const taskOrder: TaskId<W>[] = graph
      .topologicalSort(options.selectedTasks, true)
      .reverse()

    const emitter = typedEmitter<
      TaskEvents<W> & {
        workflowStart: WorkflowStartArgs<W>
        workflowFinish: WorkflowFinishArgs<W>
      }
    >()

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
          throw new Error(`Requested result for task ${id} before it finished`)
        }
      }

      for (const id of taskOrder) {
        const erroredDependencies = []
        const skippedDependencies = []

        for (const dep of tasks.get(id)!.dependencies) {
          if (tasksErrored.has(dep)) erroredDependencies.push(dep)
          else if (tasksSkipped.has(dep)) skippedDependencies.push(dep)
        }

        if (erroredDependencies.length > 0 || skippedDependencies.length > 0) {
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
            const result = await tasks.get(id)!.run({
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
  }
