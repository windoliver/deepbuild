// Goldens on Vello CPU: only your decision blesses, loosens or waives (criterion 17); positive, negative and
// untriaged digests, with an agent's re-record arriving untriaged (25, Skia Gold's pass-fail behavior ported);
// a golden with no fixture set outside the implementation is `regression_only` (27). Each test keeps its own
// golden store in a temporary folder. At the base there is no `golden`, `record`, `goldens`, `decide` or `kit`
// call and no `test-kit-snap*` or `test-kit-selfish*` feature.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AS_ALPHA, AS_ALPHA_CLI, AS_YOU, WRITER, arr, decide, decided, golden, goldenCall, goldensCall, kit, moduleOf, obj, outcome, partIn,
  recordCall, refusedAsAgent, run, scenario, show, str, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const SNAP: Build = { set: 'full', with: ['test-kit-snap'] };
const SNAP_OFF: Build = { set: 'full', with: ['test-kit-snap-off'] };
const SELFISH: Build = { set: 'full', with: ['test-kit-selfish'] };
const ANALYTIC: Build = { set: 'full', with: ['test-kit-selfish-analytic'] };
const builds = useBuilds([FULL, SNAP, SNAP_OFF, SELFISH, ANALYTIC]);
const evidence = useEvidence();

let store = '';
beforeEach(() => { store = mkdtempSync(join(tmpdir(), 'deep-138-goldens-')); });
afterEach(() => { if (store) rmSync(store, { recursive: true, force: true }); store = ''; });

const GOLDEN = 'parity/kernel/snap-golden.board';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const calls = (build: Build, list: JsonObject[], planted?: string): JsonObject[] =>
  run(builds.bin(build), scenario(evidence(), list, { goldens: store, commit: COMMIT, ...(planted ? { planted } : {}) }));
const digestOf = (reply: JsonObject): string => str(reply['digest'], 'record.digest');

const TOLERANCE: JsonObject = { within: 2, on: 99, ceiling: 16, window: { size: 16, off: 64 }, reason: 'a looser class for the test' };

/** This test's check of an agent's three decisions: the failures it finds, empty when each was refused. */
function agentDecisionFailures(replies: JsonObject[]): string[] {
  return replies.flatMap((r, i) => (outcome(r) === 'refused' && r['code'] === 'not_your_decision' ? [] : [`the agent's decision ${i + 1} was ${outcome(r)}: ${show(r, 400)}`]));
}

describe('#138.8ef25182 only your decision blesses a golden, loosens a tolerance or waives a fixture; an agent\'s attempt is refused', () => {
  it('#138.8ef25182 alpha\'s bless, loosen and waive, over MCP and from its process tree, are refused naming alpha; the golden stays undecided; yours are decided', () => {
    const [rec] = calls(SNAP, [recordCall(AS_YOU, GOLDEN, 'vello_cpu')]);
    const digest = digestOf(rec!);
    const tries = [
      { bless: { fixture: GOLDEN, digest, backend: 'vello_cpu' } },
      { loosen: { fixture: GOLDEN, tolerance: TOLERANCE, reason: 'an agent asks' } },
      { waive: { fixture: GOLDEN, reason: 'an agent asks' } },
    ];
    const replies = calls(SNAP, [...tries.map((d) => decide(AS_ALPHA, d)), ...tries.map((d) => decide(AS_ALPHA_CLI, d)), goldenCall(GOLDEN, 'vello_cpu'), ...tries.map((d) => decide(AS_YOU, d))]);
    for (const [i, r] of replies.slice(0, 6).entries()) refusedAsAgent(r, `alpha's ${Object.keys(tries[i % 3]!)[0]} (${i < 3 ? 'MCP' : 'its tree'})`, WRITER.alpha);
    const g = golden(replies[6]!, 'the golden after alpha\'s attempts');
    expect([g.verdict, g.reason], 'nothing was blessed: the recorded digest is still untriaged').toEqual(['BLOCKED', 'untriaged']);
    for (const [i, r] of replies.slice(7).entries()) decided(r, `your ${Object.keys(tries[i]!)[0]}`);
  }, 1_800_000);

  it('#138.8ef25182 a planted hub that takes an agent\'s decision as yours (accepts_agent_decisions) is caught by the check above', () => {
    const [rec] = calls(SNAP, [recordCall(AS_YOU, GOLDEN, 'vello_cpu')]);
    const replies = calls(SNAP, [decide(AS_ALPHA, { bless: { fixture: GOLDEN, digest: digestOf(rec!), backend: 'vello_cpu' } }), decide(AS_ALPHA, { waive: { fixture: GOLDEN, reason: 'an agent asks' } })], 'accepts_agent_decisions');
    expect(agentDecisionFailures(replies).length, 'the check catches it').toBeGreaterThan(0);
  }, 1_800_000);

  it('#138.8ef25182 the kit\'s own fixture that tries (parity/framework/agent-decision.scene) passes, and fails under accepts_agent_decisions', () => {
    const fixtureName = 'parity/framework/agent-decision.scene';
    const find = (planted?: string) => {
      const r = kit(builds.bin(FULL), evidence(), { modules: ['core'], parts: ['fixtures'] }, planted ? { planted } : {});
      const c = partIn(moduleOf(r, 'core'), 'fixtures').cases.find((x) => x.fixture === fixtureName);
      expect(c, `the kit ran ${fixtureName}`).toBeDefined();
      return c!;
    };
    expect(find().verdict, 'the agent\'s attempts were refused').toBe('PASS');
    expect(find('accepts_agent_decisions').verdict, 'a hub that takes them fails the fixture').toBe('FAIL');
  }, 1_800_000);
});

/** This test's check after an agent's re-record: the failures it finds, empty when the fixture reads BLOCKED on the untriaged digest. */
function reRecordFailures(reply: JsonObject): string[] {
  const g = golden(reply, 'the golden after the re-record');
  const out: string[] = [];
  if (g.verdict !== 'BLOCKED') out.push(`the fixture reads ${g.verdict} after an agent's re-record, not BLOCKED`);
  if (g.match?.['state'] !== 'untriaged') out.push(`its digest matched ${show(g.match)}, not an untriaged digest`);
  return out;
}

describe('#138.51f71c50 each golden digest is positive, negative or untriaged; only a positive passes; an agent\'s re-record arrives untriaged and decides nothing', () => {
  it('#138.51f71c50 a recorded digest is untriaged and reads BLOCKED; your positive passes; a render that matches no digest under an unchanged environment fails', () => {
    const [rec, first] = calls(SNAP, [recordCall(AS_YOU, GOLDEN, 'vello_cpu'), goldenCall(GOLDEN, 'vello_cpu')]);
    expect([outcome(rec!), rec!['state']], 'a record arrives untriaged').toEqual(['recorded', 'untriaged']);
    const g1 = golden(first!, 'before triage');
    expect([g1.verdict, g1.reason, g1.match?.['state']], 'untriaged decides nothing').toEqual(['BLOCKED', 'untriaged', 'untriaged']);
    const [blessed, after] = calls(SNAP, [decide(AS_YOU, { bless: { fixture: GOLDEN, digest: digestOf(rec!), backend: 'vello_cpu' } }), goldenCall(GOLDEN, 'vello_cpu')]);
    decided(blessed!, 'your blessing');
    const g2 = golden(after!, 'after your blessing');
    expect([g2.verdict, g2.match?.['state'], g2.digest], 'a match to a positive passes').toEqual(['PASS', 'positive', digestOf(rec!)]);
    const [off] = calls(SNAP_OFF, [goldenCall(GOLDEN, 'vello_cpu')]);
    const g3 = golden(off!, 'the off render');
    expect(g3.digest, 'the off render has another digest').not.toBe(digestOf(rec!));
    expect([g3.verdict, g3.reason], 'a pixel change under an unchanged environment fails').toEqual(['FAIL', 'pixels_changed']);
  }, 1_800_000);

  it('#138.51f71c50 a digest you triage negative, kept with its bug, fails naming the bug', () => {
    const [rec] = calls(SNAP_OFF, [recordCall(AS_YOU, GOLDEN, 'vello_cpu')]);
    const [neg, g] = calls(SNAP_OFF, [decide(AS_YOU, { negative: { fixture: GOLDEN, digest: digestOf(rec!), backend: 'vello_cpu', bug: 'BUG-138-red-off-by-one' } }), goldenCall(GOLDEN, 'vello_cpu')]);
    decided(neg!, 'your negative');
    const r = golden(g!, 'the negative render');
    expect([r.verdict, r.reason, r.match?.['state'], r.match?.['bug']], 'a match to a negative fails, naming its bug').toEqual(['FAIL', 'negative', 'negative', 'BUG-138-red-off-by-one']);
  }, 1_800_000);

  it('#138.51f71c50 after you bless the golden, an agent\'s re-record of another render arrives untriaged, and the fixture reads BLOCKED, never PASS', () => {
    const [rec] = calls(SNAP, [recordCall(AS_YOU, GOLDEN, 'vello_cpu')]);
    calls(SNAP, [decide(AS_YOU, { bless: { fixture: GOLDEN, digest: digestOf(rec!), backend: 'vello_cpu' } })]);
    const [again, g, list] = calls(SNAP_OFF, [recordCall(AS_ALPHA, GOLDEN, 'vello_cpu'), goldenCall(GOLDEN, 'vello_cpu'), goldensCall(GOLDEN)]);
    expect([outcome(again!), again!['state']], 'the agent\'s re-record arrives untriaged').toEqual(['recorded', 'untriaged']);
    expect(reRecordFailures(g!)).toEqual([]);
    const digests = arr(list!['digests'], 'goldens.digests').map((d) => obj(d, 'digest'));
    const theirs = digests.find((d) => d['digest'] === digestOf(again!));
    expect(theirs?.['state'], 'the store keeps it untriaged').toBe('untriaged');
    expect(theirs?.['recorded_by'], 'recorded by alpha').toEqual(WRITER.alpha);
    const positives = digests.filter((d) => d['state'] === 'positive');
    const perPrint = new Map<string, number>();
    for (const d of positives) perPrint.set(`${String(d['backend'])}|${String(d['fingerprint'])}`, (perPrint.get(`${String(d['backend'])}|${String(d['fingerprint'])}`) ?? 0) + 1);
    expect([...perPrint.values()].every((n) => n === 1), `at most one positive per backend fingerprint: ${show(positives)}`).toBe(true);
    const [still] = calls(SNAP, [goldenCall(GOLDEN, 'vello_cpu')]);
    expect(golden(still!, 'your render').verdict, 'your positive still passes').toBe('PASS');
  }, 1_800_000);

  it('#138.51f71c50 a store that reads every recorded digest as positive (every_digest_positive) passes after the re-record, and this test\'s check rejects it', () => {
    const [rec] = calls(SNAP, [recordCall(AS_YOU, GOLDEN, 'vello_cpu')]);
    calls(SNAP, [decide(AS_YOU, { bless: { fixture: GOLDEN, digest: digestOf(rec!), backend: 'vello_cpu' } })]);
    const [, g] = calls(SNAP_OFF, [recordCall(AS_ALPHA, GOLDEN, 'vello_cpu'), goldenCall(GOLDEN, 'vello_cpu')], 'every_digest_positive');
    expect(reRecordFailures(g!).length, 'the check catches the planted store').toBeGreaterThan(0);
  }, 1_800_000);
});

describe('#138.61aacaf4 a reference implementation\'s hashes become truth only with a fixture set outside the implementation; otherwise its golden is regression_only', () => {
  const SELF = 'parity/kernel/selfish.board';
  const OUTSIDE = 'parity/kernel/selfish-analytic.board';
  const CRITERION = '#999.0badc0de';
  const blessSelf = (build: Build): JsonObject => {
    const [rec] = calls(build, [recordCall(AS_YOU, SELF, 'vello_cpu')]);
    const [blessed] = calls(build, [decide(AS_YOU, { bless: { fixture: SELF, digest: digestOf(rec!), backend: 'vello_cpu' } })]);
    decided(blessed!, 'your blessing');
    return blessed!;
  };

  it('#138.61aacaf4 test.kit.selfish, whose only fixture is its own first render, gets a regression_only golden naming no fixture; its interface isn\'t truth and the criterion it alone covers stays open', () => {
    const blessed = blessSelf(SELFISH);
    expect([blessed['standing'], blessed['first_oracle']], 'the blessing names no outside fixture').toEqual(['regression_only', null]);
    const [list] = calls(SELFISH, [goldensCall(SELF)]);
    expect(list!['standing']).toBe('regression_only');
    const r = kit(builds.bin(SELFISH), evidence(), { modules: ['test.kit.selfish'], parts: ['fixtures'] }, { goldens: store, commit: COMMIT });
    const m = moduleOf(r, 'test.kit.selfish');
    const iface = obj(m.raw['interface'], 'interface');
    expect(iface['truth'], 'its hashes are not its interface\'s truth').toBe(false);
    expect(iface['missing'], 'the kind lacks a fixture set outside the implementation').toContain('test.kit.selfish@1');
    expect(r.criteria[CRITERION], 'a criterion a regression_only golden alone covers stays open').toBe('open');
  }, 1_800_000);

  it('#138.61aacaf4 with an analytic fixture beside it (test-kit-selfish-analytic) the first blessing names that fixture, the interface is truth and the criterion is proved', () => {
    const blessed = blessSelf(ANALYTIC);
    expect([blessed['standing'], blessed['first_oracle']], 'the blessing names the analytic fixture').toEqual(['truth', OUTSIDE]);
    const r = kit(builds.bin(ANALYTIC), evidence(), { modules: ['test.kit.selfish'], parts: ['fixtures'] }, { goldens: store, commit: COMMIT });
    const m = moduleOf(r, 'test.kit.selfish');
    expect(obj(m.raw['interface'], 'interface')['truth']).toBe(true);
    expect(r.criteria[CRITERION]).toBe('proved');
  }, 1_800_000);
});
