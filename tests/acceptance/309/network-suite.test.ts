// #309.4: the macOS backend passes the network seam's suite (#140) through its local test relay, which delays, drops,
// duplicates and reorders 10,000 messages, so every message arrives once and in order; and a planted backend that
// delivers a message twice fails it, naming the fault.
//
// The suite is #140's `seam_suite` call in `deep-show run`, with `backend` naming the macOS backend; the planted twin
// is chosen by the startup argument `--planted net_macos_delivers_twice` (README: The surface under test). Beside the
// verdict, the reply carries what was sent and what arrived and the relay's counts, and this file checks those itself.
// At the base the call ignores `backend` and runs #140's test backend, and deep-show refuses the planted name.
import { describe, expect, it } from 'vitest';
import { arr, backendOf, MACOS_BACKEND, num, obj, runShow, str, strs, useBins, useCleanup, useOut } from './helpers.ts';

const bins = useBins(['deep-show']);
const out = useOut();
useCleanup();
const MESSAGES = 10_000;
const OTHER_FAULTS = ['out_of_order', 'sent_before_join', 'unlisted_host'];

interface SuiteReply {
  status: string; faults: string[]; backend: { name: string; version: string };
  relay: { messages: number; delayed: number; dropped: number; duplicated: number; reordered: number };
  given: string[]; connected: string[]; sentBeforeJoin: number; sent: number[]; delivered: number[];
}
async function suite(seed: number, planted?: string): Promise<SuiteReply> {
  const what = `the network seam's suite on the macOS backend, seed ${seed}${planted ? `, --planted ${planted}` : ''}`;
  const call = { call: 'seam_suite', seam: 'network', backend: MACOS_BACKEND, messages: MESSAGES, seed };
  const [reply] = await runShow(bins.bin('deep-show'), { evidence: out(), calls: [call] }, what, planted);
  const r = obj(reply, what);
  expect(r['seam'], `${what}: the reply names its seam`).toBe('network');
  const relay = obj(r['relay'], `${what}: relay`);
  const hosts = obj(r['hosts'], `${what}: hosts`);
  const ids = (key: string): number[] => arr(r[key], `${what}: ${key}`).map((v, i) => num(v, `${what}: ${key}[${i}]`));
  return {
    status: str(r['status'], `${what}: status`),
    faults: strs(r['faults'], `${what}: faults`),
    backend: backendOf(r['backend'], `${what}: backend`),
    relay: {
      messages: num(relay['messages'], `${what}: relay.messages`), delayed: num(relay['delayed'], `${what}: relay.delayed`), dropped: num(relay['dropped'], `${what}: relay.dropped`),
      duplicated: num(relay['duplicated'], `${what}: relay.duplicated`), reordered: num(relay['reordered'], `${what}: relay.reordered`),
    },
    given: strs(hosts['given'], `${what}: hosts.given`), connected: strs(hosts['connected'], `${what}: hosts.connected`),
    sentBeforeJoin: num(r['sent_before_join'], `${what}: sent_before_join`),
    sent: ids('sent'), delivered: ids('delivered'),
  };
}

/** This file's own reading of what arrived against what was sent: once each, in the order sent. Each problem names its fault. */
function deliveryProblems(sent: number[], delivered: number[]): string[] {
  const problems: string[] = [];
  const order = new Map(sent.map((id, i) => [id, i]));
  if (order.size !== sent.length) problems.push(`the sender's ids aren't distinct (${sent.length} sent, ${order.size} distinct)`);
  const seen = new Set<number>();
  let last = -1;
  let lastId: number | null = null;
  for (const id of delivered) {
    const at = order.get(id);
    if (at === undefined) { problems.push(`forged: message ${id} arrived but was never sent`); continue; }
    if (seen.has(id)) { problems.push(`delivered_twice: message ${id} arrived twice`); continue; }
    seen.add(id);
    if (at < last) problems.push(`out_of_order: message ${id} arrived after message ${lastId}, which was sent after it`);
    else { last = at; lastId = id; }
  }
  const missing = sent.filter((id) => !seen.has(id));
  if (missing.length) problems.push(`lost: ${missing.length} messages never arrived, the first ${missing.slice(0, 5).join(', ')}`);
  return problems;
}

describe('#309.4 the macOS backend passes the network seam\'s suite through its local test relay, which delays, drops, duplicates and reorders 10,000 messages', () => {
  for (const seed of [1, 2, 3]) {
    it(`#309.4 seed ${seed}: the macOS backend passes the network seam's suite; every one of 10,000 messages arrives once and in order through the test relay's delays, drops, duplicates and reorders`, async () => {
      const s = await suite(seed);
      expect(s.backend.name, 'the suite ran the network seam\'s macOS backend').toBe(MACOS_BACKEND);
      expect(s.relay.messages, 'the test relay carried 10,000 messages').toBe(MESSAGES);
      expect(s.sent.length, '10,000 messages were sent').toBe(MESSAGES);
      for (const fault of ['delayed', 'dropped', 'duplicated', 'reordered'] as const) {
        expect(s.relay[fault], `the test relay ${fault} some of them`).toBeGreaterThan(0);
      }
      expect(deliveryProblems(s.sent, s.delivered), 'every message arrived once and in the order it was sent').toEqual([]);
      expect(s.sentBeforeJoin, 'nothing was sent before the join call').toBe(0);
      expect(s.connected.filter((h) => !s.given.includes(h)), 'no connection went to a host the backend wasn\'t given').toEqual([]);
      expect(s.faults, 'the suite names no fault').toEqual([]);
      expect(s.status, 'the suite passes the macOS backend').toBe('PASS');
    }, 1_200_000);
  }

  it('#309.4 a planted macOS backend that delivers a message twice (deep-show run --planted net_macos_delivers_twice) fails the network seam\'s suite, naming the fault delivered_twice', async () => {
    const s = await suite(1, 'net_macos_delivers_twice');
    expect(s.backend.name.startsWith(MACOS_BACKEND), `the suite ran (a planted twin of) the macOS backend: ${s.backend.name}`).toBe(true);
    expect(deliveryProblems(s.sent, s.delivered).some((p) => p.startsWith('delivered_twice')), 'this file\'s own reading finds a message delivered twice').toBe(true);
    expect(s.status, 'the suite fails the planted backend').toBe('FAIL');
    expect(s.faults, 'the suite names the fault delivered_twice').toContain('delivered_twice');
    expect(s.faults.filter((f) => OTHER_FAULTS.includes(f)), 'and none of the faults it didn\'t plant').toEqual([]);
  }, 1_200_000);
});
