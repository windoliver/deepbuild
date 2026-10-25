# Acceptance tests for #34: the App API and the live stream on the hub's socket

Written first, blind, from issue #34 (its text as of October 24, 2026: Scope, the 12 acceptance criteria, Proof and
Depends on), its epic #4 and its dependencies #16, #318, #319 and #28 (read only to keep their scope out), and #19's
title and state (open), and from `docs/technical-design.md`: the App API row of Five ways in (Extension API), Socket
roles and contract versions (The trusted path is a device you paired), Threats, and what stops each one, One event
log, with tables built from it (log_pos, power cuts, the test VFS), How we know version 0 works (Criteria to tests,
Wrong programs) and the Decided rows "Answers from the terminal" and "Clicks on the question card"; and from the base
commit `8b98570` (origin/main): the hub's code (`packages/hub/src/server.ts`, `core.ts`, `wire.ts`, `vfs.ts`), the asks
core (`packages/asks`), the record, the app's hub client (`crates/deep-app/src/hub.rs`, `tests/hub_client.rs`) and the
acceptance tests of #16, #318 and #319. Nothing of #34 is implemented at the base, and no implementation of it was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With the repo's Node (`.node-version`, 24.22.0) first on `PATH`, and cargo:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/34 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/34/tsconfig.json   # type-checks the TypeScript side
```

- `--no-file-parallelism`: the files start real hubs, AC7 holds 20,000 frames behind a paused consumer, and the
  budgets time a stream; another file's CPU beside them would move those numbers.
- `app.test.ts` runs the Rust side once: `cargo test --locked -p deep-app --test acceptance_34 -- --test-threads=1`
  (the `[[test]]` entry below). Its first build compiles deep-app's dependencies (gpui-kit; about 7 minutes on a cold
  target). It can also be run by itself with that command, the same Node first on `PATH`.
- Every TypeScript test makes its folders under `/tmp/dh16-*` (#16's helpers) and the Rust ones under `/tmp/da34-*`,
  sets `HOME` to one of them for every hub it starts, and never touches the real `~/.deepbuild`. Each stops only
  processes it started, by PID, never by name or port.
- Every hub these tests start has `DEEP_HUB_TEST_CONFIRM` set to the test's stand-in, which says no unless a test
  says yes, so no test can raise a real Touch ID or polkit prompt.
- With `--root` here, Vitest writes its cache under `tests/acceptance/34/node_modules/.vite/`; delete it before
  committing.

The TypeScript tests import `packages/contracts/src/index.ts` (`canonicalize`), `packages/record/src/index.ts`
(`openRecord`) and `packages/asks/src/index.ts` (`openAsks`, `askSources`) with their `.ts` extensions, as #14 and
#318 published them, and reuse `tests/acceptance/16/helpers.ts` (the hub as a process, the socket client, hook
requests, cleanup). They import nothing from the hub. The Rust test imports `deep_app::hub` (the base's client) and
`deep_app::record` (new, below).

## The surface

The issue and the design name the App API's reads and answers, the stream, the trusted path and the record reader,
but no method names, so these tests use the smallest surface that reaches every criterion, built on the names the
base hub already serves (`events.read`, `stream.subscribe`, `ask.answer`, the hello's `start`) and on the design's
read list (`inbox · sessions · changes/:id · evidence/:sha · numbers`, `asks/:id/answer`, `decisions/:id/overrule`).

### The socket (`~/.deepbuild/hub.sock`, mode 0600; #16's line protocol, one JSON object per line with `"v": 1`)

```ts
// A connection presents the control token in its first line: {"v":1,"hello":"app"|"cli","token":"<control.token>"}.
// Every method below needs that; on any other connection it is refused and serves nothing. A line (a hello or a
// request) that carries a browser Origin at its top level ("origin" or "Origin") is refused and serves nothing, and so
// is a raw HTTP request or WebSocket upgrade with an Origin header written to the socket.
type Start = string;     // the hub's start ID: the hello's `start`, new at each start
type LogPos = number;    // the record's log_pos (#14): only grows, never reused, a JSON number

// The reads. Each result says the start ID and the log_pos it reflects.
'inbox.read'        {}                          => { start: Start; log_pos: LogPos; asks: InboxRow[] }   // @deepbuild/asks's InboxRow
'sessions.read'     {}                          => { start: Start; log_pos: LogPos; sessions: unknown[] }
'changes.read'      { id: string }              => { start: Start; log_pos: LogPos; change: unknown }     // not_found for an unknown id
'evidence.read'     { sha: string }             => { start: Start; log_pos: LogPos; evidence: unknown }   // not_found for an unknown hash
'numbers.read'      {}                          => { start: Start; log_pos: LogPos; numbers: unknown }
'events.read'       { after: LogPos; limit?: number }
                    => { start: Start; log_pos: LogPos; events: Event[] }
// events.read holds every event with after < log_pos <= its log_pos, in order: a full page reflects its last
// event, a short one the log's committed end, so an empty gap a power cut left is crossed by one read.
// limit is the app's ask; the hub may cap it (the base caps at 1,000).

// The stream.
'stream.subscribe'  { after: LogPos }           => { subscribed: true; after: LogPos; start: Start }   // the reply: the stream's first frame
//   then a frame per event with log_pos > after, in log_pos order, each sent only once its append committed:
//                   { v: 1, id: <the subscribe's id>, event: Event }      // event.log_pos, event.seq as its decimal string
//   and, once the consumer is more than 10,000 frames behind, one cut-off line and no frame after it:
//                   { v: 1, id: <the subscribe's id>, error: { code: 'fell_behind', … } }   // error@2's shape
// A consumer resumes with a new stream.subscribe after the last log_pos it holds.

// Answers and pairing.
'ask.answer'        { ask: string; option?: string; words?: string; plan_hash?: string; token?: string;   // #318's answer; token is the click's
                      device?: string; signature?: string }                                                 // a paired device's signature
                    => { … } | error
'decision.overrule' { decision: string; …; device?: string; signature?: string } => { … } | error          // served (AC1) only
'device.pair'       { name: string; public_key: string } => { device: string }                             // counts only once the OS confirms you
```

- **The trusted path.** An answer to an authority ask counts only when it carries a paired device's `device` and a
  valid `signature`, or when it comes from a `cli` connection and the OS has confirmed you for that answer. An `app`
  answer without a valid signature is refused even when the OS would confirm you. Refused, it records nothing
  (no `ask.answered`) and the ask stays `unanswered` in the inbox. The control token, the peer check and the role
  alone never make one count.
- **The signature.** Ed25519. `public_key` is the raw 32-byte key, base64url (a JWK's `x`). `signature` is base64url
  of the 64-byte signature over the RFC 8785 bytes (`canonicalize` of `@deepbuild/contracts`) of the answer's params
  with `device` in them and without `signature`. A signature from a key never paired, over other params than those
  sent, or for another ask, counts as none.
- **Pairing** counts only once the OS confirms you, so the control token can't pair a key of its own.
- **The OS confirmation** is asked by the hub, once per answer (or pairing), after the option is chosen, with a prompt
  naming the question and the option, and never cached (Decided: Clicks on the question card).

### Test-only settings the hub honours (beside #16's)

| Variable | What it does |
|---|---|
| `DEEP_HUB_TEST_CONFIRM=<executable>` | stands in for Touch ID, your password or polkit, the boundary the hub doesn't own: for each confirmation the hub runs `<executable> <prompt>`, the prompt as one argument (its text names the question and the option for an answer), and takes exit 0 as you confirmed and anything else as not |
| `DEEP_HUB_TEST_VFS` | #16's test VFS; `{"cutAfter": 1000000000}` makes every `synchronous=FULL` commit reach `ledger.db` at once and never cuts, so a SIGKILL by PID loses exactly what a power cut would |

`test.load` (#16's, served only under the test VFS) puts load on the hub: `{verdicts: 1}` commits one verdict FULL
(AC11's 899) and `{backfill: {transcript, session, agent}}` appends one `user.ask` per prompt line (AC7's 20,000).

### The app's record reader (`crates/deep-app`)

```rust
// crates/deep-app/src/record.rs, `pub mod record;` in lib.rs: the app's one record reader, the only consumer of
// the stream and the reads in the app, feeding every view as of one start ID and one log_pos.
pub struct View {
    pub start: String,                 // the hub start ID the view was read under
    pub log_pos: u64,                  // the log_pos the view reflects
    pub inbox: Vec<serde_json::Value>, // inbox.read's rows, plus a row {"ask": "ask:<id>", …} per ask.created applied since
    pub events: Vec<serde_json::Value>,// each event applied since its reads, in log_pos order, each once
}
pub struct RecordReader { /* … */ }
impl RecordReader {
    /// Connects to the hub's socket as the app, with the control token read from `token_file` (read again at each
    /// connect, since each launch writes a new one), does its reads (inbox.read at least) and subscribes after the
    /// log_pos they reflect.
    pub fn open(socket: &Path, token_file: &Path) -> Result<RecordReader, crate::hub::HubError>;
    /// Handles what comes within `timeout`: applies frames, ignores one whose log_pos it has, refetches from its
    /// last log_pos when a frame isn't the next one and moves to the log_pos the refetch reflects, and, when the
    /// connection has closed, reconnects, redoing its reads when the hub's start ID is new. A hub it can't reach yet
    /// isn't an error: it tries again on the next call.
    pub fn poll(&mut self, timeout: std::time::Duration) -> Result<(), crate::hub::HubError>;
    pub fn view(&self) -> View;
}
```

```toml
# crates/deep-app/Cargo.toml: the Rust tests live here, in tests/acceptance/34/app/, wired in by one entry
[[test]]
name = "acceptance_34"
path = "../../tests/acceptance/34/app/record_reader.rs"
```

The Rust tests can't live under `tests/acceptance/34/` as a crate of their own: a new `Cargo.toml` would have to be a
workspace member and have its dependencies listed in `scripts/repo-rules.json`, so one `[[test]]` entry in deep-app
(which already has one for `screens.rs` outside `tests/`) is the smallest wiring.

### The budgets' perf-lane tasks

`benchmarks/budgets.json` gains `hub-stream` (`["node", "benchmarks/hub.mjs", "stream"]`) and `hub-history`
(`["node", "benchmarks/hub.mjs", "history"]`), each with an `initialReason` naming #34, valid by `validateBudgets`
against the merge base's file, as #16's three hub tasks are.

## Readings where the issue and the design leave a choice

- **"The app" is the Rust app's record reader.** The design names it ("one record reader holds the stream and its
  log_pos and feeds every view"), so the app halves of AC5, AC6, AC10 and AC11 are Rust tests of `RecordReader`. AC5,
  AC6 and AC10 run it against the issue's test stream, a scripted hub on a Unix socket in the test file, since they
  fix interleavings no real hub makes on cue (an ask appended between the read and the subscription, a dropped and a
  repeated frame, a gap that stays empty); AC11 runs it against a real hub on the test VFS, as the criterion says.
  The hub's halves (every read reflects a log_pos and the start ID; frames after it; a new start ID after a cut) are
  TypeScript tests against a real hub.
- **"Subscribes from the stream's current end"** is a `stream.subscribe` with no `after`; the test stream starts such
  a subscription at its current end, as a live tail would.
- **"Shows"** is the reader's view: the ask's row in `View.inbox`; an event in `View.events`. "Applies 702 once" is
  702 once in `View.events`; "refetches from 700 before it applies 702" is an `events.read` from 700 with 701 ahead of
  702 in `View.events`.
- **AC10's "starts no refetch for the frame at 751"** is read as one `events.read` in all, the one from 700, while
  the frames at 751 to 755 arrive one by one after it is answered.
- **Which answers need the trusted path (AC2).** The tests' asks are authority asks (`effect.push`, whose "Push it"
  approves). The design adds answers that save a decision or change what a check demands; no criterion tests those
  kinds. AC4's taste answers are signed by the paired app and OS-confirmed on the CLI, so the test holds whichever way
  an implementation treats a taste call.
- **The OS confirmation is the hub's to ask.** A CLI process can't vouch for itself to the hub, so the hub runs the
  confirmation (LocalAuthentication on macOS, polkit on Linux). `DEEP_HUB_TEST_CONFIRM` is the one seam the tests mock.
  #19 needs the same confirmation for `deep off`; #34's criterion depends on it, so #34 provides the seam.
- **An unsigned app answer is refused even when the OS would confirm you**: the criterion's exception is the CLI's
  alone.
- **Pairing needs the OS to confirm you**, or the control token alone could pair a key and sign: the token-only hub the
  criterion names.
- **"Delivered like a CLI answer" (AC4)** is read through the record, which the agent's adapter delivers from: the
  App API's answer and its twin's from the CLI record the same `ask.answered` (answer, decision, plan_hash, verified,
  a click token or none), both asks leave Needs you answered, and both are on the stream. Delivery into the agent's
  session is the adapter's (the design's "your answer getting back"); the base hub's asks core hands deliveries to
  nothing, so no test sees them.
- **A browser Origin on a JSON-lines socket** is an `origin`/`Origin` field at a line's top level, as a bridge would
  carry the header, or a raw HTTP request with the header. Not a field in `params`: `evidence.paste` has an `origin`
  param of its own (#16).
- **fell_behind (AC7).** The cut-off is an error@2 line with code `fell_behind` on the subscription's id. How many
  frames reach the consumer before it depends on the socket's buffers, so the test bounds it from below with a second
  case: 8,000 events behind is never cut. After the 20,000, one more event is appended while the consumer reads on, so
  a hub that drops frames silently leaves a hole the test names; a cut-off consumer gets it by resuming.
- **The budgets (AC8).** They count only on a reference Mac (Mac15,7 or Mac15,12), with #16's judge; elsewhere each is
  skipped as INCONCLUSIVE, never passed. Power isn't gated on. "Delivers an event to the app within 50 ms" is from a
  hook request written to the app's frame read, 1,000 hooks a run. "30 days of history page in under 300 ms" is read
  as the whole log, #16's 30-day seeding (about 90,000 events), paged through `events.read` from 0 to the end, with
  the app asking up to 10,000 a page; the other reading, one page of it, would already hold at the base.
- **Logs (AC9)** are the hub's stdout and stderr (what its login service writes to `logs/`), the files under
  `<root>/logs/` and `~/Library/Logs/`, and the CLI's output; every form #15 names for a held value is searched.
- **AC11's 899** is a verdict committed `synchronous=FULL` through `test.load`; 1 to 898 are hooks, each one event.
  The tests reach exact log positions with hooks and fail BLOCKED, naming the setup, if the hub's own events get in
  the way.
- **IDs.** Each `describe` names its criterion's ID, `#34.<first 8 hex of the SHA-256 of its text>` (trimmed,
  whitespace collapsed, the `- [ ] ` dropped), as the trace lane reads tags.

## Criteria to tests

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#34.e5ab40cc` | a request without the token is refused | `access.test.ts` AC1 (7): each App API method served with the token; five token-less ways in (no hello, no token as app or CLI, a wrong token, an empty one), each method refused and nothing served; a new token each launch at mode 0600, the last launch's refused |
| AC2 `#34.0e31665e` | an authority answer without a paired device's signature is refused, unless from the CLI with the OS confirming you; a token-only hub fails | `answers.test.ts` AC2 (5): the app's token-only answer refused with the OS ready, then its signed answer counts; a stranger's key, a swapped option and another ask's signature refused; pairing without the OS refused; the CLI's answer refused until the OS confirms, asked once each, the prompt naming the question and option; (wrong program) the token-only hub, naming the ask. `judges.test.ts` AC2 (4): the judge against the twin's answers |
| AC3 `#34.e685e92c` | a request carrying a browser Origin is refused | `access.test.ts` AC3 (5): a hello with the token carrying `origin`/`Origin` (two values); a request line carrying it (two values); an HTTP request and a WebSocket upgrade with an Origin and the token, no 101 or 200, nothing appended |
| AC4 `#34.fbf5f587` | an answer posted here is delivered like a CLI answer | `answers.test.ts` AC4 (2): a taste call and an authority ask, each against its twin answered from the CLI |
| AC5 `#34.ed028526` | cold start: inbox at 800, an ask at 801 before the subscription, subscribe after 800 and show it | `app.test.ts` AC5 → Rust `ac5_cold_start_…` (the test stream; an app subscribing from the current end fails naming the ask); `stream.test.ts` AC5 (1): the hub's half, each read at 800 with the start ID, the first event frame after 800 is 801's |
| AC6 `#34.ef7fb9f9` | 701 dropped, 702 twice: refetch from 700, show 701, apply 702 once | `app.test.ts` AC6 → Rust `ac6_a_dropped_frame_…` (an app applying frames as they come fails naming 701) |
| AC7 `#34.adea68b1` | 20,000 behind: cut off with fell_behind past 10,000, resume gets every missed event in order, none twice; a silent dropper fails naming the first lost | `stream.test.ts` AC7 (3): 20,000; 8,000 never cut; (wrong program) the silent dropper, naming the first log_pos lost |
| AC8 `#34.c677f0f1` | budgets on the reference Mac against the merge base: stream within 50 ms at p95; 30 days of history in under 300 ms | `budgets.test.ts` AC8 (5): the two perf-lane tasks valid against the merge base; each bench mode runs; stream p95; 30 days paged |
| AC9 `#34.fe55a29c` | the token never appears in logs or in the debug bundle | `privacy.test.ts` AC9 (3): two launches' tokens in no log or output; (wrong program) a hub that logs it, named; the debug bundle (BLOCKED on #19 while `deep debug bundle` doesn't exist) |
| AC10 `#34.af8f9478` | 701–749 skipped: at 700, frame 750 → one refetch, move to 750, none for 751; an app staying at 700 fails naming the count | `app.test.ts` AC10 → Rust `ac10_an_app_at_700_…` |
| AC11 `#34.6ce4b9ff` | test VFS, 900–905 lost after being shown: new start ID on the first frame, the app redoes its reads and no longer shows them; resuming after 905 fails naming 900 | `app.test.ts` AC11 → Rust `ac11_after_a_power_cut_…` (a real hub on the test VFS); `stream.test.ts` AC11 (1): the hub's half, the new start ID on the first frame, 900–905 gone, no log_pos handed out again |
| AC12 `#34.a891cda8` | hook stamps "1760013451123456789" and "…790" come back on the stream as two events with those exact strings | `stream.test.ts` AC12 (2): the two stamps on the raw stream; (wrong program) a hub writing seq as a JSON number |

## Wrong programs

Each criterion that names a wrong program has one, kept out of the shipped code, and the test fails on it naming what
the criterion says. Two more (AC9, AC12) name none in the criterion and get one anyway, since their tests would
otherwise pass on the base unproven.

| Criterion | Wrong program | Where | How the test fails on it |
|---|---|---|---|
| AC2 | a hub that counts an answer carrying only the control token | `helpers.ts` `tokenOnlySigner`: the real hub behind a socket that holds a paired key and signs every unsigned answer | the ask is answered; the failure names it. Needs `device.pair`, so BLOCKED at the base; `judges.test.ts` shows the judge on that hub's answers |
| AC5 | an app that subscribes from the stream's current end | a mutant of a sample reader kept outside the checkout (BASE-FAILURE.txt) | "the app doesn't show ask:…" |
| AC6 | an app that applies frames as they come | the same, mutant `apply-as-they-come` | "the app skipped log_pos 701" |
| AC7 | a hub that drops its frames silently | `helpers.ts` `silentDropper`: reads the hub at once and drops frames while its consumer is over 10,000 frames behind | "log_pos N was lost with no fell_behind", N the first lost; runs at the base |
| AC9 | a hub that logs its token | `fixtures/leak-token.mjs`, loaded with `node --import` before the hub | the judge finds it in the hub's stderr; runs at the base |
| AC10 | an app that stays at 700 after the refetch | mutant `stay-after-refetch` | "the app refetched from 700 6 times" |
| AC11 | an app that resumes after 905 | mutant `resume-across-starts` | "the app still shows log_pos 900 …" |
| AC12 | a hub that writes `seq` as a JSON number | `fixtures/seq-as-number.mjs`, loaded with `node --import` before the hub | "no event on the stream carries seq … it came back as a JSON number"; runs at the base |

The base is the wrong program for the rest (BASE-FAILURE.txt).

## What depends on other issues

- **`deep debug bundle` is #19's** (CLI basics: setup, status, doctor, off and on, debug bundle), open at this base.
  AC9's bundle test fails BLOCKED, naming #19, until the command exists; it then reads the file whose path the
  command prints last (gzip inflated) for every form of the token. Until #19 lands, #34's PR proves AC9's log half only
  and says `Part of #34`.
- **Delivery into the agent's session** is the adapter's, behind the asks core's `deliver`; AC4 holds the record's half.
- **The OS confirmation** is shared with #19 (`deep off`); the seam above is #34's, since AC2 needs it.

## Files

- `helpers.ts`: asks seeded through the asks core; the OS confirmation's stand-in; device keys, pairing and signing;
  moving the log to an exact log_pos; the judges; the planted hubs; the reference-Mac check. Reuses #16's helpers.
- `access.test.ts` (AC1, AC3), `answers.test.ts` (AC2, AC4), `judges.test.ts` (AC2's judge), `stream.test.ts` (AC5's and
  AC11's hub halves, AC7, AC12), `privacy.test.ts` (AC9), `budgets.test.ts` (AC8), `app.test.ts` (AC5, AC6, AC10, AC11
  through the Rust target).
- `app/record_reader.rs`: the Rust tests, with the test stream and a real hub on the test VFS.
- `fixtures/seq-as-number.mjs`, `fixtures/leak-token.mjs`: planted hubs, as preloads.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base, and each wrong program's run.
