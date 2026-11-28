# Acceptance tests for #2370: the host refuses a request a web page sent

Written first, blind, by a job that never saw an implementation of #2370. It read:

- issue #2370's body: its Scope, its six criteria and its Proof
- the design sections it links, through `node scripts/design-section.mjs --issue 2370`: Extension API and Threats,
  and what stops each one
- `AGENTS.md`
- the base commit `254bdc87c`: `packages/extension-host/src/host.ts` (`turnOn`, `serve`), its public entry
  `packages/extension-host/src/index.ts`, `packages/otlp/src/index.ts`, `packages/record` (how an append is
  checked), and #348's suite `tests/acceptance/348/` (README, `helpers.ts`, `inbound.test.ts`, `fixtures/inbound`,
  `wrong.ts`) for its conventions and its inbound fixture

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0), as #348's README says:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the record reads packages/evidence/dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2370 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2370/tsconfig.json
```

- **`--no-file-parallelism`:** each file opens the supervisor and starts a sandboxed package, and AC6 runs #348's
  `inbound.test.ts`, which reads listeners with `lsof`. `lane.json` runs the folder alone for the same reason.
- **The environment and temp folders:** this suite uses #348's `helpers.ts`, so its rules hold: `CLAUDE*`, `DEEP_*`
  and `AI_AGENT` are taken out of the test process's environment, `HOME` is a temp folder, every package, record
  and home is under `/tmp/dh348-*` and removed after its file, and every host a file opens is closed after it.
  The planted hosts in `wrong.ts` are closed by the test that opened them. Nothing is stopped by name or port.
- **No network:** every listener is on 127.0.0.1: the one `turnOn` returns and, in a wrong-program test, the
  planted host in front of it.

## The surface under test

The tests reach the host only through its public entry, `packages/extension-host/src/index.ts`, with #348's
surface and nothing new:

- `openExtensionHost(...)`, `host.ready()`, `host.install({ from, builtBy: null })`, `host.check(pkg)`,
  `host.load(pkg)`, through #348's `openWorld` and `openHost`
- `host.turnOn(id, routes)` returning `{ address: '127.0.0.1:<port>' }`
- `host.runCheck('ext.<plugin>.report', ...)`, through #348's `report`: each fixture reports what it saw

Every request is written by hand on a `node:net` socket, so each header is exactly what the test says: `Host`,
`Origin`, `Sec-Fetch-Site` and `Sec-Fetch-Mode` are sent or left out as named, with `Connection: close`.

### The fixtures and their counts

- **`inbound`** is #348's, used by path (`tests/acceptance/348/fixtures/inbound`, copied by #348's `pkg`). It
  registers `POST /v1/traces` and `POST /admin/exec`. Its report, `ext.inbound.report`, is
  `{ pid, hits: { 'POST /v1/traces': n, 'POST /admin/exec': n }, ownListen }`; its count is the sum of `hits`.
- **`counter`** is this suite's (AC2's new fixture). It registers `GET /status` and `POST /set` and answers each
  200. Its report, `ext.counter.report`, is `{ pid, seen: { 'GET /status': n, 'POST /set': n } }`; its count is the
  sum of `seen`. Its `index.ts` carries a `.fixture` suffix, so Vitest and `tsc` skip it.

### The record's event count (AC5)

Every event in the world's record, read page by page through `record.read` (#348's `World.events`). The test
reads it before the first refused request and after the last, before it asks the package for its count, and
counts the events whose `log_pos` is past the last one before, by kind.

## Readings

- **"Answered by the package" (AC1).** The answer is the fixture's own: 200 with `traces got <body>`.
- **"Reaches the package" (AC2, AC3).** The answer is 200 and the package's count grew by one per request.
- **"No Host header ... answered 400" (AC2).** A request line with no `Host` line at all. Its 400 may come from
  Node before the host sees it, as the Scope says; the test reads only the answer and the count.
- **"The count stays as it was" (AC3).** The count before the three `Sec-Fetch-Site` requests, read through the
  report, equals the count after them.
- **"1,000 refused requests in a row" (AC5).** One after another, each on its own connection, taking turns among
  the three ways a request is refused: an `Origin`, a `Sec-Fetch-Site: cross-site`, and a `Host` of
  `example.test:<port>`, alternating `GET /status` and `POST /set`. The test also checks each was answered 403.
- **"Runs unchanged" (AC6).** `tests/acceptance/348/inbound.test.ts` and its fixture's two files hash as at the
  base, and a child Vitest run of that one file, with #348's root, passes both its tests.

## Criteria to tests

| Criterion | Test | At this base |
|---|---|---|
| AC1 Origin on #348's inbound fixture | `ac1-origin.test.ts` | fails: the Origin POST is answered 200 and the count reads 1 |
| AC2 a `Host` that isn't the listener's | `ac2-host.test.ts` | fails: both requests with `Host: example.test:<port>` reach the package |
| AC3 `Sec-Fetch-Site`, and a tool's `Sec-Fetch-Mode` | `ac3-sec-fetch.test.ts` (2) | the first fails: the three reach the package |
| AC4 checks before the route is matched | `ac4-before-route.test.ts` (2) | the first fails: the path never registered is answered 404 |
| AC5 a refusal appends nothing | `ac5-record.test.ts` (2) | the first fails: the package counts the requests |
| AC6 #348's AC12 unchanged | `ac6-348-ac12.test.ts` | passes |

## Wrong programs

The criteria's planted hosts are in `wrong.ts`. Each is a small HTTP listener on 127.0.0.1 in front of the real
host's listener: it answers a request itself by its own wrong rule, or hands it on to the address `turnOn` gave
with the `Host` set to that address. A wrong-program test runs the same scenario function as the criterion's test,
with the planted host's address and the real package's count and record, and expects it to fail with the named
message. So each runs the same at the base and on a right host.

| Planted host | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `refusesAnySecFetchHeader` | AC3 | refuses an `Origin`, a `Sec-Fetch-Site`, another `Host`, and any `Sec-Fetch-*` header | the GET with only `Sec-Fetch-Mode: cors` is answered 403; the failure names the header `Sec-Fetch-Mode: cors` |
| `matchesTheRouteFirst` | AC4 | answers 404 or 405 to a route not chosen before it looks at the headers | `POST /never-registered` is answered 404; the failure names the path |
| `appendsAnEventPerRefusal` | AC5 | refuses as a right host does, and appends one `ext.counter.refused` store item per refusal | the record grows by 1,000; the failure names `ext.counter.refused` |

AC1, AC2 and AC6 name no planted host. AC1 and AC2 fail on the base, which is their wrong program.

## Files

- `helpers.ts`: the counter package, a served package (a world and host from #348's helpers, the package
  installed, checked, loaded and turned on), the raw request writer and the line each request prints.
- `wrong.ts`: the planted hosts.
- `ac1-origin.test.ts` to `ac6-348-ac12.test.ts`: one file per criterion.
- `fixtures/counter`: AC2's new fixture.
- `lane.json`: the folder runs alone.
- `BASE-FAILURE.txt`: the run on the base commit. `TWINS-RUN.txt`: the wrong-program tests' run.
