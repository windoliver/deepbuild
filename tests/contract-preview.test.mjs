// #1802's two Scope lines its criteria don't reach, on the contract step itself: a break file the step didn't use
// fails it, and a release's notes give its count of preview entries beside the last release's.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PARAMS = { type: 'object', properties: { threshold: { type: 'integer' } }, required: ['threshold'], additionalProperties: false };

/** A tree publishing `api`, with what the step printed for each run on it. */
async function tree(api, run) {
  assert.ok(existsSync(join(REPO, 'packages/contracts/dist/index.js')), 'BLOCKED: packages/contracts/dist is not built (npm run build --workspaces)');
  const { d1Digest } = await import('../packages/contracts/dist/index.js');
  const root = mkdtempSync(join(tmpdir(), 'deep-contract-preview-'));
  const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const publish = (rows) => write('packages/contracts/extension-api.json', JSON.stringify(rows.map((r) => ({ variants: null, since: 'R1', digest: d1Digest(PARAMS), params: PARAMS, ...r }))));
  const step = (...args) => { const r = spawnSync(process.execPath, ['scripts/contract-diff.mjs', ...args, '--root', root], { cwd: REPO, encoding: 'utf8' }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  publish(api);
  write('contracts/shipped.json', JSON.stringify({ pieces: api.filter((r) => r.stability === 'stable').map((r) => ({ piece: `fixture/${r.method}`, calls: [r.method] })) }));
  try {
    await run({ step, write, publish });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a break file the step didn\'t use fails it, naming the file', async () => {
  await tree([{ method: 'deep.stays', stability: 'stable' }], ({ step, write }) => {
    assert.equal(step('record', '--release', 'R1').code, 0);
    assert.equal(step('check', '--release', 'R2').code, 0, 'R2 with nothing changed and no break file passes');
    write('contracts/breaks/R1_R2/1802.txt', 'workaround: Call deep.stays.\n');
    const r = step('check', '--release', 'R2');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL contracts: contracts\/breaks\/R1_R2\/1802\.txt: /m);
  });
});

test('a release\'s notes give its count of preview entries beside the last release\'s', async () => {
  const preview = (method) => ({ method, stability: 'preview', tracking: '#1802', preview_since: 'R1', decide_by: 'R4' });
  await tree([preview('deep.one'), preview('deep.two')], ({ step, publish }) => {
    assert.equal(step('record', '--release', 'R1').code, 0);
    publish([preview('deep.one')]);
    const r = step('notes', '--release', 'R2');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^Preview entries: 1 in R2, 2 in R1$/m);
  });
});
