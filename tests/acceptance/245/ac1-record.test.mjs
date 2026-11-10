// #245 AC1: "Both forms run the fixture, recording step wall time (p50 and p95) and mapping and
// page-fault overhead for each". Reads the spike's stored record; times nothing itself.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AGENTS, BLOCKS, FORMS, MIN_STEPS, RATE_HZ, RECORD, REFERENCE_MACS, THREADS,
  inRepo, loadRecord, nearestRank, sha256File,
} from './helpers.mjs';

test('#245 AC1 the record was made on a reference Mac under the design\'s timing conditions', () => {
  const r = loadRecord();
  assert.equal(r.issue, 245, `${RECORD}: issue must be 245`);
  const h = r.host ?? {};
  assert.ok(REFERENCE_MACS.includes(h.model), `BLOCKED: host.model ${JSON.stringify(h.model)} is not a reference Mac (${REFERENCE_MACS.join(', ')})`);
  assert.equal(h.os, 'macOS', 'BLOCKED: host.os must be macOS');
  assert.ok(typeof h.os_build === 'string' && h.os_build.trim() !== '', 'host.os_build: the macOS build is recorded with every result');
  assert.equal(h.power, 'ac', 'INCONCLUSIVE: a timing counts only on mains power (host.power "ac")');
  assert.equal(h.low_power_mode, false, 'INCONCLUSIVE: a timing counts only with Low Power Mode off');
  assert.equal(h.thermal, 'nominal', 'INCONCLUSIVE: a timing counts only with the thermal state nominal');
});

test('#245 AC1 the fixture is the 8,000-agent steering program at 60 Hz with 8 blocks, kept in the repo by hash', () => {
  const r = loadRecord();
  const f = r.fixture ?? {};
  assert.equal(f.agents, AGENTS, 'fixture.agents');
  assert.equal(f.rate_hz, RATE_HZ, 'fixture.rate_hz');
  assert.equal(f.blocks, BLOCKS, 'fixture.blocks');
  const abs = inRepo(f.path);
  assert.ok(abs, `fixture.path ${JSON.stringify(f.path)} must be a repo-relative path inside the checkout`);
  assert.ok(!f.path.startsWith('tests/acceptance/245/'), 'the fixture is the spike\'s (and #212\'s), not this suite\'s');
  assert.ok(existsSync(abs), `BLOCKED: no fixture at ${f.path}`);
  assert.match(String(f.sha256), /^[0-9a-f]{64}$/, 'fixture.sha256');
  assert.equal(sha256File(abs), f.sha256, `fixture.sha256 is not the hash of ${f.path}`);
  const bytes = readFileSync(abs);
  if (f.path.endsWith('.wasm')) {
    assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], `${f.path} is not WebAssembly`);
  } else {
    assert.ok(f.path.endsWith('.wat'), 'fixture.path names a .wasm or .wat logic program');
    assert.match(bytes.toString('utf8'), /\(module\b/, `${f.path} is not a WebAssembly text module`);
  }
});

for (const name of FORMS) {
  test(`#245 AC1 ${name} ran the fixture and recorded step wall time and mapping and page-fault overhead, p50 and p95, from its per-step samples`, () => {
    const r = loadRecord();
    const m = r.forms?.[name];
    assert.ok(m && typeof m === 'object', `BLOCKED: ${RECORD} has no forms.${name}`);
    assert.equal(m.threads, THREADS[name], `forms.${name}.threads`);
    assert.ok(Number.isInteger(m.steps) && m.steps >= MIN_STEPS, `forms.${name}.steps must be an integer of at least ${MIN_STEPS}`);
    for (const key of ['wall_ms', 'overhead_ms']) {
      const s = m[key];
      assert.ok(s && typeof s === 'object', `forms.${name}.${key} missing`);
      assert.ok(Array.isArray(s.samples), `forms.${name}.${key}.samples: one reading per step`);
      assert.equal(s.samples.length, m.steps, `forms.${name}.${key}.samples has one reading per step`);
      for (const [i, x] of s.samples.entries()) {
        assert.ok(typeof x === 'number' && Number.isFinite(x) && x >= 0, `forms.${name}.${key}.samples[${i}] = ${x} is not a finite reading`);
      }
      if (key === 'wall_ms') assert.ok(s.samples.every((x) => x > 0), `forms.${name}.wall_ms: a step takes time`);
      for (const [q, p] of [[0.5, 'p50'], [0.95, 'p95']]) {
        assert.ok(typeof s[p] === 'number' && Number.isFinite(s[p]), `forms.${name}.${key}.${p} missing`);
        assert.equal(s[p], nearestRank(s.samples, q), `forms.${name}.${key}.${p} is not the nearest-rank ${p} of its samples`);
      }
    }
  });
}

test('#245 AC1 both forms ran the same fixture to the same bits', () => {
  const r = loadRecord();
  const one = r.forms?.one_instance?.deep_hash;
  const cow = r.forms?.copy_on_write?.deep_hash;
  assert.match(String(one), /^[0-9a-f]{16,}$/, 'forms.one_instance.deep_hash: the full-state hash after the last step');
  assert.match(String(cow), /^[0-9a-f]{16,}$/, 'forms.copy_on_write.deep_hash: the full-state hash after the last step');
  assert.equal(cow, one, 'the two forms must give the same bits (design: Step blocks)');
  assert.equal(r.forms.copy_on_write.steps, r.forms.one_instance.steps, 'both forms run the same number of steps');
});
