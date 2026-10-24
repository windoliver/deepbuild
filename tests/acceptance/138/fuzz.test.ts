// The fuzzing parts against their wrong programs: a test module that panics (criteria 1, 2), a content key
// that leaves out params (1), the core's refusal without a code and a refusal that writes (2), and four
// planted twins of Patch's laws (20). Planted test modules get fewer sequences than the default only to find
// the planted fault; the default 10,000 is shipped.test.ts's. At the base there is no `kit` call and no
// `test-kit-crash` feature.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  expectFailure, failuresIn, isObject, kit, moduleOf, num, obj, partIn, str, useBuilds, useEvidence,
  type Build, type JsonValue,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const CRASH: Build = { set: 'full', with: ['test-kit-crash'] };
const builds = useBuilds([FULL, CRASH]);
const evidence = useEvidence();

describe('#138.a5815177 a crash in a fuzzed sequence becomes a corpus file; a cache that misses a clean rebuild fails', () => {
  it('#138.a5815177 test.kit.crash panics on n > 90: clean_rebuild fails with crash, naming the seed and a corpus file the report lists, holding the sequence, which replays the crash', () => {
    const r = kit(builds.bin(CRASH), evidence(), { modules: ['test.kit.crash'], parts: ['clean_rebuild'], sequences: 2_000 });
    const m = moduleOf(r, 'test.kit.crash');
    expect(m.verdict, 'the crashing module fails the kit').toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'clean_rebuild'), 'crash', {}, 'test.kit.crash clean_rebuild');
    const seed = num(f['seed'], 'crash.seed');
    const file = str(f['corpus'], 'crash.corpus');
    expect(r.corpus, 'the report lists the corpus file the crash wrote').toContain(file);
    expect(file.startsWith(evidence()), `the corpus file is under the run's evidence root: ${file}`).toBe(true);
    expect(existsSync(file), `the corpus file exists: ${file}`).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
    expect(isObject(saved), 'the corpus file is a JSON object').toBe(true);
    const o = obj(saved, 'the corpus file');
    expect(o['module'], 'the corpus file names the module').toBe('test.kit.crash');
    expect(o['seed'], 'the corpus file holds the seed').toBe(seed);
    expect(Array.isArray(o['patches']) && (o['patches'] as JsonValue[]).length > 0, 'the corpus file holds the patch sequence').toBe(true);
    const again = kit(builds.bin(CRASH), evidence(), { modules: ['test.kit.crash'], parts: ['clean_rebuild'], replay: file });
    expectFailure(failuresIn(moduleOf(again, 'test.kit.crash'), 'clean_rebuild'), 'crash', { seed }, 'the replayed corpus file');
  }, 1_800_000);

  it('#138.a5815177 a planted content key without params (key_without_params) fails clean_rebuild for marks2d with mismatch, naming what differed and the seed', () => {
    const clean = kit(builds.bin(FULL), evidence(), { modules: ['marks2d'], parts: ['clean_rebuild'], sequences: 300 });
    expect(partIn(moduleOf(clean, 'marks2d'), 'clean_rebuild').verdict, 'the clean core passes the same 300 sequences').toBe('PASS');
    const r = kit(builds.bin(FULL), evidence(), { modules: ['marks2d'], parts: ['clean_rebuild'], sequences: 300 }, { planted: 'key_without_params' });
    const m = moduleOf(r, 'marks2d');
    expect(m.verdict, 'a stale cache fails the module').toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'clean_rebuild'), 'mismatch', {}, 'marks2d under key_without_params');
    expect(['array', 'cache', 'key', 'snapshot'], 'the mismatch says what differed from the clean rebuild').toContain(f['what']);
    str(f['name'], 'mismatch.name');
    num(f['seed'], 'mismatch.seed');
  }, 1_800_000);
});

describe('#138.b4f429ff the patch fuzzer finds panics and refusals without codes, and a refused patch that writes', () => {
  it('#138.b4f429ff test.kit.crash\'s panic is found by patch_fuzz, naming the seed', () => {
    const r = kit(builds.bin(CRASH), evidence(), { modules: ['test.kit.crash'], parts: ['patch_fuzz'], sequences: 2_000 });
    const m = moduleOf(r, 'test.kit.crash');
    expect(m.verdict).toBe('FAIL');
    num(expectFailure(failuresIn(m, 'patch_fuzz'), 'panic', {}, 'test.kit.crash patch_fuzz')['seed'], 'panic.seed');
    expect(num(obj(partIn(m, 'patch_fuzz').raw['stats'], 'stats')['panics'], 'stats.panics'), 'the panic is counted').toBeGreaterThan(0);
  }, 1_800_000);

  it.each([
    ['refusal_without_code', 'refusal_without_code', {}],
    ['refused_patch_writes', 'law', { law: 2 }],
  ] as const)('#138.b4f429ff planted %s fails patch_fuzz with %s, naming the seed', (planted, code, fields) => {
    const r = kit(builds.bin(FULL), evidence(), { modules: ['marks2d'], parts: ['patch_fuzz'], sequences: 300 }, { planted });
    const m = moduleOf(r, 'marks2d');
    expect(m.verdict, `${planted} fails the module`).toBe('FAIL');
    num(expectFailure(failuresIn(m, 'patch_fuzz'), code, fields, `marks2d under ${planted}`)['seed'], `${code}.seed`);
  }, 1_800_000);
});

describe('#138.ca6ad34d planted twins of Patch\'s laws each fail, naming the law and the patch\'s seed', () => {
  it.each([
    ['dry_run_skips_recheck', 1],
    ['undo_reorder_mints_key', 3],
    ['apply_time_order_keys', 4],
    ['incremental_check_skips_referrers', 5],
  ] as const)('#138.ca6ad34d %s fails law %i naming a seed; that seed alone fails it again, and passes on the clean core', (planted, law) => {
    const bin = builds.bin(FULL);
    const r = kit(bin, evidence(), { modules: ['marks2d'], parts: ['patch_fuzz'], sequences: 500 }, { planted });
    const m = moduleOf(r, 'marks2d');
    expect(m.verdict, `${planted} fails the module`).toBe('FAIL');
    const f = expectFailure(failuresIn(m, 'patch_fuzz'), 'law', { law }, `marks2d under ${planted}`);
    const seed = num(f['seed'], 'law.seed');
    const once = kit(bin, evidence(), { modules: ['marks2d'], parts: ['patch_fuzz'], patch_seed: seed }, { planted });
    expectFailure(failuresIn(moduleOf(once, 'marks2d'), 'patch_fuzz'), 'law', { law, seed }, `the one patch with seed ${seed} under ${planted}`);
    const clean = kit(bin, evidence(), { modules: ['marks2d'], parts: ['patch_fuzz'], patch_seed: seed });
    expect(partIn(moduleOf(clean, 'marks2d'), 'patch_fuzz').verdict, `the patch with seed ${seed} keeps law ${law} on the clean core`).toBe('PASS');
  }, 1_800_000);
});
