import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputs as configInputs } from './config-eval.mjs';
import { inputs as verdictInputs } from './verdict-proofs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// The repo's declared test paths. The unit lane's runners take their file patterns from them, and perf
// sets the test files a change adds or modifies apart by them.
export const testPaths = ['tests/**', 'packages/**/test/**', 'packages/**/*.test.ts', 'crates/*/tests/**'];
/** A runner's file patterns: each declared path narrowed to that runner's test files. Cargo finds its own. */
export const testGlobs = (extension) => testPaths
  .map((path) => (path.endsWith('/**') ? `${path}/*.test.${extension}` : path))
  .filter((glob) => glob.endsWith(`.test.${extension}`) && !glob.startsWith('crates/'));

/** Vitest files a lane of their own runs, so the unit lane leaves them out. */
export const ownLane = ['tests/acceptance/684/lean.test.ts'];
/**
 * Vitest files the unit lane runs one at a time, after the parallel block (see the lane); affected.mjs does so with any
 * runner. tests/acceptance/327/ holds answers-redraft/, the blind redraft that is #327 AC2's hub-side test (its README);
 * the earlier answers.test.ts there keeps AC7, AC15 and AC16, so the folder runs whole.
 */
export const alone = ['tests/acceptance/1172/', 'tests/acceptance/84/', 'tests/acceptance/580/', 'tests/acceptance/67/', 'tests/acceptance/994/hub.test.ts', 'tests/acceptance/994/deadline-redraft/', 'tests/acceptance/20/', 'tests/acceptance/65/', 'tests/acceptance/82/', 'tests/acceptance/1202/', 'tests/acceptance/55/', 'tests/acceptance/103/', 'tests/acceptance/363/', 'tests/acceptance/365/', 'tests/acceptance/262/', 'tests/acceptance/366/', 'tests/acceptance/356/', 'tests/acceptance/24/', 'tests/acceptance/26/', 'tests/acceptance/389/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/', 'tests/acceptance/393/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/855/', 'tests/acceptance/857/', 'tests/acceptance/854/', 'tests/acceptance/896/', 'tests/acceptance/881/', 'tests/acceptance/411/', 'tests/acceptance/488/', 'tests/acceptance/489/', 'tests/acceptance/490/', 'tests/acceptance/490-redraft-2/', 'tests/acceptance/490-oracle/', 'tests/acceptance/490-oracle-redraft/', 'tests/acceptance/491/', 'tests/acceptance/388/', 'tests/acceptance/16/', 'tests/acceptance/373/', 'tests/acceptance/160/', 'tests/acceptance/96/', 'tests/acceptance/374/', 'tests/acceptance/375/', 'tests/acceptance/670/', 'tests/acceptance/138/', 'tests/acceptance/185/', 'tests/acceptance/200/', 'tests/acceptance/417/', 'tests/acceptance/418/', 'tests/acceptance/221/', 'tests/acceptance/412/', 'tests/acceptance/1098/budgets.test.ts', 'tests/acceptance/1015/claude.test.ts', 'tests/acceptance/1015/codex.test.ts', 'tests/acceptance/1015/focused.test.ts', 'tests/acceptance/1015/waiter.test.ts', 'tests/acceptance/1015/memory.test.ts', 'tests/acceptance/1015/gpu.test.ts', 'tests/acceptance/1015/redraft/own-repo.test.ts', 'tests/acceptance/1015/budgets.test.ts', 'tests/acceptance/1143/', 'tests/acceptance/399/', 'tests/acceptance/87/gate/',
  'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/377/', 'tests/acceptance/378/', 'tests/acceptance/420/', 'tests/acceptance/421/', 'tests/acceptance/423/', 'tests/acceptance/424/', 'tests/acceptance/419/', 'tests/acceptance/428/', 'tests/acceptance/430/', 'tests/group-compositor.test.ts', 'tests/acceptance/1297/', 'tests/acceptance/422/', 'tests/acceptance/425/', 'tests/scene3d-interface.test.ts', 'tests/scene3d-shading.test.ts', 'tests/acceptance/441/', 'tests/acceptance/440/', 'tests/acceptance/443/', 'tests/acceptance/433/', 'tests/acceptance/671/', 'tests/acceptance/1162/', 'tests/acceptance/381/', 'tests/acceptance/398/', 'tests/acceptance/397/', 'tests/acceptance/406/', 'tests/acceptance/238/', 'tests/acceptance/415/', 'tests/acceptance/383/', 'tests/acceptance/384/', 'tests/acceptance/400/', 'tests/acceptance/401/', 'tests/acceptance/105/', 'tests/acceptance/498/', 'tests/acceptance/806/', 'tests/acceptance/402/', 'tests/acceptance/104/', 'tests/acceptance/989/', 'tests/acceptance/327/', 'tests/acceptance/379/', 'tests/acceptance/777/', 'tests/acceptance/823/', 'tests/acceptance/856/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts', 'tests/acceptance/311/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/331/', 'tests/acceptance/315/', ...['replay', 'budgets', 'process-start'].map((f) => `tests/acceptance/21/${f}.test.ts`), 'tests/acceptance/348/', 'tests/acceptance/349/', 'tests/acceptance/351/', 'tests/acceptance/355/', 'tests/acceptance/884/', 'tests/acceptance/139/',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/666/fast.test.ts', 'tests/acceptance/668/fast.test.ts', 'tests/acceptance/567/fast.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts', 'tests/acceptance/237/', 'tests/acceptance/34/', 'tests/acceptance/667/', 'tests/acceptance/380/', 'tests/acceptance/382/', 'tests/acceptance/386/', 'tests/acceptance/1174/', 'tests/acceptance/371/', 'tests/acceptance/376/', 'tests/acceptance/306/', 'tests/acceptance/403/', 'tests/acceptance/429/', 'tests/acceptance/483/', 'tests/acceptance/484/',
  'tests/acceptance/18/kit/', 'tests/acceptance/18/session/', 'tests/acceptance/18/binding/', ...['callers', 'failures', 'loops', 'mcp', 'prompts', 'record', 'replies'].map((f) => `tests/acceptance/18/mapping/${f}.test.ts`),
  'tests/acceptance/453/',
  ...['coexist', 'disable', 'install', 'stophold', 'tamper', 'waiter'].map((f) => `tests/acceptance/18/install/${f}.test.ts`), 'tests/acceptance/19/',
  'tests/acceptance/1312/',
  'tests/acceptance/629/',
  'tests/acceptance/25/routes/', 'tests/acceptance/25/fallbacks/', 'tests/acceptance/25/live/budgets.test.ts', 'tests/acceptance/321/', 'tests/acceptance/303/', 'tests/acceptance/322/', 'tests/acceptance/323/', 'tests/acceptance/324/', 'tests/acceptance/325/', 'tests/acceptance/347/', 'tests/acceptance/340/',
  'tests/acceptance/29/hub.test.ts', 'tests/acceptance/29/slots.test.ts', 'tests/acceptance/907/slots.test.ts', 'tests/acceptance/907/background.test.ts', 'tests/acceptance/965/', 'tests/acceptance/996/', 'packages/hub/test/loop-starters.test.ts', 'packages/hub/test/loop-transcript.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/1175/',
  'tests/acceptance/23/permissions/', 'tests/acceptance/23/match/budgets.test.ts', 'tests/acceptance/83/', 'tests/acceptance/120/budgets.test.ts', 'tests/acceptance/120/budgets-idle-redraft.test.ts',
  ...['wake', 'repeat', 'waits', 'budgets'].map((f) => `tests/acceptance/27/${f}.test.ts`), 'tests/acceptance/27/outcomes-redraft/', 'tests/acceptance/27/desktop-redraft-2/', 'tests/acceptance/124/', 'tests/acceptance/906/', 'packages/hub/test/drive.test.ts',
  'tests/acceptance/990/',
  'tests/acceptance/140/gpu/', 'tests/acceptance/140/view/', 'tests/acceptance/140/platform/', 'tests/acceptance/309/', 'tests/acceptance/385/', 'tests/acceptance/874/redraft/',
  ...['cycles', 'planted', 'leftovers', 'sessions/readings', 'sessions/planted'].map((f) => `tests/acceptance/824/${f}.test.ts`), 'tests/acceptance/1285/', 'tests/acceptance/1294/'];
/**
 * Vitest files run by hand, as their READMEs say: #685's proof checks need Lean 4.35 and Kani 0.68 installed, and
 * minutes; #666's, #668's and #669's live checkpoints and #18's live sessions start real Claude Code sessions on your plan, so
 * only the release preflight runs them (releaseLanes, below). #112's live eval replays 20 real tasks you export from
 * your archive, on your plan for up to two hours, so only you run it (tests/acceptance/112/README.md, The live run).
 * #27's first AC3 draft is kept as written but run by hand only: its step 3 is satisfied by step 1's wake (every ask
 * shares the option ID green), so its blind redraft, desktop-redraft/, was AC3's test (the owner's call on PR #816).
 * That redraft and outcomes.test.ts read `delivered` at once after a hook replies, which a hub that confirms delivery
 * from the transcript records only after; their second blind redrafts, desktop-redraft-2/ (AC3) and
 * outcomes-redraft/ (AC4's Oct 9 cases), run in their place, and the two are kept as written, by hand only.
 * #124's live sessions start real Claude Code and Codex sessions on your plan, and its budgets count only on the
 * reference Mac (tests/acceptance/124/README.md, Live only). #883's Proof reads the Mac's own Notification Center,
 * so it needs the app bundle allowed to notify. #874's first draft is kept as written, by hand only: the command check
 * kind (#30) reads its here-document check as untraced, so it never passes on a snapshot; its blind redraft, redraft/,
 * runs in its place. #824's per-session redraft, sessions/redraft-readings/, is kept as written, by hand only: it holds
 * deep-actions to a Node process's size and reads an event's session as `session_id`, so the first draft, with two
 * edits approved on 2026-11-03 (tests/acceptance/824/sessions/README.md), runs in its place.
 * #14's first AC6 redraft is kept as written, by hand only: it allows no event but the ones it
 * appended, and since #570 the record also appends the core's move.refused for each move a lifecycle table refuses;
 * its blind redraft, ac6-redraft-2/, runs in its place (the owner's call on PR #1232).
 * #1015's first AC7 draft is kept as written, by hand only: its sessions put a stand-in `cargo` first on PATH, which
 * answers affected.mjs's own `cargo metadata` and marks the run started before any block runs; its blind redraft,
 * redraft/own-repo.test.ts, runs in its place.
 */
export const byHand = ['tests/acceptance/685/', 'tests/acceptance/1202/session.live.test.ts', 'tests/acceptance/666/session.live.test.ts', 'tests/acceptance/668/session.live.test.ts', 'tests/acceptance/567/session.live.test.ts', 'tests/acceptance/669/session.live.test.ts', 'tests/acceptance/1156/session.live.test.ts', 'tests/acceptance/18/mapping/record.live.test.ts', 'tests/acceptance/18/install/tamper.live.test.ts', 'tests/acceptance/21/sessions.live.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/112/live.test.ts', 'tests/acceptance/27/session.live.test.ts', 'tests/acceptance/27/desktop.test.ts', 'tests/acceptance/27/desktop-redraft/', 'tests/acceptance/27/outcomes.test.ts', 'tests/acceptance/806/live.test.ts',
  'tests/acceptance/124/ac1-agents.live.test.ts', 'tests/acceptance/124/ac5-budgets.live.test.ts', 'tests/proof/883/', 'tests/proof/994/', 'tests/acceptance/366/ac1-build.live.test.ts', 'tests/acceptance/140/gpu/color.live.test.ts',
  'tests/acceptance/140/gpu/capture.live.test.ts', ...['empty', 'invalid', 'starts'].map((f) => `tests/acceptance/874/${f}.test.ts`),
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts', 'tests/acceptance/824/sessions/budgets.long.test.ts',
  'tests/acceptance/824/sessions/redraft-readings/', 'tests/acceptance/14/ac6-redraft.test.ts', 'tests/acceptance/1015/own-repo.test.ts', 'tests/acceptance/1016/',
  // #994: real windows that take focus, a real hub, and 100 s of the retry schedule by the clock.
  'tests/acceptance/994/app.test.ts', 'tests/acceptance/994/taste.test.ts'];

/**
 * Test files whose verdict reads the machine's load or timing (docs/parallel-proof.md, section 7), which run only under
 * a timed grant: affected.mjs with --timed, and the before and trace lanes. They are the files that call
 * environmentProblem(, judgeTiming, judgeLimit, referenceMacProblem or notReference, or gate on a helper's
 * `status === 'INCONCLUSIVE'`; those that gate on the load or a reference Mac through a helper of another name, as
 * #120's inconclusiveIfLoaded, #34's notReferenceMac, #104's judge, #25's judgeP95 and #906's mustBeHeld; and those
 * judging a wall-clock budget, named one by one. A rule by what a file imports marks 386 files, so none is used.
 */
export const timed = [
  'tests/acceptance/103/budgets.test.ts', 'tests/acceptance/104/budgets.test.ts',
  'tests/acceptance/105/budgets.test.ts', 'tests/acceptance/105/live.test.ts',
  'tests/acceptance/1097/budgets.test.ts', 'tests/acceptance/1098/budgets.test.ts',
  'tests/acceptance/111/budgets.test.ts', 'tests/acceptance/1113/load.test.mjs', 'tests/acceptance/112/live.test.ts',
  'tests/acceptance/120/budgets-idle-redraft.test.ts', 'tests/acceptance/120/budgets.test.ts',
  'tests/acceptance/124/ac5-budgets.live.test.ts', 'tests/acceptance/138/budgets.test.ts',
  'tests/acceptance/139/budgets.test.ts', 'tests/acceptance/14/budgets.test.ts',
  'tests/acceptance/140/platform/budgets.test.ts', 'tests/acceptance/140/view/access.test.ts',
  'tests/acceptance/140/view/parity-planted-redraft.test.ts', 'tests/acceptance/140/view/parity.test.ts',
  'tests/acceptance/140/view/timing.test.ts', 'tests/acceptance/15/budgets.test.ts',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/16/budgets.test.ts',
  'tests/acceptance/18/kit/budgets.test.ts', 'tests/acceptance/185/budgets.test.ts',
  'tests/acceptance/19/status/budgets.test.ts', 'tests/acceptance/20/budgets.test.ts',
  'tests/acceptance/200/budgets.test.ts', 'tests/acceptance/21/replay.test.ts',
  'tests/acceptance/21/sessions.live.test.ts', 'tests/acceptance/23/match/budgets.test.ts',
  'tests/acceptance/236/budgets.test.ts', 'tests/acceptance/237/budgets.test.ts',
  'tests/acceptance/238/budgets.test.ts', 'tests/acceptance/24/budgets.test.ts',
  'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/25/live/budgets.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/routes/twenty-minutes.test.ts',
  'tests/acceptance/25/routes/wake.test.ts', 'tests/acceptance/26/budgets.test.ts',
  'tests/acceptance/262/budgets.test.ts', 'tests/acceptance/27/budgets.test.ts',
  'tests/acceptance/28/budgets.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/30/budgets.test.ts', 'tests/acceptance/303/budgets.test.ts',
  'tests/acceptance/304/budgets.test.ts', 'tests/acceptance/305/budgets.test.ts',
  'tests/acceptance/306/budgets.test.ts', 'tests/acceptance/31/budget-snapshot.test.ts',
  'tests/acceptance/31/budgets.test.ts', 'tests/acceptance/311/budgets.test.ts',
  'tests/acceptance/315/budgets-overhead-redraft.test.ts', 'tests/acceptance/315/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/325/timing.test.ts',
  'tests/acceptance/331/budgets.test.ts', 'tests/acceptance/34/budgets.test.ts',
  'tests/acceptance/340/flow/budgets.test.ts', 'tests/acceptance/348/budgets.test.ts',
  'tests/acceptance/356/budgets.test.ts', 'tests/acceptance/356/click.test.ts',
  'tests/acceptance/358/spike.live.test.mjs', 'tests/acceptance/365/budgets.test.ts',
  'tests/acceptance/377/budgets.test.ts', 'tests/acceptance/379/reasons.test.ts',
  'tests/acceptance/380/budgets.test.ts', 'tests/acceptance/383/city.test.ts', 'tests/acceptance/385/spike.test.ts',
  'tests/acceptance/386/budgets.test.ts', 'tests/acceptance/387/budgets.test.ts',
  'tests/acceptance/39/budgets.test.ts', 'tests/acceptance/397/candles.test.ts',
  'tests/acceptance/399/budgets.test.ts', 'tests/acceptance/40/budgets.test.ts',
  'tests/acceptance/401/budgets.test.ts', 'tests/acceptance/402/budgets.test.ts',
  'tests/acceptance/412/budgets.test.ts', 'tests/acceptance/417/budgets.test.ts',
  'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/489/budgets.test.ts',
  'tests/acceptance/55/budgets.test.ts', 'tests/acceptance/65/budgets.test.ts', 'tests/acceptance/568/judge.test.mjs',
  'tests/acceptance/572/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts',
  'tests/acceptance/63/budgets.test.ts', 'tests/acceptance/667/raised.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts',
  'tests/acceptance/68/budgets.test.ts', 'tests/acceptance/69/budgets.test.ts',
  'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/823/run.test.ts', 'tests/acceptance/823/wait.test.ts',
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts',
  'tests/acceptance/83/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/854/idle.test.ts',
  'tests/acceptance/854/patch.test.ts', 'tests/acceptance/854/replica.test.ts',
  'tests/acceptance/854/scene-read.test.ts', 'tests/acceptance/855/costs.test.ts',
  'tests/acceptance/855/keying.test.ts', 'tests/acceptance/857/background.test.ts',
  'tests/acceptance/857/speedup.test.ts', 'tests/acceptance/87/models/budgets.test.ts',
  'tests/acceptance/87/numbers/budget.test.ts', 'tests/acceptance/880/redraft/touch-id.test.ts',
  'tests/acceptance/880/touch-id.test.ts', 'tests/acceptance/881/latency.test.ts',
  'tests/acceptance/896/dirty.test.ts', 'tests/acceptance/896/settled.test.ts',
  'tests/acceptance/906/prompt.test.ts', 'tests/acceptance/906/stop.test.ts', 'tests/acceptance/96/budgets.test.ts',
  'tests/benchmark.test.mjs'
];

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/conformance-lint.mjs'], [process.execPath, 'scripts/slots-check.mjs'], [process.execPath, 'scripts/canvas-closures.mjs', 'closures'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift'], [process.execPath, 'scripts/record-reader-guard.mjs'], [process.execPath, 'scripts/color-literal-guard.mjs'], [process.execPath, 'scripts/guide.mjs', '--check']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names, declare the slot each slots-check FAIL line names with its interface, kit and planted fill, give each canvas list a closure-lint FAIL line names its closure or make the reference table and packages/contracts/canvas-closures.json agree where a drift FAIL line says they differ, read the record through the one reader in crates/deep-app/src/record.rs from each module a record-reader FAIL line names, draw each color a color-literal FAIL line names from the role it names, or regenerate the extension guide with node scripts/guide.mjs.' },
  { name: 'unit', commands: [
    // The canvas, text and marks acceptance files each build a binary before spawning it, and cargo
    // clones the binary into target/debug anew on every build, fresh or not, so a file spawning it
    // while a sibling file builds finds it gone or half-written: those files run one at a time, after
    // every other file has run in parallel. The hub's files (#16) start real hubs and time their
    // sockets to 2 ms, so they too run one at a time, with nothing beside them. So does each file
    // that times an issue's frozen budget on the reference Mac (gated by environmentProblem()): #14's
    // 5,000 appends a second fell to 3,300-4,000/s beside the parallel block and passed alone. The
    // supervisor's files (#236) too: they read the system's one sandbox log stream. And deep-hook's
    // files (#315), and #666's checkpoint through it: they build it and time it to 50 ms.
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...alone, ...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone],
    ['cargo', 'test', '--workspace', '--locked'],
    // Node's acceptance suites under tests/acceptance/ run by hand, as their READMEs say: #48's live
    // tests spend plan usage, and #246's check that change against its own base.
    [process.execPath, '--test', 'tests/*.test.mjs', ...testGlobs('mjs').filter((glob) => !glob.startsWith('tests/'))],
  ], fix: 'Repair the behavior named by the failing test.' },
  // #139's contract step: every published entry with its history, diffed against every earlier release in
  // contracts/releases/, a break passing only with its reviewed contracts/breaks file.
  { name: 'contracts', commands: [[process.execPath, 'scripts/contract-diff.mjs', 'check']], fix: 'Follow the Fix line under each contracts FAIL above: give the entry its since, stability, tracking issue or replaced_by, take a new major, or commit a reviewed contracts/breaks/<from>_<to>/<issue>.txt quoting each diff line and a workaround.' },
  // #139's interface diffs: cargo-semver-checks on the canvas module crates and deep-hook against HEAD, and the
  // TypeScript extension API against its committed report, so an interface change shows in the pull request that made it.
  { name: 'interfaces', commands: [[process.execPath, 'scripts/api-surface.mjs']], fix: 'Commit the API report that shows the change you meant (node scripts/api-surface.mjs --write-report), or undo the public change each FAIL api line names; install cargo-semver-checks (cargo install cargo-semver-checks --locked) for a BLOCKED api line.' },
  // The GPU layer's render logic on wgpu's noop backend, with no GPU (#377): slots and fences,
  // uploads that settle, a lost device's rebuild and submission in frame order.
  { name: 'noop', commands: [['cargo', 'test', '--locked', '-p', 'deep-gpu']], fix: 'Repair the render logic the failing noop test names.' },
  // #140: every platform seam's conformance suite on this build's backends; a suite this run can't give what it needs reads BLOCKED.
  { name: 'seams', commands: [[process.execPath, 'scripts/seams.mjs']], fix: 'Repair the backend each FAIL line names against its seam\'s suite.' },
  // #309: the relay suite on the shipped relay, and relay@1's interop run against every relay implementation.
  { name: 'relay', commands: [[process.execPath, 'scripts/relay-kit.mjs']], fix: 'Repair the relay or the backend each FAIL line names, or run the interop against the relay a protocol change left out.' },
  // #140: the canvas core's crates build for the web's platform, wasm32 with threads off, so nothing native-only creeps in.
  { name: 'wasm32', commands: [[process.execPath, 'scripts/wasm32.mjs']], fix: 'Remove the threads or the native-only API from the crate each FAIL line names, or install the target (rustup target add wasm32-unknown-unknown).' },
  // The event catalogue holds every kind the design docs and the open issues name (#605). It reads the
  // contracts package the typecheck lane builds.
  { name: 'catalogue drift', commands: [[process.execPath, 'scripts/catalogue-drift.mjs']], fix: 'Add each kind named above to the catalogue with its schema, or write the name so it does not read as an event kind; offline, run again with network and gh signed in.' },
  // Every link from the design docs and the open issues into docs/*.md lands on a heading or an <a id> (#910). It
  // reads the open issues the catalogue drift lane fetched.
  { name: 'design links', commands: [[process.execPath, 'scripts/design-links.mjs']], fix: 'Point each link named above at a heading or <a id> its doc has, or give the doc back the heading it linked; offline, run again with network and gh signed in.' },
  // The fixture corpus (#47): every covered agent version has a recorded set holding each event its
  // facts list, each set replays clean through its adapter, and the corpus stays under 200 MB.
  { name: 'corpus', commands: [[process.execPath, 'scripts/corpus.mjs', 'check']], fix: 'Follow the Fix line under each corpus failure above.' },
  // The canvas conformance kit over the shipped canvas modules (#138): every part, headless on Vello CPU and
  // wgpu's noop backend, no GPU. It rewrites crates/deep-show/kit-ledger.json, which a release build seals by.
  { name: 'canvas kit', commands: [[process.execPath, 'scripts/canvas-kit.mjs']], fix: 'Repair the canvas module and part each line above names; run the kit call alone to replay a failing seed.' },
  // Build first, so a broken build fails this lane instead of comparing a stale binary.
  { name: 'parity quick', commands: [['cargo', 'build', '--workspace', '--locked'], [process.execPath, 'scripts/parity.mjs']], fix: 'Repair the Rust build, the CLI behavior or the cross-binary help/version mismatch.' },
  // The proof lanes (#569): the test guard, fails before on the merge base, the trace lane, and the
  // lifecycle enumerator, crash suite and verdict replay when the change touches their paths. The release
  // preflight adds the mutation lane and runs the lifecycle enumerator and crash suite in full.
  { name: 'proof', commands: [[process.execPath, 'scripts/proof.mjs', ...(process.env.DEEP_PREFLIGHT === 'release' ? ['--release'] : [])]], fix: 'Follow the Fix line under each proof lane finding above.' },
  // The verdict table in Lean (#684): the model's proofs and their axioms, then the engine against the model's
  // seeded claims and the rank-swap twins. Lean builds take a while, so the local preflight runs it only for a
  // change to what its script says it checks (#821); the release preflight always does.
  {
    name: 'verdict proofs', paths: verdictInputs,
    commands: [[process.execPath, 'scripts/verdict-proofs.mjs'], [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/684', 'lean.test.ts', '-t', 'AC3|AC4', '--silent=false']],
    fix: 'Repair the proof or build error each FAIL line names, keeping every theorem on Lean\'s standard axioms, or make the engine and packages/verdicts/model agree on the vector named; under BLOCKED, install the toolchain as its Fix line says.',
  },
  // Configuration evals (#112): a change to an instruction file, a skill or the agents' settings lands only with a
  // replay of it on real past tasks that didn't regress. The replay spends plan usage, so you start it; this gate only
  // reads the report it left.
  {
    name: 'config eval', paths: configInputs,
    commands: [[process.execPath, 'scripts/config-eval.mjs', 'gate']],
    fix: 'Under BLOCKED, run the two commands its Fix line names; under FAIL, the change broke the tasks named, so rework it and replay it again.',
  },
];

/**
 * Lanes only the release preflight runs, after the checks and apart from their time budget: #666's spine checkpoint,
 * #668's setup checkpoint, #567's spine exit and #18's live sessions start real Claude Code sessions on your plan, and take minutes.
 */
export const releaseLanes = [
  {
    // #824's: 5,000 cycles beside the merge base's, about 90 minutes, so never in the checks' time budget.
    name: 'hub churn',
    commands: [[process.execPath, 'benchmarks/hub-churn.mjs', '--merge-base']],
    fix: 'Follow the Fix line under each hub churn FAIL above; a BLOCKED run names the reading this platform cannot take.',
  },
  {
    // #824's: 1, 10 and 30 open sessions, then the merge base built and read the same way, so minutes.
    name: 'hub sessions',
    commands: [[process.execPath, 'benchmarks/hub-sessions.mjs', '--merge-base']],
    fix: 'Follow the Fix line under the hub sessions FAIL above; a BLOCKED run names the reading this platform cannot take.',
  },
  {
    // #139's ecosystem corpus: everything DeepBuild has made or shipped (contracts/corpus.json) against the candidate,
    // and the previous release's fixture package loaded and called in it. A new failure holds the release until its
    // owner marks it fixed or accepted with its break file (contracts/corpus-decisions.json).
    name: 'ecosystem corpus',
    commands: [[process.execPath, 'scripts/contract-diff.mjs', 'corpus'], [process.execPath, 'scripts/contract-diff.mjs', 'old-load']],
    fix: 'Fix the piece each new corpus failure names, or record your decision in contracts/corpus-decisions.json: fixed once it passes again, or accepted with a reviewed break file quoting its diff line and a workaround.',
  },
  {
    // #429's calibration run: deep-gpu's calibrate call times every shipped operator and the fixture graphs, each in
    // its own pass, five runs after warm-up on the reference Mac, and passes only with every estimate within 25% of
    // its measured p95; a failed run holds composed graphs, and the planted halved noise weight must fail it.
    name: 'operator calibration',
    commands: [[process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/429', '--no-file-parallelism', 'calibration.test.ts']],
    fix: 'Measure the graphs each calibration FAIL lists as outside the bound, then set the op table weights (crates/deep-canvas/src/steps.rs) or the cost constants (crates/deep-canvas-effects/src/check.rs) from the measurement; an INCONCLUSIVE run under load runs again on an idle reference Mac.',
  },
  {
    name: 'spine checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/666', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as a Claude Code version the adapter facts cover.',
  },
  {
    // #668's: deep setup beside your own hook, a real session in deep status with its tool calls and commit, the
    // doctor, off and on, and deep setup --undo leaving your settings byte for byte.
    name: 'setup checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/668', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #669's: a real stop that says done before the fix held and sent back with its FAIL line, the fix's PASS naming
    // its commit, deep status matching the chat, and "all done?" answered from the record.
    name: 'done gate checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/669', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #1156's: a real session's risky calls stopped before they run: an unreadable push denied, a delete staged, a
    // push held on its plan until a signed yes, a stack's stand-in and a project extension's deny.
    name: 'risky calls checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/1156', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #567's: the spine's exit, a seeded false "done" in a real session held, sent back naming its check, and its line in the chat.
    name: 'spine exit',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/567', 'session.live.test.ts']],
    fix: 'Repair what the failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    name: 'claude code adapter live',
    commands: [
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/mapping', 'record.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/install', 'tamper.live.test.ts'],
      // #25's routes back into a session: the Stop hold, the waiter's wake, the next prompt and a resume's start.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live', 'routes.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live-redraft', 'ac2.live.test.ts'],
      // #27's exit criterion: an answer wakes an idle session, and a repeat in a new session is decided for you.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/27', 'session.live.test.ts'],
    ],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` for the settings-tamper sessions.',
  },
  {
    // #140's validation lane: the GPU fixtures once with Metal's API and shader validation on and the shader
    // translator's bounds checks off, every float target and storage buffer read back for non-finite values.
    name: 'gpu validation',
    commands: [[process.execPath, 'scripts/gpu-validation.mjs']],
    fix: 'Repair the shader each FAIL line names (an out-of-bounds access or a non-finite value it wrote); a BLOCKED line names the shader kind or the validation the lane could not run.',
  },
];

/**
 * The paths a change touches: every path that differs between the merge base with origin/main and the working
 * tree, committed or not, and new files git doesn't ignore. Null when that can't be worked out.
 */
export function changedPaths(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) return null;
  const diff = git('diff', '--name-only', '-z', '--no-renames', base.stdout.trim());
  const untracked = git('ls-files', '-z', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0) return null;
  return [...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean);
}
/**
 * Whether a lane's paths cover a file: a predicate, such as the `inputs` its script exports, or a list in which a
 * folder ending in `/**` matches everything under it and anything else matches itself.
 */
const covers = (paths, file) => (typeof paths === 'function' ? paths(file)
  : paths.some((path) => (path.endsWith('/**') ? file.startsWith(path.slice(0, -2)) : file === path)));
/**
 * The changed files a lane's script says it reads (its `inputs` export) that the lane's paths miss (#821); null when
 * the script can't be loaded, so what it reads is unknown. A child loads it, so runLanes stays synchronous.
 */
function missed(lane, changed, cwd) {
  const script = lane.commands.flat().find((arg) => /^scripts\/[^/]+\.mjs$/.test(arg));
  if (!script) return { files: [] };
  const code = `import { readFileSync } from 'node:fs';
    const { inputs } = await import(${JSON.stringify(pathToFileURL(join(cwd, script)).href)});
    const files = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(typeof inputs === 'function' ? files.filter((file) => inputs(file)) : []));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, input: JSON.stringify(changed), encoding: 'utf8', maxBuffer: 2 ** 28 });
  try {
    if (result.status !== 0) return null;
    const reads = JSON.parse(result.stdout.trim().split('\n').at(-1));
    return { script, files: reads.filter((file) => !covers(lane.paths, file)) };
  } catch {
    return null;
  }
}

const throttle = fileURLToPath(new URL('./throttle.mjs', import.meta.url));
const leaseScript = fileURLToPath(new URL('./lease', import.meta.url));
/** A lane command's throttle class: the vitest parallel block and node --test are test, anything else build. */
const throttleClass = ([command, ...args]) => (command === process.execPath
  && ((args[0]?.endsWith('vitest.mjs') && !args.includes('--no-file-parallelism')) || args[0] === '--test') ? 'test' : 'build');

export function runLanes(lanes, { cwd = root } = {}) {
  const failures = [];
  // The release preflight runs every lane; the local one runs a lane with paths only for a change that touches them.
  const release = process.env.DEEP_PREFLIGHT === 'release';
  // The lanes that read the open issues share one fetch a run, in this file (scripts/open-issues.mjs); perf's
  // copies name theirs.
  const issues = process.env.DEEP_OPEN_ISSUES ? undefined : mkdtempSync(join(tmpdir(), 'deep-open-issues-'));
  if (issues) process.env.DEEP_OPEN_ISSUES = join(issues, 'open-issues.json');
  let changed;
  for (const lane of lanes) {
    if (lane.paths && !release) {
      changed ??= changedPaths(cwd);
      // A lane skips only when its script reads none of the change either.
      if (changed && !changed.some((file) => covers(lane.paths, file))) {
        const misses = missed(lane, changed, cwd);
        if (misses?.files.length) {
          failures.push(`FAIL ${lane.name}: its paths miss ${misses.files.join(', ')}, which ${misses.script} reads\n  Fix: Take the lane's paths from the inputs ${misses.script} exports.`);
          continue;
        }
        if (misses) {
          console.log(`SKIP ${lane.name}: the change touches no file it reads`);
          continue;
        }
      }
    }
    const started = performance.now();
    console.log(`RUN ${lane.name}`);
    let failure = lane.commands.length ? undefined : { state: 'BLOCKED', error: 'No check was run' };
    for (const [command, ...args] of lane.commands) {
      let directory, descriptor, result, output = '';
      try {
        directory = mkdtempSync(join(tmpdir(), 'deep-preflight-output-'));
        const log = join(directory, 'output');
        descriptor = openSync(log, 'w', 0o600);
        // One shared descriptor preserves the child's stdout/stderr write order.
        // Through the machine's throttle table, by its class (docs/parallel-proof.md, section 6), and under a cpu.slot
        // of the calling session's through scripts/lease (#1015).
        result = spawnSync(process.execPath, [throttle, throttleClass([command, ...args]), '--wait', '30', '--', leaseScript, command, ...args], { cwd, stdio: ['ignore', descriptor, descriptor] });
        output = readFileSync(log, 'utf8').trim();
      } catch (error) {
        result = { status: null, error };
      } finally {
        try {
          if (descriptor !== undefined) closeSync(descriptor);
          if (directory) rmSync(directory, { recursive: true, force: true });
        } catch (error) {
          result = { status: null, error };
        }
      }
      if (output) console.log(output);
      if (result.status !== 0 && !failure) {
        const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
        const error = result.error?.message
          ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
          ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b|\bINCONCLUSIVE\b/i.test(line))
          ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`;
        // A diagnostic that names its own state keeps it: a check that couldn't run reads BLOCKED, not
        // FAIL, and one that couldn't read all it checks reads INCONCLUSIVE.
        const [, state, rest] = error.match(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/) ?? [];
        failure = { state: result.error ? 'BLOCKED' : state ?? 'FAIL', error: rest ?? error };
      }
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    if (failure) failures.push(`${failure.state} ${lane.name}: ${failure.error}\n  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
    else console.log(`PASS ${lane.name} (${elapsed} s)`);
  }
  if (issues) {
    delete process.env.DEEP_OPEN_ISSUES;
    rmSync(issues, { recursive: true, force: true });
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}
