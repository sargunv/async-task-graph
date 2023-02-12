import { EventEmitter as NodeEventEmitter } from "node:events"

export type EventDefinition = Record<string, any>
export type EventName<D extends EventDefinition> = string & keyof D
export type EventListener<E> = (args: E) => void

export interface EventSink<D extends EventDefinition> {
  emit: <N extends EventName<D>>(eventName: N, args: D[N]) => void
}

export interface EventSource<D extends EventDefinition> {
  on: <N extends EventName<D>>(
    eventName: N,
    listener: EventListener<D[N]>,
  ) => void
  off: <N extends EventName<D>>(
    eventName: N,
    listener: EventListener<D[N]>,
  ) => void
}

export type EventEmitter<D extends EventDefinition> = EventSink<D> &
  EventSource<D>

/**
 * A wrapper around the Node.js EventEmitter class that provides
 * type safety for the event names and arguments.
 */
export const typedEmitter = <D extends EventDefinition>(): EventEmitter<D> =>
  new NodeEventEmitter()
