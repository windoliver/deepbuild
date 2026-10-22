import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, IN_ALPHA, PANELS, PROCESSES, SESSIONS, SMALL, claim, decodePng, issues, outcome, readEvidence, run, snapshots, useEvidence, useShowBinary,
  type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
/** Alpha's claim whose definition names DOC.b as its deliverable, not DOC.a. */
const OTHER_WORK = claim(1);
/** Alpha's claim whose definition names DOC.a itself as its deliverable. */
const THIS_WORK = claim(2);

const scenario = (claimHandle: string): JsonObject => ({
  evidence: evidence(),
  sessions: SESSIONS,
  processes: PROCESSES,
  panels: PANELS,
  docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' } },
  claims: {
    [OTHER_WORK]: { session: ALPHA.id, deliverables: [DOC.b] },
    [THIS_WORK]: { session: ALPHA.id, deliverables: [DOC.a] },
  },
  calls: [{ call: 'deep show', peer: IN_ALPHA, check: true, claim: claimHandle, doc: DOC.a, document: SMALL, t: '0s', size: [320, 200], include: ['issues', 'pixels'] }],
});

describe('AC3 a render-back snapshot never counts as proof for any claim', () => {
  it('AC3 a settled snapshot of a document that passes its checks proves nothing for a claim whose deliverable it isn\'t: the check never passes the claim', async () => {
    const reply = run(scenario(OTHER_WORK)).replies[0]!;
    expect(outcome(reply), 'the document is presented').toBe('presented');
    const shots = snapshots(reply);
    expect(shots.length, 'with a snapshot').toBe(1);
    const image = decodePng(await readEvidence(evidence(), shots[0]!.sha256));
    expect([image.width, image.height], 'kept as evidence by its hash').toEqual([320, 200]);
    expect(issues(reply).filter((i) => i.severity === 'error'), 'and its checks raise no error').toEqual([]);
    expect(VERDICTS, `the result is a verdict, got ${JSON.stringify(reply['result'])}`).toContain(reply['result']);
    expect(reply['result'], 'yet the snapshot never passes a claim: a picture explains and never proves').not.toBe('PASS');
  });

  it('AC3 the same check passes a claim whose deliverable is the document itself, on its checks, not its picture', () => {
    const reply = run(scenario(THIS_WORK)).replies[0]!;
    expect(outcome(reply), 'the document is presented').toBe('presented');
    expect(reply['result'], 'the document is the work, so its passing checks pass the claim').toBe('PASS');
  });
});
