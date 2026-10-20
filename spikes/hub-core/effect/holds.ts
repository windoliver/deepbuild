// A hold: a session's hook, answered when its check settles, at 2 s, or on a cancel. The check
// leases a port, runs up to four attempts, and gives its port back once its groups are gone.
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import { Ports } from "./ports.ts"
import { Processes } from "./processes.ts"
import type { Argv } from "./processes.ts"

export const HOLD_MS = 2000
const RETRIES = 3

export interface HoldInfo {
  readonly id: string
  readonly session: string
}

// Extensions stay plain TypeScript: a promise and an AbortSignal.
export interface Extension {
  readonly name: string
  onHold(hold: HoldInfo, signal: AbortSignal): unknown
}

export interface HoldRequest extends HoldInfo {
  readonly argv: Argv
}

export type Outcome =
  | { readonly outcome: "pass" | "fail" | "timeout" | "cancelled" }
  | { readonly outcome: "blocked"; readonly error: { readonly message: string; readonly stack: string | undefined } }

export type Send = (line: object) => Effect.Effect<void>

export class Holds extends Context.Service<Holds, {
  // Acknowledges at once, then replies with the outcome. Its port goes back once its processes are gone.
  readonly hold: (request: HoldRequest, send: Send) => Effect.Effect<void>
  // Settles every open hold of the session as cancelled and returns how many it settled.
  readonly cancel: (session: string) => Effect.Effect<number>
}>()("hub-core/Holds") {
  static readonly layer = (extensions: ReadonlyArray<Extension>) =>
    Layer.effect(
      Holds,
      Effect.gen(function*() {
        const ports = yield* Ports
        const processes = yield* Processes
        // Each open hold's outcome, by session. Whoever settles it first, the check or a cancel, decides it.
        const open = new Map<string, Set<Deferred.Deferred<Outcome>>>()

        const check = Effect.fn("Holds.check")(function*(request: HoldRequest, attempts: Ref.Ref<number>) {
          const port = yield* ports.lease(request.session, request.id)
          const attempt = Ref.update(attempts, (n) => n + 1).pipe(Effect.andThen(processes.attempt(request.argv, port)))
          // No delay between attempts. A check that can't start isn't retried.
          yield* Effect.retry(attempt, { schedule: Schedule.recurs(RETRIES), while: (error) => error._tag === "CheckFailed" })
        }, Effect.scoped)

        const outcome = (request: HoldRequest, attempts: Ref.Ref<number>) =>
          check(request, attempts).pipe(
            Effect.as<Outcome>({ outcome: "pass" }),
            Effect.catchTags({
              CheckFailed: () => Effect.succeed<Outcome>({ outcome: "fail" }),
              SpawnError: (error) =>
                Effect.succeed<Outcome>({ outcome: "blocked", error: { message: error.message, stack: error.stack } })
            })
          )

        // Extensions run beside the hold and are never awaited, so a promise that never settles, or a
        // timer it keeps, can't hold up a reply, a lease or the hub's exit.
        const notify = (hold: HoldInfo) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const controller = new AbortController()
              for (const extension of extensions) {
                void Promise.resolve().then(() => extension.onHold(hold, controller.signal)).catch(() => {})
              }
              return controller
            }),
            (controller) => Effect.sync(() => controller.abort())
          )

        const track = (session: string, settled: Deferred.Deferred<Outcome>) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              if (!open.has(session)) open.set(session, new Set())
              open.get(session)?.add(settled)
            }),
            () =>
              Effect.sync(() => {
                const holds = open.get(session)
                holds?.delete(settled)
                if (holds?.size === 0) open.delete(session)
              })
          )

        const hold = Effect.fn("Holds.hold")(function*(request: HoldRequest, send: Send) {
          const now = yield* Clock.currentTimeMillis
          yield* send({ ack: request.id, hold_until_ms: now + HOLD_MS })
          const attempts = yield* Ref.make(0)
          const settled = yield* Deferred.make<Outcome>()
          yield* track(request.session, settled)
          yield* notify({ id: request.id, session: request.session })
          const work = yield* Effect.forkScoped(
            outcome(request, attempts).pipe(Effect.flatMap((result) => Deferred.succeed(settled, result)))
          )
          // The 2 s cover the wait for a port and every attempt. The hook stops waiting at the deadline,
          // so a timeout is answered at once: the check is interrupted, so it starts no further attempt,
          // and the hold's scope waits for its group to go before the port goes back.
          yield* Effect.forkScoped(
            Effect.sleep(Duration.millis(HOLD_MS)).pipe(
              Effect.andThen(Deferred.succeed(settled, { outcome: "timeout" })),
              Effect.andThen(Fiber.interrupt(work))
            )
          )
          const result = yield* Deferred.await(settled)
          // A cancel stops the check before the reply, so the reply means its processes and port are free.
          if (result.outcome === "cancelled") yield* Fiber.interrupt(work)
          yield* send({ id: request.id, ...result, attempts: yield* Ref.get(attempts) })
        }, Effect.scoped)

        const cancel = Effect.fn("Holds.cancel")(function*(session: string) {
          let cancelled = 0
          for (const settled of [...(open.get(session) ?? [])]) {
            if (yield* Deferred.succeed(settled, { outcome: "cancelled" })) cancelled++
          }
          return cancelled
        })

        return Holds.of({ hold, cancel })
      })
    )
}
