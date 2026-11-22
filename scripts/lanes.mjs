import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputs as configInputs } from './config-eval.mjs';
import { inputs as verdictInputs } from './verdict-proofs.mjs';
import { alone, byHand, exclusive, LANE_FILE, ownLane, redrafted, slow, timed } from './lanes-lists.mjs';
// Lane definitions are imported without the build tooling by runner configs and minimal fixture repositories.
const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('../', import.meta.url));
// The repo's declared test paths. The unit lane's runners take their file patterns from them, and perf
// sets the test files a change adds or modifies apart by them.
export const testPaths = ['tests/**', 'packages/**/test/**', 'packages/**/*.test.ts', 'crates/*/tests/**'];
/** A runner's file patterns: each declared path narrowed to that runner's test files. Cargo finds its own. */
export const testGlobs = (extension) => testPaths
  .map((path) => (path.endsWith('/**') ? `${path}/*.test.${extension}` : path))
  .filter((glob) => glob.endsWith(`.test.${extension}`) && !glob.startsWith('crates/'));

// The lane lists, in lanes-lists.mjs.
export { alone, byHand, exclusive, LANE_FILE, ownLane, redrafted, slow, timed };

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/vendor-rebase.mjs', 'check'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/size-ratchet.mjs'], [process.execPath, 'scripts/wait-ratchet.mjs'], [process.execPath, 'scripts/doc-ceilings.mjs'], [process.execPath, 'scripts/reading-rule.mjs'], [process.execPath, 'scripts/conformance-lint.mjs'], [process.execPath, 'scripts/slots-check.mjs'], [process.execPath, 'scripts/canvas-closures.mjs', 'closures'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift'], [process.execPath, 'scripts/canvas-closures.mjs', 'paths'], [process.execPath, 'scripts/record-reader-guard.mjs'], [process.execPath, 'scripts/render-lint.mjs'], [process.execPath, 'scripts/plant-lint.mjs'], [process.execPath, 'scripts/loads-lint.mjs'], [process.execPath, 'scripts/budget-table.mjs', 'check'], [process.execPath, 'scripts/cache-lint.mjs'], [process.execPath, 'scripts/blocking-call-guard.mjs'], [process.execPath, 'scripts/ask-sources-guard.mjs'], [process.execPath, 'scripts/keymap-guard.mjs'], [process.execPath, 'scripts/color-literal-guard.mjs'], [process.execPath, 'scripts/guide.mjs', '--check'], [process.execPath, 'scripts/panel-catalog.mjs'], [process.execPath, 'scripts/known-failures-check.mjs'], [process.execPath, 'scripts/fetch-lock.mjs', 'lint'], [process.execPath, 'scripts/exit-lint.mjs'], [process.execPath, 'scripts/app-copy-lint.mjs']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, each size FAIL line, each waits FAIL line, each doc-ceilings FAIL line and each reading rule FAIL line, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names, declare the slot each slots-check FAIL line names with its interface, kit and planted fill, give each canvas list a closure-lint FAIL line names its closure or make the reference table and packages/contracts/canvas-closures.json agree where a drift FAIL line says they differ, give each holder a paths FAIL line names its line in its section\'s Paths row of docs/canvas-primitives.md saying what packages/contracts/canvas-paths.json holds (the deep-show unit test the_paths_listing_is_what_the_full_set_seals prints that file from the seal), and each same a check kind or fixture that holds it, read the record through the one reader in crates/deep-app/src/record.rs from each module a record-reader FAIL line names, put each plant read a plant FAIL line names under its cargo feature, give each judgeLimit call a loads FAIL line names its loads, rewrite benchmarks/windows/numbers.md from the window records where a budget-table FAIL line names a row (node scripts/budget-table.mjs write), move each blocking call a blocking-call FAIL line names off the UI thread or give it its reason, give each source an ask-source FAIL line names its row in packages/asks/sources.json, give each chord a keymap FAIL line names a free key, no ⌃, or the variant_of its ⌥ needs, draw each color a color-literal FAIL line names from the role it names, regenerate the extension guide with node scripts/guide.mjs, follow the Fix line under each panel-catalog FAIL line, or give each known failure a known-failures FAIL line names an open issue and the date it was added, fixing it or taking it out once 14 days have passed, or pin each scripts/fetch-lock.json row a fetch-lock FAIL line names to a commit with its sha256, size and credit, or exit with 0, 1, 2 or 3 where an exits FAIL line names a command that can exit another code, or draw each string a copy FAIL line names from a key of crates/deep-app/copy/en.json through crate::copy, its numbers through the table\'s placeholders and plural forms.' },
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
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone, ...[...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
    // A listed failure must not prevent later targets from reporting unlisted failures.
    ['cargo', 'test', '--workspace', '--locked', '--no-fail-fast'],
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
  { name: 'catalogue drift', commands: [[process.execPath, 'scripts/catalogue-drift.mjs']], fix: 'Add each kind named above to the catalogue with its schema, write the name so it does not read as an event kind, or list a name that is no event kind in scripts/not-event-kinds.txt beside the open issue that names it, and remove each stale entry named above; offline, run again with network and gh signed in.' },
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
  // #2777: every field list of the sealed listing carries its closure, read from the deep-show built here, and the
  // reference's generated table says what that listing holds. The lane prints its reading of lists saying instead:
  // nothing; the reading is never a verdict.
  { name: 'field lists', commands: [['cargo', 'build', '--locked', '--bin', 'deep-show'], [process.execPath, 'scripts/canvas-closures.mjs', 'fields'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift', '--built']], fix: 'Give each field list a FAIL fields line names its closure in crates/deep-canvas/src/registry/fields.json (or beside its kind), and regenerate the reference\'s field-list table with node scripts/canvas-closures.mjs table where a drift FAIL line says it differs from the listing.' },
  // #458: the parity suite's quick lane, the kit's fixtures and their planted-fault twins on Vello CPU and the noop
  // backend, no GPU, after the fixture scan over every canvas fixture and its evidence. What can't run reads BLOCKED
  // in its row, for the release bar to weigh; the lane fails on what ran and didn't hold.
  { name: 'parity suite quick', commands: [['cargo', 'build', '--locked', '--bin', 'deep-show'], [process.execPath, 'scripts/fixture-scan.mjs'], [process.execPath, 'scripts/parity-suite.mjs', 'run', 'quick']], fix: 'Remove or redact what each fixture scan line names; repair the fixture each FAIL line names, give a fixture an INVALID line names a planted-fault twin that fails, and read both results of an INCONCLUSIVE one before running it again on a new commit.' },
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
    // #2403's: a shipped language with a key it lacks or a translation whose English changed since it was written.
    name: 'copy',
    commands: [[process.execPath, 'scripts/app-copy-lint.mjs', '--release']],
    fix: 'Translate each key a copy release FAIL line names again in crates/deep-app/copy/<language>.json, or confirm the translation there still reads right: node scripts/app-copy-lint.mjs confirm <language> <key> [<text>].',
  },
  {
    // #2047's: each issue closed as completed keeps a test on main naming each of its criteria; one that doesn't is
    // reopened, naming them. It reads and writes issues with your gh sign-in, and runs no test and no model.
    name: 'closed issues',
    commands: [[process.execPath, 'scripts/closed-sweep.mjs']],
    fix: 'Each BLOCKED line names an issue or a list gh could not read: check your gh sign-in (gh auth status) and run the lane again. A reopened issue closes again through its own change, with a test naming each criterion its comment names.',
  },
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
    // #458's: the parity suite's other lanes on the release commit (full on the GPU, cross on a second machine, the
    // optional oracle lanes), then the release report, which applies the bar to every fixture's rows of that commit:
    // each must-pass fixture PASS, each other PASS or BLOCKED with an owner and a reason.
    name: 'parity suite release',
    commands: [...['full', 'cross', 'oracle'].map((lane) => [process.execPath, 'scripts/parity-suite.mjs', 'run', lane]), [process.execPath, 'scripts/parity-suite.mjs', 'report']],
    fix: 'Repair the fixture each FAIL line names; a fixture the bar names needs a PASS on the release commit when it is must-pass, and otherwise a PASS or a BLOCKED row with an owner and a reason in scripts/parity-suite.json.',
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

/** The workspace's crates from cargo metadata: folders, path dependencies, the names they run by, and test targets. */
export function crates(cwd) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  // A cargo that can't start (not on PATH) leaves no stderr, only the spawn error, which names it (#2635).
  if (result.error) throw Error(`cargo metadata failed: ${result.error.message}`);
  if (result.status !== 0) throw Error(`cargo metadata failed: ${result.stderr.trim().split('\n').at(-1)}`);
  // cargo names paths as the disk resolves them, as /private/var for /var.
  const repo = (path) => relative(realpathSync(cwd), path).split(sep).join('/');
  return JSON.parse(result.stdout).packages.map((pkg) => {
    const dir = repo(dirname(pkg.manifest_path));
    const kind = (target) => ['bin', 'test', 'bench', 'example'].find((k) => target.kind.includes(k));
    return {
      name: pkg.name, dir,
      // The folders of its targets outside it, as the [[test]] files in tests/acceptance.
      away: [...new Set(pkg.targets.map((target) => dirname(repo(target.src_path))).filter((folder) => folder !== dir && !folder.startsWith(`${dir}/`)))],
      deps: pkg.dependencies.filter((dep) => dep.path).map((dep) => dep.name),
      names: [...new Set([pkg.name, ...pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.name)])],
      // Each target by the build file and source path cargo test's Running line names, with the argument that reruns it.
      targets: pkg.targets.map((target) => ({
        key: `${target.name.replaceAll('-', '_')} ${relative(dirname(pkg.manifest_path), target.src_path).split(sep).join('/')}`,
        rerun: `-p ${pkg.name} ${kind(target) ? `--${kind(target)} ${target.name}` : '--lib'}`,
        doc: target.kind.includes('lib') ? target.name.replaceAll('-', '_') : null,
      })),
    };
  });
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
    const test = line.match(/^test (.+?) \.\.\. (ok|FAILED|BLOCKED|INVALID|INCONCLUSIVE)$/);
    if (test && test[2] === 'ok') passed.push(`cargo ${target} › ${test[1]}`);
    if (test && test[2] !== 'ok') failures.push({ id: `cargo ${target} › ${test[1]}`, state: test[2] === 'FAILED' ? 'FAIL' : test[2], message: '' }), failed.add(target);
    const ignored = line.match(/^test (.+?) \.\.\. ignored(?:, (.*))?$/);
    if (ignored) skips.push({ id: `cargo ${target} › ${ignored[1]}`, note: ignored[2] ?? '' });
    // Custom harnesses report unrun cases too; a listed target must not turn those into passes.
    const unproven = line.match(/^test result: (BLOCKED|INVALID|INCONCLUSIVE)\b/)?.[1];
    if (unproven) failures.push({ id: `cargo ${target}`, state: unproven, message: line.slice(13) }), failed.add(target);
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
  if (command === 'cargo' && args[0] === 'test') return cargoResults(output, status, crates(cwd));
  if (!existsSync(report)) return null;
  try {
    const results = reportResults(cwd, readFileSync(report, 'utf8'), args.some((arg) => arg.endsWith('vitest.mjs')) ? 'vitest' : '');
    if (results.cut) return null;
    // vitest's -t leaves every other test skipped with no note: a filter's choice, not a skip.
    return args.includes('-t') ? { ...results, skips: results.skips?.filter(({ note }) => note) } : results;
  } catch {
    return null;
  }
}

function knownFailures(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'scripts/known-failures.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * One command's run in a lane: each test's state, unproven tests and listed skips/failures. Only exact FAIL IDs can
 * be listed; BLOCKED, INVALID and INCONCLUSIVE remain unproven. A run that failed only by listed tests or tests
 * naming their own state stands on those. A runner killed outright doesn't.
 */
export function readRun(results, status, cwd, timed) {
  const { failures = [], passed = [], skips = [], noGrant } = results ?? {};
  const baseline = knownFailures(cwd);
  const { covered, open } = readSkips(skips, baseline.skips, timed);
  const known = failures.filter(({ id, state }) => state === 'FAIL' && Object.hasOwn(baseline.failures ?? {}, id));
  const listedFailures = new Map(known.map(({ id }) => [id, baseline.failures[id]]));
  const stated = failures.filter(({ state }) => state !== 'FAIL'), unsure = [...stated, ...open];
  const row = ({ id, state, message }) => state === 'FAIL' && listedFailures.has(id) ? { id, state: 'LISTED', note: listedFailures.get(id) } : { id, state, note: message };
  return {
    tests: [...passed.map((id) => ({ id, state: 'PASS' })), ...failures.map(row), ...open.map((skip) => ({ ...row(skip), skipped: true })), ...covered.map(({ id, note }) => ({ id, state: 'LISTED', note, skipped: true }))],
    unsure, covered: [...covered, ...known.map(({ id, message }) => ({ id, note: message, reason: listedFailures.get(id) }))],
    explained: status !== null && status < 128 && (Boolean(noGrant) || (failures.length > 0 && stated.length + known.length === failures.length)),
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
  // Never forward a shell's binary directory, even to a lane that starts its own proof.
  const environment = { ...process.env };
  delete environment.DEEP_BIN_DIR;
  let changed, binaries, binaryError;
  try {
    const selected = [];
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
      selected.push(lane);
    }
    for (const lane of selected) {
      const started = performance.now();
      console.log(`RUN ${lane.name}`);
      let failure = lane.commands.length ? undefined : { state: 'BLOCKED', error: 'No check was run' };
      const tree = exactTree(cwd), tests = [], unproven = [], listedTests = [];
      for (const [command, ...args] of lane.commands) {
        let directory, descriptor, result, results, output = '';
        try {
          directory = mkdtempSync(join(tmpdir(), 'deep-preflight-output-'));
          const log = join(directory, 'output'), report = join(directory, 'report');
          const reported = reporting([command, ...args], report);
          if (reported && !binaries && !binaryError) {
            binaries = mkdtempSync(join(tmpdir(), 'deep-lane-binaries-'));
            try {
              const { binaryNames, buildBinaries, commandFiles, watchBinaries } = require('./proof-binaries.mjs');
              watchBinaries(binaries);
              const files = selected.flatMap((lane) => lane.commands).flatMap((command) => commandFiles(cwd, command));
              buildBinaries(cwd, join(binaries, 'bin'), binaryNames(cwd, files), undefined, { timeout: 0 });
            } catch (error) { binaryError = error; }
          }
          if (reported && binaryError) throw binaryError;
          descriptor = openSync(log, 'w', 0o600);
          // One shared descriptor preserves the child's stdout/stderr write order.
          // Through the machine's throttle table, by its class (docs/parallel-proof.md, section 6), and under a cpu.slot
          // of the calling session's through scripts/lease (#1015).
          result = spawnSync(process.execPath, [throttle, throttleClass([command, ...args]), '--wait', '30', '--', leaseScript, ...reported?.command ?? [command, ...args]], { cwd, env: { ...environment, ...reported?.env, ...reported && binaries ? { DEEP_BIN_DIR: join(binaries, 'bin') } : {} }, stdio: ['ignore', descriptor, descriptor] });
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
        listedTests.push(...run.covered);
        let found = run.found;
        if (result.status !== 0 && !run.explained) {
          const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
          // A test run's first error is its first failing test, as its runner's report names it: an output line can't
          // stand in, since a coloured assertion misses the pattern and a line the lease prints matches the fallback (#12).
          const failed = run.tests.find(({ state }) => state === 'FAIL');
          const error = result.error?.message
            ?? (failed && `${failed.id}${failed.note ? `: ${failed.note}` : ''}`)
            ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
            ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b|\bINCONCLUSIVE\b/i.test(line))
            ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`;
          // A diagnostic that names its own state keeps it: a check that couldn't run reads BLOCKED, not
          // FAIL, and one that couldn't read all it checks reads INCONCLUSIVE.
          const [, state, rest] = error.match(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/) ?? [];
          found = { state: state ?? (result.error ? 'BLOCKED' : 'FAIL'), error: rest ?? error };
        }
        if (stands(found, failure)) failure = found;
      }
      const elapsed = ((performance.now() - started) / 1000).toFixed(2);
      for (const { id, note, reason } of listedTests) console.log(`LISTED ${id}${note ? `: ${note}` : ''} (${reason})`);
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
  } finally {
    if (binaries) rmSync(binaries, { recursive: true, force: true });
    if (issues) {
      delete process.env.DEEP_OPEN_ISSUES;
      rmSync(issues, { recursive: true, force: true });
    }
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}
