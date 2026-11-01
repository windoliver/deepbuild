// #140.13: the network seam's suite fails a planted backend that delivers a message twice, one that delivers two out
// of order, one that sends before its join call and one that connects to a host it wasn't given, naming the fault, and
// passes a correct test backend through a local test relay that delays, drops, duplicates and reorders 10,000
// messages.
//
// The suite runs through `deep-show run`'s `seam_suite` call with `seam: "network"`, on the network seam's correct test
// backend, or on a planted backend chosen by the startup argument `--planted <name>` (README: The surface under test).
// The network seam's real backends come later (#309, #179); this task ships the seam, its suite and its test backends.
// Beside the suite's verdict, the reply carries what was sent and what arrived, the relay's counts, the hosts given and
// connected and what was sent before the join call, and this file checks those itself: the verdict is never the only
// evidence. At the base `deep-show run` has no `seam_suite` call and refuses these planted names.
import { describe, expect, it } from 'vitest';
import { arr, backendOf, num, obj, runShow, str, useOut, useShow } from './helpers.ts';

const show = useShow(['default']);
const out = useOut();
const MESSAGES = 10_000;

/** The planted backends and the fault each must be failed with (README: Planted programs). */
const PLANTED = {
  net_delivers_twice: 'delivered_twice',
  net_delivers_out_of_order: 'out_of_order',
  net_sends_before_join: 'sent_before_join',
  net_connects_unlisted_host: 'unlisted_host',
} as const;
type NetPlanted = keyof typeof PLANTED;
const FAULTS = Object.values(PLANTED);

interface Suite {
  status: string; faults: string[]; backend: { name: string; version: string };
  relay: { messages: number; delayed: number; dropped: number; duplicated: number; reordered: number };
  given: string[]; connected: string[]; sentBeforeJoin: number; sent: number[]; delivered: number[];
}
function suite(seed: number, planted?: NetPlanted): Suite {
  const what = `the network seam's suite, seed ${seed}${planted ? `, --planted ${planted}` : ''}`;
  const [reply] = runShow(show.bin(), { evidence: out(), calls: [{ call: 'seam_suite', seam: 'network', messages: MESSAGES, seed }] }, what, planted);
  const r = obj(reply, what);
  expect(r['seam'], `${what}: the reply names its seam`).toBe('network');
  const relay = obj(r['relay'], `${what}: relay`);
  const hosts = obj(r['hosts'], `${what}: hosts`);
  const ids = (key: string): number[] => arr(r[key], `${what}: ${key}`).map((v, i) => num(v, `${what}: ${key}[${i}]`));
  return {
    status: str(r['status'], `${what}: status`),
    faults: arr(r['faults'], `${what}: faults`).map((f, i) => str(f, `${what}: faults[${i}]`)),
    backend: backendOf(r['backend'], `${what}: backend`),
    relay: {
      messages: num(relay['messages'], `${what}: relay.messages`), delayed: num(relay['delayed'], `${what}: relay.delayed`), dropped: num(relay['dropped'], `${what}: relay.dropped`),
      duplicated: num(relay['duplicated'], `${what}: relay.duplicated`), reordered: num(relay['reordered'], `${what}: relay.reordered`),
    },
    given: arr(hosts['given'], `${what}: hosts.given`).map((h, i) => str(h, `${what}: hosts.given[${i}]`)),
    connected: arr(hosts['connected'], `${what}: hosts.connected`).map((h, i) => str(h, `${what}: hosts.connected[${i}]`)),
    sentBeforeJoin: num(r['sent_before_join'], `${what}: sent_before_join`),
    sent: ids('sent'), delivered: ids('delivered'),
  };
}

/** This file's own reading of what arrived against what was sent: once each, in the order sent. Each problem names the fault. */
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

describe('#140.13 the network seam\'s suite passes a correct test backend through a local test relay that delays, drops, duplicates and reorders 10,000 messages', () => {
  for (const seed of [1, 2, 3]) {
    it(`#140.13 seed ${seed}: the correct test backend passes, every one of 10,000 messages arrives once and in order through the relay's delays, drops, duplicates and reorders, nothing is sent before the join call and no connection goes to a host it wasn't given`, () => {
      const s = suite(seed);
      expect(s.relay.messages, 'the relay carried 10,000 messages').toBe(MESSAGES);
      expect(s.sent.length, '10,000 messages were sent').toBe(MESSAGES);
      for (const fault of ['delayed', 'dropped', 'duplicated', 'reordered'] as const) {
        expect(s.relay[fault], `the test relay ${fault} some of them`).toBeGreaterThan(0);
      }
      expect(deliveryProblems(s.sent, s.delivered), 'every message arrived once and in the order it was sent').toEqual([]);
      expect(s.sentBeforeJoin, 'nothing was sent before the join call').toBe(0);
      expect(s.given.length, 'the backend was given a host (the relay\'s)').toBeGreaterThan(0);
      expect(s.connected.length, 'the backend connected').toBeGreaterThan(0);
      expect(s.connected.filter((h) => !s.given.includes(h)), 'no connection went to a host it wasn\'t given').toEqual([]);
      expect(s.faults, 'the suite names no fault').toEqual([]);
      expect(s.status, 'the suite passes the correct test backend').toBe('PASS');
    }, 1_200_000);
  }
});

describe('#140.13 the network seam\'s suite fails each planted backend, naming its fault', () => {
  const evidence: Record<string, (s: Suite) => [boolean, string]> = {
    delivered_twice: (s) => [deliveryProblems(s.sent, s.delivered).some((p) => p.startsWith('delivered_twice')), 'a message arrives twice in what was delivered'],
    out_of_order: (s) => [deliveryProblems(s.sent, s.delivered).some((p) => p.startsWith('out_of_order')), 'two messages arrive out of the order they were sent'],
    sent_before_join: (s) => [s.sentBeforeJoin > 0, 'something was sent before the join call'],
    unlisted_host: (s) => [s.connected.some((h) => !s.given.includes(h)), 'a connection went to a host it wasn\'t given'],
  };
  for (const [planted, fault] of Object.entries(PLANTED) as [NetPlanted, (typeof FAULTS)[number]][]) {
    it(`#140.13 a planted backend (--planted ${planted}) fails the suite, naming the fault ${fault}`, () => {
      const s = suite(1, planted);
      const [seen, what] = evidence[fault]!(s);
      expect(seen, `the reply shows the planted fault: ${what} (${JSON.stringify({ hosts: { given: s.given, connected: s.connected }, sent_before_join: s.sentBeforeJoin, problems: deliveryProblems(s.sent, s.delivered).slice(0, 3) })})`).toBe(true);
      expect(s.status, `the suite fails the planted backend ${planted}`).toBe('FAIL');
      expect(s.faults, `the suite names the fault ${fault}`).toContain(fault);
      expect(s.faults.filter((f) => f !== fault && (FAULTS as readonly string[]).includes(f)), 'and none of the other planted backends\' faults').toEqual([]);
    }, 1_200_000);
  }
});

