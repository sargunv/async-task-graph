import { Graph } from "graph-data-structure"

import type {
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"

export const validateTaskGraph = <W extends UnknownWorkflowDefinition>(
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

  // we validate after toposort so we only need to register the subgraph
  for (const id of taskOrder)
    if (!tasks.has(id)) throw new Error(`Task ${id} is not registered`)

  return { graph, taskOrder }
}
