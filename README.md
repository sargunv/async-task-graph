[![npm badge](https://img.shields.io/npm/v/async-task-graph)](https://www.npmjs.com/package/async-task-graph)

# async-task-graph

Library to aid in orchestrating asynchronous tasks with interdependencies, with
a focus on strongly typed task definitions.

## Usage

<!-- !test program yarn dlx -q ts-node -T -->

<!-- !test in usage -->

```ts
import { makeWorkflowBuilder, WorkflowDefinition } from "async-task-graph"

type SimpleWorkflow = WorkflowDefinition<{
  context: { hello: string }
  returns: {
    foo: string
    bar: number
    baz: void
  }
}>

const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()

wfBuilder.addTask({
  id: `foo`,
  dependencies: [],
  run: ({ context }) => {
    return Promise.resolve(JSON.stringify(context))
  },
})

wfBuilder.addTask({
  id: `bar`,
  dependencies: [`foo`],
  run: ({ getTaskResult }) => {
    const str = getTaskResult(`foo`)
    return Promise.resolve(str.length)
  },
})

wfBuilder.addTask({
  id: `baz`,
  dependencies: [`bar`],
  run: ({ getTaskResult }) => {
    getTaskResult(`bar`)
    return Promise.resolve()
  },
})

const { taskOrder, emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

emitter.on(`taskFinish`, ({ id, result }) => {
  console.log(`${id} returned ${JSON.stringify(result)}`)
})

runWorkflow({ hello: `world` }).then(() => {
  console.log(`done`)
})
```

The above example will output:

<!-- !test out usage -->

```txt
foo returned "{\"hello\":\"world\"}"
bar returned 17
baz returned undefined
done
```
