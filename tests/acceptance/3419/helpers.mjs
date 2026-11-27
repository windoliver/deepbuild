import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approve, hardwareKey } from './authenticator.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

export const OWN = 9419;
export const OTHER = 9420;
const issueBody = (n) => `Planted for #3419.\n\n### Acceptance criteria\n- [ ] The planted suite ${n} holds\n\n### Proof\nNone.\n`;

export const testFile = (name = 'holds') => `import assert from 'node:assert/strict';
import test from 'node:test';

test('${name}', () => {
  assert.equal(1 + 1, 2);
});
`;

export const importingTestFile = (name = 'holds') => `import assert from 'node:assert/strict';
import test from 'node:test';
import { two } from './fixture.mjs';

test('${name}', () => {
  assert.equal(1 + 1, two);
});
`;
export const FIXTURE = 'export const two = 2;\n';

const WHY = 'shared: the planted port; each file holds it.';
export const laneJson = (fields = {}) => `${JSON.stringify({ alone: true, why: WHY, ...fields }, null, 2)}\n`;

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

const CARGO = '[workspace]\nresolver = "2"\nmembers = []\n';

export function scene(t, { base = {}, commits = [], issue = OWN, scripts = join(CHECKOUT, 'scripts') } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3419-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'scene'), home = join(dir, 'home'), issues = join(dir, 'issues'), tmp = join(dir, 'tmp');
  for (const folder of [cwd, home, tmp]) mkdirSync(folder);
  write(issues, Object.fromEntries([OWN, OTHER].map((n) => [`${n}.md`, issueBody(n)])));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  const key = hardwareKey('fixture-person');
  git('init', '-q', '-b', 'main');
  cpSync(scripts, join(cwd, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(cwd, 'node_modules'));
  write(cwd, { '.gitignore': 'node_modules\ntarget\n', 'Cargo.toml': CARGO, '.deepbuild/approvers': key.line, ...base });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  commits.forEach(({ files = {}, remove = [], approved = false }, at) => {
    write(cwd, files);
    for (const path of remove) rmSync(join(cwd, path));
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', `Planted commit ${at + 1}\n\nPart of #${issue}`);
    if (approved) approve({ dir, git }, key, [...Object.keys(files), ...remove], `c${at + 1}`);
  });
  const env = { ...process.env, HOME: home, TMPDIR: tmp, XDG_CACHE_HOME: join(home, '.cache'), DEEP_PROOF_ISSUES: issues, DEEP_SHARDS: '1', DEEP_TEST_GRANT_WAIT: '5',
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_BIN_DIR', 'DEEP_GATES', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_WORK_TREE']) delete env[name];
  return { dir, cwd, env };
}

const ran = (result) => ({ status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', all: `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}` });
const node = ({ cwd, env }, args, timeout = 240_000) => ran(spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 }));

export const guard = (box) => node(box, ['scripts/proof.mjs', 'guard']);

export const affected = (box, args) => node(box, ['scripts/affected.mjs', ...args], 600_000);

export const failLines = (output) => output.split('\n').filter((line) => /^FAIL guard: /.test(line));

export function listBlocks(stdout) {
  const blocks = {};
  for (const line of stdout.split('\n')) {
    const found = line.match(/^(parallel|alone|timed|slow|exclusive) (vitest|node): (.*?)(?: \(--(?:timed|slow) runs them\))?$/);
    if (found) blocks[`${found[1]} ${found[2]}`] = found[3].split(' ').filter(Boolean);
    const skip = line.match(/^SKIP (\S+)/);
    if (skip) (blocks.skip ??= []).push(skip[1]);
  }
  return blocks;
}
export const blocksOf = (blocks, file) => Object.keys(blocks).filter((name) => blocks[name].includes(file));

export async function lintLane(box) {
  const code = `const { checks } = await import(${JSON.stringify(join(box.cwd, 'scripts/lanes.mjs'))}); console.log(JSON.stringify(checks.find(({ name }) => name === 'lint').commands.filter(([, script]) => script?.startsWith('scripts/'))));`;
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: box.cwd, env: box.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (read.status !== 0) return Object.assign([{ label: 'reading the lint lane', status: read.status, output: `${read.stdout}${read.stderr}` }], { cwd: box.cwd });
  const commands = JSON.parse(read.stdout.trim().split('\n').at(-1));
  const runs = commands.map(([command, ...args]) => new Promise((done) => {
    const child = spawn(command, args, { cwd: box.cwd, env: box.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (status, signal) => { clearTimeout(timer); done({ label: args.join(' '), status: status ?? signal, output }); });
    child.on('error', (error) => { clearTimeout(timer); done({ label: args.join(' '), status: 'error', output: error.message }); });
  }));
  return Object.assign(await Promise.all(runs), { cwd: box.cwd });
}
