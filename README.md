[![NPM](https://img.shields.io/npm/v/async-task-graph)](https://www.npmjs.com/package/async-task-graph)
[![CI](https://img.shields.io/github/actions/workflow/status/sargunv/async-task-graph/ci.yml)](https://github.com/sargunv/async-task-graph/actions/workflows/ci.yml)
[![Codecov](https://img.shields.io/codecov/c/github/sargunv/async-task-graph?token=IIYTXZ5MRM)](https://app.codecov.io/gh/sargunv/async-task-graph/)
[![License](https://img.shields.io/npm/l/async-task-graph)](https://github.com/sargunv/async-task-graph/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/async-task-graph)](https://github.com/sargunv/async-task-graph/blob/main/package.json)
[![ESM](https://img.shields.io/badge/module%20type-esm-brightgreen)](https://github.com/sargunv/async-task-graph/blob/main/package.json)

# async-task-graph

This library aids in writing and executing workflows asynchronous tasks with
interdependencies, with a focus on well-typed task definitions.

## Usage

```ts
import { workflowBuilder, concurrentExecutor } from "async-task-graph"

const builder = workflowBuilder<{
  context: { hello: string }
  returns: {
    foo: string
    bar: number
  }
}>()

builder.addTask({
  id: `foo`,
  dependencies: [],
  run: ({ context }) => {
    return Promise.resolve(JSON.stringify(context))
  },
})

builder.addTask({
  id: `bar`,
  dependencies: [`foo`],
  run: ({ getTaskResult }) => {
    const str = getTaskResult(`foo`)
    return Promise.resolve(str.length)
  },
})

const { emitter, runWorkflow } = builder.build(concurrentExecutor())

emitter.on(`taskFinish`, ({ id, result }) => {
  console.log(`${id} returned ${JSON.stringify(result)}`)
})

await runWorkflow({ hello: `world` })
```
