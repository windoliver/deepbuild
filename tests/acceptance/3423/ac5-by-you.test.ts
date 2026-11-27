import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, agent, approve, brief, entryFor, fixtureRepo, hardware, list, obj, record, recordPath, reply, taste } from './helpers.ts';

const FILE = recordPath(9601);

function world() {
  const approver = hardware('approver-a');
  const outsider = hardware('outsider-a');
  const { dir, shas } = fixtureRepo([{
    '.deepbuild/approvers': approver.line,
    [FILE]: record(9601, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', by: 'you', maker: agent('session-y') }),
  }]);
  return { dir, head: shas[0]!, approver, outsider };
}

describe(`${AC[5]} an agent's call marked as yours`, () => {
  it(`${AC[5]} an agent-made record that says by: "you" is refused, naming the field`, () => {
    const w = world();
    const r = taste(['lane', '--root', w.dir]);
    const lane = reply(r, 'lane on the scratch repository');
    expect(r.status, `the lane fails on ${FILE}:\n${r.out.slice(0, 1500)}`).not.toBe(0);
    const failures = list(lane['failures'], 'lane failures').map((f) => obj(f, 'a failure')).filter((f) => f['file'] === FILE);
    expect(failures.map((f) => ({ reason: f['reason'], field: f['field'] })), `the lane's failures for ${FILE}: ${brief(lane['failures'])}`)
      .toEqual([{ reason: 'agent-marked-yours', field: 'by' }]);
    expect(r.out, 'the lane\'s output names the record').toContain(FILE);
  }, TIMEOUT);

  it(`${AC[5]} the same record under a signed tag that names it reads as that person's call`, () => {
    const w = world();
    approve(w.dir, w.approver, [FILE], w.head, 'taste-9601');
    const r = taste(['lane', '--root', w.dir]);
    const lane = reply(r, 'lane on the scratch repository');
    const e = entryFor(lane, FILE);
    expect({ maker: e['maker'], reads_as: e['reads_as'], whose: e['whose'] }, `${FILE} under approver-a's signed tag: ${brief(e)}`)
      .toEqual({ maker: 'agent', reads_as: 'call', whose: 'approver-a' });
    expect(list(lane['failures'], 'lane failures'), 'the signed record is not refused').toEqual([]);
    expect(r.status, 'the lane passes').toBe(0);
  }, TIMEOUT);

  it(`${AC[5]} under a tag by a key that isn't on the approvers list it stays a reading`, () => {
    const w = world();
    approve(w.dir, w.outsider, [FILE], w.head, 'taste-9601');
    const r = taste(['lane', '--root', w.dir]);
    const lane = reply(r, 'lane on the scratch repository');
    const e = entryFor(lane, FILE);
    expect({ maker: e['maker'], reads_as: e['reads_as'], whose: e['whose'] }, `${FILE} under outsider-a's tag: ${brief(e)}`)
      .toEqual({ maker: 'agent', reads_as: 'reading', whose: null });
  }, TIMEOUT);
});
