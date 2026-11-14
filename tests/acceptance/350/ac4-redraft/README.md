# Blind redraft of #350 AC4 (`#350.43f82359`)

> An extension that registers a handler and an action and then fails to start exposes neither; enabling and
> disabling one 20 times leaves no listener or callback it owned; and a call from a removed version that finishes
> after its replacement is active changes no state and delivers nothing through the replacement

Written from the issue and the design only. I did not open `../staged.test.ts`, `../ac9-redraft/`, the host's
implementation, any `dist/`, git history, pull requests or evidence, and I was not told why this test is redrafted.

## What I read

- Issue #350: Scope, criteria, Proof.
- `docs/technical-design.md`: Composition (the sentence on staging and removal, quoted below), Dogfooding; `AGENTS.md`.
- `../README.md`, `../helpers.ts`, `../judges.ts` (its first 60 lines), `../tsconfig.json`, and in `../fixtures/`:
  `starts`, `cyclehub`, `cycle`, `acts`, `replies`, `hooker`, and `user/index.ts.fixture`.
- `tests/acceptance/348/README.md` and `tsconfig.json`; the first 40 lines of `tests/acceptance/111/redraft/README.md`
  (for a redraft README's form).
- `packages/extension-host/src/index.ts`, and from `src/host.ts` the exported type declarations only (`Plant`,
  `HookRequest`, `HookReply`, `ActionTarget`, `ActionCall`, `ActionResult`, `ActionListing`, `InstallFrom`, `Load`,
  `Loaded`, `Refused`, the `ExtensionHost` interface), by line range; no function body.
- `packages/record/src/index.ts`: its head, `Connection` and `Event`. `packages/contracts/src/hook.ts`:
  `JoinedHookReply`.

The design's rule (Composition): "A piece's handlers, actions and outputs are staged while it starts and published
only once it's ready, so one that fails to start exposes none of them [...]. Removing or disabling a piece stops new
calls first and detaches in reverse order of what depends on it, leaving no listener it owned, and a call from a
removed version that finishes after its replacement is active can't change state or deliver through the replacement."

## The surface

`../README.md`'s: `install`, `check`, `load`, `loaded`, `hook`, `callAction`, `disable` of the host's entry,
through `../helpers.ts` (`openWorld`, `openHost`, `installAndLoad`, `releaseEntry`, `toolBefore`, `blocksOf`,
`agentSees`, `tracked`, `alive`, `taskEvent`, `tasksTitled`, `HEADLESS`, `HOOK_GRANT`). The test packages are this
folder's own (`fixtures/`, code with the `.fixture` suffix), prepared as `helpers.ts`'s `pkg` prepares the shared ones.

A hub package's code runs where the test can't count it from a reply alone, so each hub fixture writes a line per run
of its handler or action to a log in a temp folder outside the package (named in its `probe.json`). The test reads
only lines written after a mark it takes, so a conformance run that could write there changes nothing.

## How each clause is checked

### 1. "registers a handler and an action and then fails to start exposes neither"

`fixtures/halfstart`, first-party, in the hub. It registers a `tool.before` handler and the action
`ext.halfstart.ping`, and then fails to start only when the test's folder holds `fail-start`, which the test writes
after conformance passed. The folder is outside the package, so the bytes and digest are the same for both tests.

- **Control.** Without the file it loads; a hook gets its block and a call its action's output.
- **The criterion.** With the file, the package registers both and then waits before it throws. In that window the
  test sends a hook and calls the action; then it lets the start fail. The load must not be `loaded`; neither the
  reply made during the start nor one made after may carry a block of it; neither call may be `done`; it isn't in
  `loaded()`; and the package's log must hold no run of the handler or the action at all.

Why: "staged while it starts and published only once it's ready". "Exposes neither" is read at both moments a wrong
host could expose them: while it starts, and after it failed. Wrong programs caught: publish at registration; keep a
failed start's registrations; report the failed start as loaded.

Only the hub place is tested: a package can be made to pass conformance (run in the sandbox) and then fail at its
load without changing its bytes only where the test can reach it after the check, which is the hub.

### 2. "enabling and disabling one 20 times leaves no listener or callback it owned"

Enable is `load`, disable is `disable` (`../README.md`). Two places, 20 cycles each after a first load and disable:

- **Sandboxed** (`fixtures/pulse`, outside the release). Each load draws its own number; its block carries that
  number and how many times this load's handler ran. Each enable: exactly one block, a number no earlier load had,
  beat 1 then beat 2 on a second hook, and the action answers from the same load. Each disable: no block of it, no
  `failed` entry naming it (a listener still asked of a stopped process), the action isn't `done`, it isn't in
  `loaded()`, and every process the supervisor tracked for the load's run is gone within 5 s.
- **In the hub** (`fixtures/pulsehub`, first-party), where a disabled load's code stays in the process and only the
  host's lists keep it from being called. Each enable: one block, with an ID no earlier load had, and the log shows
  one handler line and one action line, both this load's. Each disable: no block, the action isn't `done`, and the
  log gains no handler or action line of any load.
- Both: after 20 cycles this process holds no more sockets, pipes, servers, child processes or watchers
  (`process.getActiveResourcesInfo()`, timers left out) than after cycle 2.

Why: the "listener" a piece owns is its hook handler and the "callback" its action (the two the criterion's first
clause names), plus what the host holds to reach them (its process and connection). Each is read from outside.
Wrong programs caught: a disable that leaves the handler or action reachable; an enable that adds a handler without
removing the last (two blocks, or an old load answering); a leftover process; a per-cycle leak of a handle.

### 3. "a call from a removed version that finishes after its replacement is active changes no state and delivers nothing through the replacement"

`fixtures/swap`, first-party, in the hub at 1.0.0 and 2.0.0, both in the release. The hub is the place where a
removed version's code can still finish a call: it is still in the process. 2.0.0 replaces 1.0.0 by being installed
and loaded (`../README.md`: "A new version here replaces the old by installing it"); the test then shows `loaded()`
holds 2.0.0 alone and a ping at 2.0.0 answers, and only then lets 1.0.0's call go on.

- **Control.** `ext.swap.hold`, finishing while 1.0.0 is still active, appends its event and returns its output.
- **Changes no state.** A `hold` call to 1.0.0 is in flight when 2.0.0 becomes active. Released, 1.0.0's code
  registers one more `tool.before` handler and appends a `task.created`. The record must hold no such task and no
  new event by `ext:deepbuild/swap`; and the next hook must carry 2.0.0's block alone, with 2.0.0's handler the only
  one that ran.
- **Delivers nothing.** A hook (deadline 60 s) held by 1.0.0's handler and a `hold` call to 1.0.0 are both in flight
  when 2.0.0 becomes active. Released: the call must not come back `done`; the hook's reply, if it comes, must hold
  no block of 1.0.0's; nothing of 2.0.0's ran for either; 2.0.0 then answers a ping and a hook as itself.

Wrong programs caught: a host that leaves a removed version's `deep` object working; one that hands a removed
version's late output or late hook reply on under the extension's name; one that reroutes the late call to 2.0.0.

## What I found ambiguous, and how I read it

- **"A call from a removed version."** It can mean a call the removed version is serving (an action call or a hook
  it was handed) or a call it makes on the host (`deep.record.append`, `deep.on`). I test both: the calls it serves
  are in flight across the replacement, and when they go on they make calls on the host.
- **"Delivers nothing through the replacement."** I read "delivers" as anything of the late call reaching someone:
  an action's output to its caller, a handler's block to the agent. A block in a hook reply is labelled with the
  extension's name, and once 2.0.0 is active that name is the replacement's, so a late 1.0.0 block joined into a
  reply is delivered through it. A narrower reading is possible: that a hook sent while 1.0.0 was active is
  1.0.0's to answer, and only requests made after the replacement count. The Scope's wording ("a removed version's
  late call can't act through its replacement") and "removal stops new calls first and detaches" don't settle it.
  I kept the wider reading because the criterion says "delivers nothing", and the design's "leaving no listener it
  owned" covers a handler still holding a request. The same goes for the late action call not coming back `done`.
- **"Fails to start."** A package whose code registers and then throws (after a wait) at its load, after its
  conformance passed. A load that rejects and one that returns `refused` both count as not started.
- **"Enabling and disabling."** `load` and `disable` of an installed, checked package; not `turnOn`/`turnOff`,
  which are #348's inbound routes.
- **A call that never settles** is taken as delivering nothing, after a bounded wait.

## How to run

Packages built; the command sandbox off (the host starts processes in the platform sandbox).

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/350/ac4-redraft
node node_modules/typescript/bin/tsc -p tests/acceptance/350/ac4-redraft/tsconfig.json
```

## Results

Linux, bubblewrap, Node 24, on the checkout as given (5 runs, `RESULTS.txt`, load average about 5):
every run 6 passed, 1 failed, the same test with the same message each time. The type check passes.

Passed in all 5: both controls, the failed start, 20 cycles sandboxed, 20 cycles in the hub, and "changes no state".

Failed in all 5: "AC4 a removed version's call that finishes after its replacement is active delivers nothing: no
output from its action, no block from its handler, and nothing run on the replacement", at its second assertion
(the late action call's "not `done`" assertion before it passed):

```
AssertionError: the removed version's late reply reaches no agent: {"order":["deepbuild/swap"],"bound":10000,"denies":[],"context":[{"extension":"deepbuild/swap","text":"swap 1.0.0 late handler reply"}],"failed":[]}: expected '{"context":[{"extension":"deepbuild/s…' not to contain 'late handler reply'
```

So a hook that 1.0.0's handler was holding when 2.0.0 became active is answered, after the replacement, with
1.0.0's block under `deepbuild/swap`. The assertions after that line in the same test did not run. I did not change
the test and did not look for the cause.
