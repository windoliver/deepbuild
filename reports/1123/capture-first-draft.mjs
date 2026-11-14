// #1123 regression: a sibling's real Cargo build must not supply the runner's private snapshot.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url)), probe = 'tests/capture.test.mjs';
for (const surface of ['lanes', 'proof-runs', 'affected']) test(`${surface}: capture excludes a concurrent foreign Cargo build`, async () => {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-capture-'))), cwd = join(box, 'repo');
  const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  const env = { ...process.env, HOME: join(box, 'home'), CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_NET_OFFLINE: 'true',
    PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH}`, CAPTURE_BOX: box, RUSTC_WRAPPER: join(box, 'rustc-wrapper.mjs') };
  for (const key of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'DEEP_THROTTLE', 'RUSTC_WORKSPACE_WRAPPER']) delete env[key];
  const run = (command, args, where = cwd, extra = {}) => {
    const r = spawnSync(command, args, { cwd: where, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `${command} ${args.join(' ')}\n${r.stderr ?? r.error}`); return r.stdout.trim();
  };
  let child, ended = false, output = '';
  try {
    mkdirSync(env.HOME, { recursive: true });
    cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true }); // Unmodified owned modules, including lints.
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'));
    for (const [dir, word, version] of [[cwd, 'own', '0.0.0'], [join(box, 'foreign'), 'foreign', '0.0.1']]) {
      put(join(dir, 'Cargo.toml'), `[package]\nname="deep-hook"\nversion="${version}"\nedition="2021"\n`);
      put(join(dir, 'src/main.rs'), `fn main() { println!("${word}"); }\n`);
      put(join(dir, 'word'), word);
      run('cargo', ['generate-lockfile', '--offline'], dir, { RUSTC_WRAPPER: '' });
    }
    put(join(cwd, '.gitignore'), 'target\nnode_modules\n');
    put(join(cwd, probe), `import test from 'node:test'; import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process'; import {appendFileSync,readFileSync,realpathSync} from 'node:fs'; import {join,resolve} from 'node:path';
test('#${9001}.00000000 owns its binary', () => {
  const dir=process.env.DEEP_BIN_DIR, bin=join(dir ?? 'target/debug','deep-hook');
  const r=spawnSync(bin,[],{encoding:'utf8'}), expected=readFileSync('word','utf8');
  const privateBin=Boolean(dir) && realpathSync(bin)!==resolve('target/debug/deep-hook');
  appendFileSync(join(process.env.CAPTURE_BOX,'observed'),JSON.stringify({actual:r.stdout?.trim(),expected,privateBin})+'\\n');
  assert.equal(r.stdout?.trim(),expected,'must execute this run’s own build'); assert.ok(privateBin);
});\n`);
    const git = (...args) => run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'capture fixture');
    env.CAPTURE_REV = git('rev-parse', 'HEAD');
    const url = (file) => JSON.stringify(pathToFileURL(join(cwd, 'scripts', file)).href);
    const driver = surface === 'lanes' ? `const {runLanes}=await import(${url('lanes.mjs')});
process.exitCode=runLanes([{name:'unit',commands:[['cargo','build','--locked'],[process.execPath,'--test',${JSON.stringify(probe)}]],fix:'capture own build'}],{cwd:process.cwd()});`
      : surface === 'affected' ? `process.argv=[process.execPath,${JSON.stringify(join(cwd, 'scripts/affected.mjs'))},${JSON.stringify(probe)}]; await import(${url('affected.mjs')});`
        : `const {prepareRuns,removeTemporaries}=await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/proof-runs.mjs')).href)});
try { const r=prepareRuns({root:process.cwd(),change:{base:process.env.CAPTURE_REV,head:process.env.CAPTURE_REV,whole:[{path:${JSON.stringify(probe)},status:'A',hunks:[]}]}}); console.log(JSON.stringify([...r.base.results.values(),...r.head.results.values()])); } finally {removeTemporaries();}`;
    put(join(box, 'driver.mjs'), `process.env.CAPTURE_OWNER=String(process.pid);\n${driver}\n`);
    // Rust's supported wrapper boundary: stop only our driver, not Cargo; let Cargo finish and release its lock.
    put(env.RUSTC_WRAPPER, `#!${process.execPath}
import {spawnSync} from 'node:child_process'; import {existsSync,writeFileSync} from 'node:fs'; import {join,resolve} from 'node:path';
const a=process.argv.slice(3), r=spawnSync(process.argv[2],a,{stdio:'inherit'}), mark=join(process.env.CAPTURE_BOX,'ready');
if(r.status===0 && a.includes('--crate-name') && a[a.indexOf('--crate-name')+1]==='deep_hook' && !existsSync(mark)) {
  process.kill(Number(process.env.CAPTURE_OWNER),'SIGSTOP');
  writeFileSync(mark,JSON.stringify({cargo:process.ppid,cwd:process.env.CARGO_MANIFEST_DIR,built:resolve(a[a.indexOf('--out-dir')+1],'../deep-hook')}));
}
process.exit(r.status ?? 1);\n`);
    chmodSync(env.RUSTC_WRAPPER, 0o755);
    child = spawn(process.execPath, [join(box, 'driver.mjs')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const done = new Promise(resolve => { child.on('error', e => { ended = true; output += e; resolve(); }); child.on('close', () => { ended = true; resolve(); }); });
    const until = async predicate => { const end = Date.now() + 60000; while (!predicate() && Date.now() < end) await sleep(10); assert.ok(predicate(), `BLOCKED capture handshake\n${output}`); };
    await until(() => existsSync(join(box, 'ready')) || ended);
    if (existsSync(join(box, 'ready'))) {
      const mark = JSON.parse(readFileSync(join(box, 'ready'), 'utf8'));
      await until(() => { const r=spawnSync('ps',['-o','stat=','-p',String(mark.cargo)],{encoding:'utf8'}); return r.status===1 || /^Z/.test(r.stdout.trim()); });
      assert.equal(run(mark.built, [], mark.cwd), 'own', 'the runner’s own Cargo finished before the competing build');
      // Never attack a private target: the sibling writes only the checkout's conventional shared target/.
      run('cargo', ['build', '--offline', '--target-dir', join(mark.cwd, 'target')], join(box, 'foreign'), { RUSTC_WRAPPER: '' });
      assert.equal(run(join(mark.cwd, 'target/debug/deep-hook'), [], mark.cwd), 'foreign');
      child.kill('SIGCONT');
    }
    await until(() => ended); await done;
    const observed = existsSync(join(box, 'observed')) ? readFileSync(join(box, 'observed'), 'utf8').trim().split('\n').map(JSON.parse) : [];
    assert.equal(observed.length, surface === 'proof-runs' ? 2 : 1, output);
    for (const row of observed) { assert.equal(row.actual, row.expected, `foreign build captured by ${surface}\n${output}`); assert.equal(row.privateBin, true, output); }
    assert.ok(existsSync(join(box, 'ready')), 'no real runner build exercised the capture window');
  } finally {
    if (child && !ended) { child.kill('SIGCONT'); child.kill('SIGTERM'); }
    rmSync(box, { recursive: true, force: true });
  }
});
