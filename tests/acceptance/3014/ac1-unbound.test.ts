// #3014 AC1: suite 393's writer.test.ts passes as it stands, its unbound-call test finding no object in the evidence
// store, and, read with the issue's first scope line, a run that neither lists nor opens a fixture's document writes
// none of the fixtures' assets. The wrong programs are the base (every run writes every listed fixture's assets) and
// the twins writes-every-fixture and skips-unbound-only (README: The wrong programs).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALPHA, PLAIN, doc, hashesNamed, listed, nameOf, objects, run, runSuiteFile, show, useShowBinary, useStores, world } from './helpers.ts';

const AC1 = '#3014.2c886ba2';
/** Suite 393's criterion 4 test of the unbound call, by its title in writer.test.ts. */
const UNBOUND_TEST = 'AC4 a deep_show call bound to no session is refused: it draws nothing, makes no revision and attaches no evidence';

useShowBinary();
const store = useStores();

describe(`${AC1} tests/acceptance/393/writer.test.ts passes, its unbound-call test finding no object in the evidence store`, () => {
  it(`${AC1} AC1 tests/acceptance/393/writer.test.ts, run unchanged, passes every test, its unbound-call test among them`, () => {
    const r = runSuiteFile('tests/acceptance/393/writer.test.ts', join(store(), 'writer-report.json'));
    const unbound = r.tests.filter((t) => t.name.endsWith(UNBOUND_TEST));
    expect(unbound.length, `the report holds suite 393's unbound-call test once (tests: ${JSON.stringify(r.tests.map((t) => t.name))}; output: ${r.output})`).toBe(1);
    const failed = r.tests.filter((t) => t.status !== 'passed').map((t) => `${t.name} [${t.status}]: ${t.failure}`);
    expect(failed, 'every test of writer.test.ts passes; the unbound-call test finds no object in the evidence store').toEqual([]);
    expect(r.status, `vitest exits 0 on writer.test.ts: ${r.output}`).toBe(0);
  }, 1_800_000);

  it(`${AC1} AC1 a run that lists and opens no fixture writes no fixture's asset: an unbound deep_show leaves its fresh store empty, and a bound deep_show of a plain board leaves none of the hashes the listed fixtures name`, () => {
    const fixtures = listed(store());
    const named = new Map<string, string[]>();
    for (const f of fixtures) for (const sha of hashesNamed(f.document)) named.set(sha, [...(named.get(sha) ?? []), nameOf(f)]);
    expect(named.size, 'some listed fixture names an asset by its SHA-256, so the check below is not empty').toBeGreaterThan(0);

    const unboundStore = store();
    const [refused] = run(world(unboundStore, [show(null, doc(1), PLAIN, ['issues', 'pixels'])]));
    expect(refused!['outcome'], 'the deep_show call bound to no session is refused').toBe('refused');
    expect(refused!['code'], 'with the code no_session').toBe('no_session');
    expect(objects(unboundStore), 'a run of one deep_show call bound to no session leaves its fresh evidence store with no object').toEqual([]);

    const plainStore = store();
    const [shown] = run(world(plainStore, [show(ALPHA.id, doc(1), PLAIN)]));
    expect(shown!['outcome'], `the plain board is presented: ${JSON.stringify(shown).slice(0, 1500)}`).toBe('presented');
    const written = objects(plainStore).filter((sha) => named.has(sha)).map((sha) => `${sha} (named by ${named.get(sha)!.join(', ')})`);
    expect(written, 'a run that shows a plain board, listing and opening no fixture, writes no asset a listed fixture names').toEqual([]);
  }, 600_000);
});
