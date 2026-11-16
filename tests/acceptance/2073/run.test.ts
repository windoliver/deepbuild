// #2073: deep_run asks the project's trust before anything starts, and runs a trusted project's check on the claim's
// commit in a temporary checkout, as a claim's checks run. One test per acceptance criterion (README: Criteria to
// tests). Each plays one session of an agent stand-in in the fixture repo: deep_claim at the repo's commit, then
// deep_run through the session's own deep mcp, with the record read back through `events.read`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  AC1, AC2, AC3, COMMITTED, EDITED, FILE, HOLDS_COMMITTED, HOLDS_EDITED, MARKER, PROJECT, claimed, cleanup, deepRun, ended, eventMatching, shown, world,
} from './helpers.ts';

afterEach(cleanup, 60_000);

test(`${AC1} in a fixture repo no trust record covers, deep_run of the check that writes a marker file outside the repo is refused naming trust and the project, no run.started is appended and the marker isn't written`, async () => {
  const w = await world({ trusted: false });
  const claim = await claimed(w);
  const out = await deepRun(w, MARKER, claim);

  // Whatever the reply says, a run the hub started is in the record: it is read for 5 s for a run.started of this check
  // or this claim, and a run found there gets until its run.finished, a minute at most, to write the marker.
  const started = await eventMatching(w.hub, (e) => e.kind === 'run.started' && (e.data?.check === MARKER || e.data?.claim === claim), 5_000);
  if (started) await eventMatching(w.hub, (e) => e.kind === 'run.finished' && e.data?.run === started.data.run, 60_000);
  const written = existsSync(w.marker) ? readFileSync(w.marker, 'utf8').trim() : undefined;

  // The refusal's whole text, the test's own folder taken out of it where trust is looked for, so no path names it.
  const said = JSON.stringify(out.value ?? out.reply);
  const wrong: string[] = [];
  if (!out.isError) wrong.push(`deep_run wasn't refused: it returned ${shown(w, out.value)}`);
  else {
    if (!/trust/i.test(said.replaceAll(w.tmp, ''))) wrong.push(`the refusal doesn't name trust: ${shown(w, said)}`);
    if (!said.includes(PROJECT)) wrong.push(`the refusal doesn't name the project (${PROJECT}): ${shown(w, said)}`);
  }
  if (started) wrong.push(`a run.started was appended: ${String(started.data.run)} of the check ${String(started.data.check)} for ${String(started.data.claim)}`);
  if (written !== undefined) wrong.push(`the marker file <tmp>/marker, outside the repo, was written: it holds "${written}"`);
  expect(wrong, `${AC1} no trust record covers <tmp>/${PROJECT} (no decision of the core's, and neither Claude Code's workspace trust nor Codex's trusted projects), so deep_run of its spec's ${MARKER} check for ${claim} must be refused before anything starts, naming the project and that its spec checks run only once you trust it`).toEqual([]);
}, 300_000);

test(`${AC2} in a trusted fixture repo, a tracked file edited after the claim doesn't change deep_run's outcome for that claim: the runs read ${FILE} as the claim's commit holds it`, async () => {
  const w = await world({ trusted: true });
  const claim = await claimed(w);
  // The edit: after the claim is in the record and before any run of it, the live worktree's state.txt stops holding
  // what the claim's commit holds. Nothing else changes: the spec and the check's script stay as committed.
  writeFileSync(join(w.repo, FILE), `${EDITED}\n`);

  // One check passes only where state.txt holds the committed word and the other only where it holds the edit's, so
  // the two outcomes say which tree the runs read, whichever it was.
  const outcomes: Record<string, string> = {};
  for (const check of [HOLDS_COMMITTED, HOLDS_EDITED]) {
    const out = ended(w, check, await deepRun(w, check, claim));
    outcomes[check] = out.isError ? `refused: ${shown(w, out.value)}` : String(out.value?.outcome);
  }
  const atCommit = { [HOLDS_COMMITTED]: 'passed', [HOLDS_EDITED]: 'failed' };
  const atEdit = { [HOLDS_COMMITTED]: 'failed', [HOLDS_EDITED]: 'passed' };
  const same = (a: Record<string, string>, b: Record<string, string>): boolean => JSON.stringify(a) === JSON.stringify(b);
  const read = same(outcomes, atEdit) ? `are those of the live worktree's edit of ${FILE} ("${EDITED}"): the runs read ${FILE} in the live worktree`
    : same(outcomes, atCommit) ? `are those of the claim's commit` : `are those of neither the commit's ${FILE} nor the edit's`;
  expect(outcomes, `${AC2} ${FILE} was edited in the worktree after ${claim} was made at ${w.commit.slice(0, 7)}, where it holds "${COMMITTED}"; deep_run for that claim must read ${FILE} as that commit holds it, so ${HOLDS_COMMITTED} passes and ${HOLDS_EDITED} fails. The outcomes ${read}`).toEqual(atCommit);
}, 300_000);

test(`${AC3} in the same trusted repo, deep_run of a passing check still returns passed with its evidence handles, as #26 has it`, async () => {
  const w = await world({ trusted: true });
  const claim = await claimed(w);
  const out = ended(w, HOLDS_COMMITTED, await deepRun(w, HOLDS_COMMITTED, claim));
  expect(out.isError, `${AC3} deep_run of ${HOLDS_COMMITTED}, which passes at the claim's commit, must return its run's result in the trusted repo <tmp>/${PROJECT}: ${shown(w, out.reply)}`).toBe(false);
  expect(out.value?.outcome, `${AC3} deep_run of ${HOLDS_COMMITTED} must return passed: ${shown(w, out.value)}`).toBe('passed');
  expect(out.value?.run, `${AC3} deep_run names its run: ${shown(w, out.value)}`).toMatch(/^run:[0-9A-Za-z]+$/);

  // Its evidence handles: ev:<sha256> each, at least the run's output, and the ones the record names for that run.
  const handles: unknown = out.value?.evidence;
  const list = Array.isArray(handles) ? handles.map(String) : [];
  expect(list.length > 0 && list.every((h) => /^ev:[0-9a-f]{64}$/.test(h)), `${AC3} deep_run returns the run's evidence handles, each ev:<sha256>, and at least one, since the check prints a line: ${shown(w, out.value)}`).toBe(true);
  const finished = await eventMatching(w.hub, (e) => e.kind === 'run.finished' && e.data?.run === out.value.run, 30_000);
  expect(finished?.data?.outcome, `${AC3} the record holds ${String(out.value.run)}'s run.finished, passed: ${shown(w, finished?.data ?? 'no run.finished for it')}`).toBe('passed');
  const named: unknown = finished?.data?.evidence;
  const recorded = (Array.isArray(named) ? named : []).map((sha) => `ev:${String(sha)}`);
  expect([...list].sort(), `${AC3} the handles deep_run returns are its run's own: the evidence ${String(out.value.run)}'s run.finished names`).toEqual([...recorded].sort());
}, 300_000);
