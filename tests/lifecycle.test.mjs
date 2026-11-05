// Regressions of scripts/lifecycle.mjs replay (#570) that its acceptance suite doesn't cover: each passed a log it
// must fail before the second review's fixes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const ID = (n) => `01K74FKZVK8Q2X5R7M3N9P4T${String(n).padStart(2, '0').replace(/[ILOU]/g, 'A')}`;
const envelope = { actor: 'you', scope: 'you', ts: 1_760_013_451_123 };

/** Runs replay on one log of these events, numbered in log_pos order. */
function replay(t, events) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'log.jsonl');
  writeFileSync(file, events.map((e, i) => JSON.stringify({ ...envelope, ...e, log_pos: i + 1 })).join('\n') + (events.length ? '\n' : ''));
  const r = spawnSync(process.execPath, [join(root, 'scripts/lifecycle.mjs'), 'replay', file], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
}
const resource = { host: 'local', kind: 'port', key: '4317' };
const acquired = { v: 2, id: ID(1), kind: 'lease.acquired', writer: 'core', data: { resource, holder: 'session:S1', mode: 'exclusive', expires: 1 } };

test("a refusal the core recorded for a move its table allows fails: the record refused too much", (t) => {
  const r = replay(t, [
    { v: 4, id: ID(1), kind: 'ask.created', writer: 'core', data: {} },
    { v: 4, id: ID(2), kind: 'ask.answered', subject: `ask:${ID(1)}`, writer: 'core', data: {} },
    { v: 1, id: ID(3), kind: 'move.refused', writer: 'core', data: { object: `ask:${ID(1)}`, table: 'ask.machine@1', state: 'open', event: 'ask.answered', event_id: ID(2) } },
  ]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL lifecycle replay: .*was refused moving ask:\S+ from open, which ask\.machine@1 allows/);
});

test("an agent's release of a session's lease with no proof fails", (t) => {
  const r = replay(t, [acquired, { v: 2, id: ID(2), kind: 'lease.released', writer: 'hook', data: { ...acquired.data, proof: [] } }]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL lifecycle replay: .*\(lease\.released\) moves lease:port\/4317 from held/);
});

test('a release whose proof cites itself fails: a proof cites only earlier events', (t) => {
  const r = replay(t, [acquired, { v: 2, id: ID(2), kind: 'lease.released', writer: 'core', data: { ...acquired.data, proof: [ID(2)] } }]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL lifecycle replay: .*\(lease\.released\)/);
});

test('an empty log never passes', (t) => {
  const r = replay(t, []);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^INVALID lifecycle replay: .*the log holds no event/m);
});
