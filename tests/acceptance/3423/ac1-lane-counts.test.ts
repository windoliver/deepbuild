// AC1 #3423.63f64cd6: "On the records main held at `ebf1e7f44` the lane counts 19 calls by a person and 98 readings
// by an agent, 4 of them signed for by a person. On the merge base it fails, naming a record whose maker is prose"
//
// The lane (`node scripts/taste.mjs lane`, README.md) runs on this checkout, the change, and its entries for the 129
// record files ebf1e7f44 held are counted: 117 hold a call, 19 by a person, 98 by an agent, 4 of those named by a
// signed approval tag. The same lane on the merge base's records, whose maker is prose in who/by/delegated/how, fails
// naming one of them. Once the change has landed the merge base holds the field, so the failing read is then taken on
// ebf1e7f44, whose 129 records are the merge base's byte for byte (README.md).
import { describe, expect, it } from 'vitest';
import { AC, READ_ON, REPO, TIMEOUT, brief, holdsMaker, list, mergeBase, obj, recordPathsAt, reply, taste } from './helpers.ts';

describe(`${AC[1]} the lane over main's taste records`, () => {
  it(`${AC[1]} on the records ebf1e7f44 held the lane counts 19 calls by a person and 98 readings by an agent, 4 of them signed`, () => {
    const paths = new Set(recordPathsAt(READ_ON));
    expect(paths.size, 'ebf1e7f44 holds 129 record files').toBe(129);
    const r = taste(['lane', '--root', REPO]);
    const lane = reply(r, 'lane on the change');
    expect(list(lane['failures'], 'lane failures'), `the lane passes on the change: ${brief(lane['failures'])}`).toEqual([]);
    expect(r.status, `lane exits 0 on the change:\n${r.out.slice(0, 1500)}`).toBe(0);
    const entries = list(lane['records'], 'lane records').map((e) => obj(e, 'a lane record')).filter((e) => paths.has(e['file'] as string));
    const seen = new Set(entries.map((e) => e['file']));
    expect([...paths].filter((p) => !seen.has(p)), 'the lane reads every record ebf1e7f44 held').toEqual([]);
    const calls = entries.filter((e) => e['call'] !== null);
    const person = calls.filter((e) => e['maker'] === 'person');
    const agent = calls.filter((e) => e['maker'] === 'agent');
    const signed = agent.filter((e) => list(e['signed'], `${String(e['file'])} signed`).length > 0);
    expect({ calls: calls.length, person: person.length, agent: agent.length, signed: signed.length },
      `counts over ebf1e7f44's records; signed: ${signed.map((e) => e['file']).join(', ')}`).toEqual({ calls: 117, person: 19, agent: 98, signed: 4 });
  }, TIMEOUT);

  it(`${AC[1]} on the merge base the lane fails, naming a record whose maker is prose`, () => {
    const base = mergeBase();
    const rev = holdsMaker(base) ? READ_ON : base;
    const records = new Set(recordPathsAt(rev));
    const r = taste(['lane', '--root', REPO, '--rev', rev]);
    const lane = reply(r, `lane --rev ${rev}`);
    expect(r.status, `lane exits non-zero on ${rev}:\n${r.out.slice(0, 1500)}`).not.toBe(0);
    const prose = list(lane['failures'], 'lane failures').map((f) => obj(f, 'a failure'))
      .filter((f) => f['reason'] === 'maker-in-prose' && records.has(f['file'] as string));
    expect(prose.length, `a failure names a record of ${rev} whose maker is prose: ${brief(lane['failures'])}`).toBeGreaterThan(0);
    expect(r.out, 'the lane\'s output names that record').toContain(prose[0]!['file'] as string);
  }, TIMEOUT);
});
