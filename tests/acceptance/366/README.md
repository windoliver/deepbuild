# Acceptance tests for #366: plug-in model jobs and pages, and the stocks view end to end

Written first, blind, by a job that never saw an implementation of #366 (none exists at the base). It read:

- issue #366 as of October 31, 2026: its Scope, its six checkbox criteria, its Proof and its Depends on
- `docs/technical-design.md`: Extension API (TypeScript, in-process) (`deep.runner.run`, `deep.registerView`,
  `deep.readNow`, `deep.registerModel`, the first-plug-in tier, Add anything and its seven sentences), the building-block
  rows "Screen and panel" and "Runner", Blocks for plug-ins that do real work (Source and reading, Runner, Read now,
  Notice, Replay and a clock, Panels more fully), "One way to interact, in every scene" (⌘K), and Dogfooding
- `AGENTS.md`
- for conventions: the READMEs, helpers and BASE-FAILURE.txt of #363, #364, #365, #159, #124 and #338;
  `scripts/proof-change.mjs` and `scripts/lanes.mjs`
- the base, read only, at `39980abe`: `packages/extension-host` (host.ts, sources.ts, runtime/deep.mjs),
  `packages/runner`, `packages/contracts` (extension-api.json, the manifest schema), `packages/record`,
  `crates/deep-replica` (`deep-drive`, its plants), `crates/deep-app` (panels, `mount_panel`), `docs/extension-guide.md`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.
The issue has six checkbox criteria, AC1 to AC6, in the body's order.

## How to run

macOS (the runner's jobs and plug-ins run under Seatbelt; the replica renders with Metal), Node 24.22.0 first on `PATH`,
cargo, and a shell whose own sandbox is off (in Claude Code, the Bash tool with its sandbox off):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # if any package's dist is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/366 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/366/tsconfig.json
# by hand only, never in a lane: records the AC1 builds (spends plan usage)
DEEP366_LIVE=1 DEEP366_CLAUDE_OAUTH_TOKEN=... CODEX_API_KEY=... \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/366 ac1-build.live.test.ts
```

- `ac3-page.test.ts` and `ac6-rank.test.ts` build `deep-drive` once with `cargo build --locked -p deep-replica --bin
  deep-drive` (with the toolchain from the real `RUSTUP_HOME`/`CARGO_HOME`, read before HOME moves); a machine that
  can't build it fails them BLOCKED. Each replica gets a copy of the panel, since gpui-shell writes `gpui-kit.d.ts`
  and `jsconfig.json` beside a script it runs.
- `helpers.ts` removes `CLAUDE*`, `DEEP_*`, `ANTHROPIC_*` and `AI_AGENT` from the environment, points `HOME` at a temp
  folder holding a fake Claude Code sign-in (made-up tokens), sets `TZ=UTC`; nothing touches the real `~/.deepbuild`,
  `~/.claude` or Keychain. Temp folders are `/tmp/dh366-*`, removed after each file (and at process exit).
- No network: `api.market.example` and `api.mail.example` are HTTP servers on 127.0.0.1 the test runs, reached only
  through the HTTP client the hub is given, which refuses any other name before a socket. The model is the fake
  `claude` (`fixtures/fake-claude.pl`, cut down from #159's): the agent CLI is the boundary DeepBuild doesn't own.
- Processes: the runner stops its jobs (its `close`); a replica is stopped by its PID; nothing by name or port.
- Vitest may leave `tests/acceptance/366/node_modules/.vite/`; delete it before committing.

## The surface under test (every name below is picked here unless the issue or design names it)

The issue and design name `deep.runner.run`, the runner (#159), pages that take parameters, ⌘K commands, a recency
list that starts empty in a replica, the market host, a session handle, content-free fields and readings with their
freshness. The tests reach them through `packages/extension-host/src/index.ts`, `packages/runner/src/index.ts`,
`packages/record/src/index.ts` and the `deep-drive` binary of `crates/deep-replica`.

### `@deepbuild/extension-host` gains

```ts
import type { Runner } from '@deepbuild/runner';
interface ExtensionHostOptions { /* ... */ runner?: Runner }   // the runner R1 built: every deep.runner.run goes through it
interface ExtensionHost {
  /** Runs the package's own tests (as the extension guide says to write them) on this host's replay and clock. */
  testPackage(pkg: Installed): Promise<{ passed: boolean; testsRun: number; failures: { test: string; message: string }[] }>;
}
```

### The package's side: `deep.runner.run` (preview, in `EXTENSION_API` and the contract)

```ts
deep.runner.run({ prompt: string, inputs: string[] /* handles */, budget: { usd: number }, deadline: number /* ms */ })
  : Promise<{ handle: string /* reading:<id> */, value: unknown, cites: string[], as_of: number, stale_at: number }>
```

- The job runs on the host's runner, on your agent (Claude Code here). The plug-in's prompt reaches the agent's stdin
  with each of its lines intact; the host may add its own. The agent's final result is one JSON object
  `{ "value": ..., "cites": [handle, ...] }` (the host tells it so); the answer is a reading with its own handle.
- `as_of` is the oldest as-of time among the readings it cites; `stale_at` the earliest `as_of + freshFor` among them.
  `deep.notices.send` may cite an answer's handle while fresh and refuses it from `stale_at` on, naming the handle.
- A failed job rejects with an error naming its stop cause (e.g. `rate_limited`); no answer, no text.
- Each input handle is checked against the plug-in's grant before any job is recorded: one the grant doesn't reach
  (a `session:<id>` under a record grant without `text`) rejects naming the handle, `grant` and `text`/content-free.
  Each handle the job cites is filtered the same way: the plug-in gets only cites its grant reaches (or a refusal).
- `deep.registerView(name, panel, area, { pages: [{ name, param, values }], commands: [{ name, action }] })`: the
  fourth argument carries the view's pages and ⌘K commands, and the host wires the call (it says "isn't wired into
  this host yet" at the base). A panel that calls the network itself is refused at install, conformance or load,
  naming the call (`fetch` and the host).

Sandboxed actions return a thrown error's text to nobody (host.ts), so the fixture's `ask` and `notify` actions catch
and answer what the plug-in got as `got`.

### `deep-drive` gains (#124's binary)

- `launch.view`: the view's registration as `deep.registerView` gives it, `{ name, pages, commands }`
  (`fixtures/stocks/view.json`), for the panel in `launch.panel`.
- ⌘K: `act press cmd-k` opens it with its input focused; `cmd-a` then `type` sets the query; its entries are
  `list_box_option` nodes named by the entry, ranked top to bottom; `escape` closes it; clicking an entry opens it.
  A command's entry is its `name`; a page's entries are `<page name>: <value>` per value (`Stock: NVDA`).
- A page opens by mounting the view's panel with `props.page = { name, params: { [param]: value } }` given to the
  script's `init`; the fixture panel then draws `Stock page: NVDA`.
- ⌘K's recency: the live app keeps it in `~/.deepbuild/app/recency.json`, `{ "recent": [entry names, newest first] }`;
  a replica's starts empty and never reads that file.
- `DEEP_DRIVE_PLANT=page-drops-param` (a page opens with no parameters) and `ranks-by-live-recency` (the ranker reads
  the live app's recency file), added to `drive/plant.rs`.

## The recorded builds (AC1)

The replay reads each agent's build from **`docs/evidence/366/stocks/<agent>/`**, `<agent>` = `claude-code`, `codex`:

- `package/`: the package the agent wrote, as written, its manifest's `digest` set by `packageDigest`
- `recording.json`: the host's `recording()` (`{ v: 1, calls }`, secrets stripped) from the passing run
- `build.json`: `{ format: "deep.build@1", sentence, agent: { name, version }, clock, grant, first_try, repair_rounds, built }`

`ac1-build.live.test.ts` writes them (to `$DEEP366_LIVE_OUT` or that folder): the agent, headless on a temp HOME signed
in only through `DEEP366_CLAUDE_OAUTH_TOKEN` / `CODEX_API_KEY`, gets the sentence word for word, the extension guide
and its examples, and `MARKET.md` describing the feed on `api.market.example` (`/v1/quote`, `/v1/history`, key in
`X-Api-Key`, secret `market_key`). The package is then installed (grant: the market host only), checked, loaded, each
polled source read once, and `testPackage` run, on the clock `2026-11-02T14:30Z` against a local feed; a failure goes
back to the agent, up to two repair rounds (the first-try reading for #59, never a pass or fail). The replay does the
same steps in the same order on the recording, the recorded clock and an HTTP client that refuses everything.

**"Uses only these blocks"** (`judges.ts`, `blocksProblems`): `requires.preview` lists only `deep.registerView`,
`deep.readNow`, `deep.registerSource`, `deep.secret`, `deep.store(.put/.get/.list)`, `deep.schedule(.read)`,
`deep.notices.send`, `deep.registerAction`, `deep.runner.run` (all preview, so #139 refuses any call not listed); the
manifest declares no checks, events, provides, uses, replaces, environments, leases, kernel, host, templates or codes;
access words only `hosts`, `agent`; the grant only the market host; the code outside its tests names no other `deep`
member and calls `deep.registerView`; it has a panel (a folder with `main.js`), none of whose code calls `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource` or `deep.fetch`.

**The copy whose panel calls the market host**: the package copied, `fetch("https://api.market.example/q?symbol=NVDA");`
appended to its first panel's `main.js`, the digest set again; it must be refused at install, conformance or load, the
refusal naming `fetch` and `api.market.example`.

## Criteria to tests

IDs as `scripts/proof-change.mjs` computes them. A test headed `(wrong program)` runs the wrong program through the
criterion's judge and expects the judge to name what the criterion says.

| ID | Criterion (short) | Tests | Wrong programs it must fail on |
|---|---|---|---|
| AC1 `#366.c492a7c7` | recorded builds replayed: these blocks, own tests; a panel calling the market host refused, naming the call | `ac1-replay.test.ts`: the replay per agent (2); the fixture package's planted copy (1); the blocks judge (1, wrong program). `ac1-build.live.test.ts` (2, by hand) | the planted copy (fetch from the panel); packages calling `deep.record.query`, a panel fetching, a wider grant, no view |
| AC2 `#366.0ef9a5fd` | jobs through the runner, no model key in the hub; a failed job returns its failure, nothing sent | `ac2-runner.test.ts`: through the runner (1); hub answers itself on a key (1, wrong program); `rate_limited` failure and the unsent brief (1); canned text sent (1, wrong program) | a hub calling `api.anthropic.com` on a key it holds; a hub turning a failed job into canned text that the brief sends |
| AC3 `#366.f41df11e` | a stock's page from ⌘K with the stock as parameter | `ac3-page.test.ts` (2) | `DEEP_DRIVE_PLANT=page-drops-param` |
| AC4 `#366.69164550` | session handle refused before any job, naming the grant; nothing found past the grant | `ac4-grant.test.ts`: refusal (1); unchecked handle (1, wrong program); a job on its own reading (1); the job's cites passed through (1, wrong program) | a hub handing the handle to the runner unchecked (the real runner starts a job); a hub passing the job's cites (`file:` handle) through |
| AC5 `#366.30a7de7d` | an answer citing a 5-minute price reads stale 5 minutes after its as-of; a notice then refused | `ac5-stale.test.ts` (2) | an answer stamped with its job's time (10:02, fresh till 10:07): the 10:05 notice goes out |
| AC6 `#366.792d6463` | same query, same order; exact names first; a ranker reading the live recency file fails, naming the command | `ac6-rank.test.ts` (2) | `DEEP_DRIVE_PLANT=ranks-by-live-recency` |

20 tests, 2 of them live. At the base 13 fail and 5 pass: the wrong-program controls whose judges run on modelled or
base-runner outcomes (BASE-FAILURE.txt says which).

## Readings

- **AC1**: see The recorded builds. A missing recording fails naming the files; no recording is ever skipped.
- **AC2**: "through the runner": exactly one runner job whose stdin holds the plug-in's `@answer` line, Claude Code,
  finished, `apiKeySource: none` (your sign-in and plan), and the plug-in's answer is the agent's value. "Holds no
  model key": no file under the world (record, evidence, hub root, job folders) and no event holds either sign-in
  token, and the hub's HTTP client called no model host. "Its failure": the plug-in's call rejects naming
  `rate_limited` and the runner recorded that stop. "Nothing it would send goes out": the brief action sends only after
  its job answers; with a failed job no request reaches the mail host and `sends()` reads none sent; the control brief
  whose job answers does go out under a standing rule.
- **AC3**: ⌘K for "NVDA" lists `Stock: NVDA`; clicking it draws `Stock page: NVDA`.
- **AC4**: "granted only content-free fields" is a record grant of `['*']` without `text`; "before any job starts":
  no runner job has a pid, a start or a running/finished state. "Finds": the job tries to read your transcript (under
  `~/.claude/projects/`) and a notes file outside the grant, and cites `session:<id>`, `file:<notes>` and the
  plug-in's own price reading; the plug-in must get neither file's text nor any cite but its own reading (a refusal is
  also fine). At the base the runner's sandbox already denies both reads ("Operation not permitted").
- **AC5**: price read at 10:00 (fresh 5 minutes), job at 10:02 citing it; the answer's `as_of` is 10:00 and
  `stale_at` 10:05; a notice citing it at 10:04 goes out, at 10:05 is refused naming the answer's handle.
- **AC6**: queries "Add", "Stock", "a", each twice in one replica, and each of the seven names exactly; then the live
  app's recency file is written (`Add alert above target`, `Stock: AMD`, `Read prices`) and a second replica on the same
  HOME must give the first's orders and exact-name firsts. Only the fixture view's names are judged.

## What the implementer adds to `scripts/lanes.mjs`

- `alone`: `'tests/acceptance/366/'` (the files start sandboxed plug-ins, runner jobs and replicas, and build `deep-drive`)
- `byHand`: `'tests/acceptance/366/ac1-build.live.test.ts'` (real agents on your plan)

## Ambiguities, and how they were read

- "Its own tests": no surface at the base runs a package's tests; `testPackage` is picked, on the host's replay and clock.
- "These blocks": the stocks view's blocks plus Read now and the runner, checked through the manifest and the code.
- "Is refused": at install, conformance or load, whichever gate the implementation uses.
- "Reads stale": the answer's `as_of`/`stale_at` and the notice refusal; no separate reading method is required.
- Codex in AC2: the runner runs only Claude Code at the base, so AC2 is judged on Claude Code; Codex appears in AC1.
- Pages and ⌘K entry names, `props.page`, the recency file and its format, `launch.view` and the two plants are this
  job's names, documented above.
- The modelled wrong programs (AC2's key-holding hub, AC5's stamped answer) prove the judge rejects that outcome; the
  host has no seam for its policy, and adding one would be an option the task doesn't need.

## Files

`helpers.ts` (environment, world with the runner, hosts, providers, packages), `judges.ts`, `drive.ts` (deep-drive and
⌘K), the test files above, `fixtures/fake-claude.pl`, `fixtures/stocks/` (manifest, `index.ts.fixture`, `view.json`,
`panel/main.js`), `tsconfig.json`, `BASE-FAILURE.txt`.
