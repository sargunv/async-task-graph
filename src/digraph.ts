export class Digraph<T extends string> {
  private adj: Map<T, Set<T>> = new Map()

  public addNode(node: T) {
    if (!this.adj.has(node)) this.adj.set(node, new Set())
  }

  public addEdge(from: T, to: T) {
    this.addNode(from)
    this.addNode(to)
    this.adj.get(from)!.add(to)
  }

  public hasCycle() {
    const visited = new Set<T>()
    const recStack = new Set<T>()

    const visit = (node: T): boolean => {
      if (recStack.has(node)) return true
      if (visited.has(node)) return false

      visited.add(node)
      recStack.add(node)

      for (const neighbor of this.adj.get(node)!)
        if (visit(neighbor)) return true

      recStack.delete(node)
      return false
    }

    for (const node of this.adj.keys()) if (visit(node)) return true

    return false
  }

  public topologicalSort(selectedNodes?: T[]): T[] {
    const visited = new Set<T>()
    const order: T[] = []

    const visit = (node: T) => {
      if (visited.has(node)) return

      visited.add(node)

      for (const neighbor of this.adj.get(node)!) visit(neighbor)

      order.push(node)
    }

    for (const node of selectedNodes ?? this.adj.keys()) visit(node)

    return order
  }
}
