# Acceptance tests for #989: hosted terminals: resize, a capped log replayed from a checkpoint, input only from the hub, and input that never blocks output

Written first, blind, from issue #989 ("Hosted terminals: resize, a log capped in bytes and replayed from a screen
checkpoint, input only from the hub, and input that never blocks output": its description, Scope, seven acceptance
criteria and Proof line), the design sections it links and those they lean on, and base commit `881e2ed4` ("Merge pull
request #1136 from windoliver/worktree-github-issue-415-d2e96c"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

The issue has seven checkbox criteria, AC1 to AC7 in the body's order. Each test's name starts with its criterion's ID.

What was read:

- `docs/technical-design.md`: Blocks for plug-ins that host something live (Stream: "A terminal's or a log's stream
  applies backpressure instead of silently dropping output"; Canvas: "a terminal's extension parses output in its own
  process and sends screen changes"; Raw input: "It comes only from you. An agent can't send it"; Run-as-you
  permission; Handoff on update (later); Still off-limits: "Input to a terminal comes only from your focused panel, so
  no piece can let an agent type into another session"); Panels and devices, Stream and raw input ("Raw input: keys
  (press, repeat, release), text, paste, mouse, focus and resize, from a panel you focused. It can never: Reach another
  plug-in, or come from an agent") and Cell grid ("A terminal's cells, as frames and row patches against a revision,
  with cursor, scroll …"); Starting a session from the app ("A hosted terminal is held by a small host process the
  supervisor starts for it, so the session keeps running when the app quits or the hub restarts, and the hub reattaches
  when it starts"); One hub per user (the hub's lock); the budget rules (reference Macs, INCONCLUSIVE elsewhere);
  Dogfooding and Tests written first; AGENTS.md's four invariants.
- At the base: AGENTS.md; `tests/acceptance/104/` and `402/` (README, helpers, fixtures, plants, BASE-FAILURE);
  `packages/supervisor/native/helper.c` (`pty` mode: `forkpty` at the start size, `out` appended forever, input through
  the FIFO `in`, a blocking `write_all` of input inside the one `select` loop) and `helper-linux.c` (no `pty` mode);
  `packages/supervisor/src/{bubblewrap,seatbelt,supervisor}.ts`; `packages/extension-host/src/terminals.ts` (the
  terminal's folder `<home>/terminals/<id>/`, `read` from byte 0, `input` writing the FIFO non-blocking and throwing
  once it fills) and its use in `host.ts` (`deep.terminal.*`, `rawInput`, `revoke`, `close`, the `Plant` type);
  `runtime/deep.mjs` (`API`); `packages/hub/src/{lock,paths,core}.ts` (the hub's lock is `<root>/hub-lock.sqlite`, an
  exclusive SQLite transaction the kernel holds for the hub's process; the hub's extension host's `home` is the root);
  `crates/deep-canvas-cells/src/emulator.rs` (scrollback, the alternate screen, `resize`, which at the base truncates
  the bottom rows on a shrink); `crates/deep-show/src/{serve,host}.rs` (#402's PTYs, stream, panel host and resize);
  `scripts/lanes.mjs`.

What the base already does and these tests don't credit: a hosted terminal runs on macOS (`helper pty`), lives past
the app and is read on from its `out` file; `rawInput` is taken only from writer `app`. On Linux `helper-linux.c` has
no `pty` mode, so no hosted terminal opens at all. At the base nothing resizes a hosted terminal, nothing shows its tab
from the hub, the log has no cap and no checkpoint, the FIFO takes any of your processes' writes, input blocks the
host's output loop, and the hub throws partway through a paste that fills the FIFO.

## Run them

On macOS (Seatbelt) or Linux (bubblewrap at `/usr/bin/bwrap`), with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the supervisor's native helper (packages/supervisor/dist/helper)
npx vitest run --root tests/acceptance/989 --no-file-parallelism
npx tsc -p tests/acceptance/989/tsconfig.json   # type-checks once the surface below exists
```

- `--no-file-parallelism`: the files start sandboxed host processes and real process trees, push 204.8 MB through a
  pseudo-terminal, restart the hub side and time redraws. `scripts/lanes.mjs` lists `tests/acceptance/989/` in its
  one-at-a-time list (`alone`) beside `402/` and `104/`.
- The environment: `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment and
  points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`. No network, no model, no real `claude` or
  `codex` binary: every terminal runs `/bin/sh` or a Node script the tests write, run with `process.execPath` (a
  run-as-you sandbox reads your files, so it can run that Node on both platforms).
- The hub's lock: this process is the hub's. `openWorld` takes `<home>/hub-lock.sqlite` the way
  `packages/hub/src/lock.ts` does (an exclusive SQLite transaction, `locking_mode = EXCLUSIVE`), and lets it go when
  the world closes; the next start on the same files takes it again, from the same PID.
- Temp folders: every package, record, home and program folder is under `/tmp/dh989-*`, removed after its file.
- Processes are stopped only by PID: ones a test's own programs noted (each writes its PID to a file), their parents
  the tests looked up (the host processes), or ones the supervisor recorded as `process.tracked@1` in a record the test
  made, each only while it still has the start time first seen or recorded for it. Never by name or port. Hosted
  terminals outlive a host's `close` by design, so after each file the helpers stop what a test left running.
- With `--root` here, Vitest may write its cache under `tests/acceptance/989/node_modules/.vite/`; delete it.
- Timing: AC1's 100 ms redraw and AC3's 500 ms reattach are asserted as the issue states them, on every machine, as
  hard limits: they are criteria of behaviour, not the design's budgets, so the reference-Mac INCONCLUSIVE rule is not
  applied to them. Every functional half (sizes printed, rows kept, bytes on disk, modes, input refused, the paste whole,
  the program's PID) is a hard assertion too. AC3 takes a few minutes (204.8 MB through a pseudo-terminal, twice with
  its wrong program).

`BASE-FAILURE.txt` is the run at the base: every test fails, each for the reason it lists.

Nothing missing passes (invariant 2): a step a scenario needs that doesn't run (an install, an approved piece's open, a
program's note, a tab that never shows its program's first screen, a host that writes no log or checkpoint to remove, an
agent's shell that finds no way in to try) throws and fails the test, naming it; a wrong-program test whose scenario
can't reach its plant fails too.

## The surface under test

The issue names behaviours of the host process and the hub but no code API. These tests extend the existing public
entries in their style: `ExtensionHost` and `openExtensionHost`'s options from `packages/extension-host/src/index.ts`
(#348, #104), the extension API's `deep.terminal.*` methods (#104), and the terminal's folder on disk as the base keeps
it, on a real record, a real supervisor (#236) in the platform sandbox, the real native helper and real processes.
Nothing else is needed: no new package, binary, flag or export beyond what is below.

### `ExtensionHost`: two methods, and `rawInput`'s contract

```ts
/** What the app's tab for a hosted terminal shows now, from the hub's cell grid for it. Answered for every terminal the
 *  hub knows from `ready()` on, whether or not its piece has loaded yet. The connection is the app's (writer `app`). */
tab(connection: Connection, terminal: string): Promise<TerminalTab>;
/** The focused tab's size in cells, from the app (writer `app`): it reaches the program through the host as its
 *  pseudo-terminal's new size and its SIGWINCH, and the tab's grid takes the size too (a shrink keeps the bottom rows
 *  and the cursor, and moves the top rows into the scrollback). Resolves once both have it. */
resize(connection: Connection, terminal: string, cols: number, rows: number): Promise<void>;
```

`TerminalTab`, exported as a type beside `ExtensionHost`:

```ts
interface TerminalTab {
  terminal: string;
  cols: number;
  rows: number;
  /** The screen, top row first, `rows` strings, each row's text with its trailing blanks trimmed. */
  screen: string[];
  /** The scrollback, oldest first, in the same form. */
  scrollback: string[];
  /** Where the cursor is on the screen, 0-based. */
  cursor: { row: number; col: number };
  /** Whether the tab takes input: false while the terminal runs on a host of another protocol version. */
  input: boolean;
  /** What the tab says over its grid, or null; for a host of another protocol version it says the terminal runs on an
   *  older host, naming the host's version and the hub's. */
  notice: string | null;
  /** The session reads as ended: its program and host are gone, and the tab offers Resume. */
  ended: boolean;
}
```

`rawInput(connection, terminal, text)` keeps its #104 signature and its writer rule, and now: it resolves once the host
has taken the whole text, which the host then writes to the program as its pseudo-terminal takes it; it sends with
backpressure, so a text is taken whole or refused whole, never cut partway; and it is refused (throws, and nothing
reaches the program) while the terminal runs on a host of another protocol version.

### The extension API: one method, needing `run_as_you`

- **`deep.terminal.close(terminal)`** → resolves once the terminal's host process and program are stopped and its
  folder, log and checkpoint are removed. `EXTENSION_API` lists it with `needs: 'run_as_you'`, like the other three.

`deep.terminal.open`, `list` and `read` keep their #104 shapes; `read` reads what the log still holds.

### `openExtensionHost`: one option, and one export

- **`terminalProtocol?: number`**: the hosted-terminal host protocol version this hub speaks and the hosts it starts
  state when the hub connects. Default: **`TERMINAL_PROTOCOL`**, a number exported from the entry, this build's
  version. The tests set it only to `TERMINAL_PROTOCOL - 1`, standing in for the last release's hub and the hosts it
  left running.

### The terminal's files, and its input

- The terminal's folder stays where the base keeps it, `<home>/terminals/<id>/` (`<id>` is the terminal's handle
  without `term:`), mode 0700. It holds **`log`**, the ring of the program's output, at most 8 MiB (8,388,608 bytes),
  mode 0600, and **`checkpoint`**, one checkpoint of the screen and its modes, written each time the ring wraps, mode
  0600. Other entries are small (none over 64 KiB, regular files 0600). Nothing else under the hub's root or `HOME`
  grows with the output.
- The host's input is a socket in that folder, the only way in: it takes input only from a connection whose peer's PID
  (`SO_PEERCRED`/`LOCAL_PEERPID`) is the process holding the hub's lock, `<home>/hub-lock.sqlite`. Any other is refused
  and recorded: an event in the hub's record, after the attempt, whose `data` names the terminal (its `terminal`
  handle) and the writer's PID (a number anywhere in `data`); its kind is the implementer's.
- The host is the program's parent process (it holds the pseudo-terminal), as at the base.

### The test piece and the programs

`fixtures/hosted/` is a piece with run-as-you and #104's `host` declaration (terminals, past the app). Its actions:
`ext.hosted.open` ({argv, cwd, title, cols, rows} → `{opened: {terminal, run, pid}}` or `{refused}`), `ext.hosted.tabs`
(`deep.terminal.list()`), `ext.hosted.read` ({terminal, from} → `{text, next}`) and `ext.hosted.close` ({terminal} →
`{closed: true}` or `{refused}`). It has no way to type into or size a terminal.

The programs, written by `helpers.ts` into the test's folder: a **full-screen** program (on the alternate screen, a
`+--+` / `|  |` frame filling its terminal with `size CxR` on row 2, drawn at start and on every SIGWINCH at the size
its terminal has then), a **sizes** program (prints `size CxR` on every SIGWINCH), a **numbered** writer (lines of 64
bytes, `L` and a 9-digit number, as fast as its terminal takes them; optionally then one more every 50 ms, logging
what it reads), a **reader** (#104's: raw mode, logs every byte) and a **slow reader** (raw mode, takes 1 MiB a second,
prints `beat N` every 50 ms). AC2 runs `/bin/sh` printing `line 1` to `line 200`. AC5's agent shell is `/bin/sh`
execing Node with a script that writes into every FIFO and socket in the terminal's folder.

### Connections

`YOU` is `{writer: 'app', actor: 'you', scope: 'you'}`: the app, whose focused tab sends keys, paste and size.

## Planted programs

Each is a `Plant` value of `openExtensionHost`, reachable only from tests, there to prove a test fails on a wrong
program; every test headed `(wrong program)` runs the same scenario on it and asserts the failure names what its
criterion says. `Plant` gains these nine values:

| Value | The wrong program | Test |
|---|---|---|
| `keeps-start-size` | on a resize the host sends the program SIGWINCH but leaves the pseudo-terminal at its start size | AC1: fails naming the sizes terminal, whose program printed `[80x24, 80x24]` |
| `resize-drops-bottom-rows` | a shrink of the tab's grid keeps the top rows and drops the bottom ones (the base emulator's `resize`) | AC2: fails showing `line 151` to `line 170`, naming `line 181` as the first missing |
| `replays-from-first-byte` | the host keeps every byte in `log`, uncapped, and a reattach replays it from the first | AC3: fails naming `<folder>/log`, over the 8,388,608-byte cap or over 500 ms |
| `leaves-files-on-close` | `deep.terminal.close` stops the terminal and leaves its folder's files | AC4: fails naming `<folder>/log` and `<folder>/checkpoint` |
| `input-through-fifo` | the host also reads input from a FIFO `in` in the terminal's folder, which any of your processes can open (the base's way in) | AC5: fails naming the agent shell's PID, whose `echo planted` the program read |
| `input-blocks-output` | the host writes input to the pseudo-terminal with a blocking write inside its one loop (the base's `write_all`) | AC6: fails showing no new output on the tab for the drain |
| `hub-throws-when-full` | the hub writes input without backpressure and throws once the host's input is full (the base's `input`) | AC6: fails naming the byte where the paste stopped |
| `stops-older-host` | a hub that finds a host of another protocol version stops it | AC7: fails naming the host's PID and the session |
| `older-host-reads-ended` | a hub that finds a host of another protocol version reads its session as ended (`ended: true`, Resume offered) | AC7: fails naming the host's PID and the session |

## Criteria to tests

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A tab grown from 80×24 to 200×50 and back shows a full-screen program redrawn at each size within 100 ms, and a program printing its size on each change prints both | `resize.test.ts`: two terminals of 80×24; once the tab shows the full-screen program's 80×24 frame, `resize` to 200×50, then 80×24; each time the tab must show the frame drawn at that size, every row, within 100 ms of the call; the sizes program, resized the same way, must print exactly `200x50` then `80x24`. Fails on `keeps-start-size` (`[80x24, 80x24]`, naming the terminal) |
| AC2 | Shrinking a 50-row terminal whose program printed 200 numbered lines to 20 rows shows lines 181 to 200 with the cursor below them, and 1 to 180 in the scrollback in order | `resize.test.ts`: 80×50, `line 1` … `line 200`; before: the screen is 151–200, the scrollback 1–150; after `resize` to 80×20: the screen is exactly `line 181` … `line 200`, the cursor after `line 200` on the bottom row (row 19, column 8), the scrollback exactly `line 1` … `line 180`. Fails on `resize-drops-bottom-rows` (151 to 170, first missing `line 181`) |
| AC3 | 200 MB of numbered lines leave at most 8 MB of log plus one checkpoint, 0600 in a 0700 folder; after the hub restarts the tab shows the last screen and its scrollback as the checkpoint and tail give them, within 500 ms | `log.test.ts`: 3,200,000 lines of 64 bytes (204,800,000 bytes) in a 100×30 terminal; once done and the live tab shows the last screen: the folder 0700, `log` ≤ 8,388,608 bytes and 0600, one `checkpoint` 0600, nothing else large, and the world's files (but the record) within the log, the checkpoint and 1 MiB. The hub restarts (host, supervisor, record and lock closed; opened again on the same files); from the moment `openExtensionHost` is called, the tab must show the last screen (lines 3,199,972 to 3,200,000, the cursor on the empty row below) within 500 ms, and its scrollback, oldest first, must be numbered lines in order ending at line 3,199,971. Fails on `replays-from-first-byte`, naming the log |
| AC4 | Closing the terminal removes its log and checkpoint | `log.test.ts`: 150,000 lines (9.6 MB, past one ring), so the host wrote both; `ext.hosted.close`; then neither file, nor anything else in the folder, is on disk. Fails on `leaves-files-on-close`, naming both files |
| AC5 | A shell an agent started in another session that opens the terminal's input and writes `echo planted` is refused, the program receives nothing, and the record names the writer's process; the hub's own write of a focused-tab key goes through | `input.test.ts`: a reader; a `/bin/sh` the test starts outside the hub (with an agent session's environment) execs a writer that opens every FIFO and socket in the terminal's folder and writes `echo planted\r`; 1.5 s later the reader has read none of it, and within 5 s an event names the terminal and the writer's PID; then `rawInput` from the app reaches the reader. Fails on `input-through-fifo`, naming the writer's PID |
| AC6 | A 4 MB paste into a slow reader arrives whole and in order while its output keeps reaching the tab; a blocking host shows no output, and a throwing hub delivers part and fails naming the byte | `input.test.ts`: 4 MiB (4,194,304 bytes) of numbered lines through `rawInput` into a reader taking 1 MiB a second and beating every 50 ms; the reader's log must equal the paste byte for byte, `rawInput` must not throw, and while it drains the tab, read every 20 ms, must never go more than 500 ms without a new beat. Fails on `input-blocks-output` (no new output) and `hub-throws-when-full` (the byte where the paste stopped) |
| AC7 | Under a host reporting an older protocol version, restarting the hub at the newer version leaves the program's PID and its lines advancing; the tab names both versions and shows the last screen read-only; a hub that stops the host, or reads the session as ended, fails naming the host's PID and the session | `version.test.ts`: a hub with `terminalProtocol: TERMINAL_PROTOCOL - 1` opens a numbered program (150,000 lines, then one every 50 ms); the hub restarts at the default; then the host (the program's parent) and the program run on with the same start times and PID note, its lines advance, the piece lists that one terminal with the same PID, the tab is not `ended`, its notice says `older host` and names both numbers, `input` is false, its screen is 29 or more consecutive numbered lines no newer than the program had written at the restart and doesn't change in the next second, and `rawInput` from the app is refused and never read. Fails on `stops-older-host` and `older-host-reads-ended` |

The Proof line ("each criterion run on this branch and on the merge base, … with the byte counts and timings pasted")
is this suite run on both, with its own messages giving the byte counts (log size, the byte where a paste stopped) and
timings (redraw and reattach ms).

## Readings where the issue and design leave a choice

- **"The tab."** The hub's view of the hosted terminal: its cell grid as the app's tab would draw it, read through
  `ExtensionHost.tab`. A program's own output read through `deep.terminal.read` stands for "prints" (AC1's sizes).
- **"With the cursor below them" (AC2).** Twenty rows can't hold lines 181 to 200 and a row below them; the wrong
  program's "151 to 170" says the 50-row screen held 151 to 200, so line 200 ends without a newline and the cursor
  rests after it on the bottom row, where the newest output is. The test asserts exactly that position.
- **"8 MB", "200 MB", "4 MB".** The cap is read as 8 MiB (8,388,608 bytes), the larger reading. The busy program
  writes 204,800,000 bytes, at least 200 MB in either reading and no whole number of 8 MB or 8 MiB rings, so the tail
  after the last checkpoint is never empty by coincidence. The paste is 4 MiB.
- **"Exactly as the checkpoint and tail give them" (AC3).** The checkpoint's format is the implementer's, so the test
  holds the result to what the program wrote: the screen is the program's last 29 lines and the cursor below them,
  the same as the live tab before the restart; the scrollback, whatever its length, is the numbered lines in order
  ending right above the screen. "Within 500 ms" runs from the call to `openExtensionHost` (the record and supervisor
  already open) to the first `tab` read that shows that screen; the piece loads after.
- **"At most 8 MB of log plus one checkpoint on disk."** The log file is capped; exactly one file named `checkpoint`
  and no second one; and every file of the world and of `HOME` but the record (`ledger.db*`) together within the log,
  the checkpoint and 1 MiB, so a host can't keep the full output elsewhere under the hub's root.
- **"A shell started by an agent in another session"**: a real `/bin/sh` of yours, outside the hub and outside any
  sandbox (the strongest case: any of your processes), with an agent session's environment; it writes `echo planted`
  as the criterion says, raw, into every FIFO and socket the terminal's folder offers. "Refused" is read from its
  effects: the program reads nothing, and the record names the writer's PID.
- **"The hub's own process"**: the process holding the hub's lock. In these tests that is the test process, which
  holds `<home>/hub-lock.sqlite` as the hub does. #104's suite opens an extension host without taking the hub's lock
  (it predates this rule); whether its `rawInput` tests still pass under it is outside this suite and for the
  implementer to raise.
- **"While it drains the program's output keeps reaching the tab" (AC6).** The drain runs from the `rawInput` call until
  the reader has read the whole paste (about 4 s at 1 MiB a second), or nothing more came for 3 s; "keeps reaching"
  is no stretch over 500 ms (ten beats) without a new beat on the tab.
- **"The session" (AC7)** is the hosted terminal the tab shows, named by its `terminal` handle; "the host's process
  ID" is the program's parent's. "Shows the last screen read-only" is read as a screen of the program's consecutive
  numbered lines, none newer than at the restart, that holds still while the program runs on, with input off.
- **"Restarting the hub at the newer version"**: the extension host, supervisor, record and lock close, and open again
  on the same files with the default `terminalProtocol`; `terminalProtocol: TERMINAL_PROTOCOL - 1` stands in for the
  older release, whose hosts are the same helper stating that version.
- **"Closing the terminal" (AC4)**: the piece's `deep.terminal.close`, which a tab's close goes through.

## Not tested, and why

- "When two views show one terminal, the focused one sets the size and the other draws it scaled or clipped": in the
  Scope, but no criterion names it.
- "Resumed under the current host" after an older host's session ends: in the Scope, not in AC7.
- That the record names a refused writer's program as well as its PID: AC5 says "names the writer's process"; the PID
  is what identifies it.
- The cell grid's own drawing in the app's panel (#402's tests).

## The Oracle lane

The issue names no upstream test; the host process, its protocol and its files are this design's own, so nothing
upstream is ported and these tests are the local proof for every criterion.
