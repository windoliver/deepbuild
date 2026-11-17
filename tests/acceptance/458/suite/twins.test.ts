// #458 criteria 1 and 5: every fixture has at least one planted-fault twin and a twin that passes makes its parent
// INVALID; every comparison of two outputs, each oracle-lane comparison and each same-result-two-ways fixture, has a
// planted-mismatch twin and a twin that passes makes the comparison INVALID. Verdict logic, so the fixtures are
// stubs: each lane's runner is the stub the test installs, and the suite decides from what it answers (README: The
// surface under test). The wrong programs are the base, which has no suite, and any suite that passes a fixture on
// its own run alone: the blind, bare and untwinned fixtures below pass their own runs.
import { describe, expect, it } from 'vitest';
import { AC, T0, TIMEOUT, answers, arr, commit, fail, list, obj, pass, requests, rowOf, runLane, world, type Fixture, type JsonObject, type Reply } from './helpers.ts';

const board = (name: string, twins: Fixture['twins']): Fixture => ({ name: `parity/kernel/${name}.board`, lanes: ['quick'], backends: ['vello_cpu'], owner: 'you', twins });
const twinsOf = (row: JsonObject): { name: string; verdict: string }[] =>
  arr(row['twins'], `${String(row['fixture'])}'s twins`).map((t) => ({ name: String(obj(t, 'a twin')['name']), verdict: String(obj(t, 'a twin')['verdict']) }));

describe(`${AC[1]} every fixture has a planted-fault twin, and a twin that passes makes its parent INVALID`, () => {
  it(`${AC[1]} a fixture whose twins fail reads PASS; one of whose twins passes reads INVALID, twin_passed, naming the twin; one with no twin reads INVALID, no_twin; and a fixture that fails reads FAIL`, () => {
    const guarded = board('guarded', [{ name: 'dropped-fill' }]);
    const partly = board('partly-guarded', [{ name: 'dropped-fill' }, { name: 'hidden-shade' }]);
    const blind = board('blind', [{ name: 'hidden-shade' }]);
    const bare = board('bare', []);
    const broken = board('broken', [{ name: 'dropped-fill' }]);
    const w = world([guarded, partly, blind, bare, broken]);
    // Every fixture's own run passes but `broken`'s. A twin the plan doesn't name fails as planted.
    answers(w, 'quick', {
      [guarded.name]: { run: pass() },
      [partly.name]: { run: pass(), twins: { 'hidden-shade': pass('the twin draws the same') } },
      [blind.name]: { run: pass(), twins: { 'hidden-shade': pass('the twin draws the same') } },
      [bare.name]: { run: pass() },
      [broken.name]: { run: fail() },
    });
    const record = runLane(w, 'quick', { commit: commit(1), now: T0 });

    const g = rowOf(record, guarded.name);
    expect(g['verdict'], `${guarded.name}: its run passed and its twin failed as planted`).toBe('PASS');
    expect(twinsOf(g), `${guarded.name}: the row lists its twin and the twin's verdict`).toEqual([{ name: 'dropped-fill', verdict: 'FAIL' }]);
    expect(requests(w, 'quick').filter((r) => r.fixture === guarded.name).map((r) => r.twin), `${guarded.name}: the runner was asked for the fixture and for its twin`).toEqual([null, 'dropped-fill']);

    const p = rowOf(record, partly.name);
    expect(p['verdict'], `${partly.name}: one of its two twins passed`).toBe('INVALID');
    expect(p['reason'], `${partly.name}: the reason`).toBe('twin_passed');
    expect(twinsOf(p).filter((t) => t.verdict === 'PASS').map((t) => t.name), `${partly.name}: the row names the twin that passed`).toEqual(['hidden-shade']);
    expect(twinsOf(p).filter((t) => t.verdict === 'FAIL').map((t) => t.name), `${partly.name}: and the twin that failed`).toEqual(['dropped-fill']);

    const b = rowOf(record, blind.name);
    expect(b['verdict'], `${blind.name}: its only twin passed, so its own PASS proves nothing`).toBe('INVALID');
    expect(b['reason'], `${blind.name}: the reason`).toBe('twin_passed');
    expect(twinsOf(b), `${blind.name}: the row names the twin that passed`).toEqual([{ name: 'hidden-shade', verdict: 'PASS' }]);

    const n = rowOf(record, bare.name);
    expect(n['verdict'], `${bare.name}: it has no planted-fault twin`).toBe('INVALID');
    expect(n['reason'], `${bare.name}: the reason`).toBe('no_twin');

    expect(rowOf(record, broken.name)['verdict'], `${broken.name}: its own run failed, and its twin failed as planted`).toBe('FAIL');
  }, TIMEOUT);

  it(`${AC[1]} every fixture the shipped suite lists has at least one planted-fault twin`, () => {
    const fixtures = arr(list()['fixtures'], 'the shipped suite\'s fixtures').map((f) => obj(f, 'a fixture'));
    const names = fixtures.map((f) => String(f['name']));
    // The fixtures #138's kit names, and the first the base's manifest lists: the list is the kit's, not a stub's.
    for (const name of ['parity/kernel/clean-rebuild-fuzz.scene', 'parity/kernel/patch-fuzz.scene', 'parity/framework/repair-loop.scene', 'parity/kernel/board.board']) {
      expect(names, `the shipped suite lists ${name}`).toContain(name);
    }
    expect(names.filter((name) => !/^parity\/[^/]+\/[^/]+\.[a-z0-9_]+$/.test(name)), 'every fixture is named parity/<category>/<name>.<profile>').toEqual([]);
    const bare = fixtures.filter((f) => !Array.isArray(f['twins']) || f['twins'].length === 0 || f['twins'].some((t) => typeof obj(t, 'a twin')['name'] !== 'string'));
    expect(bare.map((f) => String(f['name'])), `${bare.length} of ${fixtures.length} shipped fixtures have no planted-fault twin`).toEqual([]);
  }, TIMEOUT);
});

describe(`${AC[5]} every comparison of two outputs has a planted-mismatch twin, and a twin that passes makes the comparison INVALID`, () => {
  const comparisonsOf = (row: JsonObject): Record<string, { verdict: string; reason: string | null; twin: { name: string; verdict: string } | null }> =>
    Object.fromEntries(arr(row['comparisons'], `${String(row['fixture'])}'s comparisons`).map((c) => {
      const o = obj(c, 'a comparison');
      const twin = o['twin'] === null || o['twin'] === undefined ? null : { name: String(obj(o['twin'], 'a comparison\'s twin')['name']), verdict: String(obj(o['twin'], 'a comparison\'s twin')['verdict']) };
      return [String(o['name']), { verdict: String(o['verdict']), reason: typeof o['reason'] === 'string' ? o['reason'] : null, twin }];
    }));
  const two = (normal: Reply['verdict'], final: Reply['verdict']): NonNullable<Reply['comparisons']> => [{ name: 'normal', verdict: normal }, { name: 'final', verdict: final }];

  it(`${AC[5]} a same-result-two-ways fixture and an oracle-lane fixture whose comparisons' mismatch twins fail read PASS; a comparison whose mismatch twin passes, or that has none, reads INVALID, naming the comparison and the twin, and so does its fixture`, () => {
    // Same result two ways, in the quick lane: one comparison, `pair`.
    const pair = (name: string, twins: Fixture['twins']): Fixture => ({ name: `parity/marks2d/${name}.board`, lanes: ['quick'], backends: ['vello_cpu'], owner: 'you', twins });
    const expansion = pair('expansion', [{ name: 'dropped-stroke', comparison: 'pair' }]);
    const blindPair = pair('blind-expansion', [{ name: 'hidden-shade', comparison: 'pair' }]);
    const untwinned = pair('untwinned-expansion', [{ name: 'out-of-bounds' }]);
    // Oracle-lane fixtures: two comparisons each, the normal pass before the final frame.
    const oracle = (name: string): Fixture => ({ name: `parity/scene3d/${name}.scene`, lanes: ['oracle'], backends: ['gpu'], owner: 'you', twins: [{ name: 'flipped-normals', comparison: 'normal' }, { name: 'second-light', comparison: 'final' }] });
    const room = oracle('white-room');
    const grid = oracle('roughness-grid');
    const w = world([expansion, blindPair, untwinned, room, grid]);
    const same = { ...pass(), comparisons: [{ name: 'pair', verdict: 'PASS' as const }] };
    answers(w, 'quick', {
      [expansion.name]: { run: same },
      [blindPair.name]: { run: same, twins: { 'hidden-shade': same } },
      // Its only twin is a planted fault of the fixture, which fails on its bounds and leaves the comparison equal.
      [untwinned.name]: { run: same, twins: { 'out-of-bounds': { ...fail(), reason: 'bounds', comparisons: [{ name: 'pair', verdict: 'PASS' }] } } },
    });
    const matched = { ...pass(), comparisons: two('PASS', 'PASS') };
    answers(w, 'oracle', {
      [room.name]: { run: matched },
      // The twin planted for the final frame leaves both comparisons passing.
      [grid.name]: { run: matched, twins: { 'second-light': matched } },
    });
    const quick = runLane(w, 'quick', { commit: commit(1), now: T0 });
    const outside = runLane(w, 'oracle', { commit: commit(1), now: T0 });

    const e = rowOf(quick, expansion.name);
    expect(e['verdict'], `${expansion.name}: the pair is equal and its planted mismatch isn't`).toBe('PASS');
    expect(comparisonsOf(e), `${expansion.name}: the row lists the comparison, its verdict and its twin's`).toEqual({ pair: { verdict: 'PASS', reason: null, twin: { name: 'dropped-stroke', verdict: 'FAIL' } } });

    const bp = rowOf(quick, blindPair.name);
    expect(comparisonsOf(bp), `${blindPair.name}: the comparison's planted mismatch passed, so the comparison is INVALID, naming the twin`).toEqual({ pair: { verdict: 'INVALID', reason: 'twin_passed', twin: { name: 'hidden-shade', verdict: 'PASS' } } });
    expect(bp['verdict'], `${blindPair.name}: a fixture with an INVALID comparison`).toBe('INVALID');

    const u = rowOf(quick, untwinned.name);
    expect(comparisonsOf(u), `${untwinned.name}: no twin names the comparison, so it has no planted mismatch`).toEqual({ pair: { verdict: 'INVALID', reason: 'no_twin', twin: null } });
    expect(u['verdict'], `${untwinned.name}: a fixture with an INVALID comparison`).toBe('INVALID');

    const r = rowOf(outside, room.name);
    expect(r['verdict'], `${room.name}: both oracle-lane comparisons hold and each one's planted mismatch fails it`).toBe('PASS');
    expect(comparisonsOf(r), `${room.name}: each comparison with its own twin`).toEqual({
      normal: { verdict: 'PASS', reason: null, twin: { name: 'flipped-normals', verdict: 'FAIL' } },
      final: { verdict: 'PASS', reason: null, twin: { name: 'second-light', verdict: 'FAIL' } },
    });

    const g = rowOf(outside, grid.name);
    expect(comparisonsOf(g), `${grid.name}: the final frame's planted mismatch passed; the normal pass's failed`).toEqual({
      normal: { verdict: 'PASS', reason: null, twin: { name: 'flipped-normals', verdict: 'FAIL' } },
      final: { verdict: 'INVALID', reason: 'twin_passed', twin: { name: 'second-light', verdict: 'PASS' } },
    });
    expect(g['verdict'], `${grid.name}: a fixture with an INVALID comparison`).toBe('INVALID');
  }, TIMEOUT);
});
