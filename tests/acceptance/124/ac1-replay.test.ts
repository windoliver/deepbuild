// Criterion 1, the half that needs no model: a fixture panel's recorded deep_drive runs, one recorded from a Claude Code
// session and one from a Codex session (fixtures/runs, README: Recorded runs), replayed in a replica, pass their
// assertions; on the twin panel whose Save button stays disabled the same runs' assertion fails, and the verdict engine
// sends the claim back naming it. A run with no assertion proves nothing. The reading of how often an agent gets there
// on its first try is never a pass or fail: its rule is held here against scripts/drive-reading.mjs and wrong readings;
// the paid sessions are ac1-agents.live.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkArguments, toolList } from '../../../packages/hub/src/tools.ts';
import {
  Drive, FLICKS_PER_SECOND, ID, JOURNEY_CHECK, PANEL, REPO, RUNS, TIMEOUT_DEFAULT_MS, cleanup, judge, launch, must, readRun, replay, requireMacos, type Obj,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const AGENTS = ['claude-code', 'codex'] as const;
const expects = (calls: Obj[]) => calls.filter((c) => c.call === 'expect');

describe(`${ID.replay} recorded deep_drive runs from a Claude Code and a Codex session pass on the fixture panel and fail on its twin, naming the assertion`, () => {
  it(`${ID.replay} every recorded call is a deep_drive call the hub's strict check takes, and deep mcp lists deep_drive`, () => {
    const listed = toolList().find((t) => t.name === 'deep_drive');
    expect(listed, `deep mcp lists deep_drive (it lists ${toolList().map((t) => t.name).join(', ')})`).toBeDefined();
    expect(listed!.description, 'with a description that says a picture proves nothing').toMatch(/assert/i);
    for (const agent of AGENTS) {
      readRun(RUNS[agent]).calls.forEach((call, i) => {
        expect(() => checkArguments('deep_drive', call), `${agent} call ${i} (${call.call}) passes the hub's strict check`).not.toThrow();
      });
    }
  });

  for (const agent of AGENTS) {
    it(`${ID.replay} the ${agent} run, replayed in a replica on the fixture panel, passes every assertion, and the journey check passes the claim`, async () => {
      requireMacos();
      const run = readRun(RUNS[agent]);
      const { replies, journey } = await replay(run, PANEL.form);
      const named = expects(run.calls).map((c) => c.expect.name as string);
      const results = replies.filter((r) => r.assertion).map((r) => r.assertion as Obj);
      expect(results.map((a) => [a.name, a.passed]), 'each assertion answers its name and passes').toEqual(named.map((n) => [n, true]));
      expect(journey.outcome, `the journey passed: ${JSON.stringify(journey).slice(0, 600)}`).toBe('passed');
      expect(journey.tests_run, 'one test per assertion').toBe(named.length);
      expect(journey.failures, 'and no failure').toEqual([]);
      const between = run.calls.filter((c) => c.call !== 'launch' && c.call !== 'close').length;
      expect((journey.steps as Obj[]).length, 'a journey step, by id and digest, per call between the launch and the close').toBe(between);
      for (const s of journey.steps as Obj[]) expect([typeof s.id, s.digest], 'each step has an id and a digest').toEqual(['string', expect.stringMatching(/^[0-9a-f]{64}$/)]);
      const shots = replies.filter((_r, i) => run.calls[i]?.call === 'screenshot');
      for (const s of shots) {
        expect(s.sha256, 'a screenshot answers its sha256').toMatch(/^[0-9a-f]{64}$/);
        expect((journey.evidence as Obj[]).some((e) => e.state === 'captured' && e.sha256 === s.sha256), 'and the journey holds it as evidence by hash').toBe(true);
      }
      const v = judge(journey);
      expect(v.outcome, `the verdict engine passes the claim on this journey: ${JSON.stringify(v.reasons)}`).toBe('PASS');
      expect(v.send_backs).toEqual([]);
    }, 600_000);

    it(`${ID.replay} the same ${agent} run on the twin panel, whose Save stays disabled, fails save-enabled and sends the claim back naming it`, async () => {
      requireMacos();
      const [form, twin] = [readFileSync(join(PANEL.form, 'main.js'), 'utf8').split('\n'), readFileSync(join(PANEL.twin, 'main.js'), 'utf8').split('\n')];
      expect(form.filter((line, i) => line !== twin[i]), 'the twin differs from the fixture in one line, the one that keeps Save disabled').toEqual(['const SAVE_STAYS_DISABLED = false;']);
      const run = readRun(RUNS[agent]);
      const { replies, journey } = await replay(run, PANEL.twin);
      const failed = replies.filter((r) => r.assertion?.name === 'save-enabled').map((r) => r.assertion as Obj);
      expect(failed.map((a) => a.passed), 'save-enabled is asserted once and fails').toEqual([false]);
      expect(journey.outcome, `the journey failed: ${JSON.stringify(journey).slice(0, 600)}`).toBe('failed');
      expect((journey.failures as Obj[]).map((f) => f.test), 'its failures name the assertion').toContain('save-enabled');
      const v = judge(journey);
      expect(v.outcome, 'the verdict engine fails the claim').toBe('FAIL');
      expect(v.send_backs.length, `and sends it back: ${JSON.stringify(v)}`.slice(0, 1200)).toBeGreaterThan(0);
      expect(v.send_backs.some((b) => b.checks.includes(JOURNEY_CHECK) && `${b.cause} ${b.smallest}`.includes('save-enabled')), `naming save-enabled: ${JSON.stringify(v.send_backs)}`).toBe(true);
    }, 600_000);
  }

  it(`${ID.replay} the same run with its assertions taken out, screenshots and snapshots only, ran nothing: the claim is never passed on pictures`, async () => {
    requireMacos();
    const { replies, journey } = await replay(readRun(RUNS['claude-code']), PANEL.form, { strip: (c) => c.call === 'expect' });
    expect(replies.some((r) => typeof r.sha256 === 'string'), 'the run still took its screenshot').toBe(true);
    expect([journey.outcome, journey.tests_run], 'a journey with no assertion ran nothing').toEqual(['ran_nothing', 0]);
    expect(judge(journey).outcome, 'and the verdict is not PASS').not.toBe('PASS');
  }, 600_000);
});

describe('scope: strict locators and the 5,000 ms default timeout', () => {
  it('a locator that matches two things answers an issue naming every match, and one that matches nothing names none; neither acts', async () => {
    requireMacos();
    const drive = await Drive.start();
    // The many-nodes panel draws its own 2,000 buttons, so the ambiguity is the fixture's, whatever the shell draws.
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.many, clock: 'virtual' });
    const before = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } });
    const buttons = JSON.stringify(before.snapshot).match(/"role":"button"/g)?.length ?? 0;
    expect(buttons, 'the window holds the panel\'s buttons, more than one').toBeGreaterThan(1);
    const { reply: many } = await drive.call({ call: 'act', replica, locator: { role: 'button' }, act: { kind: 'click' } });
    expect(many.ok, 'an ambiguous locator acts on nothing').toBe(false);
    expect(many.error?.code).toBe('locate.ambiguous');
    expect(many.error?.matches?.length, `it names every match: ${JSON.stringify(many.error).slice(0, 600)}`).toBe(buttons);
    for (const m of many.error.matches as Obj[]) expect([m.role, Array.isArray(m.bounds)], 'each match by role and bounds').toEqual(['button', true]);
    const { reply: none } = await drive.call({ call: 'act', replica, locator: { text: 'No such text 124' }, act: { kind: 'click' }, timeout: 100 });
    expect([none.ok, none.error?.code], `a locator that matches nothing: ${JSON.stringify(none).slice(0, 400)}`).toEqual([false, 'locate.none']);
    const after = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } });
    expect(after.snapshot, 'nothing was acted on').toEqual(before.snapshot);
  }, 600_000);

  it('a click on the twin\'s disabled Save waits 5,000 ms of the replica\'s clock by default for it to be enabled, then times out', async () => {
    requireMacos();
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', panel: PANEL.twin, clock: 'virtual' });
    const { t: t0 } = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles'] } });
    const { reply } = await drive.call({ call: 'act', replica, locator: { role: 'button', name: 'Save' }, act: { kind: 'click' } });
    expect([reply.ok, reply.error?.code], `the click times out: ${JSON.stringify(reply).slice(0, 400)}`).toEqual([false, 'timeout']);
    expect(reply.error?.timeout_ms, 'after the default timeout').toBe(TIMEOUT_DEFAULT_MS);
    const { t: t1 } = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles'] } });
    expect((t1 - t0) / FLICKS_PER_SECOND * 1000, 'having waited 5,000 ms of virtual time').toBeGreaterThanOrEqual(TIMEOUT_DEFAULT_MS);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// The reading: scripts/drive-reading.mjs's driveReading (README: The reading). A judge, and the wrong readings it fails.

type Reading = (input: Obj) => Obj;
const runsOf = (version: string, outcomes: (string | null)[]) => outcomes.map((step) => ({ version, first_try: step === null, failed_step: step }));
/** Every way `read` breaks the reading's rule; none for a reading that keeps it. */
function readingProblems(read: Reading): string[] {
  const problems: string[] = [];
  const attempt = (input: Obj): Obj | Error => { try { return read(input); } catch (error) { return error as Error; } };
  const agent = { name: 'codex', version: '0.144.0' };
  const verdictWords = (out: Obj) => /"(PASS|FAIL)"/.test(JSON.stringify(out));
  for (const [k, outcomes] of [[5, [null, null, null, null, null]], [4, [null, null, 'type the email', null, null]]] as const) {
    const out = attempt({ agent, runs: runsOf(agent.version, [...outcomes]) });
    if (out instanceof Error) problems.push(`${k} of 5 threw: ${out.message}`);
    else {
      if (out.first_try !== k || out.runs !== 5) problems.push(`${k} of 5 reads as ${out.first_try} of ${out.runs}`);
      if (out.open_item !== null) problems.push(`${k} of 5 opens an open item: ${JSON.stringify(out.open_item)}`);
      if (verdictWords(out)) problems.push(`${k} of 5 is a reading, never a pass or fail: ${JSON.stringify(out)}`);
    }
  }
  const three = attempt({ agent, runs: runsOf(agent.version, [null, 'expect save-enabled', null, 'expect save-enabled', null]) });
  if (three instanceof Error) problems.push(`3 of 5 threw: ${three.message}`);
  else {
    if (three.first_try !== 3) problems.push(`3 of 5 reads as ${three.first_try}`);
    const item = three.open_item;
    if (!item || Array.isArray(item)) problems.push(`3 of 5 opens no single open item: ${JSON.stringify(item)}`);
    else {
      if (item.on !== 'extension-guide') problems.push(`the open item is on ${item.on}, not the extension guide`);
      if (!String(item.text).includes('codex')) problems.push(`the open item doesn't name the agent: ${item.text}`);
      if (!String(item.text).includes('expect save-enabled')) problems.push(`the open item doesn't name the step that failed: ${item.text}`);
    }
    if (verdictWords(three)) problems.push(`3 of 5 is a reading, never a pass or fail: ${JSON.stringify(three)}`);
  }
  if (!(attempt({ agent, runs: runsOf(agent.version, [null, null, null, null]) }) instanceof Error)) problems.push('four runs are read; a reading takes 5 runs per agent');
  if (!(attempt({ agent: { name: 'codex' }, runs: runsOf('0.144.0', [null, null, null, null, null]) }) instanceof Error)) problems.push('a reading with no pinned version is read');
  if (!(attempt({ agent, runs: [...runsOf(agent.version, [null, null, null, null]), ...runsOf('0.145.0', [null])] }) instanceof Error)) problems.push('a run on another version than the pinned one is read');
  return problems;
}
const PLANTED: Record<string, Reading> = {
  'opens an item at 4 of 5': (i) => { const k = i.runs.filter((r: Obj) => r.first_try).length; if (i.runs.length !== 5 || !i.agent.version || i.runs.some((r: Obj) => r.version !== i.agent.version)) throw Error('refused'); return { runs: 5, first_try: k, open_item: k <= 4 ? { on: 'extension-guide', text: `${i.agent.name}: ${i.runs.find((r: Obj) => !r.first_try)?.failed_step}` } : null }; },
  'a pass or fail': (i) => { const k = i.runs.filter((r: Obj) => r.first_try).length; if (i.runs.length !== 5 || !i.agent.version || i.runs.some((r: Obj) => r.version !== i.agent.version)) throw Error('refused'); return { runs: 5, first_try: k, outcome: k >= 4 ? 'PASS' : 'FAIL', open_item: k < 4 ? { on: 'extension-guide', text: `${i.agent.name}: ${i.runs.find((r: Obj) => !r.first_try)?.failed_step}` } : null }; },
  'names no step': (i) => { const k = i.runs.filter((r: Obj) => r.first_try).length; if (i.runs.length !== 5 || !i.agent.version || i.runs.some((r: Obj) => r.version !== i.agent.version)) throw Error('refused'); return { runs: 5, first_try: k, open_item: k < 4 ? { on: 'extension-guide', text: `${i.agent.name} under 4 of 5` } : null }; },
  'ignores the pin': (i) => { const k = i.runs.filter((r: Obj) => r.first_try).length; if (i.runs.length !== 5) throw Error('refused'); return { runs: 5, first_try: k, open_item: k < 4 ? { on: 'extension-guide', text: `${i.agent.name}: ${i.runs.find((r: Obj) => !r.first_try)?.failed_step}` } : null }; },
};

describe(`${ID.replay} how often an agent drives a panel to passing assertions on its first try is a reading: 5 runs per agent, its version pinned, under 4 of 5 opens one open item naming the agent and the step`, () => {
  it(`${ID.replay} scripts/drive-reading.mjs keeps the reading's rule`, async () => {
    const mod = await import(join(REPO, 'scripts', 'drive-reading.mjs')) as { driveReading?: Reading };
    expect(typeof mod.driveReading, 'scripts/drive-reading.mjs exports driveReading').toBe('function');
    expect(readingProblems(mod.driveReading!)).toEqual([]);
  });

});

describe('the reading\'s judge (no replica; it passes at the base)', () => {
  it('fails each wrong reading, naming what it got wrong', () => {
    const named = Object.fromEntries(Object.entries(PLANTED).map(([name, read]) => [name, readingProblems(read)]));
    expect(named['opens an item at 4 of 5']!.join('\n')).toMatch(/4 of 5 opens an open item/);
    expect(named['a pass or fail']!.join('\n')).toMatch(/never a pass or fail/);
    expect(named['names no step']!.join('\n')).toMatch(/doesn't name the step/);
    expect(named['ignores the pin']!.join('\n')).toMatch(/pinned/);
  });
});
