// #1399.6564d3ed: "A seam fixture with 12 samples against a floor of 64 reads INCONCLUSIVE, naming the counter; with
// 64 it reads its result"
//
// The seam fixture is the network seam's conformance suite as `deep-show run`'s `seam_suite` call plays it (#140): one
// match through the seam's local test relay on the correct test backend, `messages` messages from seed 1399. Each
// message is a sample; the fixture declares `exercise: [{counter: "messages", min: 64}]`, the counter being the count
// of distinct messages the relay carried, which the run reports (`relay.messages`). Two tests, one per condition:
//   - 12 messages: the suite reads INCONCLUSIVE, never PASS, and its `exercise` row names the counter with the floor
//     and the count the run read, 12.
//   - 64 messages: it reads its result, the suite's own PASS on the correct backend with no fault, and its `exercise`
//     row names the counter with the count the run read, 64.
// At the base the call takes no `exercise`: it reads PASS on 12 messages and reports no counter.

import { describe, expect, it } from 'vitest';

import { arr, isObject, type JsonObject, runShow, show, useBinary, useTemp } from './helpers.ts';

const AC = '#1399.6564d3ed';
const bin = useBinary('deep-show');
const temp = useTemp();

const FLOOR = 64;
const seamFixture = (messages: number): JsonObject =>
  ({ call: 'seam_suite', seam: 'network', messages, seed: 1399, exercise: [{ counter: 'messages', min: FLOOR }] });

/** The suite's `exercise` row for `messages`: the counter it declared, its floor and the count read from the run. */
function messagesRow(reply: JsonObject): JsonObject | undefined {
  const rows = Array.isArray(reply['exercise']) ? reply['exercise'].filter(isObject) : [];
  return rows.find((r) => r['counter'] === 'messages');
}

describe(`${AC} a fixture declares how much a check must exercise, and below its floor the check is INCONCLUSIVE`, () => {
  it(`${AC} a seam fixture of 12 samples against a floor of 64 reads INCONCLUSIVE, naming the counter`, () => {
    const [reply] = runShow(bin(), { evidence: temp(), calls: [seamFixture(12)] });
    expect(reply!['code'], `the seam_suite call was answered, not refused: ${show(reply)}`).toBeUndefined();
    expect(reply!['status'], `12 samples against a floor of 64: the suite reads INCONCLUSIVE, never its own result; the reply: ${show(reply)}`).toBe('INCONCLUSIVE');
    const row = messagesRow(reply!);
    expect(row, `the INCONCLUSIVE suite names the counter under its floor in its exercise rows: ${show(reply!['exercise'])}`).toBeDefined();
    expect(row!['min'], 'the row holds the floor the fixture declared').toBe(FLOOR);
    expect(row!['count'], 'the row holds the count read from the run: the relay carried 12 messages').toBe(12);
  });

  it(`${AC} with 64 samples the seam fixture reads its result`, () => {
    const [reply] = runShow(bin(), { evidence: temp(), calls: [seamFixture(64)] });
    expect(reply!['code'], `the seam_suite call was answered, not refused: ${show(reply)}`).toBeUndefined();
    expect(arr(reply!['faults'], 'the suite\'s faults'), 'the correct test backend shows no fault').toEqual([]);
    expect(reply!['status'], `64 samples meet the floor: the suite reads its own result, PASS on the correct backend; the reply: ${show(reply)}`).toBe('PASS');
    const row = messagesRow(reply!);
    expect(row, `the suite lists the counter its fixture declared, with the count read from the run: ${show(reply)}`).toBeDefined();
    expect(row!['min'], 'the row holds the floor the fixture declared').toBe(FLOOR);
    expect(row!['count'], 'the row holds the count read from the run: the relay carried 64 messages').toBe(64);
  });
});
