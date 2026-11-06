// The blocking-call guard (#1556) over a planted app source: a wait on a process fails naming its line, and an allowed
// one passes only with its reason.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const guard = new URL('../scripts/blocking-call-guard.mjs', import.meta.url).pathname;
const run = (source) => {
  const root = mkdtempSync(join(tmpdir(), 'blocking-call-'));
  try {
    mkdirSync(join(root, 'crates/deep-app/src'), { recursive: true });
    writeFileSync(join(root, 'crates/deep-app/src/view.rs'), source.join('\n'));
    const ran = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    return { code: ran.status, out: ran.stdout };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('each wait on a process fails naming its line, and one with its reason passes', () => {
  const { code, out } = run([
    'fn click() {',
    '    let _ = Command::new("deep").arg("setup").output();',
    '    // blocking call: reaps the child it just killed.',
    '    let _ = child.wait();',
    '    let _ = child',
    '        .wait_with_output();',
    '    let _ = Command::new("deep").status(); // blocking call: headless, no window to freeze.',
    '}',
  ]);
  assert.equal(code, 1);
  assert.deepEqual(out.trim().split('\n').map((line) => line.split(': ').slice(0, 2).join(': ')), [
    'FAIL blocking call: crates/deep-app/src/view.rs:2:46',
    'FAIL blocking call: crates/deep-app/src/view.rs:6:9',
  ]);
});

test('an allowance that gives no reason fails, as does one above other code', () => {
  const { code, out } = run([
    '    // blocking call:',
    '    let _ = child.wait();',
    '    // blocking call: reaps the child.',
    '    child.kill();',
    '    let _ = child.wait();',
  ]);
  assert.equal(code, 1);
  assert.match(out, /view\.rs:2:/);
  assert.match(out, /view\.rs:5:/);
});

test('a call named in a comment or a string is no call', () => {
  const { code, out } = run(['// a blocking .output() froze the window', 'const SAID: &str = "child.wait()";']);
  assert.equal(code, 0, out);
  assert.match(out, /^PASS blocking call/);
});
