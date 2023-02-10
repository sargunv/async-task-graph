[![npm badge](https://img.shields.io/npm/v/async-task-graph)](https://www.npmjs.com/package/async-task-graph)

# async-task-graph

Library to aid in orchestrating asynchronous tasks with interdependencies, with
a focus on strongly typed task definitions.

## Usage

```ts
export type SimpleWorkflow = WorkflowDefinition<{
  context: { hello: string }
  returns: {
    foo: string
    bar: number
    baz: void
  }
}>

export const newSimpleTask = makeTaskFunction<SimpleWorkflow>()

export const fooTask = newSimpleTask({
  id: `foo`,
  dependencies: [],
  run: ({ context }) => {
    return Promise.resolve(JSON.stringify(context))
  },
})

export const barTask = newSimpleTask({
  id: `bar`,
  dependencies: [`foo`],
  run: ({ getTaskResult }) => {
    const str = getTaskResult(`foo`)
    return Promise.resolve(str.length)
  },
})

export const bazTask = newSimpleTask({
  id: `baz`,
  dependencies: [`bar`],
  run: ({ getTaskResult }) => {
    getTaskResult(`bar`)
    return Promise.resolve()
  },
})

const wfBuilder = makeWorkflowBuilder<SimpleWorkflow>()

wfBuilder.addTask(fooTask)
wfBuilder.addTask(barTask)
wfBuilder.addTask(bazTask)

const { taskOrder, emitter, runWorkflow } = wfBuilder.buildSerialWorkflow()

emitter.on(`workflowStart`, ({ taskOrder, context }) => {
  console.log(`workflowStart: ${taskOrder}: ${JSON.stringify(context)}`)
})

emitter.on(`taskStart`, ({ id }) => {
  console.log(`taskStart: ${id}`)
})

emitter.on(`taskFinish`, ({ id, result }) => {
  console.log(`taskFinish: ${id}: ${JSON.stringify(result)}`)
})

emitter.on(`taskThrow`, ({ id, error }) => {
  console.log(`taskThrow: ${id}: ${error.message}`)
})

emitter.on(`taskSkip`, ({ id, erroredDependencies, skippedDependencies }) => {
  console.log(
    `taskSkip: ${id} because of ${erroredDependencies} and ${skippedDependencies}`,
  )
})

emitter.on(`workflowFinish`, ({ id, result }) => {
  console.log(`taskStart: ${id}`)
})

const context = { hello: `world` }
const { tasksFinished, tasksErrored, tasksSkipped } = await runWorkflow(context)

console.log(`tasksFinished: ${tasksFinished}`)
console.log(`tasksErrored: ${tasksErrored}`)
console.log(`tasksSkipped: ${tasksSkipped}`)
```
