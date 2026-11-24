// #3336.f7adc8c8: "A unit lane run leaves `git status` clean: the tree after the lane's commands is the tree it started
// on."
// #3336.7d4ab4ab: "Whatever the run writes goes to a temp or run folder: #1941's screenshots are written outside the
// checkout, and the run names where."
//
// One taste run (helpers.ts `tasteRun`) serves both: from a clean copy of this checkout, #1941's taste files the unit
// lane runs (the first draft while the copy still has it and the lane runs it, and every test file of the redraft's
// folder) run as the unit lane's vitest runs them, and the copy's `git status` is read after (issue: Proof). Neither
// test judges whether #1941's own test passes: only where its files land and whether the tree changed. Off macOS the
// taste test draws nothing, so both read INCONCLUSIVE there, never PASS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispose, elsewhere, METAL, tail, tasteRun, TASTE_LIMIT_MS, type TasteRun } from './helpers.ts';

let run: TasteRun | undefined;
let failed: Error | undefined;
beforeAll(async () => {
  if (!METAL) return;
  try { run = await tasteRun(); } catch (e) { failed = e as Error; }
}, TASTE_LIMIT_MS + 60_000);
afterAll(() => dispose(run));

const ran = (r: TasteRun): string => `${r.files.join(', ')} (exit ${r.exit}${r.stopped ? `, stopped when its ${TASTE_LIMIT_MS / 60_000} min were spent` : ''}) in ${r.repo}`;

describe('#3336 the unit lane runs #1941\'s taste test from a clean copy', () => {
  it('#3336.f7adc8c8 after #1941\'s taste test runs as the unit lane runs it, git status of the copy is clean', (ctx) => {
    if (!METAL) return ctx.skip(elsewhere('macOS, where #1941\'s taste test draws on Metal'));
    expect(failed, `the taste copy couldn't be made: ${failed?.message}`).toBeUndefined();
    const r = run!;
    expect(r.files, 'the unit lane runs at least one #1941 taste file (the first draft or its redraft)').not.toEqual([]);
    expect(r.after, `git status --porcelain of the copy after ${ran(r)}: the tree it ends on isn't the tree it started on\n--- the run's last lines:\n${tail(r.output)}`).toEqual([]);
    // A clean tree proves nothing when the run never drew: stopped, or no screenshot anywhere.
    if (r.stopped || r.shots.length === 0) return ctx.skip(`INCONCLUSIVE: git status is clean after ${ran(r)}, but the run drew no screenshot outside the copy, so the clean tree is unproven\n${tail(r.output, 30)}`);
  }, 60_000);

  it('#3336.7d4ab4ab #1941\'s taste run writes nothing into the checkout, its screenshots land outside it, and the run names where', (ctx) => {
    if (!METAL) return ctx.skip(elsewhere('macOS, where #1941\'s taste test draws on Metal'));
    expect(failed, `the taste copy couldn't be made: ${failed?.message}`).toBeUndefined();
    const r = run!;
    expect(r.files, 'the unit lane runs at least one #1941 taste file (the first draft or its redraft)').not.toEqual([]);
    // Every file under the copy, tracked or not, outside .git, node_modules and target/: none created, changed or removed.
    expect(r.written, `files under the checkout's copy that ${ran(r)} wrote; whatever the run writes goes to a temp or run folder`).toEqual([]);
    if (r.stopped || r.shots.length === 0) return ctx.skip(`INCONCLUSIVE: ${ran(r)} wrote nothing into the copy, but no screenshot outside it either, so where its screenshots go is unproven\n${tail(r.output, 30)}`);
    expect(r.named, `the run wrote ${r.shots.length} screenshots outside the checkout (${r.shots.slice(0, 4).join(', ')}${r.shots.length > 4 ? ', …' : ''}) but its output names no folder or file holding them\n--- the run's last lines:\n${tail(r.output)}`).not.toEqual([]);
  }, 60_000);
});
