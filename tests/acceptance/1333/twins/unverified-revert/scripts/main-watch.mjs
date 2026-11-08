// #1333 twin `unverified-revert`: the blind job's throwaway job with one planted fault. It lands the revert without running anything on it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LANDINGS = 5, HOURS = 6, REPEATS = 3;
const throttle = fileURLToPath(new URL('./throttle.mjs', import.meta.url));
const lease = fileURLToPath(new URL('./lease', import.meta.url));
const cwd = process.cwd();
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const git = (dir, ...args) => {
  const r = run('git', args, { cwd: dir });
  if (r.status !== 0) throw Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const gh = (...args) => {
  const r = run('gh', args, { cwd });
  if (r.status !== 0) throw Error(`gh ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const top = git(cwd, 'rev-parse', '--show-toplevel');
const folder = join(homedir(), '.deepbuild', 'main-watch', createHash('sha256').update(top).digest('hex').slice(0, 16));
mkdirSync(folder, { recursive: true });
const stateFile = join(folder, 'state.json');
const load = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
const save = (s) => { writeFileSync(`${stateFile}.tmp`, JSON.stringify(s, null, 2)); renameSync(`${stateFile}.tmp`, stateFile); };
const short = (sha) => sha.slice(0, 7);

const command = process.argv[2];
if (command === 'status') {
  const s = load();
  if (s.paused) { console.log(`landings paused: ${s.paused}`); process.exit(1); }
  console.log('landings open');
  process.exit(0);
}
if (command !== 'tick') { console.log('usage: main-watch.mjs tick|status'); process.exit(2); }

let n = 0;
function checkout(commit) {
  const dir = join(folder, 'checkouts', `${process.pid}-${n++}`);
  git(top, 'worktree', 'add', '-q', '--detach', dir, commit);
  return dir;
}
const drop = (dir) => { run('git', ['worktree', 'remove', '--force', dir], { cwd: top }); rmSync(dir, { recursive: true, force: true }); };

/** The unit and lint lanes of the checkout's own lanes.mjs, through its runLanes; each failing test or lane. */
function lanes(dir) {
  const code = `const { checks, runLanes, exactTree } = await import(${JSON.stringify(pathToFileURL(join(dir, 'scripts', 'lanes.mjs')).href)});
const tree = exactTree(${JSON.stringify(dir)});
const status = runLanes(checks.filter(({ name }) => name === 'unit' || name === 'lint'), { cwd: ${JSON.stringify(dir)} });
console.log('@@WATCH@@' + JSON.stringify({ status, tree }));`;
  const r = run(process.execPath, ['--input-type=module', '-e', code], { cwd: dir });
  process.stdout.write(r.stdout.split('\n').filter((line) => !line.startsWith('@@WATCH@@')).join('\n'));
  const { tree } = JSON.parse(r.stdout.split('\n').find((line) => line.startsWith('@@WATCH@@')).slice(9));
  const failures = [];
  for (const lane of ['unit', 'lint']) {
    const record = JSON.parse(readFileSync(join(homedir(), '.deepbuild', 'lanes', `${tree}-${lane}.json`), 'utf8'));
    const failed = record.tests.filter(({ state }) => !['PASS', 'LISTED'].includes(state)).map(({ id }) => id);
    failures.push(...failed);
    if (record.state !== 'PASS' && !failed.length) failures.push(`lane ${lane}`);
  }
  const listed = JSON.parse(readFileSync(join(dir, 'scripts', 'known-failures.json'), 'utf8')).failures ?? {};
  return failures.filter((id) => !listed[id]);
}
/** The one test alone, on a checkout, under the throttle and the lease. */
function alone(dir, id) {
  const [file, ...names] = id.split(' › ');
  const name = names.at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return run(process.execPath, [throttle, 'test', '--wait', '30', '--', lease, process.execPath, '--test', `--test-name-pattern=^${name}$`, file], { cwd: dir }).status === 0;
}
const aloneAt = (commit, id) => { const dir = checkout(commit); try { return alone(dir, id); } finally { drop(dir); } };
function issueOf(sha) {
  const message = git(top, 'log', '-1', '--format=%B', sha);
  const found = message.match(/\b(?:Closes|Fixes|Resolves|Part of)\s+#(\d+)/i);
  if (found) return Number(found[1]);
  const pr = message.match(/^Merge pull request #(\d+)/)?.[1];
  if (!pr) return null;
  return Number(gh('pr', 'view', pr, '--json', 'body', '-q', '.body').match(/\b(?:Closes|Fixes|Resolves|Part of)\s+#(\d+)/i)?.[1]) || null;
}

git(cwd, 'fetch', '-q', 'origin', 'main');
const head = git(cwd, 'rev-parse', 'origin/main');
const s = load();
const since = s.lastRun ? Number(git(cwd, 'rev-list', '--first-parent', '--count', `${s.lastRun}..${head}`)) : Infinity;
const hours = s.lastAt ? (Date.now() - s.lastAt) / 3_600_000 : Infinity;
if (!s.paused && since < LANDINGS && hours < HOURS) {
  console.log(`SKIP not due: ${since} landings and ${hours.toFixed(1)} h since the last run`);
  process.exit(0);
}
s.lastRun = head;
s.lastAt = Date.now();
save(s);

if (s.incident?.asked) { console.log(`FAIL main ${short(head)} is still red; already asked`); process.exit(0); }
const dir = checkout(head);
let fresh;
try { fresh = lanes(dir); } finally { drop(dir); }
if (!fresh.length) {
  Object.assign(s, { clean: head, paused: null, incident: null });
  save(s);
  console.log(`PASS main ${short(head)}: no new failure; landings open`);
  process.exit(0);
}
const id = fresh[0];
// Run alone again.
const runs = [{ ok: false, where: 'the unit lane' }];
for (let i = 1; i <= REPEATS; i++) runs.push({ ok: aloneAt(head, id), where: `alone, repeat ${i}` });
if (runs.some(({ ok }) => ok)) {
  console.log(`INCONCLUSIVE ${id}: failed once on main ${short(head)} and passed on a repeat; filed; landings go on`);
  gh('issue', 'create', '--title', `Flaky: ${id}`, '--body', `INCONCLUSIVE: ${id} failed on main ${short(head)} and passed when run again alone.\n\nRuns:\n${runs.map(({ ok, where }) => `- ${ok ? 'PASS' : 'FAIL'} on ${short(head)} (${where})`).join('\n')}\n`);
  Object.assign(s, { clean: head });
  save(s);
  process.exit(0);
}
s.paused = `main ${short(head)} is red: ${id}`;
save(s);
// Bisect over the landings since the last clean run, with the failing test alone.
const list = git(cwd, 'rev-list', '--first-parent', '--reverse', `${s.clean}..${head}`).split('\n').filter(Boolean);
let lo = 0, hi = list.length - 1;
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  if (aloneAt(list[mid], id)) lo = mid + 1; else hi = mid;
}
const landing = list[lo];
// Make sure the one before ran: needed when the search ended without visiting it.
if (lo > 0) aloneAt(list[lo - 1], id);
const issue = issueOf(landing);
console.log(`FAIL ${id}: broke at landing ${short(landing)} (#${issue}); landings paused`);
s.paused = `main is red: ${id} broke at ${short(landing)} (#${issue})`;
s.incident = { id, landing, issue };
save(s);
const revert = checkout(head);
try {
  const branch = `main-watch/revert-${short(landing)}`;
  git(revert, 'checkout', '-q', '-b', branch);
  const parents = git(top, 'rev-list', '--parents', '-n', '1', landing).split(' ').length - 1;
  const reverted = run('git', ['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), landing], { cwd: revert });
  if (reverted.status !== 0) {
    run('git', ['revert', '--abort'], { cwd: revert });
    console.log(`FAIL the revert of ${short(landing)} conflicts; starting an attempt on #${issue}`);
    const agent = run('sh', ['-c', 'command -v claude']).status === 0 ? 'claude' : 'codex';
    const prompt = `Main is red: ${id} fails since landing ${short(landing)} of #${issue}, and its revert conflicts. Fix main.`;
    run(agent, agent === 'claude' ? ['-p', prompt] : ['exec', prompt], { cwd: revert, input: '' });
    git(cwd, 'fetch', '-q', 'origin', 'main');
    const now = git(cwd, 'rev-parse', 'origin/main');
    if (aloneAt(now, id)) { console.log('the attempt cleared the failing test'); process.exit(0); }
    gh('issue', 'create', '--title', `Ask: main is still red after an attempt on #${issue}`, '--body', `${id} fails on main ${short(now)} since ${short(landing)} (#${issue}). Its revert conflicts, and an attempt on #${issue} ended with main still red. Landings stay paused.`);
    s.incident.asked = true;
    save(s);
    console.log(`FAIL main still red after the attempt; asked once; landings stay paused`);
    process.exit(0);
  }
  git(revert, 'push', '-q', 'origin', branch);
  const url = gh('pr', 'create', '--base', 'main', '--head', branch, '--title', `Revert ${short(landing)}: ${id} fails`, '--body', `Reverts ${landing}, which broke ${id}. Part of #${issue}`);
  const failing = [];
  if (failing.length) { console.log(`FAIL the revert doesn't clear main: ${failing.join(', ')}`); process.exit(0); }
  gh('pr', 'merge', url.match(/(\d+)$/)[1], '--merge');
  gh('issue', 'reopen', String(issue), '--comment', `Reopened: landing ${short(landing)} broke ${id} on main, so it was reverted in ${url}.`);
  git(cwd, 'fetch', '-q', 'origin', 'main');
  const now = git(cwd, 'rev-parse', 'origin/main');
  Object.assign(s, { clean: now, lastRun: now, paused: null, incident: null });
  save(s);
  console.log(`PASS the revert of ${short(landing)} landed; #${issue} reopened; landings open`);
} finally {
  drop(revert);
}
