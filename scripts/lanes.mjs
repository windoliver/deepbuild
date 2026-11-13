import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
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
export const alone = ['tests/acceptance/149/', 'tests/acceptance/1523/', 'tests/acceptance/149-redraft-ac5/', 'tests/acceptance/149-redraft-ac10/', 'tests/acceptance/84/', 'tests/acceptance/580/', 'tests/acceptance/67/', 'tests/acceptance/66/', 'tests/acceptance/994/hub.test.ts', 'tests/acceptance/994/deadline-redraft/', 'tests/acceptance/20/', 'tests/acceptance/65/', 'tests/acceptance/82/', 'tests/acceptance/1202/', 'tests/acceptance/55/', 'tests/acceptance/103/', 'tests/acceptance/363/', 'tests/acceptance/365/', 'tests/acceptance/262/', 'tests/acceptance/366/', 'tests/acceptance/356/', 'tests/acceptance/24/', 'tests/acceptance/26/', 'tests/acceptance/389/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/', 'tests/acceptance/393/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/855/', 'tests/acceptance/857/', 'tests/acceptance/854/', 'tests/acceptance/1487/', 'tests/acceptance/896/', 'tests/acceptance/881/', 'tests/acceptance/411/', 'tests/acceptance/488/', 'tests/acceptance/489/', 'tests/acceptance/490/', 'tests/acceptance/490-redraft-2/', 'tests/acceptance/490-oracle/', 'tests/acceptance/490-oracle-redraft/', 'tests/acceptance/491/', 'tests/acceptance/492/', 'tests/acceptance/492-gaps/', 'tests/acceptance/493/', 'tests/acceptance/493-redraft-ac7/', 'tests/acceptance/493-redraft-ac12/', 'tests/acceptance/493-redraft-ac18/', 'tests/acceptance/494/', 'tests/acceptance/495/', 'tests/acceptance/496/', 'tests/acceptance/497/', 'tests/acceptance/388/', 'tests/acceptance/16/', 'tests/acceptance/373/', 'tests/acceptance/160/', 'tests/acceptance/96/', 'tests/acceptance/374/', 'tests/acceptance/375/', 'tests/acceptance/670/', 'tests/acceptance/138/', 'tests/acceptance/185/', 'tests/acceptance/200/', 'tests/acceptance/417/', 'tests/acceptance/418/', 'tests/acceptance/464/', 'tests/acceptance/1646/', 'tests/dither-fill.test.ts', 'tests/acceptance/467/', 'tests/acceptance/467-redraft-ac2/', 'tests/acceptance/465/', 'tests/acceptance/166/', 'tests/acceptance/268/', 'tests/acceptance/268-redraft-ac4/', 'tests/acceptance/481/', 'tests/acceptance/486/', 'tests/acceptance/221/', 'tests/acceptance/412/', 'tests/acceptance/1098/budgets.test.ts', 'tests/acceptance/1015/claude.test.ts', 'tests/acceptance/1015/codex.test.ts', 'tests/acceptance/1015/focused.test.ts', 'tests/acceptance/1015/waiter.test.ts', 'tests/acceptance/1015/memory.test.ts', 'tests/acceptance/1015/gpu.test.ts', 'tests/acceptance/1015/redraft/own-repo.test.ts', 'tests/acceptance/1015/budgets.test.ts', 'tests/acceptance/1018/', 'tests/acceptance/1143/', 'tests/acceptance/399/', 'tests/acceptance/87/gate/', 'tests/acceptance/1537/', 'tests/acceptance/1022/',
  'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/377/', 'tests/acceptance/378/', 'tests/acceptance/420/', 'tests/acceptance/421/', 'tests/acceptance/423/', 'tests/acceptance/424/', 'tests/acceptance/430/', 'tests/group-compositor.test.ts', 'tests/acceptance/446/', 'tests/acceptance/419/', 'tests/acceptance/428/', 'tests/acceptance/1297/', 'tests/acceptance/422/', 'tests/acceptance/426/', 'tests/acceptance/425/', 'tests/acceptance/427/', 'tests/scene3d-interface.test.ts', 'tests/scene3d-shading.test.ts', 'tests/scene3d-contact.test.ts', 'tests/scene3d-culled-casters.test.ts', 'tests/acceptance/441/', 'tests/acceptance/440/', 'tests/acceptance/1640/', 'tests/acceptance/443/', 'tests/acceptance/433/', 'tests/acceptance/671/', 'tests/acceptance/1162/', 'tests/acceptance/381/', 'tests/acceptance/398/', 'tests/acceptance/397/', 'tests/acceptance/406/', 'tests/acceptance/238/', 'tests/acceptance/415/', 'tests/acceptance/383/', 'tests/acceptance/384/', 'tests/acceptance/400/', 'tests/acceptance/401/', 'tests/acceptance/105/', 'tests/acceptance/498/', 'tests/acceptance/806/', 'tests/acceptance/402/', 'tests/acceptance/104/', 'tests/acceptance/989/', 'tests/acceptance/327/', 'tests/acceptance/379/', 'tests/acceptance/1413/', 'tests/acceptance/777/', 'tests/acceptance/823/', 'tests/acceptance/856/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts', 'tests/acceptance/311/redraft-ac12/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/331/', 'tests/acceptance/37/', 'packages/checks-journey/test/unrun.test.ts', 'tests/acceptance/315/', ...['replay', 'budgets', 'process-start'].map((f) => `tests/acceptance/21/${f}.test.ts`), 'tests/acceptance/348/', 'tests/acceptance/349/', 'tests/acceptance/351/', 'tests/acceptance/355/', 'tests/acceptance/884/', 'tests/acceptance/139/',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/666/fast.test.ts', 'tests/acceptance/668/fast.test.ts', 'tests/acceptance/567/fast.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts', 'tests/acceptance/237/', 'tests/acceptance/34/', 'tests/acceptance/667/', 'tests/acceptance/380/', 'tests/acceptance/382/', 'tests/acceptance/386/', 'tests/acceptance/1174/', 'tests/acceptance/1173/', 'tests/acceptance/371/', 'tests/acceptance/376/', 'tests/acceptance/306/', 'tests/acceptance/403/', 'tests/acceptance/429/', 'tests/acceptance/431/', 'tests/acceptance/432/', 'tests/acceptance/483/', 'tests/acceptance/484/', 'tests/acceptance/252/',
  'tests/acceptance/18/kit/', 'tests/acceptance/18/session/', 'tests/acceptance/18/binding/', ...['callers', 'failures', 'loops', 'mcp', 'prompts', 'record', 'replies'].map((f) => `tests/acceptance/18/mapping/${f}.test.ts`),
  'tests/acceptance/453/',
  'tests/acceptance/46/', 'packages/github/test/',
  'tests/acceptance/1172/',
  'tests/acceptance/1454/',
  'tests/acceptance/1459/',
  'tests/acceptance/1463/',
  'tests/acceptance/1002/first-screen-redraft/',
  'tests/acceptance/994/first-screen-redraft/',
  'tests/acceptance/167/', 'tests/acceptance/1328/',
  ...['coexist', 'disable', 'install', 'stophold', 'tamper', 'waiter'].map((f) => `tests/acceptance/18/install/${f}.test.ts`), 'tests/acceptance/19/',
  'tests/acceptance/1312/',
  'tests/acceptance/629/',
  'tests/acceptance/25/routes/', 'tests/acceptance/25/fallbacks/', 'tests/acceptance/25/live/budgets.test.ts', 'tests/acceptance/321/', 'tests/acceptance/303/', 'tests/acceptance/344/', 'tests/acceptance/322/', 'tests/acceptance/323/', 'tests/acceptance/324/', 'tests/acceptance/325/', 'tests/acceptance/347/', 'tests/acceptance/340/',
  'tests/acceptance/29/hub.test.ts', 'tests/acceptance/29/slots.test.ts', 'tests/acceptance/907/slots.test.ts', 'tests/acceptance/907/background.test.ts', 'tests/acceptance/965/', 'tests/acceptance/996/', 'packages/hub/test/loop-starters.test.ts', 'packages/hub/test/loop-transcript.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/1175/',
  'tests/acceptance/23/permissions/', 'tests/acceptance/23/match/budgets.test.ts', 'tests/acceptance/83/', 'tests/acceptance/120/budgets.test.ts', 'tests/acceptance/120/budgets-idle-redraft.test.ts',
  'tests/acceptance/352/',
  ...['wake', 'repeat', 'waits', 'budgets'].map((f) => `tests/acceptance/27/${f}.test.ts`), 'tests/acceptance/27/outcomes-redraft/', 'tests/acceptance/27/desktop-redraft-2/', 'tests/acceptance/124/', 'tests/acceptance/906/', 'packages/hub/test/drive.test.ts',
  'tests/acceptance/990/',
  'tests/acceptance/140/gpu/', 'tests/acceptance/140/view/', 'tests/acceptance/140/platform/', 'tests/acceptance/309/', 'tests/acceptance/385/', 'tests/acceptance/874/redraft/',
  ...['cycles', 'planted', 'leftovers', 'sessions/readings', 'sessions/planted'].map((f) => `tests/acceptance/824/${f}.test.ts`), 'tests/acceptance/1285/', 'tests/acceptance/1294/', 'tests/acceptance/1507/', 'tests/acceptance/1998/', 'tests/acceptance/1999/', 'tests/acceptance/1848/'];
/**
 * Files whose recorded run takes over two minutes on this machine, by the fastest run each that vitest's results caches
 * in the worktrees and affected.mjs's node --test reports held on 2026-11-07. affected.mjs runs them with --slow and for
 * a change that adds or edits them, and leaves them otherwise INCONCLUSIVE, never PASS; the release preflight runs them
 * (docs/parallel-proof.md, section 7a). A file leaves the list once its run is back under two minutes.
 */
export const slow = [
  'packages/conformance/src/slots/environment.test.ts', 'packages/hub/test/loop-starters.test.ts',
  'packages/hub/test/loop-transcript.test.ts', 'packages/pi/test/guards.test.ts',
  'tests/acceptance/1002/cli.test.ts', 'tests/acceptance/1002/screens.test.ts',
  'tests/acceptance/1002/twins.test.ts', 'tests/acceptance/1015/claude.test.ts',
  'tests/acceptance/1017/floor.test.ts', 'tests/acceptance/1017/placement.test.ts',
  'tests/acceptance/1017/toolchains.test.ts', 'tests/acceptance/1113/before.test.mjs',
  'tests/acceptance/1114/lanes.test.mjs', 'tests/acceptance/1117/proofs.test.mjs',
  'tests/acceptance/112/eval.test.ts', 'tests/acceptance/1162/present.test.ts',
  'tests/acceptance/1162/query.test.ts', 'tests/acceptance/1297/convex-sun.test.ts',
  'tests/acceptance/138/release.test.ts', 'tests/acceptance/138/shipped.test.ts',
  'tests/acceptance/139/apisurface.test.ts', 'tests/acceptance/140/gpu/features.test.ts',
  'tests/acceptance/149/taste.test.ts', 'tests/acceptance/16/address.test.ts',
  'tests/acceptance/16/hotpath-ac18-redraft.test.ts', 'tests/acceptance/185/kit.test.ts',
  'tests/acceptance/185/redraft/kit-behavior-redraft.test.ts', 'tests/acceptance/19/doctor/contract.test.ts',
  'tests/acceptance/200/fillers.test.ts', 'tests/acceptance/200/gpu.test.ts', 'tests/acceptance/200/listing.test.ts',
  'tests/acceptance/200/module.test.ts', 'tests/acceptance/200/opening.test.ts',
  'tests/acceptance/262/retention.test.ts', 'tests/acceptance/27/desktop-redraft-2/desktop.test.ts',
  'tests/acceptance/27/outcomes-redraft/outcomes.test.ts', 'tests/acceptance/27/waits.test.ts',
  'tests/acceptance/30/claims.test.ts', 'tests/acceptance/30/mask.test.ts', 'tests/acceptance/31/assertion.test.ts',
  'tests/acceptance/31/base-runs.test.ts', 'tests/acceptance/31/snapshot.test.ts',
  'tests/acceptance/314/kits.test.ts', 'tests/acceptance/315/failopen.test.ts',
  'tests/acceptance/316/corpus.test.ts', 'tests/acceptance/326/setup/click.test.ts',
  'tests/acceptance/340/app/authority.test.ts', 'tests/acceptance/372/frame.test.ts',
  'tests/acceptance/379/perf-lane.test.ts', 'tests/acceptance/402/backpressure.test.ts',
  'tests/acceptance/412/listing.test.ts', 'tests/acceptance/415/navgraph.test.ts',
  'tests/acceptance/417/state.test.ts', 'tests/acceptance/419/velocity-seek.test.ts',
  'tests/acceptance/42/doctor.test.ts', 'tests/acceptance/422/showpiece-fixture.test.ts',
  'tests/acceptance/424/picks.test.ts', 'tests/acceptance/425/redraft/taste.test.ts',
  'tests/acceptance/48/harness.test.mjs', 'tests/acceptance/484/forest.test.ts', 'tests/acceptance/484/redraft-1637/forest.test.ts',
  'tests/acceptance/674/default.test.ts', 'tests/acceptance/674/document.test.ts',
  'tests/acceptance/674/nearest.test.ts', 'tests/acceptance/674/session.test.ts',
  'tests/acceptance/824/cycles.test.ts', 'tests/acceptance/85/hub/network.test.ts',
  'tests/acceptance/855/hash.test.ts', 'tests/acceptance/86/concurrent.test.ts',
  'tests/acceptance/910/ac1-issue-link.test.mjs', 'tests/acceptance/910/ac2-renamed-heading.test.mjs',
  'tests/acceptance/910/ac3-offline.test.mjs', 'tests/acceptance/965/background.test.ts',
  'tests/acceptance/965/grace.test.ts', 'tests/acceptance/965/starts.test.ts', 'tests/acceptance/992/agree.test.ts',
  'tests/live-instancers.test.ts', 'tests/scene3d-interface.test.ts'
];
/**
 * Folders and files the alone block runs with nothing beside them, not even another shard: #16's and #315's files start
 * real hubs and deep-hook and time their sockets to 2 and 50 ms, and #236's read the system's one sandbox log stream
 * (docs/parallel-proof.md, section 7).
 */
export const exclusive = ['tests/acceptance/16/', 'tests/acceptance/315/', 'tests/acceptance/236/'];
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
 * its blind redraft, ac6-redraft-2/, runs in its place (the owner's call on PR #1232). #37's first AC18 draft is kept
 * as written, by hand only: its two line assertions search the journey file for a flow-style substring that the suite's
 * own YAML rewrite never writes, so they expect line 0; its blind redraft, redraft/, runs in its place. #37's first AC16
 * draft is kept by hand too: it counts the stack's start and teardown as the runner's addition; its blind redraft,
 * redraft-ac16/, runs in its place. #37's first AC7 draft, moved unchanged into receipt-first-draft.test.ts (the owner's
 * call on PR #1153), is kept by hand: its precondition needs a first step slower than a frame; redraft-ac7/ runs in its place.
 * #1015's first AC7 draft is kept as written, by hand only: its sessions put a stand-in `cargo` first on PATH, which
 * answers affected.mjs's own `cargo metadata` and marks the run started before any block runs; its blind redraft,
 * redraft/own-repo.test.ts, runs in its place.
 */
export const byHand = ['tests/acceptance/46/live.test.ts', 'tests/acceptance/685/', 'tests/acceptance/70/', 'tests/proof/70/', 'tests/acceptance/1202/session.live.test.ts', 'tests/acceptance/666/session.live.test.ts', 'tests/acceptance/668/session.live.test.ts', 'tests/acceptance/567/session.live.test.ts', 'tests/acceptance/669/session.live.test.ts', 'tests/acceptance/1156/session.live.test.ts', 'tests/acceptance/1156/linux/', 'tests/acceptance/668/linux/', 'tests/acceptance/669/linux/', 'tests/acceptance/18/mapping/record.live.test.ts', 'tests/acceptance/18/install/tamper.live.test.ts', 'tests/acceptance/21/sessions.live.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/112/live.test.ts', 'tests/acceptance/27/session.live.test.ts', 'tests/acceptance/27/desktop.test.ts', 'tests/acceptance/27/desktop-redraft/', 'tests/acceptance/27/outcomes.test.ts', 'tests/acceptance/806/live.test.ts',
  'tests/acceptance/124/ac1-agents.live.test.ts', 'tests/acceptance/124/ac5-budgets.live.test.ts', 'tests/proof/883/', 'tests/proof/994/', 'tests/acceptance/366/ac1-build.live.test.ts', 'tests/acceptance/140/gpu/color.live.test.ts',
  'tests/acceptance/140/gpu/capture.live.test.ts', ...['empty', 'invalid', 'starts'].map((f) => `tests/acceptance/874/${f}.test.ts`),
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts', 'tests/acceptance/824/sessions/budgets.long.test.ts',
  'tests/acceptance/824/sessions/redraft-readings/', 'tests/acceptance/14/ac6-redraft.test.ts', 'tests/acceptance/37/assertions.test.ts',
  'tests/acceptance/37/budgets.test.ts', 'tests/acceptance/37/receipt-first-draft.test.ts', 'tests/acceptance/1015/own-repo.test.ts', 'tests/acceptance/1016/',
  // #994: real windows that take focus, a real hub, and 100 s of the retry schedule by the clock.
  'tests/acceptance/994/app.test.ts', 'tests/acceptance/994/taste.test.ts'];

/**
 * Test files whose verdict reads the machine's load or timing (docs/parallel-proof.md, section 7), which run only under
 * a timed grant: affected.mjs with --timed, and the before and trace lanes. They are the files that call
 * environmentProblem(, judgeTiming, judgeLimit, referenceMacProblem or notReference, or gate on a helper's
 * `status === 'INCONCLUSIVE'`; those that gate on the load or a reference Mac through a helper of another name, as
 * #120's inconclusiveIfLoaded, #34's notReferenceMac, #104's judge, #25's judgeP95 and #906's mustBeHeld; and those
 * judging a wall-clock budget, named one by one. A rule by what a file imports marks 386 files, so none is used.
 * Also those that start perf.mjs or preflight.mjs (or tests/preflight.test.mjs) from a copy of the whole scripts/
 * folder on the machine's own table (tests/takes-timed.test.mjs): each such run requests timed, and while that
 * request is pending under the block's test grant no top-level grant on the machine starts; under a timed grant
 * the request passes through.
 */
export const timed = [
  'tests/acceptance/1018/budgets.test.ts', 'tests/acceptance/1018/redraft-ac6/budgets.test.ts', 'tests/acceptance/46/budgets.test.ts',
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
  'tests/acceptance/238/budgets.test.ts', 'tests/acceptance/24/budgets.test.ts', 'tests/acceptance/24/redraft-1463/timing.test.ts',
  'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/25/live/budgets.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/routes/twenty-minutes.test.ts',
  'tests/acceptance/25/routes/wake.test.ts', 'tests/acceptance/26/budgets.test.ts',
  'tests/acceptance/262/budgets.test.ts', 'tests/acceptance/27/budgets.test.ts',
  'tests/acceptance/28/budgets.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/30/budgets.test.ts', 'tests/acceptance/303/budgets.test.ts',
  'tests/acceptance/304/budgets.test.ts', 'tests/acceptance/305/budgets.test.ts',
  'tests/acceptance/306/budgets.test.ts', 'tests/acceptance/31/budget-snapshot.test.ts',
  'tests/acceptance/31/budgets.test.ts', 'tests/acceptance/311/redraft-ac12/budgets.test.ts',
  'tests/acceptance/315/budgets-overhead-redraft.test.ts', 'tests/acceptance/315/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/325/timing.test.ts',
  'tests/acceptance/331/budgets.test.ts', 'tests/acceptance/34/budgets.test.ts',
  'tests/acceptance/37/budgets.test.ts', 'tests/acceptance/37/redraft-ac16/budgets.test.ts',
  'tests/acceptance/340/flow/budgets.test.ts', 'tests/acceptance/348/budgets.test.ts',
  'tests/acceptance/356/budgets.test.ts', 'tests/acceptance/356/click.test.ts',
  'tests/acceptance/358/spike.live.test.mjs', 'tests/acceptance/365/budgets.test.ts', 'tests/acceptance/66/budgets.test.ts',
  'tests/acceptance/377/budgets.test.ts', 'tests/acceptance/379/reasons.test.ts',
  'tests/acceptance/380/budgets.test.ts', 'tests/acceptance/383/city.test.ts', 'tests/acceptance/385/spike.test.ts',
  'tests/acceptance/386/budgets.test.ts', 'tests/acceptance/387/budgets.test.ts',
  'tests/acceptance/39/budgets.test.ts', 'tests/acceptance/397/candles.test.ts',
  'tests/acceptance/399/budgets.test.ts', 'tests/acceptance/40/budgets.test.ts',
  'tests/acceptance/401/budgets.test.ts', 'tests/acceptance/402/budgets.test.ts',
  'tests/acceptance/412/budgets.test.ts', 'tests/acceptance/417/budgets.test.ts',
  'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/489/budgets.test.ts',
  'tests/acceptance/55/budgets.test.ts', 'tests/acceptance/65/budgets.test.ts',
  'tests/acceptance/246/lanes.test.mjs', 'tests/acceptance/568/', 'tests/acceptance/583/perf-added-tests.test.mjs',
  'tests/acceptance/724/', 'tests/preflight.test.mjs',
  'tests/acceptance/572/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts',
  'tests/acceptance/63/budgets.test.ts', 'tests/acceptance/667/redraft-1463/raised.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts',
  'tests/acceptance/68/budgets.test.ts', 'tests/acceptance/69/budgets.test.ts',
  'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/823/run.test.ts', 'tests/acceptance/823/wait.test.ts',
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts',
  'tests/acceptance/83/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/854/idle.test.ts', 'tests/acceptance/1487/wakeups.test.ts',
  'tests/acceptance/854/patch.test.ts', 'tests/acceptance/854/replica.test.ts',
  'tests/acceptance/854/scene-read.test.ts', 'tests/acceptance/855/costs.test.ts',
  'tests/acceptance/855/keying.test.ts', 'tests/acceptance/857/background.test.ts',
  'tests/acceptance/857/speedup.test.ts', 'tests/acceptance/87/models/budgets.test.ts',
  'tests/acceptance/87/numbers/budget.test.ts', 'tests/acceptance/880/redraft/touch-id.test.ts',
  'tests/acceptance/880/touch-id.test.ts', 'tests/acceptance/881/latency.test.ts',
  'tests/acceptance/896/dirty.test.ts', 'tests/acceptance/896/settled.test.ts',
  'tests/acceptance/906/prompt.test.ts', 'tests/acceptance/906/stop.test.ts', 'tests/acceptance/96/budgets.test.ts',
  'tests/benchmark.test.mjs', 'tests/acceptance/1432/budgets.test.mjs'
];

// #33's suite runs one file at a time, its live files by hand, and its budget as a timed file.
alone.push('tests/acceptance/33/');
// #1427's files build deep-drive and start about 40 replicas; its budget runs by hand on the reference Mac.
alone.push('tests/acceptance/1427/');
byHand.push('tests/acceptance/1427/ac8-budget.live.test.ts');
timed.push('tests/acceptance/1427/ac8-budget.live.test.ts');
// #1550's files build a GPUI text probe and deep-drive, and start replicas.
alone.push('tests/acceptance/1550/');
// #1434's files build deep-replica and start a replica each, and ac5 runs #377's handoff suite; its live window files
// run by hand on the reference Mac, the budgets as a timed file.
alone.push('tests/acceptance/1434/');
byHand.push('tests/acceptance/1434/ac6-idle.live.test.ts', 'tests/acceptance/1434/ac7-budgets.live.test.ts', 'tests/acceptance/1434/ac8-snapshots.live.test.ts');
timed.push('tests/acceptance/1434/ac7-budgets.live.test.ts');
// #1436's files build deep-replica and drive the GPU; its live window files (reduced motion's frames, the budgets) open the
// app's window on this Mac's screen, and its budgets are a timed file.
alone.push('tests/acceptance/1436/');
byHand.push('tests/acceptance/1436/ac2-still.live.test.ts', 'tests/acceptance/1436/ac9-budgets.live.test.ts');
timed.push('tests/acceptance/1436/ac9-budgets.live.test.ts');
// #1485's files build deep-canvas-render and the app, and its AC3 file opens the app's window and times its frames.
alone.push('tests/acceptance/1485/');
timed.push('tests/acceptance/1485/panel.test.ts');
// #1486's files build deep-canvas-render in release; grid.test.ts times the first screen and the UI thread's frames.
alone.push('tests/acceptance/1486/');
timed.push('tests/acceptance/1486/grid.test.ts');
// #1485's first AC2 draft is kept as written, by hand only: it draws its five pictures in 20 u boxes and needs the
// fifth refused, where image@1's budget now counts the levels a frame draws (#1486); its blind redraft,
// 1485-redraft-ac2/, draws them at full size and runs in its place.
alone.push('tests/acceptance/1485-redraft-ac2/');
byHand.push('tests/acceptance/1485/cap.test.ts');
byHand.push('tests/acceptance/33/next-pr.live.test.ts', 'tests/acceptance/33/spine.live.test.ts');
timed.push('tests/acceptance/33/budget.test.ts');

// #1515's files each start a hub on a 500-session record, and its budgets must run with nothing beside them.
alone.push('tests/acceptance/1515/');
// #1546's files build deep-drive and start replicas; its live file opens the real window on a real hub, by hand.
alone.push('tests/acceptance/1546/');
byHand.push('tests/acceptance/1546/ac4-needs-you.live.test.ts');
timed.push('tests/acceptance/1546/ac4-needs-you.live.test.ts');

// #1348's suite runs the plain words lane, which builds and draws its fixture run in the replica: one file at a time.
alone.push('tests/acceptance/1348/');
// #1455's suite builds deep-drive, the replica and the app, and draws the fixture run in them: one file at a time.
alone.push('tests/acceptance/1455/');
// #505's files each build deep-canvas-render (and its formula file deep-show): one file at a time.
alone.push('tests/acceptance/505/', 'tests/acceptance/505-oracle/');
// #1653's files each build deep-canvas-render and draw with Vello CPU, as #467's do: one file at a time.
alone.push('tests/acceptance/1653/', 'tests/acceptance/1653-redraft-ac2-flip/');
// #536's files each build deep-canvas-render and draw with Vello CPU, as #1653's do: one file at a time.
alone.push('tests/acceptance/536/');
// #535's files each build deep-show (one also without the logic module) and #544's assembler, and draw on the GPU.
alone.push('tests/acceptance/535/');
// #1479's files build deep-canvas-render and draw with GPUI's offscreen renderer, as #385's do.
alone.push('tests/acceptance/1479/');
// #531's files build deep-logic here and for Linux x86_64 in Docker, start headless Chrome and count a process's threads.
alone.push('tests/acceptance/531/', 'tests/acceptance/531-redraft-ac11/', 'tests/acceptance/531-redraft-ac12/');
// #499's files build deep-show (and deep-logic, deep-canvas-render) in several feature sets, one a release build; the
// players and out-of-view readings are timed.
alone.push('tests/acceptance/499/');
timed.push('tests/acceptance/499/video/players.test.ts', 'tests/acceptance/499/video/out-of-view.test.ts');
// #500's files each build deep-show; the bake folder and the Oracle lane bake about 26 minutes of EBU test audio.
alone.push('tests/acceptance/500/', 'tests/acceptance/500-oracle/');
// #532's files build deep-logic here and for Linux x86_64 in Docker, start headless Chrome, and read CPU times per frame and per step.
alone.push('tests/acceptance/532/');
// #545's files build deep-logic and drive long-lived views frame by frame; ac04 builds deep-show and exports on the GPU.
alone.push('tests/acceptance/545/', 'tests/acceptance/545-redraft-ac3/', 'tests/acceptance/545-redraft-ac5/');
// #1731's files each start a hub that runs a sandboxed plug-in through the supervisor, against a TLS fixture library.
alone.push('tests/acceptance/1731/');
// #1820 starts the same real hub and sandboxed library fixture, plus the pack's HTTPS source.
alone.push('tests/acceptance/1820/');
// #1732's files each build deep-show: one file at a time.
alone.push('tests/acceptance/1732/');

// #1477's suite opens real windows and times them against the lane's rule: one file at a time, both files timed.
alone.push('tests/acceptance/1477/');
timed.push('tests/acceptance/1477/record.test.ts', 'tests/acceptance/1477/built.test.ts', 'tests/acceptance/1477/redraft/record.test.ts');
// #1718's files build deep-show and deep-hook, start hubs and lay out an installed tree.
alone.push('tests/acceptance/1718/');
// #1637's files build deep-gpu and draw a city of 120,000 solids on Metal; its budget runs as a timed file.
alone.push('tests/acceptance/1637/');
timed.push('tests/acceptance/1637/budgets.test.ts');
// #1458's replica file builds deep-drive plain and with env-plants and starts many replicas; its AC13 file opens the
// real app's window on a real hub, with Accessibility and Screen Recording, by hand.
alone.push('tests/acceptance/1458/');
byHand.push('tests/acceptance/1458/redraft-ac13/shown.test.ts');
// #501's files each build deep-show (seal.test.ts three times), export films through the GPU and the encode tool, and run a 600 s soak on the audio output.
alone.push('tests/acceptance/501/', 'tests/acceptance/501-redraft-ac10/');
timed.push('tests/acceptance/501/budgets.test.ts');
// #1818's files each build deep-show and mix seconds of audio through the media processors.
alone.push('tests/acceptance/1818/');
// #1720's files build deep-show and deep-hook, start and restart hubs and lay out an installed tree; so do the
// #1718 tests it redrafts.
alone.push('tests/acceptance/1720/', 'tests/acceptance/1718-redraft-1720/');
// #1461's files build deep-drive plain and with env-plants, start real hubs and many replicas; its AC1 and AC14 file and
// its AC28 file open the real app's window, with Accessibility and Screen Recording, by hand; its AC9 file is timed.
alone.push('tests/acceptance/1461/');
byHand.push('tests/acceptance/1461/shell.test.ts', 'tests/acceptance/1461/shown.test.ts');
timed.push('tests/acceptance/1461/budget.test.ts');
// #1100's files build deep-drive plain and with env-plants and run real setups with their hubs; its AC15 file opens the
// real app's window, with Accessibility and Screen Recording, by hand.
alone.push('tests/acceptance/1100/');
byHand.push('tests/acceptance/1100/shown.test.ts');
// #2018's files build deep-drive plain and with env-plants, and start real hubs and many replicas.
alone.push('tests/acceptance/2018/');
// #2019's files build deep-drive plain and with env-plants, start real hubs, run deep setup and many replicas.
alone.push('tests/acceptance/2019/');
// #1922's files each start a hub that installs sandboxed plug-ins and runs their job tools through the supervisor,
// counting the record's process starts around each deep_job call: one file at a time.
alone.push('tests/acceptance/1922/');
// #1924's files each start a hub, an agent stand-in and test hosts on loopback, and read every request a host gets
// around each deep_job call: one file at a time.
alone.push('tests/acceptance/1924/');
// #1923's files each start a hub and a provider on 127.0.0.1, kill and restart the hub mid-call, and count the
// provider's submissions around each deep_job call: one file at a time.
alone.push('tests/acceptance/1923/');
// #1942's files each start a hub that runs on this Mac's Lima VMs over SSH, through a relay that stalls and drops its
// connections; its facts refresh and output lag are read against the lane's timing rule.
alone.push('tests/acceptance/1942/');
timed.push('tests/acceptance/1942/budgets.test.ts', 'tests/acceptance/1942/stall.test.ts');
// #1945's files each start a hub on this Mac's Lima VMs and make a throwaway user there, cut every SSH connection of
// that user for a minute, and run root plans with its sudo password: one file at a time.
alone.push('tests/acceptance/1945/');
// #1943's files restart user services on this Mac's Lima VMs and judge check runs against deadlines there: one file at
// a time.
alone.push('tests/acceptance/1943/');
// #1983's files run the x86_64 lane, which builds deep-logic in linux/amd64 and linux/arm64 containers under emulation,
// and read the container runtime's image list, which another file's container run could change.
alone.push('tests/acceptance/1983/');
// #1462's files build deep-drive plain, with test-confirm and with each of fourteen plants, and its real and shown files
// open the real app's window on a real hub with Accessibility and Screen Recording; the shown file waits on your taste
// call, so it runs by hand.
alone.push('tests/acceptance/1462/', 'tests/acceptance/1462-redraft-ac2/');
byHand.push('tests/acceptance/1462/shown.test.ts');
// #1901's files build deep-show; build-digest.test.ts builds it three times, one with a canvas module's source changed
// for that build and restored after it, so nothing else may build in the checkout while it runs.
alone.push('tests/acceptance/1901/');
// #1925's files each start a hub that runs an 80 s encode through the supervisor and read its row to the 2 s batch,
// and its reopen file starts deep-drive twice: one file at a time.
alone.push('tests/acceptance/1925/');
// #408's files each build deep-show (module-label.test.ts with test-glyph-label). Criterion 5 runs from its redraft,
// which also builds it in release and for Linux x86_64 in a local image with a C++ toolchain and libclang, and times
// film.layout against the lane's rule; the original criterion-5 file, whose image can't build deep-show, runs by hand.
alone.push('tests/acceptance/408/crossing.test.ts', 'tests/acceptance/408/overlap-covered.test.ts', 'tests/acceptance/408/cut.test.ts', 'tests/acceptance/408/module-label.test.ts');
alone.push('tests/acceptance/408-redraft-ac5/');
timed.push('tests/acceptance/408-redraft-ac5/machines.test.ts');
// #1819's files each build deep-show, start a hub and the bakes plug-in's model host on its fixed port 8719, and run
// pinned open models on CPU: one file at a time.
alone.push('tests/acceptance/1819/');
// #502's files each build deep-show, export films through the GPU and the encode tool and speak their fixture with
// `say`; onsets.test.ts also starts a hub and the model host on its fixed port 8719: one file at a time.
alone.push('tests/acceptance/502/', 'tests/acceptance/502-oracle/');
// #503's files each build deep-show or deep-gpu, draw on the GPU, decode every listed audio format in the decode worker
// and rebake a spectrum in a linux/amd64 container; its oracle lane fetches and decodes the FATE audio samples; so does
// the blind redraft of AC1's bar chart, which builds deep-show and plays and seeks the chart's 600 frames.
alone.push('tests/acceptance/503/', 'tests/acceptance/503-oracle/', 'tests/acceptance/503-redraft-ac1/');
// #503's blind redraft of AC4's lossy test is kept by hand, as the record of its dispute: it also failed on the work
// (FFmpeg's arm64 Vorbis decode and its HE-AAC v2 decode at 32k), so the first draft stands and runs in its place.
byHand.push('tests/acceptance/503-redraft-ac4/');
// #935's files each build deep-show and run audio.gen on 38.4 s beds and the EBU loudness set; tempo.test.ts also starts
// a hub and the model host on its fixed port 8719: one file at a time.
alone.push('tests/acceptance/935/', 'tests/acceptance/935-oracle/');
byHand.push('tests/acceptance/408/machines.test.ts');
// #405's files each build deep-show. Criterion 4 runs from its redraft, which also builds it in release on a machine
// that can judge a timing now and times the geometry audit and determinism hashing against the lane's rule; the
// original criterion-4 file, whose rendered fixture the base refuses (lit solids with no paint), runs by hand.
alone.push('tests/acceptance/405/broken-fixture.test.ts', 'tests/acceptance/405/floating-exception.test.ts', 'tests/acceptance/405/lid-sweep.test.ts');
alone.push('tests/acceptance/405-redraft-ac4/');
timed.push('tests/acceptance/405-redraft-ac4/budgets.test.ts');
byHand.push('tests/acceptance/405/budgets.test.ts');
// #1936's files each build deep-show.
alone.push('tests/acceptance/1936/');
// #544's files build deep-logic and deep-show, draw on the GPU, export a film, and build deep-logic for Linux x86_64 in Docker.
alone.push('tests/acceptance/544/');
// #202's files each build deep-show (and the budgets the merge base too); its budgets time the check, kind_rules and
// the kind kit.
alone.push('tests/acceptance/202/');
timed.push('tests/acceptance/202/budgets.test.ts');
// #1971's files each build deep-show (refusal.test.ts deep-hook too), start a hub, and time op: field calls.
alone.push('tests/acceptance/1971/');
timed.push('tests/acceptance/1971/budget.test.ts');
// #1957's file builds deep-show and offers it pack graphs.
alone.push('tests/acceptance/1957/');
// #1961's files build deep-show and patch an open document to another version of its pack.
alone.push('tests/acceptance/1961/');
// #1399's files build deep-show in the full set and deep-gpu, and run the kind kit, the seam suite, the flicker check
// and the golden guard on them.
alone.push('tests/acceptance/1399/');
// #2015's file builds deep-show in the full set and runs it on a plate and a recipe pack.
alone.push('tests/acceptance/2015/');
// #220's files start hubs, build deep-show in the full set and time the typeset tool's own process.
alone.push('tests/acceptance/220/');
timed.push('tests/acceptance/220/budgets.test.ts');
// #1976's file builds deep-gpu and clicks 200 seeded rays through seven views of a plane and a sphere.
alone.push('tests/acceptance/1976/');
// #1405's spin and QoS files read a two-thread bench's count at load above the cores, and its proof runs a real budget
// 42 times: one file at a time. #724's redraft runs perf's lane as #724's own files do, under the timed grant.
alone.push('tests/acceptance/1405/', 'tests/acceptance/724-redraft-1405/');
timed.push('tests/acceptance/724-redraft-1405/');
// #1575's files each start a hub: AC5 holds 32 MiB behind a paused reader, and AC1 and its redraft time a live
// reader beside one replaying 100,000 events, as #34's stream budget is timed.
alone.push('tests/acceptance/1575/', 'tests/acceptance/1575-redraft-ac1/');
timed.push('tests/acceptance/1575/budgets.test.ts', 'tests/acceptance/1575-redraft-ac1/budgets.test.ts');
// #1964's files build deep-canvas-render and draw styled runs with Vello CPU.
alone.push('tests/acceptance/1964/');
// #1965's files each build deep-canvas-render; its cap file shapes a 240,000-byte code item, and its Oracle lane runs
// about 7,000 strings of the two Unicode files through check and raster.
alone.push('tests/acceptance/1965/', 'tests/acceptance/1965-oracle/');
// #1963's files each build deep-canvas-render and check quoted code and formulas against stored sources.
alone.push('tests/acceptance/1963/');
// #1723's files each start a real hub whose gate runs a document check through the canvas core, under a 480 s wait.
alone.push('tests/acceptance/1723/');
// #504's files each build deep-show or deep-motion with cargo, and criterion 2's hub test starts a hub and agents.
alone.push('tests/acceptance/504/');
// #504's blind redrafts of criteria 1, 2 and 8 each build deep-show or deep-motion with cargo; criterion 2's starts a
// hub and an agent stand-in.
alone.push('tests/acceptance/504-redraft-ac1/', 'tests/acceptance/504-redraft-ac2/', 'tests/acceptance/504-redraft-ac8/');
// #2026's files build the replica and deep-live plain and planted and run a hub over 30 days of history; three judge
// wall-clock limits (Needs you's load, a replayed ask within 1 s, the hub-down line within 2 s).
// The first draft's AC3 file is kept by hand: its wrong program, the app's reader keeping its place by event ID, can't
// fail under the design, since the hub raises the replayed request's ask as a new event; its blind redraft runs in its place.
alone.push('tests/acceptance/2026/', 'tests/acceptance/2026-redraft-ac3/');
timed.push('tests/acceptance/2026/load.test.ts', 'tests/acceptance/2026/outage.test.ts', 'tests/acceptance/2026-redraft-ac3/replay.test.ts');
byHand.push('tests/acceptance/2026/replay.test.ts');
// #2028's files build deep-drive plain and with env-plants, start real hubs and run three replicas each over three hours
// of the virtual clock, a frame each second while you're away.
alone.push('tests/acceptance/2028/');
// #2021's files build deep-drive plain and with env-plants and drive replicas over real hubs on a stepped clock, with
// agents' hooks and transcripts written as the run goes.
alone.push('tests/acceptance/2021/');
// #2029's files build the replica and deep-drive plain and planted, start real hubs and draw the answered asks' pages.
alone.push('tests/acceptance/2029/');
// #1056's files build deep-gpu and draw #464's pixel fixtures; records.test.ts runs #464's two-GPU tests.
alone.push('tests/acceptance/1056/');
// #404's parts: #1897's files each build deep-show in their own feature set and hold the GPU for the pixel hash;
// #1899's and #1903's build deep-gpu with test-meter, as #377's and #379's do; #2189's and its criterion-1 redraft
// build deep-gpu for release and draw on this Mac's Metal GPU, so no two device runs share it.
alone.push('tests/acceptance/1897/', 'tests/acceptance/1899/', 'tests/acceptance/1903/');
alone.push('tests/acceptance/2189/', 'tests/acceptance/2189-redraft-ac1/');
// #520's parts, the physics module: every file builds deep-physics on Rapier (#2010's AC1 a second time from a planted
// lockfile); #2010's and #2012's build and run it in linux/amd64 and linux/arm64 containers under emulation, and #2012's
// run Rapier's own tests there; #2011's build Rapier for release natively and for wasm32 and time steps in headless
// Chrome, so its budget file reads the machine's load.
alone.push('tests/acceptance/2009/', 'tests/acceptance/2009-redraft-ac2/', 'tests/acceptance/2010/', 'tests/acceptance/2010-oracle/');
alone.push('tests/acceptance/2011/', 'tests/acceptance/2012/', 'tests/acceptance/2012-oracle/');
timed.push('tests/acceptance/2011/ac2-step-budget.test.ts');
// #547's files build deep-logic and bake 108,000 and 72,000 steps; AC4 judges 20 seeks of a recorded match against 2 s.
alone.push('tests/acceptance/547/');
timed.push('tests/acceptance/547/ac4-keyframes.test.ts');
// #1967's files build deep-show, and determinism renders each side's canonical picture on the GPU.
alone.push('tests/acceptance/1967/');
// #407's files each build deep-show (carried.test.ts also with test-hold-min-2s); 407-oracle builds it too.
alone.push('tests/acceptance/407/', 'tests/acceptance/407-oracle/');
// #2014's files and its oracle each build deep-show; criterion 2 builds and rests on a 24 km plate of 801 × 801 samples.
alone.push('tests/acceptance/2014/', 'tests/acceptance/2014-oracle/');
// #1956's files each build deep-show (r1) and install the shelf pack's versions in order.
alone.push('tests/acceptance/1956/');
// #1802's ac4 and ac6 files each build deep-show with a test canvas module's features.
alone.push('tests/acceptance/1802/');
// #139's preview tests that publish an undated preview entry are redrafted after #1802; the redraft runs as #139's suite does.
alone.push('tests/acceptance/139-redraft-1802/');
// #154's files each start hubs that render stems through the supervisor, and build deep-show once; AC9 times a 60 s
// six-stem render against the reference Mac.
alone.push('tests/acceptance/154/', 'tests/acceptance/154-oracle/');
timed.push('tests/acceptance/154/budgets.test.ts');
// Its blind redraft runs the same way. The first draft's AC1 file is kept by hand: its harp test spreads a whole stem
// into Math.max, which throws on a stem that starts at the film's time 0 (tests/acceptance/154-redraft/DISPUTE.md).
alone.push('tests/acceptance/154-redraft/', 'tests/acceptance/154-oracle-redraft/');
timed.push('tests/acceptance/154-redraft/budgets.test.ts');
byHand.push('tests/acceptance/154/stems.test.ts');
// #1700's files each build deep-show; budgets.test.ts also builds it in release and times every geometry.shape
// reading against the lane's rule.
alone.push('tests/acceptance/1700/');
timed.push('tests/acceptance/1700/budgets.test.ts');
// #409's files each build deep-show and export films through the GPU; 409-oracle also runs the outside film gate.
alone.push('tests/acceptance/409/', 'tests/acceptance/409-oracle/');
// #1163's files each build deep-show; exports.test.ts exports the 600-frame 1080p film six times.
alone.push('tests/acceptance/1163/');
// #1862's suite starts a hub of its own with a fake reviewer, as #1537's does.
alone.push('tests/acceptance/1862/');
// #1401's files each build deep-show and render 3D revisions back on the GPU, AC3 in ten processes.
alone.push('tests/acceptance/1401/');
// #1958's files each build deep-show, and its budgets build the merge base and time saves.
alone.push('tests/acceptance/1958/');
timed.push('tests/acceptance/1958/budgets.test.ts');
// #306 AC3's redraft after #1958 builds deep-show, as #306's suite does.
alone.push('tests/acceptance/306-redraft-1958/');
// #157's files each build deep-show (finite.test.ts with test-export-guards), export films through the GPU, the encode tool
// and a fresh decode worker; lease.test.ts runs two exports at once, disk.test.ts attaches disk images with hdiutil, and
// budgets.test.ts reads the machine's load.
alone.push('tests/acceptance/157/', 'tests/acceptance/157-oracle/');
timed.push('tests/acceptance/157/budgets.test.ts');
// #162's files each build deep-show (atomic.test.ts with test-export-guards) and export to Lottie through the pinned
// reference renderer; the import legs start a hub and run its import job; budgets.test.ts times both.
alone.push('tests/acceptance/162/', 'tests/acceptance/162-oracle/');
timed.push('tests/acceptance/162/budgets.test.ts');
// #162's first-draft AC6 file keys a twist whose outline's corners all lie as far as the twist reaches, so its output never
// changes (tests/acceptance/162-redraft-ac6/DISPUTE.md); its blind redraft runs in its place.
alone.push('tests/acceptance/162-redraft-ac6/');
byHand.push('tests/acceptance/162/repeater.test.ts');
// #1183's files each build deep-show and judge 3D figures whose logic runs in the sandbox.
alone.push('tests/acceptance/1183/');
// #537's files build deep-gpu (most also deep-show, and #544's assembler), run logic programs and draw on the GPU;
// ac4-budget times 2,000 units at 1080p against the showpiece class's GPU budget.
alone.push('tests/acceptance/537/', 'tests/acceptance/537-oracle/');
timed.push('tests/acceptance/537/ac4-budget.test.ts');
// #539's files each build deep-show and #544's assembler, run logic programs, export on the GPU and draw the app's window.
alone.push('tests/acceptance/539/');
// #539's first-draft Oracle lane takes the upstream answer for Up and Down past a cell that can't take focus, where the
// design's grid rule gives another (tests/acceptance/539-oracle-redraft/DISPUTE.md); its blind redraft runs in its place.
alone.push('tests/acceptance/539-oracle-redraft/');
byHand.push('tests/acceptance/539-oracle/');
// #1920's files build deep-show seven times, in the full and core sets, and read each build's published plan.
alone.push('tests/acceptance/1920/');
// #1863's files each start a real hub and a session through deep-hook; the speed file times five 5 s and 6 s waits a
// side through the claim's timing check, whose verdict is a reading on a machine loaded past its cores.
alone.push('tests/acceptance/1863/');
timed.push('tests/acceptance/1863/speed.test.ts');
// #2017's files each build deep-gpu (ac3-budgets also deep-show, for release where it times) and draw on the Metal GPU;
// ac3-budgets judges the task's budgets on the reference Mac.
alone.push('tests/acceptance/2017/');
timed.push('tests/acceptance/2017/ac3-budgets.test.ts');
// #2017's first-draft AC2 file spreads every pixel of a 960 × 540 frame into Math.max, which throws before its judge runs
// (tests/acceptance/2017-redraft-ac2/DISPUTE.md); its blind redraft runs in its place.
alone.push('tests/acceptance/2017-redraft-ac2/');
byHand.push('tests/acceptance/2017/ac2-light-holds.test.ts');
// #173's files each build deep-gpu and draw the castle through frame history's window on the GPU; its
// budgets and envelope read timings and play 60 s runs on the reference Mac.
alone.push('tests/acceptance/173/');
timed.push('tests/acceptance/173/budgets.test.ts', 'tests/acceptance/173/envelope.test.ts');
slow.push('tests/acceptance/173/budgets.test.ts', 'tests/acceptance/173/envelope.test.ts');
// #2070's tests each start their own hub, paseo daemon stand-in and agent stand-in.
alone.push('tests/acceptance/2070/', 'tests/acceptance/2070-gaps/');
// #55's AC13 is its blind redraft's since #2070's dispute, settled by the owner (tests/acceptance/55-redraft-ac13/DISPUTE.md).
alone.push('tests/acceptance/55-redraft-ac13/');
// #1606's files each start their own hubs, and device.test.ts and stolen.test.ts the real app, built with its stand-ins;
// device.test.ts presses the real app's card, with Accessibility and Screen Recording, by hand.
alone.push('tests/acceptance/1606/');
byHand.push('tests/acceptance/1606/device.test.ts');
// Its redraft answers the app's card with no window, so it needs no permission and runs in the lane.
alone.push('tests/acceptance/1606-redraft-ac5-ac9/');
// #2324's files each build deep-show (with the planted engine build and sandbox.alt), deep-sandbox and deep-logic, run
// them in Docker on linux/amd64 and drive headless Chrome, as #238's and #531's do.
alone.push('tests/acceptance/2324/');
// #2197's files each start a real hub and one or two agent processes, each with its own deep mcp; budget.test.ts times
// deep_status against #26's 100 ms on the reference Mac.
alone.push('tests/acceptance/2197/');
timed.push('tests/acceptance/2197/budget.test.ts');
// #2144's AC1 runs the canvas lint on the checkout, a cargo clippy over every scope crate in its target/.
alone.push('tests/acceptance/2144/');
// #1332's files each start their own hubs, a played forge and played agents, and run a work run to its landings.
alone.push('tests/acceptance/1332/');
// #525's files each build deep-show (criterion 3 also the test.sim B builds) and play a live lab ten minutes long.
alone.push('tests/acceptance/525/');
// Its device gap test plays the labs out loud on this Mac's default output in real time, 10 minutes for the first.
alone.push('tests/acceptance/525-device/');
timed.push('tests/acceptance/525-device/device.test.ts');
slow.push('tests/acceptance/525-device/device.test.ts');

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/vendor-rebase.mjs', 'check'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/size-ratchet.mjs'], [process.execPath, 'scripts/conformance-lint.mjs'], [process.execPath, 'scripts/slots-check.mjs'], [process.execPath, 'scripts/canvas-closures.mjs', 'closures'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift'], [process.execPath, 'scripts/record-reader-guard.mjs'], [process.execPath, 'scripts/render-lint.mjs'], [process.execPath, 'scripts/plant-lint.mjs'], [process.execPath, 'scripts/blocking-call-guard.mjs'], [process.execPath, 'scripts/keymap-guard.mjs'], [process.execPath, 'scripts/color-literal-guard.mjs'], [process.execPath, 'scripts/guide.mjs', '--check'], [process.execPath, 'scripts/panel-catalog.mjs'], [process.execPath, 'scripts/known-failures-check.mjs'], [process.execPath, 'scripts/fetch-lock.mjs', 'lint']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding and each size FAIL line, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names, declare the slot each slots-check FAIL line names with its interface, kit and planted fill, give each canvas list a closure-lint FAIL line names its closure or make the reference table and packages/contracts/canvas-closures.json agree where a drift FAIL line says they differ, read the record through the one reader in crates/deep-app/src/record.rs from each module a record-reader FAIL line names, put each plant read a plant FAIL line names under its cargo feature, move each blocking call a blocking-call FAIL line names off the UI thread or give it its reason, give each chord a keymap FAIL line names a free key, no ⌃, or the variant_of its ⌥ needs, draw each color a color-literal FAIL line names from the role it names, regenerate the extension guide with node scripts/guide.mjs, follow the Fix line under each panel-catalog FAIL line, or give each known failure a known-failures FAIL line names an open issue and the date it was added, fixing it or taking it out once 14 days have passed, or pin each scripts/fetch-lock.json row a fetch-lock FAIL line names to a commit with its sha256, size and credit.' },
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
  // Every link from the design docs and the open issues into docs/*.md lands on a heading or an <a id> (#910), and
  // every `deep` command and agent tool an open issue names is in the design or planned (#1329). It reads the open
  // issues the catalogue drift lane fetched.
  { name: 'design links and names', commands: [[process.execPath, 'scripts/design-links.mjs']], fix: 'Point each link named above at a heading or <a id> its doc has, or give the doc back the heading it linked; add each name above to the design in code, or to scripts/planned-names.txt as `<name> #<issue>` while its design waits; remove a stale planned name; offline, run again with network and gh signed in.' },
  // Public text names no product the project only studied (#1329): the change's added lines, its commit messages and
  // the open issues, against the salted hashes in scripts/studied-names.json.
  { name: 'public text', commands: [[process.execPath, 'scripts/public-text.mjs']], fix: 'Restate each finding above in our own words, without the name; a name DeepBuild runs, links, calls, reads or writes leaves the list in its own pull request; offline, run again with network and gh signed in.' },
  // One set of plain words (#1348): the replica draws the lane's fixture run, and the card, the page, notifications
  // and the run's end notice show no word contracts/plain-words.json lists and no stack trace; a session's page and
  // what a row opens keep the real names.
  { name: 'plain words', commands: [['cargo', 'build', '--locked', '-p', 'deep-replica', '--features', 'env-plants', '--bin', 'deep-plain-words'], [`${process.env.CARGO_TARGET_DIR ?? 'target'}/debug/deep-plain-words`]], fix: 'Say each string above in the plain word it names, or move what it shows one click away to the page its row opens.' },
  // The fixture corpus (#47): every covered agent version has a recorded set holding each event its
  // facts list, each set replays clean through its adapter, and the corpus stays under 200 MB.
  { name: 'corpus', commands: [[process.execPath, 'scripts/corpus.mjs', 'check']], fix: 'Follow the Fix line under each corpus failure above.' },
  // The canvas conformance kit over the shipped canvas modules (#138): every part, headless on Vello CPU and
  // wgpu's noop backend, no GPU. It rewrites crates/deep-show/kit-ledger.json, which a release build seals by.
  // #1427: the motion check on the shipped journeys for Needs you, a session page and the project page.
  { name: 'motion', commands: [['cargo', 'build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive'], [process.execPath, 'scripts/motion.mjs']], fix: 'Make the motion each finding above names settle, fade or fly as declared,.' },
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
    // #41's: every recorded budget task on this commit and on the last release, which per-change margins can't bound.
    name: 'release budgets',
    commands: [[process.execPath, 'scripts/release-budgets.mjs', '--candidate', 'HEAD']],
    fix: 'Under FAIL, the task named got slower than the last release by more than the release margin: find the change that slowed it and rework it. With no last release, tag the last shipped commit release/<version>.',
  },
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
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/668', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #669's: a real stop that says done before the fix held and sent back with its FAIL line, the fix's PASS naming
    // its commit, deep status matching the chat, and "all done?" answered from the record.
    name: 'done gate checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/669', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #1156's: a real session's risky calls stopped before they run: an unreadable push denied, a delete staged, a
    // push held on its plan until a signed yes, a stack's stand-in and a project extension's deny. On Linux its twin,
    // linux/, where polkit confirms the yes (#70).
    name: 'risky calls checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/1156', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
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

// How a test run reads (docs/parallel-proof.md, section 10a): each test's state from its runner's report, skips against
// the `skips` list of known-failures.json, and the evidence record each lane writes. A skip is unrun, so it is never PASS.
export const named = (path, name) => `${path} › ${name}`;
/** Whether a list of files and of folders ending in `/` covers a file. */
export const listed = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
/** The state that stands among several: technical-design.md's precedence, and undefined when none is below PASS. */
export const worst = (states) => ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'].find((state) => states.includes(state));
/** Whether a lane's newly found state takes over from the one it holds: only a worse one does. */
export const stands = (found, held) => Boolean(found) && (!held || worst([held.state, found.state]) !== held.state);
// A failure that names its own state keeps it, as runLanes reads one: a check that couldn't run reads BLOCKED.
const stateOf = (message = '') => message.match(/^(?:\w*Error: )?(BLOCKED|INCONCLUSIVE|INVALID)\b/)?.[1] ?? 'FAIL';

/**
 * The results in a vitest or node --test report: failures with their state, the tests that passed, by ID, and any skips
 * with their notes. `noGrant`, when the throttle ended the job with no grant, is its message: its marker is then the
 * report's only row, since one beside other rows was left by a test's own throttle, not the job's. `cut` says a line
 * didn't parse. `label` names the job, when it reads a vitest job's whole report.
 */
export function reportResults(cwd, text, label = '') {
  const failures = [], passed = [], skips = [], stack = [], rows = [];
  const path = (file) => relative(cwd, file.startsWith('file:') ? fileURLToPath(file) : file).split(sep).join('/');
  let cut = false;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch {
      // A line that doesn't parse, such as a record cut short with the next run on, hides whatever its records said:
      // each file it names is unknown, and the line itself answers for a record cut before its file ends.
      cut = true;
      const records = [...line.matchAll(/\{"type":"\w+","file":("(?:[^"\\]|\\.)*")(?=,)/g)];
      const ids = [...records[0]?.index === 0 ? [] : [`report line ${index + 1}`], ...new Set(records.map(([, file]) => named(path(JSON.parse(file)), '(file)')))];
      for (const id of ids) failures.push({ id, state: 'INCONCLUSIVE', message: `line ${index + 1} of the report doesn't parse` });
      continue;
    }
    rows.push(row);
    if (row.type === 'unhandled') failures.push({ id: 'vitest › unhandled error', state: 'FAIL', message: row.message });
    if (!row.file) continue;
    const file = path(row.file);
    // node --test names a test alone; its suites are the tests started around it.
    if (row.type === 'start') stack[row.nesting] = row.name;
    const name = row.nesting === undefined ? row.name : [...stack.slice(0, row.nesting), row.name].join(' › ');
    // A suite node skips whole reports none of its tests, so it stands for them.
    if (row.type === 'skip' || row.skip || row.todo) {
      if (row.type !== 'start') skips.push({ id: named(file, name), note: row.note ?? '' });
      continue;
    }
    if (row.suite) continue;
    if (row.type === 'pass') passed.push(named(file, name));
    if (row.type === 'fail') failures.push({ id: named(file, name), state: stateOf(row.error?.message), message: row.error?.message?.split('\n')[0] ?? '' });
  }
  const noGrant = rows.length === 1 && rows[0].type === 'no-grant' ? rows[0].message : undefined;
  // The vitest reporter ends its report once all of it landed; a record lost whole leaves nothing else to see.
  if (label.startsWith('vitest') && !noGrant && !text.endsWith('{"type":"end"}\n')) failures.push({ id: `${label} report`, state: 'INCONCLUSIVE', message: "the report ends before the run did, so a test's result may be missing" });
  return { failures, passed, ...(skips.length && { skips }), ...(noGrant && { noGrant }), ...(cut && { cut }) };
}

/** The results in cargo test's output, each test by the target that reruns it, and a target that failed in no test. */
export function cargoResults(output, status, workspace) {
  const targets = new Map(workspace.flatMap((crate) => crate.targets.flatMap((target) => [[target.key, target.rerun], ...(target.doc ? [[`doc ${target.doc}`, `-p ${crate.name} --doc`]] : [])])));
  const failures = [], passed = [], skips = [], failed = new Set();
  let target = null;
  for (const line of output.split('\n')) {
    const running = line.match(/^\s*Running (?:unittests )?(.+?) \(.*?deps\/(\w+)-[0-9a-f]+\)\s*$/);
    const doc = line.match(/^\s*Doc-tests (\w+)\s*$/);
    if (running || doc) {
      const key = running ? `${running[2]} ${running[1]}` : `doc ${doc[1]}`;
      target = targets.get(key) ?? key;
    }
    const test = line.match(/^test (.+?) \.\.\. (ok|FAILED)$/);
    if (test && test[2] === 'ok') passed.push(`cargo ${target} › ${test[1]}`);
    if (test && test[2] === 'FAILED') failures.push({ id: `cargo ${target} › ${test[1]}`, state: 'FAIL', message: '' }), failed.add(target);
    const ignored = line.match(/^test (.+?) \.\.\. ignored(?:, (.*))?$/);
    if (ignored) skips.push({ id: `cargo ${target} › ${ignored[1]}`, note: ignored[2] ?? '' });
    // A harness that ran nothing says so, and nothing unrun passes.
    if (/^test result: INCONCLUSIVE/.test(line)) failures.push({ id: `cargo ${target}`, state: 'INCONCLUSIVE', message: line.slice(13) }), failed.add(target);
    // cargo names each failed target by the arguments that rerun it.
    const rerun = line.match(/(?:to rerun pass |^\s+)`(-p \S+ --\w+(?: \S+)?)`\s*$/)?.[1];
    if (rerun && !failed.has(rerun)) failures.push({ id: `cargo ${rerun}`, state: 'FAIL', message: 'the target failed outside any test it reported' }), failed.add(rerun);
  }
  if (status !== 0 && !failed.size) failures.push({ id: 'cargo test', state: 'FAIL', message: output.split('\n').find((line) => /^error/.test(line)) ?? `exited ${status}` });
  return { failures, passed, ...(skips.length && { skips }) };
}

const READING_ONLY = 'INCONCLUSIVE (reading only';
const CRITERION = /#\d+\.[0-9a-f]{8}\b/;
// A skip that says so: a platform or GPU the machine lacks. These are never listed, and leave the lane INCONCLUSIVE (platform).
// A note starting BLOCKED is a block, whatever it names: #380's M1 record names deep-gpu.
const PLATFORM = /\b(?:macOS|Linux|darwin|Metal|GPU|platform)\b/i;
export const isPlatform = (note) => !note.startsWith('BLOCKED') && PLATFORM.test(note);

/**
 * Whether a `skips` entry covers a skip: by test ID and exact note prefix, and a note-less entry only a note-less skip.
 * A reading-only skip is covered by its full note, and never in a timed file or a test carrying a criterion tag. The
 * approver, not this, confirms what an entry says of itself.
 */
function entryCovers(entry, { id, note }, timed) {
  if (entry.id !== id || isPlatform(note)) return false;
  if (note.startsWith(READING_ONLY)) return entry.note === note && !listed(timed, id.split(' › ')[0]) && !CRITERION.test(id);
  return entry.note ? note.startsWith(entry.note) : !note;
}

/** The skips as those a `skips` entry covers, printed in every summary and changing no state, and those left open. */
export function readSkips(skips, entries = [], timed = []) {
  const covered = [], open = [];
  for (const skip of skips) {
    const entry = entries.find((candidate) => entryCovers(candidate, skip, timed));
    if (entry) covered.push({ ...skip, reason: entry.reason });
    else open.push({ id: skip.id, state: skip.note.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', message: skip.note || 'skipped with no note' });
  }
  return { covered, open };
}

const vitestReporter = fileURLToPath(new URL('./proof-vitest-reporter.mjs', import.meta.url));
const nodeReporter = new URL('./proof-reporter.mjs', import.meta.url).href;
/**
 * A test command with its runner's report added beside its usual output, and the environment it needs; null for any
 * other command. Only vitest's report takes the throttle's marker: node's reporter holds its file open.
 */
export function reporting([command, ...args], report) {
  const at = args.findIndex((arg) => arg.endsWith('vitest.mjs'));
  if (at >= 0) return { command: [command, ...args.slice(0, at + 2), '--reporter=default', `--reporter=${vitestReporter}`, ...args.slice(at + 2)], env: { DEEP_PROOF_VITEST_REPORT: report } };
  if (command === process.execPath && args[0] === '--test') return { command: [command, '--test', `--test-reporter=${nodeReporter}`, `--test-reporter-destination=${report}`, '--test-reporter=spec', '--test-reporter-destination=stdout', ...args.slice(1)] };
  return null;
}

/** What a test command's run says of each test; null when it left nothing readable, and for any other command. */
export function testsOf([command, ...args], cwd, { report, output, status }) {
  if (command === 'cargo' && args[0] === 'test') return cargoResults(output, status, []);
  if (!existsSync(report)) return null;
  try {
    const results = reportResults(cwd, readFileSync(report, 'utf8'));
    if (results.cut) return null;
    // vitest's -t leaves every other test skipped with no note: a filter's choice, not a skip.
    return args.includes('-t') ? { ...results, skips: results.skips?.filter(({ note }) => note) } : results;
  } catch {
    return null;
  }
}

function skipsList(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'scripts/known-failures.json'), 'utf8')).skips;
  } catch {
    return [];
  }
}

/**
 * One command's run in a lane: each test's state for the record, the tests that proved nothing, the listed skips, the
 * state they found, and whether they explain a non-zero exit: a run that failed only by tests naming their own state,
 * or that the throttle never started, stands on those. A runner killed outright doesn't.
 */
export function readRun(results, status, cwd, timed) {
  const { failures = [], passed = [], skips = [], noGrant } = results ?? {};
  const { covered, open } = readSkips(skips, skipsList(cwd), timed);
  const stated = failures.filter(({ state }) => state !== 'FAIL'), unsure = [...stated, ...open];
  const row = ({ id, state, message }) => ({ id, state, note: message });
  return {
    tests: [...passed.map((id) => ({ id, state: 'PASS' })), ...failures.map(row), ...open.map((skip) => ({ ...row(skip), skipped: true })), ...covered.map(({ id, note }) => ({ id, state: 'LISTED', note, skipped: true }))],
    unsure, covered,
    explained: Boolean(noGrant) || (stated.length > 0 && stated.length === failures.length && status < 128),
    found: noGrant ? { state: 'INCONCLUSIVE', error: noGrant } : unsure.length ? { state: worst(unsure.map(({ state }) => state)), error: `${unsure.length} ${unsure.length === 1 ? 'test' : 'tests'} proved nothing` } : undefined,
  };
}

/**
 * The tree hash of what is on disk, uncommitted and untracked files too: HEAD's tree on a clean checkout. A copy of the
 * index, so a lane's run never touches the real one. Null outside a git repository.
 */
export function exactTree(cwd) {
  const git = (args, env) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  const index = git(['rev-parse', '--git-path', 'index']);
  if (index.status !== 0) return null; // Outside git: no tree, so no record. A tree git can't write reads undefined.
  const directory = mkdtempSync(join(tmpdir(), 'deep-lane-tree-')), copy = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    // Git rechecks a file only if it isn't older than the index, so a copy aged now would hide a same-size edit.
    // A repository nothing was added to has no index yet, and `git add -A` starts one.
    const source = resolve(cwd, index.stdout.trim());
    if (existsSync(source)) {
      copyFileSync(source, copy.GIT_INDEX_FILE);
      utimesSync(copy.GIT_INDEX_FILE, statSync(source).atime, statSync(source).mtime);
    }
    const written = git(['add', '-A'], copy).status === 0 ? git(['write-tree'], copy) : { status: 1 };
    return written.status === 0 ? written.stdout.trim() : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * A tree's lane records merged as remote lanes merge (parallel-proof §8): the worst state among them stands, so a lane's
 * FAIL wins over another's pass, and `lanes` names each lane whose own state is that state.
 */
export function mergeRecords(tree) {
  const folder = join(homedir(), '.deepbuild', 'lanes');
  const records = (existsSync(folder) ? readdirSync(folder) : [])
    .filter((name) => name.startsWith(`${tree}-`) && name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
  const state = worst(records.map((r) => r.state)) ?? 'PASS';
  return { tree, state, lanes: records.filter((r) => r.state === state).map((r) => r.lane) };
}

/** A lane's evidence record, which T7 and T8 read: its state, where it ran, on what tree, and each test's state. */
export function writeRecord(lane, state, tree, tests, more = {}) {
  if (!tree) throw new Error("git can't write this checkout's tree");
  const folder = join(homedir(), '.deepbuild', 'lanes');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, `${tree}-${lane.replace(/\W+/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify({ lane, state, host: hostname(), platform: `${process.platform}-${process.arch}`, tree, tests, ...more }, null, 2)}\n`);
  return file;
}

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
    const tree = exactTree(cwd), tests = [], unproven = [], listedSkips = [];
    for (const [command, ...args] of lane.commands) {
      let directory, descriptor, result, results, output = '';
      try {
        directory = mkdtempSync(join(tmpdir(), 'deep-preflight-output-'));
        const log = join(directory, 'output'), report = join(directory, 'report');
        const reported = reporting([command, ...args], report);
        descriptor = openSync(log, 'w', 0o600);
        // One shared descriptor preserves the child's stdout/stderr write order.
        // Through the machine's throttle table, by its class (docs/parallel-proof.md, section 6), and under a cpu.slot
        // of the calling session's through scripts/lease (#1015).
        result = spawnSync(process.execPath, [throttle, throttleClass([command, ...args]), '--wait', '30', '--', leaseScript, ...reported?.command ?? [command, ...args]], { cwd, env: { ...process.env, ...reported?.env }, stdio: ['ignore', descriptor, descriptor] });
        output = readFileSync(log, 'utf8').trim();
        results = testsOf([command, ...args], cwd, { report, output, status: result.status });
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
      const run = readRun(results, result.status, cwd, timed);
      tests.push(...run.tests);
      unproven.push(...run.unsure);
      listedSkips.push(...run.covered);
      let found = run.found;
      if (result.status !== 0 && !run.explained) {
        const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
        const error = result.error?.message
          ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
          ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b|\bINCONCLUSIVE\b/i.test(line))
          ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`;
        // A diagnostic that names its own state keeps it: a check that couldn't run reads BLOCKED, not
        // FAIL, and one that couldn't read all it checks reads INCONCLUSIVE.
        const [, state, rest] = error.match(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/) ?? [];
        found = { state: result.error ? 'BLOCKED' : state ?? 'FAIL', error: rest ?? error };
      }
      if (stands(found, failure)) failure = found;
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    for (const { id, note, reason } of listedSkips) console.log(`LISTED ${id}${note ? `: ${note}` : ''} (${reason})`);
    const platform = failure?.state === 'INCONCLUSIVE' && unproven.some(({ message }) => isPlatform(message)) ? ' (platform)' : '';
    const lines = unproven.map(({ id, state, message }) => `  ${state} ${id}${message ? `: ${message}` : ''}\n`).join('');
    if (failure) failures.push(`${failure.state} ${lane.name}${platform}: ${failure.error}\n${lines}  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
    else console.log(`PASS ${lane.name} (${elapsed} s)`);
    try {
      if (tree !== null) writeRecord(lane.name, failure?.state ?? 'PASS', tree, tests);
    } catch (error) {
      // A lane that FAILed, or read INVALID or BLOCKED, keeps its one verdict: the missing record outranks only less.
      if (failure && failure.state !== 'INCONCLUSIVE') console.log(`NOTE ${lane.name}: no evidence record: ${error.message}`);
      else failures.push(`BLOCKED ${lane.name}: no evidence record: ${error.message}\n  Fix: Clear what that names, then run the lane again.`);
    }
  }
  if (issues) {
    delete process.env.DEEP_OPEN_ISSUES;
    rmSync(issues, { recursive: true, force: true });
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}
