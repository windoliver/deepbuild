// Check attempts as process groups, and the ledger in <state> that outlives the hub. Every group is
// recorded once it starts and marked gone once it's empty, so a hub restarted after kill -9 can
// stop what the killed one left running.
import { execFileSync, spawn } from "node:child_process"
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export type Argv = readonly [string, ...Array<string>]

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly message: string
  readonly cause: unknown
}> {}

export class CheckFailed extends Data.TaggedError("CheckFailed")<{ readonly code: number | null }> {}

interface Entry {
  readonly pgid: number
  readonly startedMs?: number
  readonly gone?: true
}

interface Group {
  readonly pgid: number
  readonly exit: Promise<number | null>
}

// False once the group is empty.
const signalGroup = (pgid: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}

// SIGKILL, since the checks ignore SIGTERM, until the group is empty. One signal isn't enough on
// macOS: a member that is forking as the signal lands leaves a child in the group that never got it,
// so SIGKILL goes again on every tenth probe. The probes are signal 0, because a delivered signal costs
// milliseconds where endpoint security inspects each one. They run on Node's timers rather than the
// hub's Clock: the OS doesn't wait for a virtual tick.
const stopGroup = (pgid: number) =>
  Effect.callback<void>((resume) => {
    let probes = 0
    const poll = () => {
      if (signalGroup(pgid, probes++ % 10 === 0 ? "SIGKILL" : 0)) return
      clearInterval(timer)
      resume(Effect.void)
    }
    const timer = setInterval(poll, 5)
    poll()
  })

const start = (argv: Argv, port: number) =>
  Effect.callback<Group, SpawnError>((resume) => {
    const child = spawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: String(port) }
    })
    const exit = new Promise<number | null>((done) => child.once("exit", (code) => done(code)))
    child.once("spawn", () => resume(Effect.succeed({ pgid: child.pid!, exit })))
    child.once("error", (cause) =>
      resume(Effect.fail(new SpawnError({ message: `the check ${argv[0]} didn't start: ${cause.message}`, cause })))
    )
  })

// A group the ledger left open is still ours if its leader runs with the recorded start time, or if
// the leader is gone and the group still holds processes: the kernel never hands out the ID of a
// live group as a new PID. Anything else is left alone.
const reap = Effect.fn("Processes.reap")(function*(file: string) {
  const open = new Map<number, Entry>()
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as Entry
      if (entry.gone) open.delete(entry.pgid)
      else open.set(entry.pgid, entry)
    }
  }
  if (open.size > 0) {
    const table = execFileSync("ps", ["-axo", "pid=,pgid=,lstart="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" }
    })
    const rows = table.split("\n").flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
      return match ? [{ pid: Number(match[1]), pgid: Number(match[2]), startedMs: Date.parse(match[3] ?? "") }] : []
    })
    for (const { pgid, startedMs } of open.values()) {
      const members = rows.filter((row) => row.pgid === pgid)
      const leader = members.find((row) => row.pid === pgid)
      // ps shows start times to the second
      const ours = members.length > 0 &&
        (leader === undefined || (startedMs !== undefined && Math.abs(leader.startedMs - startedMs) < 2000))
      if (ours) yield* stopGroup(pgid)
    }
  }
  writeFileSync(file, "")
})

export class Processes extends Context.Service<Processes, {
  // One attempt: runs argv with PORT set, in a group of its own, and returns once the attempt has
  // exited and every process left in its group is gone.
  readonly attempt: (argv: Argv, port: number) => Effect.Effect<void, SpawnError | CheckFailed>
}>()("hub-core/Processes") {
  static readonly layer = (state: string) =>
    Layer.effect(
      Processes,
      Effect.gen(function*() {
        const file = join(state, "ledger.jsonl")
        yield* reap(file)
        // Held open for the hub's life: opening the file for each line costs milliseconds where
        // endpoint security inspects every open.
        const fd = yield* Effect.acquireRelease(
          Effect.sync(() => openSync(file, "a")),
          (fd) => Effect.sync(() => closeSync(fd))
        )
        const write = (entry: Entry) => Effect.sync(() => writeSync(fd, `${JSON.stringify(entry)}\n`))

        const attempt = Effect.fn("Processes.attempt")(function*(argv: Argv, port: number) {
          const group = yield* Effect.acquireRelease(
            start(argv, port),
            ({ pgid }) => stopGroup(pgid).pipe(Effect.andThen(write({ pgid, gone: true })))
          )
          // Wall time, not the hub's Clock: reap compares it with the start time ps reports.
          yield* write({ pgid: group.pgid, startedMs: Date.now() })
          const code = yield* Effect.promise(() => group.exit)
          if (code !== 0) return yield* new CheckFailed({ code })
        }, Effect.scoped)

        return Processes.of({ attempt })
      })
    )
}
