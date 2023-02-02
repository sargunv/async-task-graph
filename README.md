# async-task-graph

Library to aid in orchestrating asynchronous tasks graphs of dependencies with strong typings.

## Example

```ts
type Test = WorkflowDefinition<{
  // type of custom data that is passed to all tasks
  context: object;
  // return types of tasks are defined here
  tasks: {
    foo: string;
    bar: number;
    baz: void;
  };
}>;

const newTask = taskFnForRegistry<Test>();

const foo = newTask({
  id: 'foo',
  dependencies: [],
  run: async ({ context }) => JSON.stringify(context),
});

const bar = newTask({
  id: 'bar',
  dependencies: ['foo'],
  async run({ getTaskResult }) {
    const str = getTaskResult('foo');
    return str.length;
  },
});

const baz = newTask({
  id: 'baz',
  dependencies: ['bar'],
  async run({ getTaskResult }) {
    getTaskResult('bar');
  },
});

const emitter = executeWorkflowSerially<Test>({ foo, baz, bar }, { hello: 'world' });

emitter.on('workflowStart', args => {
  console.log('workflowStart', args);
});

emitter.on('taskStart', args => {
  console.log('taskStart', args);
});

emitter.on('taskFinish', args => {
  console.log('taskFinish', args);
});

emitter.on('taskSkip', args => {
  console.log('taskSkip', args);
});

emitter.on('taskFail', args => {
  console.log('taskFail', args);
});

emitter.on('workflowFinish', args => {
  console.log('workflowFinish', args);
});

emitter.on('workflowError', args => {
  console.log('workflowError', args);
});
```
