// Shared test-side tools for issue #875's acceptance tests (README): a hub world under /tmp/dh875-* holding #31's sample
// repo (its seeded bug, its install cloned in) with one drafted check file, a fix claim made through the real hub
// (`deep hub run`), deep-hook and #29's Claude Code stand-in, and the claim's reading taken from the record through the
// hub's socket. Nothing here stands in for DeepBuild: every reading comes from the real hub, deep-hook, the real Vitest
// and the record.
//
// Safety: every folder is under /tmp/dh875-* (#31's helpers, imported for the sample repo, make their own temp home
// under /tmp/dh31-home-* and remove it); no network and no model; processes are stopped by PID only (#29's `cleanup`).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, REAL_FIX, SEEDED } from '../31/helpers.ts';
import {
  allEvents, askNamed, CLI, control, DEEP_HOOK, DEFAULT_RULES, failureOf, lockedFor, must, REPO, req, said, SETTINGS, Session, settle, shown, sleep, startHub,
  stopHub, taskOf, type Draft, type Ev, type Hub, type Line, type World,
} from '../29/h-d.ts';

export { failureOf };

// ---- The prompt, its requirement and its drafted check (README, The check file).
/** The prompt the session types: a change request, so it opens a task. */
export const PROMPT = 'make the cart total take the discount off';
/** The drafted check file, committed on the base: one command line, which the command check kind runs as it is. */
export const CHECK = '.deepbuild/checks/cart-discount.sh';
export const CHECK_BYTES = 'node_modules/.bin/vitest run test/cart.test.ts\n';
/** The check's own test file, which every fix below adds. */
export const TEST = 'test/cart.test.ts';

/** A fix the session makes: the files it writes, and the assertion the drafted requirement names in `asserts`. */
export interface Fix { files: Record<string, string>; asserts: string[] }

/** AC3: #31's real fix for the seeded bug. Its test's expect is line 5, and it fails there on the base (100, not 90). */
export const REAL: Fix = { files: REAL_FIX, asserts: [`${TEST}:5`] };

/**
 * AC1: a fix that adds a helper, src/discount.ts, which the cart and the test both import. On the base the helper isn't
 * there, so the test file can't load and none of its tests starts. Line 7 is the expect the requirement names.
 */
export const HELPER: Fix = {
  files: {
    'src/discount.ts': 'export function discounted(amount: number, discount: number): number {\n  return amount - discount;\n}\n',
    'src/cart.ts': "import { discounted } from './discount.ts';\n\nexport interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  return discounted(cart.items.reduce((a, b) => a + b, 0), cart.discount);\n}\n",
    [TEST]: "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\nimport { discounted } from '../src/discount.ts';\n\nit('total takes the discount off', () => {\n  expect(discounted(100, 10)).toBe(90);\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n});\n",
  },
  asserts: [`${TEST}:7`],
};

/**
 * AC2: a fix that adds a function, discountedTotal, to src/cart.ts, which the base already has. On the base the test
 * loads and starts, and its expect line throws `TypeError: … is not a function` while working out its operand: the named
 * line, but no assertion compared anything. Line 5 is the expect the requirement names.
 */
export const ADDED_FUNCTION: Fix = {
  files: {
    'src/cart.ts': `${SEEDED['src/cart.ts']}export function discountedTotal(cart: Cart): number {\n  return total(cart) - cart.discount;\n}\n`,
    [TEST]: "import { expect, it } from 'vitest';\nimport { discountedTotal } from '../src/cart.ts';\n\nit('the discounted total takes the discount off', () => {\n  expect(discountedTotal({ items: [100], discount: 10 })).toBe(90);\n});\n",
  },
  asserts: [`${TEST}:5`],
};

/** The definition handed for PROMPT: one requirement, checked by CHECK, a fix check (`on_base: fails`), naming `asserts`. */
export const draftOf = (fix: Fix): Draft => ({
  ask: PROMPT,
  requirements: [req('R1', 'The cart total takes the discount off', { check: CHECK, on_base: 'fails', asserts: fix.asserts })],
  deliverables: ['src/cart.ts'],
  budget: null,
});

// ---- Temp folders under /tmp/dh875-*, removed by `removeTemp` (each test file calls it after each test).
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh875-'));
  made.push(dir);
  return dir;
}
export function removeTemp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A world as #29's `makeWorld` lays it out (a home with the shipped default guards and your ask settings, the
 * OS-confirmation stub, DEEP_HUB_TEST_DRAFTS and DEEP_HUB_TEST_WORK), under /tmp/dh875-*: its repo is #31's sample on
 * `main`, one commit (`base`) holding the seeded bug and the drafted check, with the repo's install cloned in (ignored).
 */
export function makeWorld(fix: Fix): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  for (const [path, bytes] of Object.entries({ ...SEEDED, [CHECK]: CHECK_BYTES })) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'the seeded bug and the drafted check']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  installVitest(repo);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [draftOf(fix)] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base };
}

/**
 * Clones Vitest and what it needs into `dir`'s node_modules, copy-on-write where the file system can: the packages the
 * repo's package-lock.json reaches from `node_modules/vitest` through dependencies, optional and peer dependencies, each
 * from the repo's own install, with `.bin/vitest` linked as npm links it. #31's `install` clones the whole install (about
 * 540 packages); the hub clones the worktree's node_modules again into each checkout, so on a loaded machine the smaller
 * closure keeps a claim's checkouts in seconds rather than minutes. Vitest's own nested packages come with its folder.
 */
export function installVitest(dir: string): void {
  type Entry = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  const lock = (JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, Entry> }).packages;
  if (!existsSync(join(REPO, 'node_modules/vitest'))) throw Error("BLOCKED: the repo's node_modules has no vitest (run npm ci once)");
  // Node's lookup: the nearest node_modules above the requiring package, then the top.
  const resolve = (from: string, name: string): string | null => {
    for (let at = from; ;) {
      if (lock[`${at}/node_modules/${name}`]) return `${at}/node_modules/${name}`;
      const i = at.lastIndexOf('/node_modules/');
      if (i < 0) break;
      at = at.slice(0, i);
    }
    return lock[`node_modules/${name}`] ? `node_modules/${name}` : null;
  };
  const need = new Set<string>();
  for (const queue = ['node_modules/vitest']; queue.length;) {
    const at = queue.pop()!;
    if (need.has(at)) continue;
    need.add(at);
    const e = lock[at] ?? {};
    for (const name of Object.keys({ ...e.dependencies, ...e.optionalDependencies, ...e.peerDependencies })) {
      const found = resolve(at, name);
      if (found) queue.push(found);
    }
  }
  // Top-level packages only: a nested one comes with the folder it sits in. A platform's binary that isn't installed is skipped.
  const top = [...need].filter((p) => p.split('/node_modules/').length === 1 && existsSync(join(REPO, p)));
  for (const path of top) {
    const into = join(dir, path, '..');
    mkdirSync(into, { recursive: true });
    try {
      execFileSync('/bin/cp', ['-cRH', join(REPO, path), into], { stdio: 'pipe' });
    } catch {
      execFileSync('/bin/cp', ['-RH', join(REPO, path), into], { stdio: 'pipe' });
    }
  }
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  symlinkSync('../vitest/vitest.mjs', join(dir, 'node_modules/.bin/vitest'));
}

const BUILD_LIMIT = 600_000;
/** The deep CLI and deep-hook, built; deep-hook is built once here when missing. Either missing is BLOCKED. */
export function built(): void {
  if (!existsSync(DEEP_HOOK)) spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit', timeout: BUILD_LIMIT });
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
}

// ---- A fix claim through the real hub, read back from the record.
/** One run of the claim, as run.started and run.finished record it. */
export interface RunRead { run: string; check: string; commit: string; outcome: string | null; tests_run: number | null; finished: Line | null }
/** What the record shows of the fix claim once its checks have settled. */
export interface Reading {
  plant: string | undefined;
  claim: string;
  /** The merge base: the commit the definition locked on, which the claim's uncommitted edits sit on. */
  base: string;
  /** The stop's reply to Claude Code. */
  reply: { decision?: string; reason?: string };
  /** Every verdict.made about the claim, in log order. */
  verdicts: Ev[];
  /** The claim's runs: on its snapshot, and on the merge base. */
  runs: RunRead[];
  /** The claim's line as `changes.read` gives it (what the chat shows), or why it couldn't be read. */
  line: string;
  /** The stop's held time and its split (stop.held), or null: where a slow claim's time went. */
  held: Line | null;
  stderr: string;
}
const claimsOf = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref);
function runsOf(events: readonly Ev[], claim: string): RunRead[] {
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => {
    const f = finished.get(String(e.data.run));
    return {
      run: String(e.data.run), check: String(e.data.check), commit: String(e.data.commit),
      outcome: f ? String(f.data.outcome) : null, tests_run: f && typeof f.data.tests_run === 'number' ? f.data.tests_run : null, finished: f ? f.data : null,
    };
  });
}
/**
 * Whether the claim's checks have settled: a verdict on it is made; or its stop's hold has replied with every run it
 * started finished, and either its head run didn't pass (no base run is due) or a run on the merge base has finished.
 */
function settled(events: readonly Ev[], ref: string, base: string): boolean {
  const [claim] = claimsOf(events, ref);
  if (!claim) return false;
  const id = `claim:${claim.id}`;
  if (events.some((e) => e.kind === 'verdict.made' && e.subject === id)) return true;
  if (!events.some((e) => e.kind === 'stop.held' && e.data.claim === id)) return false;
  const runs = runsOf(events, id);
  if (!runs.length || runs.some((r) => r.outcome === null)) return false;
  const head = runs.find((r) => r.commit !== base);
  return head?.outcome !== 'passed' || runs.some((r) => r.commit === base);
}

/** The session writes a file: an Edit of the whole file when it's there, a Write when it's new; refused is BLOCKED. */
async function put(s: Session, repo: string, file: string, bytes: string): Promise<void> {
  const path = join(repo, file);
  if (existsSync(path)) {
    await s.edit(file, readFileSync(path, 'utf8'), bytes);
    return;
  }
  const r = await s.call('Write', { file_path: path, content: bytes }, {
    response: { type: 'create', filePath: path, content: bytes, structuredPatch: [] },
    effect: () => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, bytes); },
  });
  if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed: ${r.before.stdout} ${r.before.stderr}`);
}

/** How long a claim's two Vitest runs may take to settle, on a loaded machine. */
const SETTLE_MS = 600_000;
/**
 * Makes the fix claim through a real hub (`plant`: DEEP_HUB_PLANT) and reads it back: a session types PROMPT, its
 * definition locks with the drafted check, it reads src/cart.ts, writes the fix's files (left uncommitted, so the claim
 * is a snapshot on the base commit) and stops; once the checks settle, the claim's verdicts, runs and line are read and
 * the hub is stopped. A hub that can't start, or a task that never locks, is BLOCKED (thrown).
 */
export async function claimFix(fix: Fix, o: { plant?: string } = {}): Promise<Reading> {
  built();
  const w = makeWorld(fix);
  const hub: Hub = await startHub(w, { plant: o.plant });
  try {
    const s = new Session(w);
    await s.start();
    await s.typed(PROMPT);
    const opened = await settle(hub, (e) => { const ref = taskOf(askNamed(e, s, PROMPT)); return ref !== undefined && lockedFor(e, ref).length > 0; }, 180_000);
    const ref = taskOf(askNamed(opened, s, PROMPT));
    if (!ref || !lockedFor(opened, ref).length) throw Error(`BLOCKED: the prompt opened no task with a locked definition: ${opened.filter((e) => e.kind.startsWith('definition.') || e.kind === 'user.ask').map(said).join('; ')}`);
    await s.read('src/cart.ts');
    for (const [file, bytes] of Object.entries(fix.files)) await put(s, w.repo, file, bytes);
    const stop = await s.stop('Done.');
    let events = await settle(hub, (e) => settled(e, ref, w.base), SETTLE_MS);
    // A verdict the hold's reply raced lands just after: read once more.
    await sleep(2000);
    events = await allEvents(hub);
    const [claim] = claimsOf(events, ref);
    if (!claim) throw Error(`BLOCKED: the stop made no claim for ${ref}: ${said(events.find((e) => e.kind === 'agent.stop'))}; the Stop hook: ${shown(stop)}; the record holds ${events.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
    const id = `claim:${claim.id}`;
    let line: string;
    try {
      const read = await control(hub, 'changes.read', { id });
      line = String((read.change as Line | undefined)?.line ?? JSON.stringify(read));
    } catch (error) {
      line = `changes.read failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    let reply: Reading['reply'] = {};
    try { reply = JSON.parse(stop.stdout || '{}') as Reading['reply']; } catch { /* no JSON: no decision */ }
    return {
      plant: o.plant, claim: id, base: w.base, reply, line, stderr: hub.stderr().slice(-2000),
      held: events.find((e) => e.kind === 'stop.held' && e.data.claim === id)?.data ?? null,
      verdicts: events.filter((e) => e.kind === 'verdict.made' && e.subject === id),
      runs: runsOf(events, id),
    };
  } finally {
    await stopHub(hub);
  }
}

// ---- The judgements: each throws an Error naming what it found, never returns false.
/** The reading in one line, for failure messages. */
export const shownReading = (r: Reading): string =>
  `verdicts ${JSON.stringify(r.verdicts.map((v) => ({ outcome: v.data.outcome, reasons: v.data.reasons })))}; runs ${JSON.stringify(r.runs.map((x) => ({ check: x.check, on: x.commit === r.base ? 'merge base' : 'snapshot', outcome: x.outcome, tests_run: x.tests_run })))}; line ${JSON.stringify(r.line)}; reply ${JSON.stringify(r.reply)}; held ${r.held ? JSON.stringify({ total: r.held.total, snapshot_start: r.held.snapshot_start, fast: r.held.fast, slow: r.held.slow }) : 'none'}`;

/** AC1, AC2: the claim's verdict is INVALID, and its reasons name `reason`. */
export function invalidNaming(r: Reading, reason: string): void {
  const invalid = r.verdicts.filter((v) => v.data.outcome === 'INVALID');
  must(invalid.length > 0, `the fix claim must be INVALID, a verdict.made with outcome INVALID about ${r.claim}: ${shownReading(r)}`);
  const reasons = invalid.flatMap((v) => (Array.isArray(v.data.reasons) ? v.data.reasons.map(String) : []));
  must(reasons.some((x) => x.includes(reason)), `the INVALID verdict must name '${reason}': its reasons are ${JSON.stringify(reasons)}; ${shownReading(r)}`);
}

/**
 * AC3: the claim is PASS. Its check passed on the snapshot; on the merge base it ran its test (tests_run at least 1,
 * as each run records how many tests ran) and failed; no verdict about it is anything but PASS; the stop wasn't sent
 * back; and the claim's line counts its one requirement passed, as a PASS verdict (`PASS 1/1`) or, with no verdict
 * made, as the record's runs show it (`says done 1/1`), with nothing unverified.
 */
export function passes(r: Reading): void {
  const head = r.runs.filter((x) => x.commit !== r.base);
  const onBase = r.runs.filter((x) => x.commit === r.base);
  must(head.length > 0 && head.every((x) => x.outcome === 'passed'), `the fix's check must pass on the claim's snapshot: ${shownReading(r)}`);
  must(onBase.length > 0, `the fix's check must run on the merge base ${r.base}: ${shownReading(r)}`);
  must(onBase.every((x) => x.outcome === 'failed'), `on the merge base the check must fail: ${shownReading(r)}`);
  must(onBase.every((x) => (x.tests_run ?? 0) >= 1), `on the merge base the check's test must run, and fail there on its assertion: the base run records ${JSON.stringify(onBase.map((x) => x.tests_run))} tests run; ${shownReading(r)}`);
  const other = r.verdicts.filter((v) => v.data.outcome !== 'PASS');
  must(!other.length, `the real fix must be PASS, never ${other.map((v) => String(v.data.outcome)).join(', ')}: ${shownReading(r)}`);
  must(r.reply.decision !== 'block', `a PASS isn't sent back: ${shownReading(r)}`);
  must(/^(PASS|says done) 1\/1(\s|$)/.test(r.line) && !r.line.includes('not verified'), `the claim's line must count its one requirement passed: ${shownReading(r)}`);
}

/**
 * On a planted hub: the scenario reached the base judgement and the plant read the base's failure as proof: its check
 * passed on the snapshot, failed on the merge base, and no verdict about it is INVALID. Without this a plant's failing
 * judgement could come from a scenario that never got that far.
 */
export function readAsProof(r: Reading): void {
  const head = r.runs.filter((x) => x.commit !== r.base);
  const onBase = r.runs.filter((x) => x.commit === r.base);
  must(head.length > 0 && head.every((x) => x.outcome === 'passed'), `${r.plant}: the check must pass on the snapshot: ${shownReading(r)}`);
  must(onBase.length > 0 && onBase.every((x) => x.outcome !== null && x.outcome !== 'passed'), `${r.plant}: the check must fail on the merge base: ${shownReading(r)}`);
  must(!r.verdicts.some((v) => v.data.outcome === 'INVALID'), `${r.plant}: the plant must read the base's failure as proof, with no INVALID verdict: ${shownReading(r)}`);
}

/** The planted wrong program (README): a hub that counts any non-zero base exit as proof. */
export const PLANT = 'any-nonzero-base-exit';

/** Asserts a judgement that holds on the right program fails on the planted one; BLOCKED and INCONCLUSIVE are rethrown. */
export async function mustFail(what: string, judge: () => void, names: string[] = []): Promise<void> {
  const message = await failureOf(judge);
  must(message !== null, `${what}: the planted wrong program passed the judgement, so it proves nothing`);
  for (const n of names) must(message.includes(n), `${what}: the failure must name ${n}: ${message}`);
}
