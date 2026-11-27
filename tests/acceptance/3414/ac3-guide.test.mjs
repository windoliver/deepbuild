import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CHECKOUT, GUIDE, checkoutFile, cleanEnv } from './helpers.mjs';

const ID = '#3414.36aa633e';
const FIELD = /`kernel`|"kernel"(?=\s*:)/g;

test(`${ID} AC3: node scripts/guide.mjs --check passes, and the generated guide holds kernel only as the name of the manifest's field`, { timeout: 120_000 }, () => {
  const run = spawnSync(process.execPath, ['scripts/guide.mjs', '--check'], { cwd: CHECKOUT, env: cleanEnv(), encoding: 'utf8', timeout: 110_000 });
  assert.equal(run.status, 0, `node scripts/guide.mjs --check exits ${run.status}:\n${run.stdout}${run.stderr}`);
  const others = checkoutFile(GUIDE).split('\n').flatMap((line, i) => {
    const left = line.replace(FIELD, '');
    return /kernel/i.test(left) ? [`${GUIDE}:${i + 1}: ${(left.match(/.{0,60}kernel.{0,40}/i) ?? [left])[0]}`] : [];
  });
  assert.deepEqual(others, [], `the generated guide says kernel other than as the manifest's field \`kernel\`:\n${others.join('\n')}`);
});
