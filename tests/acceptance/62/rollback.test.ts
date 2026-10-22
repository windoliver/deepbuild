// #62 AC11 and AC4: rollback is a compensating event. Rolling back appends learn.rolled_back and deletes no
// event; rolling back one change flags what was built on it; rolling back to a date compensates newest
// first and restores exactly what agents read at session start.
import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';
import { allEvents, apply, canon, DAY, expectState, handleOf, HOUR, layerRow, openWorld, propose, removeRoots, said, sliceText, startSession, widen, youApp } from './helpers.ts';

afterEach(removeRoots);

const asLogged = (events: Event[]): string[] => events.map((e) => `${e.log_pos}:${canon(e)}`);

describe('AC11 rolling back appends learn.rolled_back and deletes no event', () => {
  it('AC11 rolling back one change appends one learn.rolled_back, keeps every event, and flags the change that supersedes it and the one that cites it, not an unrelated one', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: 'the api runs on 4100 now' },
      { id: 'm2', from: 'you', text: 'no, it moved to 4101' },
      { id: 'm3', from: 'you', text: 'lint with biome' },
    ]);
    const scope = `session:${S1}`;
    const a = await apply(w, { target: 'slice:api', diff: '+ api runs on 4100', evidence: [{ at: said(S1, 'm1'), quote: 'runs on 4100' }], scope });
    const hA = await handleOf(w, a);
    const b = await apply(w, { target: 'slice:api', diff: '- api runs on 4100\n+ api runs on 4101', evidence: [{ at: said(S1, 'm2'), quote: 'moved to 4101' }], scope, supersedes: hA });
    // C cites A: its quote is at A's handle, which resolves to A's diff (README: Readings).
    const c = await apply(w, { target: 'slice:web', diff: '+ web proxies the api on its port', evidence: [{ at: hA, quote: 'api runs on 4100' }], scope });
    const e = await apply(w, { target: 'slice:lint', diff: '+ lint with biome', evidence: [{ at: said(S1, 'm3'), quote: 'lint with biome' }], scope });
    for (const id of [a, b, c, e]) await expectState(w, id, 'applied', 'before the rollback');

    const before = await allEvents(w.record);
    const rolled = await w.record.rollBack(youApp, { change: a });
    expect(rolled, 'the rollback compensates the one change').toEqual([a]);
    const after = await allEvents(w.record);
    // Wrong program: a rollback that deletes or rewrites A's event, or that leaves no event of its own.
    expect(asLogged(after.slice(0, before.length)), 'every earlier event is still in the log, as it was').toEqual(asLogged(before));
    expect(after.slice(before.length).map((x) => x.kind), 'the rollback is one appended learn.rolled_back').toEqual(['learn.rolled_back']);
    await expectState(w, a, 'rolled_back', 'the rolled-back change');
    // Wrong program: a rollback that flags nothing, or everything.
    for (const id of [b, c]) {
      const row = await expectState(w, id, 'applied', 'a change built on the rolled-back one stays, flagged');
      const flag = String(row.flagged ?? '');
      expect(flag.includes(a) || flag.includes(hA), `${id} is flagged, naming the rolled-back change (flagged: ${flag})`).toBe(true);
    }
    expect((await layerRow(w, e)).flagged ?? null, 'an unrelated change is not flagged').toBeNull();
    expect(await sliceText(w, S1), 'an unrelated change stays in the slice').toContain('lint with biome');
    await w.record.close();
  });
});

describe('AC4 rolling back to a date restores the start slice exactly and flags what depended on it', () => {
  it('AC4 AC11 everything learned since a date is compensated newest first, one learn.rolled_back each, nothing deleted; every session reads at its start exactly what it read then; a pending change built on a rolled-back one is flagged', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: 'alpha: the api runs on 4100' },
      { id: 'm2', from: 'you', text: 'bravo: tests run with vitest' },
      { id: 'm3', from: 'you', text: 'never push without asking' },
      { id: 'm4', from: 'you', text: 'charlie: the web runs on 4200' },
      { id: 'm5', from: 'you', text: 'bravo moved: tests run with vitest --run' },
    ]);
    const S2 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'add a coupon field' }]);
    const S3 = await startSession(w, 'blog', [{ id: 'm1', from: 'you', text: 'write the release notes' }]);
    const sessions = [S1, S2, S3];
    const scope = `session:${S1}`;
    const c1Change = { target: 'slice:alpha', diff: '+ api runs on 4100', evidence: [{ at: said(S1, 'm1'), quote: 'the api runs on 4100' }] };
    const c1 = await apply(w, { ...c1Change, scope });
    const c2 = await apply(w, { target: 'slice:bravo', diff: '+ tests run with vitest', evidence: [{ at: said(S1, 'm2'), quote: 'tests run with vitest' }], scope });
    const rule = await apply(w, { layer: 'base', target: 'rule:nopush', diff: '+ never push without asking', evidence: [{ at: said(S1, 'm3'), quote: 'never push without asking' }], scope: 'all' }, 'you');

    // The date: everything before it stays; everything learned since is rolled back.
    const date = w.clock.tick(HOUR);
    const then = new Map<string, unknown>();
    for (const s of sessions) then.set(s, await w.record.startSlice(s));
    w.clock.tick(HOUR);

    const c3 = await apply(w, { target: 'slice:charlie', diff: '+ web runs on 4200', evidence: [{ at: said(S1, 'm4'), quote: 'the web runs on 4200' }], scope });
    const w1 = await widen(w, { ...c1Change, scope: 'repo:shop', supersedes: await handleOf(w, c1) }, 'you');
    const c5 = await apply(w, { target: 'slice:bravo', diff: '- tests run with vitest\n+ tests run with vitest --run', evidence: [{ at: said(S1, 'm5'), quote: 'vitest --run' }], scope, supersedes: await handleOf(w, c2) });
    const refused = await apply(w, { target: 'spec:shop', diff: '+ guests may check out', evidence: [{ at: said(S1, 'm5'), quote: 'bravo moved' }], scope });
    await expectState(w, refused, 'refused', 'a learned change aimed at a spec');
    const pending = await propose(w, S1, 'shop', { target: 'slice:charlie', diff: '- web runs on 4200\n+ web runs on 4201', evidence: [{ at: said(S1, 'm4'), quote: 'web runs on 4200' }], scope, supersedes: await handleOf(w, c3) });
    for (const id of [c3, w1, c5]) await expectState(w, id, 'applied', 'learned after the date');
    expect(await sliceText(w, S2), 'the widening reached the repo').toContain('api runs on 4100');
    expect(JSON.stringify(await w.record.startSlice(S1)), 'the slice changed after the date').not.toBe(JSON.stringify(then.get(S1)));
    w.clock.tick(DAY);

    const before = await allEvents(w.record);
    const posOf = new Map(before.map((e) => [e.id, e.log_pos]));
    const rolled = await w.record.rollBack(youApp, { since: date });
    // Exactly what was learned since the date and still in force: not the refused attempt, not the pending
    // proposal, not what came before, and not your typed rule, which isn't learned.
    expect([...rolled].sort(), 'the changes learned since the date are compensated').toEqual([c3, w1, c5].sort());
    const positions = rolled.map((id) => posOf.get(id)!);
    expect(positions, 'newest first').toEqual([...positions].sort((x, y) => y - x));
    const after = await allEvents(w.record);
    expect(asLogged(after.slice(0, before.length)), 'every earlier event is still in the log, as it was').toEqual(asLogged(before));
    const appended = after.slice(before.length);
    expect(appended.map((x) => x.kind), 'one learn.rolled_back per compensated change, nothing else').toEqual(rolled.map(() => 'learn.rolled_back'));
    // The compensating events are appended in the same order, newest change first.
    const targetOf = new Map(before.map((e) => [e.id, (e.data as { target?: string }).target]));
    expect(appended.map((x) => (x.data as { target?: string }).target), 'each learn.rolled_back names its change, newest first').toEqual(rolled.map((id) => targetOf.get(id)));

    // Wrong programs: a rollback that drops the widening leaves S2 reading alpha; one that only marks c5 rolled
    // back leaves S1 without bravo's first wording; one that reads the slice from the latest rows differs.
    for (const s of sessions) expect(await w.record.startSlice(s), `session ${s} reads exactly what it read at the date`).toEqual(then.get(s));
    for (const id of [c3, w1, c5]) await expectState(w, id, 'rolled_back', 'learned after the date');
    for (const id of [c1, c2, rule]) await expectState(w, id, 'applied', 'before the date');
    await expectState(w, refused, 'refused', 'the refused attempt stays refused');
    const flag = String((await layerRow(w, pending)).flagged ?? '');
    expect(flag.includes(c3) || flag.includes(await handleOf(w, c3)), `the pending change built on a rolled-back one is flagged (flagged: ${flag})`).toBe(true);
    await w.record.close();
  });
});
