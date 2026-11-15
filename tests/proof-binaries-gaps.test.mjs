// Selection and lifetime regressions for #1123; real runners and dependency-free Cargo fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { cargoRepo, commit, dump, git, run, sandbox, write } from './acceptance/1123/helpers.mjs';

const plain = "import test from 'node:test'; import assert from 'node:assert/strict'; test('selected', () => assert.equal(2 + 2, 4));\n";
const unused = "import {test,expect} from 'vitest'; test('excluded', () => { expect(process.env.DEEP_BIN_DIR).toBeTruthy(); /* deep-hook */ });\n";
function fixture(t) {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'crates/deep-hook/src/main.rs', 'fn main() { compile_error!("unselected binary"); }\n');
  return box;
}
function launch(box, lanes) {
  write(box.repo, 'driver.mjs', `import {runLanes} from './scripts/lanes.mjs'; process.exitCode=runLanes(${lanes});\n`);
  commit(box, 'fixture'); git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(box.repo, 'changed.md', 'the only changed path\n');
  return run(box, process.execPath, ['driver.mjs']);
}

test('path-skipped lanes cannot add binary build prerequisites to the selected lane', (t) => {
  const box = fixture(t);
  write(box.repo, 'tests/plain.test.mjs', plain);
  write(box.repo, 'tests/optional.test.ts', unused);
  const result = launch(box, `[{name:'selected',commands:[[process.execPath,'--test','tests/plain.test.mjs']],fix:'none'}, {name:'optional',paths:['untouched/**'],commands:[[process.execPath,'node_modules/vitest/vitest.mjs','run','tests/optional.test.ts']],fix:'none'}]`);
  assert.equal(result.status, 0, dump(result));
  assert.match(result.stdout, /SKIP optional/);
  assert.match(result.stdout, /PASS selected/);
});

test('Vitest excludes apply before binary demand is collected', (t) => {
  const box = fixture(t);
  write(box.repo, 'tests/plain.test.ts', "import {test,expect} from 'vitest'; test('selected',()=>expect(2+2).toBe(4));\n");
  write(box.repo, 'tests/ignore/bad.test.ts', unused);
  write(box.repo, 'vitest.config.mjs', "export default {test:{include:['tests/**/*.test.ts']}};\n");
  const result = launch(box, `[{name:'selected',commands:[[process.execPath,'node_modules/vitest/vitest.mjs','run','--exclude','tests/ignore/**']],fix:'none'}]`);
  assert.equal(result.status, 0, dump(result));
  assert.match(result.stdout, /PASS selected/);
  assert.doesNotMatch(result.stdout, /unselected binary/);
});

for (const signal of ['SIGTERM', 'SIGKILL']) {
  test(`run-private directories disappear after the creating lane receives ${signal}`, async (t) => {
    const box = sandbox(t), ready = join(box.dir, 'ready');
    write(box.repo, 'tests/hold.test.mjs', `import test from 'node:test'; import {writeFileSync} from 'node:fs'; test('holds', async()=>{writeFileSync(${JSON.stringify(ready)},JSON.stringify({bin:process.env.DEEP_BIN_DIR,pid:process.pid}));await new Promise(r=>setTimeout(r,20000));});\n`);
    write(box.repo, 'driver.mjs', "import {runLanes} from './scripts/lanes.mjs';runLanes([{name:'hold',commands:[[process.execPath,'--test','tests/hold.test.mjs']],fix:'none'}]);\n");
    const child = spawn(process.execPath, ['driver.mjs'], { cwd: box.repo, env: box.env, stdio: 'ignore', detached: true });
    const done = new Promise((resolve) => child.once('exit', resolve));
    t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
    const end = Date.now() + 15000;
    while (!existsSync(ready) && Date.now() < end) await sleep(25);
    assert.ok(existsSync(ready), 'real consumer must start before interrupting its runner');
    const { bin } = JSON.parse(readFileSync(ready, 'utf8'));
    assert.ok(bin && existsSync(bin), 'the consumer received a live private directory');
    child.kill(signal); await done;
    const deadline = Date.now() + 5000;
    while (existsSync(bin) && Date.now() < deadline) await sleep(25);
    assert.equal(existsSync(bin), false, 'a killed run must not leave its binary directory');
  });
}
