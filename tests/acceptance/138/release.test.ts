// #138.68b285c9: a canvas module that fails any part of the kit can't be registered in a release build. The
// kit writes its per-module results to a ledger; a release build (`cargo build --release`) embeds the ledger
// named by DEEP_KIT_LEDGER at build time and its seal refuses a module whose record is missing, of another
// digest or not PASS (README: A release build refuses what failed the kit). The planted module is
// `test.kit.carry` with a checkpoint that leaves out a counter (it fails carried_state); its clean twin passes.
// Two release builds: slow, so the timeouts are long. At the base there is no `kit` call, no ledger and no
// `test-kit-carry*` feature.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REFUSED_EXIT, REGISTRY, kit, obj, releaseBuild, run, scenario, show, start, str, strs, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const BAD: Build = { set: 'full', with: ['test-kit-carry-drops-hits'] };
const GOOD: Build = { set: 'full', with: ['test-kit-carry'] };
const builds = useBuilds([BAD, GOOD]);
const evidence = useEvidence();

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-138-release-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

/** The default kit over every module of a build, writing its ledger. */
function ledgerOf(build: Build, name: string): { ledger: string; record: JsonObject } {
  const ledger = join(dir, `${name}.json`);
  const r = kit(builds.bin(build), evidence(), { ledger });
  expect(existsSync(ledger), `the kit wrote its ledger to ${ledger}`).toBe(true);
  const written = obj(JSON.parse(readFileSync(ledger, 'utf8')), 'the ledger');
  for (const m of r.modules) {
    if (m.module === 'core') continue;
    const rec = obj(written[m.module], `the ledger's record of ${m.module}`);
    expect(rec['verdict'], `${m.module}: the ledger records the kit's verdict`).toBe(m.verdict);
    expect(rec['digest'], `${m.module}: the ledger records the module's digest`).toBe(m.digest);
    str(rec['version'], `${m.module}: version`);
    obj(rec['parts'], `${m.module}: parts`);
  }
  return { ledger, record: obj(written['test.kit.carry'], 'the ledger\'s record of test.kit.carry') };
}

describe('#138.68b285c9 a canvas module that fails any part of the kit can\'t be registered in a release build', () => {
  it('#138.68b285c9 test.kit.carry with a checkpoint that drops a counter fails the kit, and the release build embedding that ledger refuses to start, naming it and no shipped module', () => {
    const { ledger, record } = ledgerOf(BAD, 'bad');
    expect(record['verdict'], 'the planted module failed the kit').toBe('FAIL');
    expect(obj(record['parts'], 'parts')['carried_state'], 'its carried_state part failed').toBe('FAIL');
    const built = releaseBuild(BAD, ledger, dir);
    expect(built.error, 'the release build compiles').toBe('');
    const s = start(built.bin, ['run'], [{ evidence: evidence(), calls: [REGISTRY] }]);
    expect(s.status, `the release build refuses to start (exit ${REFUSED_EXIT}): ${s.stdout.slice(0, 800)} ${s.stderr.slice(0, 800)}`).toBe(REFUSED_EXIT);
    expect(s.lines.length, 'one refusal line and no reply').toBe(1);
    const line = obj(s.lines[0], 'the refusal');
    expect([line['code'], line['reason']], `the seal refuses for the kit: ${show(line)}`).toEqual(['seal_refused', 'kit_failed']);
    expect(strs(line['modules'], 'refusal.modules'), 'it names the module that failed the kit, and only it').toEqual(['test.kit.carry']);
  }, 3_600_000);

  it('#138.68b285c9 the same module with the counter in its checkpoint passes the kit, and its release build starts and seals it', () => {
    const { ledger, record } = ledgerOf(GOOD, 'good');
    expect(record['verdict'], 'the fixed module passed the kit').toBe('PASS');
    const built = releaseBuild(GOOD, ledger, dir);
    expect(built.error, 'the release build compiles').toBe('');
    const [reg] = run(built.bin, scenario(evidence(), [REGISTRY]));
    expect(strs(reg!['modules'], 'registry.modules'), 'the release build sealed the module').toContain('test.kit.carry');
  }, 3_600_000);
});
