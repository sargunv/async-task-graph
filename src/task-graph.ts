import type {
  TaskFor,
  TaskId,
  UnknownWorkflowDefinition,
} from "./core-types.js"
import { Digraph } from "./digraph.js"

export const validateTaskGraph = <W extends UnknownWorkflowDefinition>(
  tasks: Map<TaskId<W>, TaskFor<W>>,
  selectedTasks?: TaskId<W>[],
) => {
  const graph = new Digraph()

  for (const task of tasks.values()) {
    graph.addNode(task.id)
    for (const dep of task.dependencies) {
      // missing nodes are added implicitly so order doesn't matter
      graph.addEdge(task.id, dep)
    }
  }

  const taskOrder: TaskId<W>[] = graph.topologicalSort(selectedTasks)

  // we only validate the selected subgraph
  for (const id of taskOrder)
    if (!tasks.has(id)) throw new Error(`Task ${id} is not registered`)

  return { graph, taskOrder }
}
