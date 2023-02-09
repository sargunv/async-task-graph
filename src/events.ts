import { EventEmitter } from "node:events"

export type EventDefinition = Record<string, any>
export type EventName<D extends EventDefinition> = string & keyof D
export type EventListener<E> = (args: E) => void

export interface TypedEventEmitter<D extends EventDefinition> {
  on: <N extends EventName<D>>(
    eventName: N,
    listener: EventListener<D[N]>,
  ) => void
  off: <N extends EventName<D>>(
    eventName: N,
    listener: EventListener<D[N]>,
  ) => void
  emit: <N extends EventName<D>>(eventName: N, args: D[N]) => void
}

/**
 * A wrapper around the Node.js EventEmitter class that provides
 * type safety for the event names and arguments.
 */
export const typedEmitter = <
  D extends EventDefinition,
>(): TypedEventEmitter<D> => new EventEmitter()
