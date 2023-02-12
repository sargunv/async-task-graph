import { Graph } from "graph-data-structure"

import type {
  Task,
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { EventSink, typedEmitter } from "./event-emitter.js"
import {
  TaskEvents,
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

    buildSerialWorkflow: (
      options?: Parameters<typeof newSerialWorkflow>[1],
    ) => {
      return newSerialWorkflow(
        new Map(Object.entries(registry as TaskRegistry<W>)),
        options,
      )
    },
  }
}

const validateTaskGraph = <W extends UnknownWorkflowDefinition>(
  tasks: Map<TaskId<W>, TaskFor<W>>,
  selectedTasks?: TaskId<W>[],
) => {
  const graph = Graph()

  for (const task of tasks.values()) {
    graph.addNode(task.id)
    for (const dep of task.dependencies) {
      // missing nodes are added implicitly so order doesn't matter
      graph.addEdge(task.id, dep)
    }
  }

  if (graph.hasCycle()) throw new Error(`Task graph has a cycle`)

  const taskOrder: TaskId<W>[] = graph
    .topologicalSort(selectedTasks, true)
    .reverse()

  // we do this after toposort so we only need to register the subgraph
  for (const id of taskOrder)
    if (!tasks.has(id)) throw new Error(`Task ${id} is not registered`)

  return { graph, taskOrder }
}

const newTaskTracker = <W extends UnknownWorkflowDefinition>(
  emitter: EventSink<TaskEvents<W>>,
) => {
  const tasksFinished = new Map<TaskId<W>, W[`returns`][TaskId<W>]>()
  const tasksErrored = new Set<TaskId<W>>()
  const tasksSkipped = new Set<TaskId<W>>()

  return {
    isFinished: (id: TaskId<W>) => tasksFinished.has(id),
    isErrored: (id: TaskId<W>) => tasksErrored.has(id),
    isSkipped: (id: TaskId<W>) => tasksSkipped.has(id),
    getResult: <Id extends TaskId<W>>(id: Id) => {
      if (tasksFinished.has(id)) {
        return tasksFinished.get(id) as W[`returns`][Id]
      } else {
        // type checker should prevent this
        throw new Error(`Requested result for task ${id} before it finished`)
      }
    },
    start: (id: TaskId<W>) => emitter.emit(`taskStart`, { id }),
    finish: <Id extends TaskId<W>>(id: Id, result: W[`returns`][Id]) => {
      emitter.emit(`taskFinish`, { id, result })
      return tasksFinished.set(id, result)
    },
    error: (id: TaskId<W>, error: Error) => {
      emitter.emit(`taskThrow`, { id, error })
      return tasksErrored.add(id)
    },
    skip: (
      id: TaskId<W>,
      erroredDependencies: TaskId<W>[],
      skippedDependencies: TaskId<W>[],
    ) => {
      emitter.emit(`taskSkip`, { id, erroredDependencies, skippedDependencies })
      return tasksSkipped.add(id)
    },
    getSummary: () => ({
      tasksFinished: [...tasksFinished.keys()],
      tasksErrored: [...tasksErrored],
      tasksSkipped: [...tasksSkipped],
    }),
  }
}

const newSerialWorkflow = <W extends UnknownWorkflowDefinition>(
  tasks: Map<TaskId<W>, TaskFor<W>>,
  options: { selectedTasks?: TaskId<W>[] } = {},
) => {
  const { taskOrder } = validateTaskGraph(tasks, options.selectedTasks)

  const emitter = typedEmitter<
    TaskEvents<W> & {
      workflowStart: WorkflowStartArgs<W>
      workflowFinish: WorkflowFinishArgs<W>
    }
  >()

  const runWorkflow = async (context: W[`context`]) => {
    emitter.emit(`workflowStart`, { taskOrder, context })

    const tracker = newTaskTracker<W>(emitter)

    for (const id of taskOrder) {
      const erroredDependencies = []
      const skippedDependencies = []

      for (const dep of tasks.get(id)!.dependencies) {
        if (tracker.isErrored(dep)) erroredDependencies.push(dep)
        else if (tracker.isSkipped(dep)) skippedDependencies.push(dep)
      }

      if (erroredDependencies.length > 0 || skippedDependencies.length > 0) {
        tracker.skip(id, erroredDependencies, skippedDependencies)
      } else {
        tracker.start(id)

        try {
          const result = await tasks.get(id)!.run({
            getTaskResult: tracker.getResult,
            context,
          })
          tracker.finish(id, result)
        } catch (error) {
          if (error instanceof Error) tracker.error(id, error)
          else tracker.error(id, new Error(String(error)))
        }
      }
    }

    const summary = tracker.getSummary()
    emitter.emit(`workflowFinish`, summary)
    return summary
  }

  return {
    taskOrder,
    emitter,
    runWorkflow,
  }
}
