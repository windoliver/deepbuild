// Process-list output is OS-boundary evidence, never permission to discard unparseable rows.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

for (const field of ['ppid', 'pgid']) test(`malformed ${field} scan cannot certify a binary build`, t => {
  const box = sandbox(t), tools = join(box.dir, 'tools'), directory = join(box.dir, 'run');
  mkdirSync(tools); mkdirSync(directory);
  const ps = spawnSync('sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(ps, 'BLOCKED: real process-list command required');
  const start = spawnSync(ps, ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8', env: { ...box.env, TZ: 'UTC', LC_ALL: 'C' },
  });
  assert.equal(start.status, 0, 'owner identity is available');
  write(tools, 'ps', `#!/bin/sh\n'${ps}' "$@" || exit $?\ncase "$*" in *${field}*) printf 'unreadable-process-row\\n';; esac\n`);
  chmodSync(join(tools, 'ps'), 0o755);
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/proof-bin-build.mjs'), directory,
    String(process.pid), start.stdout.trim(), process.execPath, '-e', 'console.log("REAL BUILD COMPLETED")'], {
    cwd: box.repo, env: { ...box.env, PATH: `${tools}:${box.env.PATH}` }, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.error, undefined, 'supervisor reports its own result, not an outer timeout');
  if (field === 'pgid') assert.match(result.stdout, /REAL BUILD COMPLETED/, 'real work finished before cleanup evidence failed');
  else assert.doesNotMatch(result.stdout, /REAL BUILD COMPLETED/, 'unproven launch ancestry starts no work');
  assert.notEqual(result.status, 0, 'malformed process evidence is not successful cleanup');
  assert.match(result.stderr, /BLOCKED.*process.*scan.*malformed/i, 'missing evidence is explicitly named');
  if (field === 'pgid') {
    const records = join(box.repo, 'target/.deep-proof-builds');
    assert.ok(existsSync(records) && readdirSync(records).some(file => file.endsWith('.json')),
      'unproven cleanup keeps the bay reuse barrier record');
  }
});
