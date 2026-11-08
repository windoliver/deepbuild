// AC4: a timing check that fails while load exceeds the core count is rerun alone once; the rerun decides, and the run
// under load stays attached to the verdict with its load reading. The hub counts 4 cores (DEEP_HUB_TEST_CORES) and
// reads the machine's 1-minute load from DEEP_HUB_TEST_LOAD (README SURFACE), which the test sets. The timing check
// fails until a time the agent's own change sets, 90 s on; the load reads 9 until that time has passed, then 1. The
// agent's deliverable is `src/ready-at.json`, under the code the check tests: a file its run reads under a test, fixture or
// script folder would be the check's own (design, Whose checks count), and an approved check changed into the agent's own
// can send the claim back but never pass it, so a PASS could never be reached.
import { writeFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import {
  AC4, ClaudeSession, allEvents, cleanup, lastPos, listed, makeWorld, must, said, settle, startHub, trust, type Draft, type Ev, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const ASK = 'make the cart total fast enough for the checkout page';
const CHECK = '.deepbuild/checks/speed.sh';
const SPEED_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst { at } = require('../src/ready-at.json');\ntest('the cart totals within its time budget', () => {\n  assert.ok(Date.now() >= at, `over its time budget by ${at - Date.now()} ms`);\n});\n";
const DRAFT: Draft = {
  ask: ASK,
  requirements: [{ id: 'R1', text: 'The cart totals within its time budget', source_line: 'ask#L1', refuted_by: 'a total that takes longer than its budget', check: CHECK, on_base: 'passes', asserts: ['tests/speed.test.js:5'], depth: 'unit', oracle: 'code', near_misses: [], timing: true }],
  deliverables: ['src/ready-at.json'],
  budget: null,
};
const world = (): World => makeWorld({ drafts: [DRAFT], files: { [CHECK]: '#!/bin/sh\nnode --test tests/speed.test.js\n', 'tests/speed.test.js': SPEED_TEST, 'src/ready-at.json': '{ "at": 0 }\n' } });

const handles = (events: readonly Ev[], ref: string): Set<string> => new Set(events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref).map((e) => `claim:${e.id}`));
/** The timing check's runs on the session's claims (the base-commit run told apart by its commit), each with its finish. */
function speedRuns(events: readonly Ev[], ref: string, base: string): { started: Ev; finished: Ev | undefined }[] {
  const claims = handles(events, ref);
  return events.filter((e) => e.kind === 'run.started' && claims.has(String(e.data.claim)) && String(e.data.check).includes('speed') && e.data.commit !== base)
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
const verdicts = (events: readonly Ev[], ref: string): Ev[] => { const claims = handles(events, ref); return events.filter((e) => e.kind === 'verdict.made' && (claims.has(String(e.data.claim)) || claims.has(String(e.subject)))); };

/** One session asks for the change, its definition locks, its turn writes the time the check passes from (90 s on) and stops. */
async function scenario(w: World, hub: Awaited<ReturnType<typeof startHub>>): Promise<{ ref: string; at: number; since: number }> {
  const s = ClaudeSession.open(w, w.repo);
  await s.start();
  await s.typed(ASK);
  // The agent reads while its definition drafts: a hook deep-hook spooled under load reaches the hub with a later one.
  const locked = (all: Ev[]) => all.some((e) => e.kind === 'definition.locked' && all.some((u) => u.kind === 'user.ask' && u.session === s.id && Array.isArray(u.data.tasks) && u.data.tasks.includes(e.data.task_ref)));
  let events = await settle(hub, locked, 10_000);
  for (const end = Date.now() + 600_000; !locked(events) && Date.now() < end;) {
    await s.read('tests/speed.test.js');
    events = await settle(hub, locked, 10_000);
  }
  const ask = events.find((e) => e.kind === 'user.ask' && e.session === s.id);
  const ref = Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
  must(ref !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === ref), `BLOCKED: ${AC4} the handed definition for "${ASK}" never locked within 10 minutes (a loaded machine can take minutes, README): ${listed(events.filter((e) => e.kind === 'user.ask' || e.kind === 'definition.locked'))}`);
  const since = await lastPos(hub);
  const at = Date.now() + 90_000;
  await s.write('src/ready-at.json', `{ "at": ${at} }\n`);
  await s.stop('Done: the total is fast enough.');
  events = await allEvents(hub);
  return { ref: ref!, at, since };
}

describe(`${AC4} a timing check that fails under load is rerun alone once, and the rerun decides`, () => {
  it(`${AC4} fails at load 9 on 4 cores, is rerun once the load is 1, passes: the verdict is PASS and carries the run under load with its reading, 9`, async () => {
    const w = world();
    await trust(w, []);
    writeFileSync(w.load, '9.0\n');
    const hub = await startHub(w);
    const { ref, at } = await scenario(w, hub);

    let events = await settle(hub, (all) => speedRuns(all, ref, w.base).some((r) => r.finished), 180_000);
    const first = speedRuns(events, ref, w.base)[0];
    must(first?.finished !== undefined, `BLOCKED: ${AC4} the timing check never ran on the session's claim: ${listed(events.filter((e) => e.kind.startsWith('run.') || e.kind === 'claim.made'))}`);
    must(first.finished.ts < at, `INCONCLUSIVE: ${AC4} the first run of the timing check ended after the time it passes from, so nothing failed under load (machine too slow): ${said(first.finished)}`);
    must(first.finished.data.outcome !== 'passed', `BLOCKED: ${AC4} the first run must fail, before its time: ${said(first.finished)}`);
    while (Date.now() < at + 2_000) await new Promise((r) => setTimeout(r, 250));
    const dropped = Date.now();
    writeFileSync(w.load, '1.0\n');

    events = await settle(hub, (all) => verdicts(all, ref).length > 0, 300_000);
    const runs = speedRuns(events, ref, w.base);
    const loaded = runs[0]!;
    const handle = String(loaded.started.data.run);
    const readings = events.filter((e) => JSON.stringify(e.data ?? {}).includes(handle.replace(/^run:/, '')) && e.data.load === 9);
    must(readings.length > 0, `${AC4} the run under load (${handle}) must stay in the record with its load reading, 9: its events are ${listed(events.filter((e) => JSON.stringify(e.data ?? {}).includes(handle.replace(/^run:/, ''))))}`);
    must(readings.some((e) => e.data.under_load === true) || events.some((e) => JSON.stringify(e.data ?? {}).includes(handle.replace(/^run:/, '')) && e.data.under_load === true), `${AC4} the run under load (${handle}) must be marked under load: ${listed(readings)}`);
    must(runs.length === 2, `${AC4} the timing check must be rerun alone exactly once after its run under load: it ran ${runs.length} times: ${runs.map((r) => said(r.finished ?? r.started)).join('; ')}`);
    must(runs[1]!.started.ts >= dropped - 1_000, `${AC4} the rerun must run alone, once the load is back under the 4 cores (at ${dropped}): it started at ${runs[1]!.started.ts}`);
    const verdict = verdicts(events, ref).at(-1)!;
    must(verdict.data.outcome === 'PASS', `${AC4} the rerun passed, and it decides: the verdict must be PASS, not ${String(verdict.data.outcome)}: ${said(verdict)}`);
    must(JSON.stringify(verdict.data).includes(handle.replace(/^run:/, '')), `${AC4} the run under load (${handle}) must stay attached to the verdict: ${said(verdict)}`);
  }, 1_500_000);

  it(`${AC4} the twin: at load 2 on 4 cores the same failure counts: no run is set aside as under load, and the verdict is not PASS`, async () => {
    const w = world();
    await trust(w, []);
    writeFileSync(w.load, '2.0\n');
    const hub = await startHub(w);
    const { ref } = await scenario(w, hub);
    const events = await settle(hub, (all) => verdicts(all, ref).length > 0, 300_000);
    const verdict = verdicts(events, ref).at(-1);
    must(verdict !== undefined, `BLOCKED: ${AC4} the twin's claim got no verdict: ${listed(events.filter((e) => e.kind.startsWith('run.') || e.kind === 'claim.made'))}`);
    const runs = speedRuns(events, ref, w.base);
    const marked = events.filter((e) => e.data?.under_load === true);
    must(marked.length === 0, `${AC4} with the load (2) under the 4 cores, no run is under load: ${listed(marked)}`);
    must(verdict.data.outcome !== 'PASS', `${AC4} a timing check that fails with the load under the core count is a counted failure: the verdict must not be PASS: ${said(verdict)} after ${runs.length} runs`);
  }, 1_500_000);
});
