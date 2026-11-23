// #3137 AC2 (#3137.3f5777c3): the `preflight` budget in benchmarks/budgets.json moves again only by an approved
// proposal, an `Approves: benchmarks/budgets.json › preflight › <limit> <before> → <after>` item, whose entry records the
// measured full run it moves for as `measured`, {date, machine, load, elapsedMs}: the day, a reference Mac's model, a
// one-minute load below that Mac's cores and the run's elapsed time, a run no earlier move recorded, with a changeReason
// of its own. A move with no approval is refused, naming the item that would approve it, and so is an approved one with
// no such run (design: Parallel proof, section 12a, "The preflight's budget"; How we know version 0 works, "The
// preflight's unit lane and its budget").
//
// Reached through validateBudgets in scripts/benchmark.mjs as perf.mjs and budget-window.mjs call it: the change's
// manifest, its merge base's, and the items of the approvals on the change's commits, read by approvedItems from
// signed tags under deep/approved/ in a fixture repository (tests/fixtures/approver.mjs stands in for the key). The
// merge base is this checkout's own manifest, so each scene is the next change that moves the budget. The base's
// benchmark.mjs is the wrong program: it refuses every second move of the preflight budget, approved or not.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after as afterAll } from 'node:test';
import { fileURLToPath } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

const ID = '#3137.3f5777c3';
const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const { approvedItems, references, validateBudgets } = await import(join(CHECKOUT, 'scripts/benchmark.mjs'));
const BUDGETS = 'benchmarks/budgets.json';
const base = JSON.parse(readFileSync(join(CHECKOUT, BUDGETS), 'utf8'));
const before = base.preflight.limits.elapsedMs;
const after = before + 600_000;
const item = (from, to, limit = 'elapsedMs', id = 'preflight') => `benchmarks/budgets.json › ${id} › ${limit} ${from} → ${to}`;
const ITEM = item(before, after);
// The reference Mac with the fewest cores, so a load under another one's cores but not under its own tells them apart.
const mac = [...references].sort((a, b) => a.cores - b.cores)[0];
// A day no earlier than any run the merge base's entry records.
const DAY = [base.preflight.measured?.date, '2026-11-22'].filter((day) => typeof day === 'string').sort().at(-1);
const run = (fields = {}) => ({ date: DAY, machine: mac.model, load: 3.4, elapsedMs: 1_320_017, ...fields });
// A reason of the move's own that names the run it moves for.
const reasonFor = (m, from, to) => `Raised from ${from / 1000} s to ${to / 1000} s on ${m.date}: a full scripts/preflight on ${m.machine} (${mac.name}, mains power) took ${m.elapsedMs} ms (${Math.round(m.elapsedMs / 1000)} s) of checks at a one-minute load of ${m.load}, measured ${m.date}; the checks no longer fit ${from / 1000} s.`;

/** `established` with its preflight limit moved to `to`, recording `measured` (none when null) and a reason of its own. */
function moved(established, { to = after, measured = run(), reason } = {}) {
  const current = structuredClone(established);
  const from = established.preflight.limits.elapsedMs;
  const { measured: _earlier, changeReason: _reason, ...entry } = established.preflight;
  current.preflight = {
    ...entry,
    limits: { ...established.preflight.limits, elapsedMs: to },
    changeReason: reason ?? (measured ? reasonFor(measured, from, to) : `Raised from ${from / 1000} s to ${to / 1000} s on ${DAY}: the checks no longer fit.`),
    ...(measured === null ? {} : { measured }),
  };
  return current;
}

/** validateBudgets's refusal of a change, or null when it accepts it. */
function refusal(current, established, approved) {
  try {
    validateBudgets(current, established, approved);
    return null;
  } catch (error) {
    return error.message;
  }
}

// A git process of the fixture's own, with none of the caller's repository variables.
for (const name of Object.keys(process.env)) if (/^GIT_/.test(name)) delete process.env[name];

/**
 * A fixture repository: a merge base with this checkout's manifest and `.deepbuild/approvers` listing the maintainer,
 * and two commits on it that move the preflight budget as `moved()` does: `approved`, tagged by the maintainer's key
 * with the move's item, and `stranger`, tagged with the same item by a key the list doesn't hold.
 */
let scene;
afterAll(() => { if (scene) rmSync(scene.repo, { recursive: true, force: true }); });
function fixture() {
  if (scene) return scene;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3137-budget-')));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const { maintainer, stranger, list } = people();
  git('init', '-q', '-b', 'main');
  write(APPROVERS, list);
  write(BUDGETS, readFileSync(join(CHECKOUT, BUDGETS), 'utf8'));
  git('add', '-A');
  git('commit', '-qm', 'merge base');
  const baseSha = git('rev-parse', 'HEAD');
  write(BUDGETS, `${JSON.stringify(moved(base), null, 2)}\n`);
  git('commit', '-qam', 'Raise the preflight budget for its measured run');
  const approved = git('rev-parse', 'HEAD');
  tag(dir, 'deep/approved/3137-preflight', approved, [ITEM], maintainer);
  git('checkout', '-q', '-b', 'stranger', baseSha);
  write(BUDGETS, `${JSON.stringify(moved(base), null, 2)}\n`);
  git('commit', '-qam', 'Raise the preflight budget, tagged by a stranger');
  const strangerSha = git('rev-parse', 'HEAD');
  tag(dir, 'deep/approved/3137-stranger', strangerSha, [ITEM], stranger);
  return (scene = { repo: dir, base: baseSha, approved, stranger: strangerSha, read: (sha) => JSON.parse(execFileSync('git', ['show', `${sha}:${BUDGETS}`], { cwd: dir, encoding: 'utf8' })) });
}

test(`${ID} a commit that moves the preflight budget, approved by the maintainer's signed tag naming that move and recording the measured full run it moves for, passes validateBudgets with the approvals' items`, () => {
  const s = fixture();
  const items = approvedItems(s.repo, s.base, s.approved);
  assert.ok(items.includes(ITEM), `the fixture's signed tag wasn't read as an approval: ${JSON.stringify(items)}`);
  const current = s.read(s.approved);
  const refused = refusal(current, s.read(s.base), items);
  assert.equal(refused, null, `validateBudgets refused the approved move of preflight's elapsedMs from ${before} to ${after}, recording ${JSON.stringify(current.preflight.measured)}: ${refused}`);
});

test(`${ID} the same move with no approval is refused, naming the item that would approve it, and so is one tagged by a key the approvers list doesn't hold`, () => {
  const none = refusal(moved(base), base, []);
  assert.ok(none, 'a move of the preflight budget with no approval was accepted');
  assert.ok(none.includes(ITEM), `the refusal of the unapproved move doesn't name the item that would approve it, ${ITEM}: ${none}`);
  const s = fixture();
  const items = approvedItems(s.repo, s.base, s.stranger);
  const strangers = refusal(s.read(s.stranger), s.read(s.base), items);
  assert.ok(strangers, `a move tagged only by a key off the approvers list was accepted (items read: ${JSON.stringify(items)})`);
  assert.ok(strangers.includes(ITEM), `the refusal of the stranger-tagged move doesn't name the item that would approve it, ${ITEM}: ${strangers}`);
});

test(`${ID} an approval naming another move doesn't approve this one: items for another number, another limit, the reverse move or a task's budget leave it refused, naming its own item`, () => {
  const task = base.tasks.find(({ limits }) => limits?.p50Ms !== undefined) ?? base.tasks[0];
  const [metric, value] = Object.entries(task.limits)[0];
  const others = [
    item(before, after - 300_000),
    // A longer number that starts with this move's own.
    item(before, after * 10),
    item(before, after, 'peakBytes'),
    item(after, before),
    item(value, value * 2, metric, task.id),
    item(before, after, 'elapsedMs', task.id),
  ];
  const refused = refusal(moved(base), base, others);
  assert.ok(refused, `an approval naming other moves (${others.join('; ')}) approved the move of preflight's elapsedMs from ${before} to ${after}`);
  assert.ok(refused.includes(ITEM), `the refusal doesn't name the item that would approve the move, ${ITEM}: ${refused}`);
});

test(`${ID} an approved move that records no measured run, or one missing its day, machine, load or elapsed time, is refused, where the same move recording its run is accepted`, () => {
  const accepted = refusal(moved(base), base, [ITEM]);
  assert.equal(accepted, null, `the approved move recording its measured run was refused: ${accepted}`);
  const runs = { 'no measured run': null, 'a run with no day': run({ date: undefined }), 'a run with no machine': run({ machine: undefined }), 'a run with no load': run({ load: undefined }), 'a run with no elapsed time': run({ elapsedMs: undefined }) };
  for (const [what, measured] of Object.entries(runs)) {
    const current = moved(base, { measured: measured && JSON.parse(JSON.stringify(measured)) });
    assert.ok(refusal(current, base, [ITEM]), `an approved move recording ${what} was accepted: ${JSON.stringify(current.preflight)}`);
  }
});

test(`${ID} an approved move whose measured run isn't on a reference Mac is refused, where the same run on ${mac.model} is accepted`, () => {
  const accepted = refusal(moved(base), base, [ITEM]);
  assert.equal(accepted, null, `the approved move measured on ${mac.model} was refused: ${accepted}`);
  for (const machine of ['Mac14,2', 'MacBookPro18,3']) {
    assert.ok(!references.some(({ model }) => model === machine), `${machine} is a reference Mac`);
    const current = moved(base, { measured: run({ machine }) });
    assert.ok(refusal(current, base, [ITEM]), `an approved move measured on ${machine}, none of the reference Macs, was accepted`);
  }
});

test(`${ID} an approved move whose measured run's one-minute load isn't below that Mac's cores is refused, at its core count and above it, though under another reference Mac's`, () => {
  const accepted = refusal(moved(base), base, [ITEM]);
  assert.equal(accepted, null, `the approved move measured at load 3.4 on ${mac.model} (${mac.cores} cores) was refused: ${accepted}`);
  for (const load of [mac.cores, mac.cores + 2]) {
    const current = moved(base, { measured: run({ load }) });
    assert.ok(refusal(current, base, [ITEM]), `an approved move measured on ${mac.model} (${mac.cores} cores) at load ${load} was accepted`);
  }
});

test(`${ID} once a move recorded its run, the next approved move records a run of its own: the same run again, or the earlier reason kept, is refused`, () => {
  const first = run({ elapsedMs: 1_200_003 });
  const established = moved(base, { measured: first });
  const further = after + 300_000;
  const next = item(after, further);
  const fresh = refusal(moved(established, { to: further, measured: run() }), established, [next]);
  assert.equal(fresh, null, `an approved further move recording a new run was refused: ${fresh}`);
  const again = moved(established, { to: further, measured: first });
  assert.ok(refusal(again, established, [next]), `an approved further move recording the run the earlier move recorded was accepted: ${JSON.stringify(again.preflight)}`);
  const kept = moved(established, { to: further, measured: run(), reason: established.preflight.changeReason });
  assert.ok(refusal(kept, established, [next]), 'an approved further move keeping the earlier move\'s changeReason was accepted');
});
