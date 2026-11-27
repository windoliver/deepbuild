import { describe, expect, it } from 'vitest';
import {
  READ_ON, REPO, TIMEOUT, brief, holdsMaker, list, mergeBase, obj, recordPathsAt, reply, showAt, taste, type JsonObject,
} from '../3423/helpers.ts';
import { DELEGATED } from './records.ts';

const PROSE = ['who', 'by', 'delegated', 'how'];

describe('#3423.a2928d51 the lane over main\'s taste records', () => {
  it('#3423.a2928d51 on the records ebf1e7f44 held the lane counts 14 calls by a person and 103 readings by an agent, 4 of them signed for by a person', () => {
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
      `counts over ebf1e7f44's records; signed: ${signed.map((e) => e['file']).join(', ')}`).toEqual({ calls: 117, person: 14, agent: 103, signed: 4 });
    const agentFiles = new Set(agent.map((e) => e['file'] as string));
    expect(DELEGATED.filter((f) => !agentFiles.has(f)), 'the five records whose notes say the owner delegated and an agent looked are readings by an agent').toEqual([]);
  }, TIMEOUT);

  it('#3423.a2928d51 on the merge base the lane fails, naming a record whose maker is prose', () => {
    const base = mergeBase();
    const rev = holdsMaker(base) ? READ_ON : base;
    const records = new Set(recordPathsAt(rev));
    const r = taste(['lane', '--root', REPO, '--rev', rev]);
    const lane = reply(r, `lane --rev ${rev}`);
    expect(r.status, `lane exits non-zero on ${rev}:\n${r.out.slice(0, 1500)}`).not.toBe(0);
    const prose = list(lane['failures'], 'lane failures').map((f) => obj(f, 'a failure'))
      .filter((f) => f['reason'] === 'maker-in-prose' && records.has(f['file'] as string));
    expect(prose.length, `a failure names a record of ${rev} whose maker is prose: ${brief(lane['failures'])}`).toBeGreaterThan(0);
    const named = prose[0]!['file'] as string;
    const held = JSON.parse(showAt(rev, named)) as JsonObject;
    expect({ maker: 'maker' in held, prose: PROSE.some((k) => k in held) }, `${named} at ${rev} has its maker in prose only`).toEqual({ maker: false, prose: true });
    expect(r.out, 'the lane\'s output names that record').toContain(named);
  }, TIMEOUT);
});
