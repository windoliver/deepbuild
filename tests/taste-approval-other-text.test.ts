import { describe, expect, it } from 'vitest';
import { TIMEOUT, agent, approve, brief, entryFor, fixtureRepo, hardware, list, recordPath, record, reply, taste } from './acceptance/3423/helpers.ts';

const FILE = recordPath(9602);

describe('the taste lane and a tag approving another text of a record', () => {
  it('lists no signature from a tag that approved a call the record no longer says', () => {
    const approver = hardware('approver-b');
    const { dir, shas } = fixtureRepo([
      { '.deepbuild/approvers': approver.line, [FILE]: record(9602, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-z') }) },
      { [FILE]: record(9602, { verdict: 'looks_wrong', when: '2026-11-18T10:00:00Z', maker: agent('session-z') }) },
    ]);
    approve(dir, approver, [FILE], shas[0]!, 'taste-9602-old');
    const lane = reply(taste(['lane', '--root', dir]), 'lane on the scratch repository');
    const e = entryFor(lane, FILE);
    expect(list(e['signed'], 'signed'), `${FILE} after its call changed: ${brief(e)}`).toEqual([]);
    expect(e['reads_as'], 'it reads as an agent\'s reading').toBe('reading');
  }, TIMEOUT);
});
