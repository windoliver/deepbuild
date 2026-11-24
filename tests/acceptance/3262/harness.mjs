// How the #3262 acceptance tests run #3222's harness (criteria 1 and 2; README: The surface under test). The harness
// is the checkout's own `docs/spikes/3222/harness.mjs`: it starts a real hub of that checkout's build, which runs that
// checkout's `deep-show canvas`, drives it with scripted sessions and writes one row per call. A test runs it in this
// checkout (the change) and in a built checkout of the merge base (`DEEP_3262_BASE`), one after the other, and keeps
// both outputs side by side. Nothing here judges: judge.mjs does.
//
// Every process started here is stopped by PID (the harness, and the hub it names in its ready line), and the
// temporary folder is removed. A run that can't be made throws a plain Error starting BLOCKED or INCONCLUSIVE.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout under test: this suite is three levels down. */
export const REPO = join(HERE, '..', '..', '..');
/** The harness the criteria name, by its path in a checkout. */
export const HARNESS = 'docs/spikes/3222/harness.mjs';
/** Where both sides' outputs are kept, in the checkout under test (README: Kept outputs). */
export const KEPT = 'docs/evidence/3262';
/** The proof lanes stop a file at 20 minutes: what a file's harness runs may take together, with room to stop them. */
const FILE_MS = 18 * 60_000;
const started = Date.now();

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const blocked = (text) => Error(`BLOCKED: ${text}`);

/** What a checkout lacks to run the harness, or null: the built CLI and hub, the canvas core and the hook client the hub needs. */
export function unbuilt(checkout) {
  const missing = [HARNESS, 'docs/spikes/3222/probe.mjs', 'packages/cli/dist/main.js', 'packages/hub/dist/canvas.js', 'node_modules'].filter((file) => !existsSync(join(checkout, file)));
  for (const bin of ['deep-show', 'deep-hook']) if (!['debug', 'release'].some((profile) => existsSync(join(checkout, 'target', profile, bin)))) missing.push(`target/{debug,release}/${bin}`);
  return missing.length ? `${checkout} lacks ${missing.join(', ')} (npm run build --workspaces; cargo build --locked --bin deep-show --bin deep-hook)` : null;
}

/** The harness's environment: this one without the hub's, the agents' and git's settings, HOME moved into the run's folder. */
function harnessEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|TMUX|CLAUDE|CODEX|GIT_)/.test(k) || k === 'NODE_OPTIONS' || k === 'NODE_TEST_CONTEXT') continue;
    env[k] = v;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
}

/**
 * Runs `node docs/spikes/3222/harness.mjs <flags> --gate --home <dir> --out <file>` in `checkout` and gives its output:
 * the object, and its text as the harness wrote it. `--gate` only makes the harness name its hub's PID before its
 * sessions send a call, so this can stop that hub; the go line is written as soon as the ready line is read.
 */
export async function runHarness(checkout, flags, what) {
  const lack = unbuilt(checkout);
  if (lack) throw blocked(`${what} can't run: ${lack}`);
  const left = FILE_MS - (Date.now() - started);
  if (left < 60_000) throw Error(`INCONCLUSIVE: ${what} wasn't started: this file's earlier runs left it ${Math.round(left / 1000)} s of the ${FILE_MS / 60_000} minutes a file may take`);
  // Short: the hub's socket path must fit in 104 bytes.
  const tmp = realpathSync(mkdtempSync('/tmp/dh3262-'));
  const home = join(tmp, 'h');
  mkdirSync(home);
  const outFile = join(tmp, 'out.json');
  const child = spawn(process.execPath, [join(checkout, HARNESS), ...flags, '--gate', '--home', home, '--out', outFile], { cwd: checkout, env: harnessEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-3000); });
  child.stdin.on('error', () => undefined);
  const exited = new Promise((done) => { child.once('exit', (code, signal) => done({ code, signal })); child.once('error', (error) => done({ code: null, signal: error.message })); });
  let hub, timer;
  // deadline: only turns a harness that never ends into a result that names it; the run itself waits for the harness's exit.
  const late = new Promise((done) => { timer = setTimeout(() => done('late'), left); });
  try {
    const first = new Promise((done) => {
      createInterface({ input: child.stdout }).once('line', done);
      void exited.then(() => done(undefined));
    });
    const line = await Promise.race([first, late]);
    if (line === 'late') throw Error(`INCONCLUSIVE: ${what} wasn't ready within ${Math.round(left / 1000)} s (the rest of this file's ${FILE_MS / 60_000} minutes)`);
    let ready;
    try { ready = JSON.parse(line ?? ''); } catch { ready = undefined; }
    if (ready?.ready !== true || !Number.isInteger(ready.hub)) throw blocked(`${what}: the harness didn't start its hub and sessions (its first line is ${JSON.stringify(line ?? null)}, not {"ready": true, "hub": <pid>}); it said: ${said.trim().slice(-1500)}`);
    hub = ready.hub;
    child.stdin.end('go\n');
    const end = await Promise.race([exited, late]);
    if (end === 'late') throw Error(`INCONCLUSIVE: ${what} hadn't ended ${Math.round(left / 1000)} s after it started (the rest of this file's ${FILE_MS / 60_000} minutes), so its calls' times weren't read`);
    if (end.code !== 0) throw blocked(`${what}: the harness exited ${end.code ?? end.signal}: ${said.trim().slice(-1500)}`);
    if (!existsSync(outFile)) throw blocked(`${what}: the harness wrote no --out file`);
    const text = readFileSync(outFile, 'utf8');
    try { return { output: JSON.parse(text), text }; } catch (error) { throw blocked(`${what}: the harness's --out file isn't JSON: ${error.message}`); }
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      // The harness stops what it started when it is asked to stop.
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* it has just ended */ }
      let grace;
      // deadline: bounds the wait for the harness's own cleanup before it is killed.
      const gone = await Promise.race([exited, new Promise((done) => { grace = setTimeout(() => done('still'), 30_000); })]);
      clearTimeout(grace);
      if (gone === 'still') try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    }
    if (hub && alive(hub)) try { process.kill(hub, 'SIGKILL'); } catch { /* gone */ }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function git(checkout, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const run = spawnSync('git', ['-C', checkout, ...args], { env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return run.status === 0 ? run.stdout.trim() : null;
}

/**
 * The built checkout of the merge base, which `DEEP_3262_BASE` names: its path and its commit. BLOCKED, never a pass,
 * when it isn't given, isn't another checkout, isn't built, isn't at this checkout's merge base with origin/main (as
 * scripts/proof-change.mjs reads it), or holds changed program files: its output would not be the merge base's.
 */
export function mergeBase() {
  const given = process.env.DEEP_3262_BASE;
  if (!given) throw blocked('DEEP_3262_BASE names no built checkout of the merge base, so the harness wasn\'t run on it and nothing is kept beside the change\'s output');
  const path = resolve(given);
  if (!existsSync(path)) throw blocked(`DEEP_3262_BASE names ${path}, which isn't there`);
  if (realpathSync(path) === realpathSync(REPO)) throw blocked('DEEP_3262_BASE names the checkout under test: its output would be a copy of the change\'s');
  const lack = unbuilt(path);
  if (lack) throw blocked(`DEEP_3262_BASE isn't a built checkout: ${lack}`);
  const commit = git(path, 'rev-parse', 'HEAD');
  if (!commit) throw blocked(`git can't read the commit DEEP_3262_BASE (${path}) is at`);
  const base = git(REPO, 'merge-base', 'HEAD', 'origin/main');
  if (!base) throw blocked('git can\'t read this checkout\'s merge base with origin/main (git merge-base HEAD origin/main), so nothing shows that DEEP_3262_BASE is at it');
  if (commit !== base) throw blocked(`DEEP_3262_BASE is at ${commit}, and this checkout's merge base with origin/main is ${base}`);
  const changed = git(path, 'status', '--porcelain', '--untracked-files=no', '--', 'crates', 'packages', 'docs/spikes/3222', 'Cargo.toml', 'Cargo.lock');
  if (changed === null) throw blocked(`git can't read the state of DEEP_3262_BASE (${path})`);
  if (changed) throw blocked(`DEEP_3262_BASE holds changed files, so it isn't the merge base's program: ${changed.split('\n').slice(0, 5).join('; ')}`);
  return { path, commit };
}

/** The merge base's run of the same flags: its output, which names the merge base's commit as the commit it ran at. */
export async function runOnMergeBase(base, flags, what) {
  const run = await runHarness(base.path, flags, `${what} on the merge base`);
  const at = run.output?.machine?.commit;
  if (at !== base.commit) throw blocked(`${what} on the merge base: its output names commit ${JSON.stringify(at ?? null)} as the one it ran at, not the merge base ${base.commit}`);
  return run;
}

/** BLOCKED when two runs weren't taken with the same build of the canvas core: they aren't a before and an after. */
export function sameCore(change, base, what) {
  const [a, b] = [change.output?.machine?.canvas_core, base.output?.machine?.canvas_core];
  if (a !== b) throw blocked(`${what}: the change's hub ran ${JSON.stringify(a ?? null)} and the merge base's ${JSON.stringify(b ?? null)}; build both checkouts' canvas core the same way`);
}

/**
 * Keeps a run's output on the change and on its merge base side by side, as the harness wrote each:
 * `docs/evidence/3262/<name>.json` and `docs/evidence/3262/<name>.merge-base.json`. Returns the two paths.
 */
export function keep(name, change, base) {
  const dir = join(REPO, KEPT);
  mkdirSync(dir, { recursive: true });
  const files = [[`${name}.json`, change.text], [`${name}.merge-base.json`, base.text]];
  for (const [file, text] of files) writeFileSync(join(dir, file), text);
  for (const [file, text] of files) if (readFileSync(join(dir, file), 'utf8') !== text) throw blocked(`${KEPT}/${file} doesn't hold the output that was written to it`);
  return files.map(([file]) => `${KEPT}/${file}`);
}
