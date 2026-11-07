// Main is watched (#1333). By rule nothing runs after a merge, so the host's scheduler (launchd or cron, say hourly)
// runs a tick here, in a checkout of the watched repository:
//
//   node scripts/main-watch.mjs tick     one scheduled run
//   node scripts/main-watch.mjs status   the gate a landing reads: `landings open` (exit 0) or `landings paused: …` (1)
//
// A tick fetches origin's main and, once 5 landings reached it or 6 hours passed since the last run, or while landings
// are paused, runs the unit and lint lanes of that head's own scripts/lanes.mjs, in a checkout of it, through its
// runLanes: under the machine's throttle grants and `deep lease`, with no hosted CI and no model. A failure that
// known-failures.json doesn't list runs again alone. One that passes on a repeat is flaky: INCONCLUSIVE, filed with its
// runs, and nothing pauses. One that holds pauses landings, and is bisected with only the failing test over the
// landings since the last clean run, to name the landing and its issue. A pull request reverts that landing and is
// merged once the failing test passes on it and nothing else fails there; the issue reopens naming the failure, and
// landings open again. A revert that conflicts or doesn't clear main starts an attempt on that issue, a headless agent
// run, and only once that has ended with main still red is a person asked, once: a GitHub issue titled `Ask: …`.
// State is kept under ~/.deepbuild/main-watch/, one file per watched checkout.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LANDINGS = 5;
const HOURS = 6;
const REPEATS = 3;
const LANES = ['unit', 'lint'];
const ATTEMPT_HOURS = 4;

const git = (cwd, ...args) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (run.status !== 0) throw Error(`git ${args.join(' ')}: ${(run.stderr || run.stdout).trim()}`);
  return run.stdout.trim();
};
const tryGit = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
const short = (sha) => sha.slice(0, 10);
const say = (line) => console.log(line);

const repo = (() => {
  const top = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
  if (top.status !== 0) {
    console.log('BLOCKED main-watch: not in a git repository');
    process.exit(2);
  }
  return top.stdout.trim();
})();
const home = join(homedir(), '.deepbuild', 'main-watch');
const key = createHash('sha256').update(repo).digest('hex').slice(0, 16);
const stateFile = join(home, `${key}.json`);
const tree = join(home, key, 'tree');

function load() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return { reds: {}, filed: {} };
  }
}
// Written whole and renamed into place, so `status` never reads half a file while a tick runs.
function save(state) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${stateFile}.tmp`, stateFile);
}
const paused = (state) => Object.values(state.reds ?? {});

function gh(...args) {
  const run = spawnSync('gh', args, { cwd: repo, encoding: 'utf8' });
  if (run.status !== 0) throw Error(`gh ${args.slice(0, 2).join(' ')}: ${(run.error?.message ?? run.stderr).trim()}`);
  return run.stdout.trim();
}
const numberOf = (url) => Number(url.match(/(\d+)\s*$/)?.[1]);

/** The checkout the lanes run in, at `sha`: kept between runs, so ignored builds (node_modules, target) stay warm. */
function checkout(sha) {
  if (!existsSync(join(tree, '.git'))) {
    mkdirSync(join(home, key), { recursive: true });
    tryGit(repo, 'worktree', 'prune');
    git(repo, 'worktree', 'add', '--detach', '--force', tree, sha);
  } else {
    git(tree, 'checkout', '-q', '--detach', '--force', sha);
  }
  git(tree, 'clean', '-fdq');
  prepare();
  return tree;
}

/** A Node workspace's dependencies and builds, which its tests import, through the throttle and the lease as the lanes. */
function prepare() {
  const manifest = join(tree, 'package.json');
  if (!existsSync(manifest) || !JSON.parse(readFileSync(manifest, 'utf8')).workspaces) return;
  const lock = existsSync(join(tree, 'package-lock.json')) ? createHash('sha256').update(readFileSync(join(tree, 'package-lock.json'))).digest('hex') : '';
  const marker = join(home, key, 'installed');
  const steps = [...(existsSync(join(tree, 'node_modules')) && existsSync(marker) && readFileSync(marker, 'utf8') === lock ? [] : [['npm', 'ci', '--no-audit', '--no-fund']]), ['npm', 'run', 'build', '--workspaces', '--if-present']];
  for (const step of steps) {
    const run = spawnSync(process.execPath, [join(tree, 'scripts/throttle.mjs'), 'build', '--wait', '30', '--', join(tree, 'scripts/lease'), ...step], { cwd: tree, stdio: ['ignore', 'inherit', 'inherit'] });
    if (run.status !== 0) say(`NOTE main-watch: ${step.join(' ')} exited ${run.status ?? run.signal}; the lanes report what that leaves`);
    else if (step[1] === 'ci') writeFileSync(marker, lock);
  }
}

// Runs `lanes` (names in checks, or lane objects) of the checkout's own lanes.mjs through its runLanes, in a child so
// each commit's module loads fresh, and reads the evidence record each lane wrote. A lint lane's failures are its
// findings, read as affected.mjs reads them when the checkout can load it.
const RUNNER = `import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [cwd, spec, out] = process.argv.slice(1);
const mod = await import(pathToFileURL(join(cwd, 'scripts/lanes.mjs')).href);
const wanted = JSON.parse(spec);
const lanes = wanted.names ? mod.checks.filter(({ name }) => wanted.names.includes(name)) : wanted.lanes;
const tree = mod.exactTree(cwd);
const outputs = {}, print = console.log;
let current;
console.log = (...parts) => {
  const line = parts.join(' ');
  current = line.match(/^RUN (.+)$/)?.[1] ?? current;
  if (current) outputs[current] = (outputs[current] ?? '') + line + '\\n';
  print(...parts);
};
const status = mod.runLanes(lanes, { cwd });
console.log = print;
const read = (name) => { try { return JSON.parse(readFileSync(join(homedir(), '.deepbuild', 'lanes', tree + '-' + name.replace(/\\W+/g, '-') + '.json'), 'utf8')); } catch { return null; } };
let lintFindings;
try { ({ lintFindings } = await import(pathToFileURL(join(cwd, 'scripts/affected.mjs')).href)); } catch {}
const verdicts = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS', 'RUN', 'LISTED', 'NOTE', 'SKIP'];
const result = lanes.map(({ name }) => {
  const record = read(name);
  // runLanes prints each lane's verdict after every lane ran; those lines aren't the lane's own findings.
  const own = (outputs[name] ?? '').split('\\n').filter((line) => !verdicts.some((word) => line.startsWith(word + ' ' + name + ' ') || line.startsWith(word + ' ' + name + ':') || line === word + ' ' + name)).join('\\n');
  const findings = name === 'lint' && lintFindings && record && record.state !== 'PASS' ? lintFindings(cwd, name, own, 1) : null;
  return { name, record, findings };
});
writeFileSync(out, JSON.stringify({ status, lanes: result }));
`;

/**
 * What a run of `lanes` at `sha` found: each failing ID with its message, the IDs that passed, the listed failures, and
 * the lanes that read neither PASS nor FAIL, so proved nothing. `lanes` may be a function of the checkout.
 */
function runAt(sha, lanes = { names: LANES }) {
  const cwd = checkout(sha);
  if (typeof lanes === 'function') lanes = lanes();
  if (!lanes) return { failing: new Map(), passed: new Set(), listed: [], unproven: [] };
  const scratch = mkdtempSync(join(tmpdir(), 'deep-main-watch-'));
  try {
    const out = join(scratch, 'result.json');
    spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER, cwd, JSON.stringify(lanes), out], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { lanes: [] };
    const known = (() => {
      try {
        return { failures: {}, lint: {}, timing: [], ...JSON.parse(readFileSync(join(cwd, 'scripts/known-failures.json'), 'utf8')) };
      } catch {
        return { failures: {}, lint: {}, timing: [] };
      }
    })();
    const failing = new Map(), passed = new Set(), listed = [], unproven = [];
    for (const { name, record, findings } of result.lanes) {
      if (!record) {
        failing.set(`lane ${name}`, 'the lane left no evidence record');
        continue;
      }
      if (record.state === 'PASS') passed.add(`lane ${name}`);
      else if (record.state !== 'FAIL') unproven.push(`${record.state} ${name}`);
      for (const test of record.tests ?? []) {
        if (test.state === 'PASS') passed.add(test.id);
        else if (test.state !== 'FAIL') continue;
        else if (known.failures[test.id] || known.timing.includes(test.id)) listed.push(test.id);
        else failing.set(test.id, test.note ?? '');
      }
      if (record.state !== 'FAIL' || (record.tests ?? []).some(({ state }) => state === 'FAIL')) continue;
      if (!findings) failing.set(`lane ${name}`, `the ${name} lane failed outside any test`);
      else {
        const counts = new Map();
        for (const { state, key: finding } of findings) {
          if (state !== 'FAIL') continue;
          counts.set(finding, (counts.get(finding) ?? 0) + 1);
          if (counts.get(finding) > (known.lint[finding] ?? 0)) failing.set(finding, 'lint');
          else listed.push(finding);
        }
      }
    }
    if (!result.lanes.length) failing.set('lane runner', 'the lanes could not be run');
    return { failing, passed, listed, unproven };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A failure run alone: its test with its own runner, a lint finding's lane, or the lane that failed outside a test;
 * null for a test whose file this checkout doesn't have.
 */
function aloneLanes(id) {
  const lane = (commands) => ({ lanes: [{ name: 'main-watch', commands, fix: 'Repair the behavior named by the failing test.' }] });
  if (id.startsWith('lane ')) return { names: [id.slice(5)] };
  if (id.startsWith('cargo ')) {
    const [target, name] = id.slice(6).split(' › ');
    return lane([['cargo', 'test', '--locked', ...target.split(' '), ...(name ? ['--', '--exact', name] : [])]]);
  }
  const [file, ...names] = id.split(' › ');
  const name = names.at(-1);
  if (!name) return { names: ['lint'] };
  if (!existsSync(join(tree, file))) return null;
  const source = readFileSync(join(tree, file), 'utf8');
  if (file.endsWith('.ts') || /from ['"]vitest['"]/.test(source)) return lane([[process.execPath, 'node_modules/vitest/vitest.mjs', 'run', file, '-t', escape(name)]]);
  return lane([[process.execPath, '--test', `--test-name-pattern=${escape(name)}`, file]]);
}
/** Whether a run shows `id` cleared: a test or lane that passed, or a lint finding no longer found. */
const cleared = ({ failing, passed }, id) => !failing.has(id) && (passed.has(id) || !(id.includes(' › ') || id.startsWith('lane ')));
/** Whether `id` fails run alone at `sha`: true, false, or null when that commit doesn't run it. */
function failsAt(sha, id) {
  const run = runAt(sha, () => aloneLanes(id));
  return run.failing.has(id) ? true : cleared(run, id) ? false : null;
}

/** A landing's issue and pull request, from its message, or the body of the pull request its subject names. */
function issueOf(sha) {
  const message = git(repo, 'log', '-1', '--format=%B', sha);
  const pr = Number(message.match(/^Merge pull request #(\d+)/)?.[1]) || undefined;
  const ref = /\b(?:Closes|Fixes|Resolves|Part of)\s+#(\d+)/i;
  let issue = Number(message.match(ref)?.[1]) || undefined;
  if (!issue && pr) {
    try {
      issue = Number(gh('pr', 'view', String(pr), '--json', 'body', '-q', '.body').match(ref)?.[1]) || undefined;
    } catch {}
  }
  return { issue, pr };
}

/** Files an issue and returns its number. */
const file = (title, body) => numberOf(gh('issue', 'create', '--title', title, '--body', body));

/**
 * Bisects the first-parent landings after the last clean run, up to the head the failure was found on, with only the
 * failing test. A failure that also fails at the last clean run's commit, or with no clean run, has no landing.
 */
function bisect(red, clean) {
  if (!clean) return null;
  const line = git(repo, 'rev-list', '--first-parent', '--reverse', `${clean}..${red.since}`).split('\n').filter(Boolean);
  if (!line.length || failsAt(clean, red.id)) return null;
  let good = -1, bad = line.length - 1;
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2);
    if (failsAt(line[mid], red.id)) bad = mid;
    else good = mid;
  }
  return line[bad];
}

/** A pull request reverting the landing on main's head, merged once the failing test passes and nothing else fails. */
function revert(red, head, failingAtHead) {
  checkout(head);
  const merge = git(repo, 'rev-list', '--parents', '-n', '1', red.landing).split(' ').length > 2;
  const reverted = tryGit(tree, 'revert', '--no-edit', ...(merge ? ['-m', '1'] : []), red.landing);
  if (reverted.status !== 0) {
    tryGit(tree, 'revert', '--abort');
    say(`NOTE main-watch: the revert of ${short(red.landing)} conflicts on main`);
    return 'conflicts';
  }
  const branch = `main-watch/revert-${short(red.landing)}`;
  git(tree, 'push', '-q', '--force', 'origin', `HEAD:refs/heads/${branch}`);
  const pr = numberOf(gh('pr', 'create', '--base', 'main', '--head', branch, '--title', `Revert ${short(red.landing)}: ${red.id} fails on main`,
    '--body', `${red.id} fails on main since ${short(red.landing)}${red.issue ? ` (#${red.issue})` : ''}, found by the main watch (#1333). It lands once that test passes here and nothing else fails.`));
  red.revertPr = pr;
  const commit = git(tree, 'rev-parse', 'HEAD');
  const run = runAt(commit);
  const others = [...run.failing.keys()].filter((id) => !failingAtHead.has(id));
  if (!cleared(run, red.id) || others.length || run.unproven.length) {
    say(`NOTE main-watch: the revert #${pr} doesn't clear main: ${run.failing.has(red.id) ? `${red.id} still fails` : others.length ? `it fails ${others.join(', ')}` : run.unproven.length ? `its lanes read ${run.unproven.join(', ')}` : `${red.id} didn't run`}`);
    try { gh('pr', 'close', String(pr), '--comment', 'The revert does not clear main, so an attempt on the issue takes over.'); } catch {}
    return 'stays red';
  }
  gh('pr', 'merge', String(pr), '--merge');
  say(`PASS main-watch: the revert #${pr} of ${short(red.landing)} landed`);
  if (red.issue) gh('issue', 'reopen', String(red.issue), '--comment', `Reopened by the main watch: ${red.id} fails on main since this issue's landing ${short(red.landing)}, which #${pr} reverted.`);
  return 'landed';
}

/**
 * A headless agent run on the issue, in a checkout of main's head; it ends when the agent exits. The agent runs under
 * its own settings and the user-level DeepBuild hooks, so it can't change a check.
 */
function attempt(red, head, why) {
  const bin = ['claude', 'codex'].find((name) => spawnSync('sh', ['-c', `command -v ${name}`]).status === 0);
  if (!bin) {
    say(`NOTE main-watch: no claude or codex on PATH, so no attempt on #${red.issue} starts`);
    return;
  }
  checkout(head);
  const prompt = `Main is red: ${red.id} fails on main at ${short(head)}${red.landing ? `, since landing ${short(red.landing)}` : ''}, and ${why}. Work issue #${red.issue}: make that test pass on main without weakening, skipping or editing any check, on a branch of your own, and open a pull request that says Fixes #${red.issue}.`;
  say(`RUN main-watch: an attempt on #${red.issue} with ${bin}`);
  spawnSync(bin, bin === 'claude' ? ['-p', prompt] : ['exec', prompt], { cwd: tree, stdio: ['ignore', 'inherit', 'inherit'], timeout: ATTEMPT_HOURS * 3_600_000 });
}

function fetchHead() {
  git(repo, 'fetch', '-q', 'origin', 'main');
  return git(repo, 'rev-parse', 'origin/main');
}

/** Carries one held failure as far as it goes: named, reverted, attempted, asked. Each step is kept, so none repeats. */
function settle(state, red, head, failingAtHead) {
  if (!red.named) {
    red.landing = bisect(red, state.clean) ?? undefined;
    Object.assign(red, red.landing ? issueOf(red.landing) : {});
    red.named = true;
    if (red.landing) say(`FAIL main-watch: ${red.id} fails on main since landing ${short(red.landing)}${red.issue ? ` (#${red.issue}` : ' (no issue'}${red.pr ? `, PR #${red.pr})` : ')'}`);
    else say(`FAIL main-watch: ${red.id} fails on main, and no landing since the last clean run ${state.clean ? short(state.clean) : '(none yet)'} caused it`);
    save(state);
  }
  if (!red.issue) {
    red.issue = file(`Main is red: ${red.id}`, `The main watch (#1333) found ${red.id} failing on main at ${short(red.since)}${red.landing ? `, since landing ${short(red.landing)}` : ', with no landing to blame'}.\n\n${red.message ?? ''}`);
    save(state);
  }
  if (red.landing && !red.revert) {
    red.revert = revert(red, head, failingAtHead);
    save(state);
    if (red.revert === 'landed') return 'landed';
  }
  if (!red.attempted) {
    attempt(red, head, red.landing ? (red.revert === 'conflicts' ? 'its revert conflicts' : 'its revert does not clear main') : 'no landing since the last clean run caused it');
    red.attempted = Date.now();
    save(state);
  }
  if (!red.asked) {
    const now = fetchHead();
    if (failsAt(now, red.id) === false) {
      say(`NOTE main-watch: ${red.id} passes on main at ${short(now)} after the attempt; the next tick runs the lanes there`);
      return 'red';
    }
    red.asked = file(`Ask: main is red: ${red.id} (#${red.issue})`, `${red.id} fails on main at ${short(now)}${red.landing ? `, since landing ${short(red.landing)}` : ''}. The automatic recoveries ended without clearing it: ${red.revert === 'conflicts' ? 'its revert conflicts' : red.revert ? 'its revert does not clear main' : 'there was no landing to revert'}, and the attempt on #${red.issue} ended. Landings stay paused until main is clean.`);
    say(`ASK main-watch: #${red.asked} for ${red.id}; landings stay paused`);
    save(state);
  }
  return 'red';
}

function tick() {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const lock = join(home, `${key}.lock`);
  let held;
  try {
    held = openSync(lock, 'wx');
    writeFileSync(held, String(process.pid));
  } catch {
    let pid, alive = false;
    try { pid = Number(readFileSync(lock, 'utf8')); } catch { return tick(); }
    // Signal 0 only asks whether the holder still runs.
    try { process.kill(pid, 0); alive = true; } catch {}
    if (alive) return say(`main-watch: a tick is already running (pid ${pid})`);
    rmSync(lock, { force: true });
    return tick();
  }
  try {
    run();
  } finally {
    closeSync(held);
    rmSync(lock, { force: true });
  }
}

function run() {
  const state = load();
  state.reds ??= {};
  state.filed ??= {};
  const head = fetchHead();
  if (state.last && !paused(state).length) {
    const count = tryGit(repo, 'rev-list', '--first-parent', '--count', `${state.last.head}..${head}`);
    const landings = count.status === 0 ? Number(count.stdout.trim()) : Infinity;
    const hours = (Date.now() - state.last.at) / 3_600_000;
    if (landings < LANDINGS && hours < HOURS) return say(`main-watch: not due: ${landings} of ${LANDINGS} landings since ${short(state.last.head)}, ${hours.toFixed(1)} of ${HOURS} hours`);
  }
  say(`RUN main-watch: the ${LANES.join(' and ')} lanes on main at ${short(head)}`);
  const { failing, listed, unproven } = runAt(head);
  state.last = { head, at: Date.now() };
  for (const id of listed) say(`KNOWN ${id}`);
  for (const lane of unproven) say(`INCONCLUSIVE main-watch: ${lane} on main at ${short(head)}, so this run isn't a clean one`);
  // A held failure no longer failing is cleared; a new one runs again alone, and pauses landings only if it holds.
  for (const id of Object.keys(state.reds)) if (!failing.has(id)) delete state.reds[id];
  for (const [id, message] of failing) {
    if (state.reds[id]) continue;
    const runs = [`FAIL on ${short(head)} in the ${LANES.join(' and ')} lanes`];
    let passes = false;
    for (let k = 1; k <= REPEATS && !passes; k++) {
      passes = failsAt(head, id) === false;
      runs.push(`${passes ? 'PASS' : 'FAIL'} on ${short(head)} run alone, repeat ${k} of ${REPEATS}`);
    }
    if (passes) {
      say(`INCONCLUSIVE main-watch: ${id} failed on main at ${short(head)} and passed run alone, so it reads flaky; landings stay open`);
      if (!state.filed[id]) state.filed[id] = file(`Flaky: ${id}`, `INCONCLUSIVE: ${id} failed on main at ${short(head)} and passed when run alone again (the main watch, #1333).\n\n${message}\n\nRuns:\n${runs.map((line) => `- ${line}`).join('\n')}`);
      continue;
    }
    state.reds[id] = { id, since: head, message, runs };
    say(`FAIL main-watch: ${id} fails on main at ${short(head)} on every repeat; landings paused`);
    save(state);
  }
  let landed = false;
  for (const red of paused(state)) {
    if (settle(state, red, head, failing) !== 'landed') continue;
    // The revert's tree was run whole. Main is clean there if it holds nothing else and nothing else landed since;
    // otherwise the failure stays held until a tick runs the lanes on main without it.
    landed = true;
    const now = fetchHead();
    if (paused(state).length === 1 && git(repo, 'rev-parse', `${now}^{tree}`) === git(tree, 'rev-parse', 'HEAD^{tree}')) {
      delete state.reds[red.id];
      state.clean = now;
      state.last = { head: now, at: Date.now() };
    }
    break;
  }
  if (!landed && !paused(state).length && !unproven.length) state.clean = head;
  save(state);
  say(paused(state).length ? `landings paused: main is red: ${paused(state).map(({ id }) => id).join(', ')}` : 'landings open');
}

function status() {
  const reds = paused(load());
  if (!reds.length) return say('landings open');
  say(`landings paused: main is red: ${reds.map(({ id, landing, issue }) => `${id}${landing ? ` since ${short(landing)}` : ''}${issue ? ` (#${issue})` : ''}`).join('; ')}`);
  process.exitCode = 1;
}

const command = process.argv[2];
if (command === 'tick') tick();
else if (command === 'status') status();
else {
  console.log('usage: node scripts/main-watch.mjs tick|status');
  process.exitCode = 2;
}
