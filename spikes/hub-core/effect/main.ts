// The Effect build of the #56 hub slice: one JSON request per connection on <state>/hub.sock.
// See tests/acceptance/56/README.md for the surface. Effect comes in module by module, since
// nothing here tree-shakes the "effect" barrel and importing all of it costs memory.
import { mkdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import type { Server, Socket } from "node:net"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Schema from "effect/Schema"
// The virtual clock: the hub's time starts at 0 and moves only on `tick`.
import * as TestClock from "effect/testing/TestClock"
import { Holds } from "./holds.ts"
import type { Extension, Send } from "./holds.ts"
import { Ports } from "./ports.ts"
import { Processes } from "./processes.ts"

const Request = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("hold"),
    id: Schema.String,
    session: Schema.String,
    check: Schema.Struct({ argv: Schema.NonEmptyArray(Schema.String) })
  }),
  Schema.Struct({ op: Schema.Literal("cancel"), session: Schema.String }),
  Schema.Struct({ op: Schema.Literal("leases") }),
  Schema.Struct({ op: Schema.Literal("stats") }),
  Schema.Struct({ op: Schema.Literal("tick"), ms: Schema.Finite })
])
type Request = typeof Request.Type
const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(Request))

class BadRequest extends Data.TaggedError("BadRequest")<{ readonly message: string }> {}

const firstLine = (socket: Socket) =>
  Effect.callback<string, BadRequest>((resume) => {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf("\n")
      if (end >= 0) resume(Effect.succeed(buffer.slice(0, end)))
    })
    socket.once("close", () => resume(Effect.fail(new BadRequest({ message: "closed before a request line" }))))
  })

const listen = (path: string, onConnection: (socket: Socket) => void) =>
  Effect.acquireRelease(
    Effect.callback<Server, Error>((resume) => {
      // A socket file left here belongs to a hub on this state that is gone.
      rmSync(path, { force: true })
      const server = createServer(onConnection)
      server.once("error", (error) => resume(Effect.fail(error)))
      server.listen(path, () => resume(Effect.succeed(server)))
    }),
    // Not waiting for open connections to end: the holds behind them are interrupted on their own.
    (server) => Effect.sync(() => server.close())
  )

const terminated = Effect.callback<void>((resume) => {
  const stop = () => resume(Effect.void)
  process.once("SIGTERM", stop)
  return Effect.sync(() => process.off("SIGTERM", stop))
})

const serve = Effect.fn("Hub.serve")(function*(state: string, virtual: boolean) {
  const holds = yield* Holds
  const ports = yield* Ports

  const respond = (request: Request, send: Send): Effect.Effect<void> => {
    switch (request.op) {
      case "hold":
        return holds.hold({ id: request.id, session: request.session, argv: request.check.argv }, send)
      case "cancel":
        return holds.cancel(request.session).pipe(Effect.flatMap((cancelled) => send({ ok: true, cancelled })))
      case "leases":
        return ports.held.pipe(Effect.flatMap((held) => send({ pool: ports.pool, held })))
      case "stats":
        return Effect.suspend(() =>
          send({
            rssBytes: process.memoryUsage().rss,
            maxRssBytes: process.resourceUsage().maxRSS * 1024,
            handles: process.getActiveResourcesInfo().length
          })
        )
      case "tick":
        if (!virtual) return send({ error: "tick needs --clock virtual" })
        // adjust returns once every sleep due by the new time has woken
        return TestClock.adjust(Duration.millis(request.ms)).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((now) => send({ now }))
        )
    }
  }

  const connection = (socket: Socket) => {
    // A client that hangs up early only loses its reply.
    socket.on("error", () => {})
    const send: Send = (line) =>
      Effect.sync(() => {
        if (socket.writable) socket.write(`${JSON.stringify(line)}\n`)
      })
    return firstLine(socket).pipe(
      Effect.flatMap(decodeRequest),
      Effect.flatMap((request) => respond(request, send)),
      Effect.catch((error) => send({ error: error.message })),
      Effect.ensuring(Effect.sync(() => socket.end()))
    )
  }

  // Each connection runs in a fiber of this set; closing the scope interrupts them all, which
  // stops every hold's processes.
  const run = yield* FiberSet.makeRuntime()
  const socket = join(state, "hub.sock")
  yield* listen(socket, (client) => {
    run(connection(client))
  })
  yield* Console.log(JSON.stringify({ ready: true, variant: "effect", socket, pid: process.pid }))
  yield* terminated
}, Effect.scoped)

export async function main(args: ReadonlyArray<string>): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      state: { type: "string" },
      ports: { type: "string" },
      extension: { type: "string", multiple: true },
      clock: { type: "string" }
    }
  })
  const range = values.ports?.match(/^(\d+)-(\d+)$/)
  if (!values.state || !range) throw new Error("usage: --state <dir> --ports <first>-<last> [--extension <module>]... [--clock virtual]")
  const state = resolve(values.state)
  mkdirSync(state, { recursive: true })
  const first = Number(range[1])
  const pool = Array.from({ length: Number(range[2]) - first + 1 }, (_, index) => first + index)
  const extensions = await Promise.all(
    (values.extension ?? []).map(async (path): Promise<Extension> => (await import(pathToFileURL(resolve(path)).href)).default)
  )
  const virtual = values.clock === "virtual"

  const services = Holds.layer(extensions).pipe(
    Layer.provideMerge(Layer.mergeAll(Processes.layer(state), Ports.layer(pool)))
  )
  const program = serve(state, virtual).pipe(
    Effect.provide(services),
    // stdout carries the ready line only
    Effect.provideService(Logger.LogToStderr, true)
  )
  const exit = await Effect.runPromiseExit(virtual ? program.pipe(Effect.provide(TestClock.layer())) : program)
  if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
  // Exit now instead of when the event loop drains: an extension's timers would keep it open.
  process.exit(Exit.isSuccess(exit) ? 0 : 1)
}
