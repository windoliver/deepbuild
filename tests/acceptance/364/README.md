# Acceptance tests for #364: plug-in sources and secrets

Written first, blind, by a job that never saw an implementation of #364 (none exists at the base). It read:

- issue #364 as of October 30, 2026: its Scope, its 7 checkbox criteria and its Proof
- `docs/technical-design.md`: Blocks for plug-ins that do real work (Source and reading, Secret, Replay and a clock),
  Extension API (TypeScript, in-process), Building blocks (the blocks table's Source and reading, Secret, and Replay
  and clock rows), and Privacy (the scrub by value and its forms)
- `AGENTS.md`
- the acceptance tests of #350 and #314, for their conventions
- the packages #364 builds on, read only: `extension-host` (its host, `deep.fetch` with grant hosts, quota and
  `redirect: 'manual'`, its runtime's API list), `contracts` (extension-api.json's preview `deep.registerSource` and
  `deep.secret` tracking #364, `slots/source@1.json`, the hub-slot table's `source@1` row, `checkManifest` and
  extension.manifest@1), `conformance` (`slots/source.ts`, the source@1 kit with its planted
  `skips-first-after-resume`; `slots/reading-source.ts`), `evidence` (`scrub.ts`: `scrub`, `scrubList`, the forms by
  value), `hub/src/keychain.ts`, `record`
- the base commit `6ba47cdb`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 7 checkbox criteria, AC1 to AC7, in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0). The shell's default `node` may be another version; put 24.22.0 first on
`PATH` (on the machine these were written on it is fnm's, `~/.local/share/fnm/node-versions/v24.22.0/installation/bin`):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # if any package's dist is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/364 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/364/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed processes through the supervisor and time calls against a
  source's timeout, so nothing else should run beside them.
- **The platform sandbox:** packages from outside the release run under the supervisor's sandbox, as in #348 and
  #350, so the run needs a shell that may start it (in Claude Code, the Bash tool with its own sandbox off).
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild` or the real Keychain.
- **Temp folders:** every package, record, evidence store and home is under `/tmp/dh364-*`, removed after its file.
  Every host a test opens is closed after its file, which stops what it started; nothing is stopped by name or port.
- **No network:** `api.market.example` and `cdn.other.example` are HTTP servers this process runs on 127.0.0.1. The
  hub reaches them only through the HTTP client the test gives it (below), which refuses any other name, and a name
  marked offline, before opening a socket. "No network" (AC6) is simulated that way.

## The surface under test

The issue names no module. #364 builds on #348–#350's host, so the tests reach it only through
`packages/extension-host/src/index.ts`, plus the manifest fields `checkManifest` reads in `@deepbuild/contracts`.
Names come from the issue and the design: source, reading (unit, source, as-of time), host, secret and handle,
quota, timeout, freshness (`freshFor`), `keyTest`, the trusted path, the OS secret store, recording, replay and the
clock, BLOCKED and its cause, valid, invalid and INCONCLUSIVE.

Three of the options below are seams the tests need: the secret store stands in for the OS one, the HTTP client
routes the issue's two names to local servers, and the recording is what the design's replay replays. None loosens a
check: the host's own rules (which host a handle goes to, which redirect it follows, what it scrubs before the
parser) sit above the client and the store, and production passes neither.

### `packages/extension-host/src/index.ts` gains

```ts
import type { Connection } from '@deepbuild/record';

/** One outside call the hub makes for a source, as it hands it to its HTTP client. */
export interface HttpRequest { url: string; method: string; headers: Record<string, string> }
/** What came back, as the client got it. Header names lower-case. A 3xx comes back as it is, with its Location. */
export interface HttpAnswer { status: number; headers: Record<string, string>; body: string }
/**
 * The hub's HTTP client for source calls (key tests among them). It never follows a redirect; it rejects when the
 * host can't be reached (no network); it stops when `signal` aborts. The default is Node's fetch with
 * `redirect: 'manual'`. Tests pass one that routes the names they use to local servers.
 */
export type HttpClient = (request: HttpRequest, signal: AbortSignal) => Promise<HttpAnswer>;

/** The OS secret store as the hub reaches it (the Keychain on macOS). Tests pass an in-memory one. */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** One source call as recorded: no form of any secret value anywhere in it. */
export interface RecordedCall {
  source: string;              // the source's name, ext.<plugin>.<name>
  request: HttpRequest;
  answer: HttpAnswer | { error: 'timeout' | 'unreachable' };
}
export interface Recording { v: 1; calls: RecordedCall[] }

/** A reading: the parser's value and unit, with the source and the as-of time the hub gives it. */
export interface Reading { source: string; value: number; unit: string; as_of: number }
export type SourceRead =
  | { status: 'reading'; reading: Reading }
  | { status: 'BLOCKED' | 'failed'; source: string; cause: string };   // cause e.g. "off-host redirect"
export type KeyTest = 'valid' | 'invalid' | 'INCONCLUSIVE' | 'untested';

export interface ExtensionHostOptions {
  // ...#348–#350's options; `now` is the clock: as-of times and freshness read it.
  /** The OS secret store; tests only pass one. */
  secrets?: SecretStore;
  /** The HTTP client every source call goes through; tests only pass one. */
  http?: HttpClient;
  /**
   * Replay: every source call is answered from this recording, in order, by the first unused call with the same
   * source, method and URL, and never reaches the client. A call it doesn't hold makes no reading. A replay reads no
   * secret: a recording holds none, so a missing secret blocks nothing under it.
   */
  replay?: Recording;
}

export interface ExtensionHost {
  // ...#348–#350's methods, and:
  /**
   * The trusted path (the app, or the CLI once the OS confirms you): the value of a secret a package's manifest names.
   * With a loaded source of that package that names the secret and declares a key test, the test's one call is made
   * with this value first: a 2xx reads valid and saves it; the source refusing the key (401, 403) reads invalid and
   * saves nothing; a test that couldn't run (no network, a timeout, a rate limit or a 5xx) reads INCONCLUSIVE and saves
   * it. With no key test it reads untested and saves it. Saving writes the secret store only.
   */
  enterSecret(connection: Connection, extension: string, name: string, value: string): Promise<{ test: KeyTest; saved: boolean }>;
  /**
   * A read of a source the hub makes, as a schedule, a view or a check needing its reading would: from the cache while
   * the last reading is within `freshFor` of the clock, else one call. A redirect is followed only to the source's own
   * host, with the secret; one to any other host sends nothing there and reads BLOCKED, cause off-host redirect.
   * Before the parser gets an answer, its status line, headers and body are scrubbed of every secret value the hub
   * holds, in the Privacy scrub's forms.
   */
  readSource(name: string): Promise<SourceRead>;
  /** Every source call this host made, recorded with secrets stripped. */
  recording(): Recording;
}
```

### The package's side (runtime `deep`, `EXTENSION_API`)

`deep.secret` joins the API list (`needs: null`); `deep.registerSource` is there already. Both stay preview, so a
package lists them in `requires.preview`.

```ts
deep.secret(name: string): Promise<string>        // a handle, never the value; `name` is one the manifest's secrets lists
deep.registerSource(name: string, source: PolledSource | StreamSource): Promise<void>

interface PolledSource {
  variant: 'polled';
  host: string;                       // a host the grant names; every call is https://<host><path>
  path: string;                       // the call's path (GET)
  secret?: string;                    // a handle from deep.secret; then exactly one of:
  header?: string;                    //   the value goes in this header as it is (X-Api-Key), or
  basic?: { user: string };           //   Authorization: Basic base64(user + ':' + value)
  quota: { per_minute: number; per_day: number };
  timeout: number;                    // ms per call
  freshFor: number;                   // ms a reading stays fresh
  keyTest?: { path: string };         // one GET on the same host, with the value as you enter it
  /** Every answer the source gets, 2xx or not, scrubbed; it throws when the answer holds no reading. */
  parse(answer: HttpAnswer): { value: number; unit: string };
}
/** source@1's fill shape: the kit hands its own stream at install. */
interface StreamSource {
  variant: 'stream';
  read(stream: { events: { seq: number; kind: string; data: string }[] }, cursor: string | null, limit: number):
    { events: { seq: number; kind: string; data: string }[]; cursor: string | null };
}
```

### The manifest (`checkManifest` reads both beside extension.manifest@1, as it reads `templates` and `environments`)

```json
"secrets": [{ "name": "market_key", "for": "the market data API's key" }],
"sources": [{ "name": "ext.market.price", "variant": "polled" }]
```

A source's name is `ext.<plugin>.<name>`. Each source the manifest lists is one the code registers.

### At install

Each `stream` source the manifest lists is a source@1 fill: the install runs `@deepbuild/conformance`'s source@1 kit
(its fixed part) on what the package registered, wherever the package runs, and records
`{ slot: 'source@1', fill: <name>, verdict }` in `Installed.kits`. A FAIL refuses the install, naming the case, as
the other kits' do. The kit's `restart()` restarts the package's run, as a hub restart would: nothing the package
held in memory survives it (a sandboxed package gets a new process).

## Readings

- **"Never appears in the record, a log, a URL or a prompt" (AC1).** The record is every event read back and the
  ledger's files. A log is any file the hub, the supervisor or the package wrote: every file under the world's folder
  (the ledger and its WAL, the evidence store, `~/.deepbuild` and the extensions' folders), the package's folder and
  the temp HOME, as UTF-8 and UTF-16LE, with the record open and again after the host and the record closed. A URL is
  every URL the hub asked its client for and every request line that reached the provider. A prompt is what a hook
  reply hands the agent: a release copy of the plug-in in the hub adds everything it was given to a tool.before
  context. "Appears" means any form the Privacy scrub covers (raw; URL-encoded, either hex case; base64 at byte offsets
  0, 1 and 2, standard and URL-safe). The provider echoes the key back so the plug-in's side has it to leak. What the
  hub answers its caller (`enterSecret`, `readSource`) holds none either. Only the header the source names carries it.
- **"Recorded source calls with secrets stripped" (AC2).** `recording()` after two live calls holds both calls with
  their answers and no form of the key. The plug-in's test is a new world given that recording, as data, and a clock
  the test sets (a Saturday) and moves. No secret is entered there.
- **"A clock they control" (AC2).** A reading's `as_of` is the clock's time at its call, replayed or live; a read
  within `freshFor` comes from the cache with the same `as_of` and makes no call (the parser isn't called); a read past
  it makes the next call.
- **"Make no live call" (AC2).** The replaying hub is given a client that would reach the live server: the server
  sees no request and the client is asked for nothing, even when the recording runs out.
- **"Passes source@1 at install" (AC3).** The install's kit record, and the planted reader refused at install with
  the kit's first fixture, `five-by-two`, in the refusal. The kit itself judges the two reads from one cursor and the
  restart.
- **"Sends nothing to cdn.other.example" (AC4).** No request reaches the server standing in for it and the hub asks
  its client for nothing on that host. "What needs the price reading" is the hub's read of the source (`readSource`),
  which reads BLOCKED with a cause containing `off-host redirect`.
- **"Reaches the plug-in's parser as `invalid key [redacted]`" (AC5).** The body the parser gets matches
  `^invalid key \[redacted\]$` ignoring case: the Privacy scrub's mask is `[REDACTED]`, and either case of the mask
  word passes. The recorded error answer is served by the local server (Proof: "each … scrub … case against local
  test servers"), not replayed: the blocks table says a recording is never replayed with a secret in it.
- **"Entered against a recorded provider" (AC6).** The local server gives the key-test call the provider's recorded
  answer for each case; the timeout case gets no answer (the source's timeout is 500 ms); no network is the client
  refusing the name. Each case starts from an empty store, and "saved" is whether the store holds the value after.
- **The URL-safe echo (AC7).** For this key, `mk/test+51f0c9=`, base64 at every offset has no `+` or `/`, so its
  standard and URL-safe forms are the same text. The echo header therefore can't tell the alphabets apart; the
  criterion's wrong program fails on the Basic credentials' base64 at byte offset 2, which the test names.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#364.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped. A test headed `(wrong program)` runs the scenario through the wrong program the criterion names and expects
it to fail the criterion's judge (`judges.ts`) with the problem naming what the criterion says.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#364.8ec0560e` | a secret's value never in the record, a log, a URL or a prompt | `secrets.test.ts` AC1 (2): an outside plug-in in the sandbox (URL, record, files, what it and the caller get); a release copy in the hub (the prompt) | fails (manifest `secrets`/`sources` refused; no `enterSecret`, `readSource`) |
| AC2 `#364.fd9dab33` | tests run from recordings with secrets stripped and a clock, no live call | `replay.test.ts` AC2 (1) | fails |
| AC3 `#364.3a628510` | a stream source passes source@1 at install; the planted reader fails, naming the fixture | `stream.test.ts` AC3 (2): the clean source; the planted reader | fails (no kit at install) |
| AC4 `#364.25091cf4` | off-host redirect sends nothing and is BLOCKED; same-host redirect followed with the key; a following client fails, naming the host | `redirect.test.ts` AC4 (3) | fails |
| AC5 `#364.161145a6` | the error answer reaches the parser as `invalid key [redacted]`, no form; a logs-only scrub fails, naming the form | `secrets.test.ts` AC5 (2) | fails |
| AC6 `#364.9f6db5ef` | key test: 200 valid and saved, 401 invalid and not, 503/timeout/no network INCONCLUSIVE and saved; a rejecting test fails, naming the case | `keytest.test.ts` AC6 (2) | fails |
| AC7 `#364.5f1f8998` | Basic credentials (offset 2) and the URL-safe echo reach the parser in neither form; a standard-only scrub fails, naming the form | `secrets.test.ts` AC7 (2) | fails |

## Wrong programs

Built in this folder (`twins.ts`, `fixtures/feed-skips`), never by editing a package. Each runs on the same
scenario's real bytes: the answers the local servers gave as the HTTP client got them, or the real hub it wraps.

| Twin | Criterion | What it is | How it fails |
|---|---|---|---|
| `followingClient` | AC4 | the real hub given an HTTP client that follows each 3xx itself, resending the request (the key header with it) to the Location | the key reaches cdn.other.example; the judge says `sent /q to cdn.other.example, delivering the key …` |
| `scrubsLogsOnly` | AC5 | a hub that scrubs its log line of the answer by the Privacy scrub (`scrubValues`, every form) and hands the parser the answer as the client got it | the judge names the forms it found: `raw` in the body, `URL-encoded` and base64 in the headers |
| `fixtures/feed-skips` | AC3 | source@1's planted reader: the first read of a run that starts from a cursor skips that cursor's first event | the install refuses it at `five-by-two` |
| `rejectsWhenUnsure` | AC6 | the real hub's entry, with an INCONCLUSIVE key test turned into a rejection (the saved value taken out, `invalid`) | the judge names `503:`, `timeout:` and `no network:` |
| `scrubsOwnStandardBase64` | AC7 | a hub that takes out the key raw, URL-encoded and as `Buffer.from(key).toString('base64')` only | the judge names `base64 at byte offset 2` |

The scrub twins (AC5, AC7) stand beside the hub rather than inside it: the hub has no seam for its scrub, and adding
one would be a production option that weakens a check. They prove the judge tells a wrong scrub from a right one on
the scenario's own answer; the real hub's parser input is judged by the same function. Each of those tests also checks
the answer as the client got it carried the forms the criterion names, so a hub that passes didn't pass on an answer
without them.

## Redrafts

- **AC5 (wrong program), `scrubsLogsOnly`.** A dispute found the twin's own log check failing on every program: the twin
  scrubbed its log of the raw key only (`split(key)`), while the test asserts its log holds no form of the key, and
  AC5's answer carries the key URL-encoded and base64 in its headers too. The twin was a worse program than the one
  the criterion names. Redrafted blind (no implementation read): the twin's log now goes through
  `@deepbuild/evidence`'s `scrubValues`, the Privacy scrub by value in every form, so it is "a hub that scrubs logs and
  traces properly but hands the parser the raw answer". The test is unchanged; what it proves is the same: the judge
  names the forms in the parser's input (`raw`, `URL-encoded`).

## What the tests don't cover

The Scope's items with no criterion: quota, back-off and each call's recorded cost; windowed queries; non-HTTP
sources and sign-in through an OAuth loopback; readings kept only while cited and the series' 24-hour, 7-day and
30-day keeping (#262); `work.item@1` and `push.record@1`; removing a secret on the trusted path after listing what
goes BLOCKED; the trusted path's refusal of an agent's connection; and a missing secret's BLOCKED. A PR should say how
it proves them, or say `Part of #364` for what stays open.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world, hosts with their seams, the in-memory secret store,
  the local servers and the routed HTTP client, the fixture copier, install-check-load, the probe reader, the
  tool.before request and the byte search.
- `judges.ts`: the key's forms, and the criteria's assertions the wrong programs must fail (AC4, AC5, AC6, AC7).
- `twins.ts`: the wrong programs.
- The test files: `secrets.test.ts` (AC1, AC5, AC7), `replay.test.ts` (AC2), `stream.test.ts` (AC3),
  `redirect.test.ts` (AC4), `keytest.test.ts` (AC6).
- `fixtures/`: the test packages, their code carrying a `.fixture` suffix so Vitest and `tsc` skip it: `market` (the
  price source, as `test/market` in the sandbox and `deepbuild/market` in the hub), `feed` (a stream source) and
  `feed-skips` (the planted reader).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the type check on the base commit.
