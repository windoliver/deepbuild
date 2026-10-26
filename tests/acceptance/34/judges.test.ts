// AC2's judge against the planted twin's answers, at any base: the planted hub (helpers.ts, tokenOnlySigner)
// needs device.pair to run end to end, so these show, on what that hub and a right one return, that the judge
// AC2's tests assert with names the ask when an answer counted without the trusted path, and passes otherwise.
import { describe, expect, it } from 'vitest';
import { judgeNotCounted } from './helpers.ts';

const ASK = 'ask:01K74FKZVK8Q2X5R7M3N9P4T6W';
const refused = { v: 1, id: 'a', error: { code: 'unsigned', retryable: false, remediation: 'Sign it on a paired device.', path: '/params/signature', actual: '', evidence: [] } };
const answered = [{ kind: 'ask.answered', subject: ASK, data: { answer: 'approve', decision: 'allow', via: 'card' } }];

describe('AC2 #34.0e31665e the judge of an answer that must not count', () => {
  it('AC2 a right hub\'s refusal, with nothing recorded and the ask open, passes', () => {
    expect(judgeNotCounted(ASK, refused, [], { ask: ASK, outcome: 'unanswered' })).toBeNull();
  });
  it.each([
    ['the planted hub answers it', { v: 1, id: 'a', result: { answered: ASK } }, answered, { ask: ASK, outcome: 'answered' }],
    ['it refuses the reply but records the answer', refused, answered, { ask: ASK, outcome: 'answered' }],
    ['it refuses and records nothing, yet closes the ask', refused, [], { ask: ASK, outcome: 'defaulted' }],
  ])('AC2 (wrong program) %s: the judge names the ask', (_name, reply, events, row) => {
    expect(judgeNotCounted(ASK, reply, events, row)).toContain(ASK);
  });
});
