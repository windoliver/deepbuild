// The lease pool: a queue of free ports. A lease is scoped, so its port goes back when the
// holder's scope closes, after every finalizer added later in that scope (its process groups) ran.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"

export interface Lease {
  readonly port: number
  readonly session: string
  readonly hold: string
}

export class Ports extends Context.Service<Ports, {
  readonly pool: ReadonlyArray<number>
  readonly lease: (session: string, hold: string) => Effect.Effect<number, never, Scope.Scope>
  readonly held: Effect.Effect<ReadonlyArray<Lease>>
}>()("hub-core/Ports") {
  static readonly layer = (pool: ReadonlyArray<number>) =>
    Layer.effect(
      Ports,
      Effect.gen(function*() {
        const free = yield* Queue.unbounded<number>()
        yield* Queue.offerAll(free, pool)
        const held = new Map<number, Lease>()

        const lease = (session: string, hold: string) =>
          Effect.acquireRelease(
            Queue.take(free),
            (port) => Effect.sync(() => held.delete(port)).pipe(Effect.andThen(Queue.offer(free, port))),
            // a hold still waiting for a port can time out or be cancelled
            { interruptible: true }
          ).pipe(Effect.tap((port) => Effect.sync(() => held.set(port, { port, session, hold }))))

        return Ports.of({ pool, lease, held: Effect.sync(() => [...held.values()]) })
      })
    )
}
