// #2078: a stop after nothing but reads reuses the last snapshot only when the worktree's tree and HEAD, read at the
// claim, equal that snapshot's. Through a real hub (`deep hub run`), the real deep-hook and #82's Claude Code stand-in,
// a session's first stop makes a claim whose check, a real Vitest run on #31's sample repo, passes. Something then
// happens in its worktree that no hook saw, the session Reads one file and stops again, and what that second claim
// covers is read from the record and from DeepBuild's object store (README). The merge base is the wrong program: it
// takes the first claim's snapshot on the hooks' word and carries PASS.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, verdict } from '../82/helpers.ts';
import { removeTemp } from '../875/helpers.ts';
import {
  AC1, AC2, BIG, CHECK, claimOf, commits, FILE, fileAt, FIXED, leavesBigFile, parentOf, passingClaim, rewritesFile, SCOPE, shownClaim, stopsAgain, storeObjects,
  UNHOOKED, type ClaimRead, type Scene,
} from './helpers.ts';

// Removing a world's cloned install takes a while on a loaded machine.
afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

const LIMIT = 2_400_000;

/** The first claim's checks passed, on a snapshot of its own that holds the session's fix: where every scenario starts. */
function firstPassed(scene: Scene): string {
  const { first } = scene;
  expect(first.outcome, `the first claim's check must pass, so its verdict is PASS: ${shownClaim(first)}`).toBe('PASS');
  expect(first.commit, `the first claim's verdict names the commit it covers: ${shownClaim(first)}`).toMatch(/^[0-9a-f]{40}$/);
  expect(first.commit, `the first claim covers a snapshot of the uncommitted fix, not HEAD ${scene.w.base}: ${shownClaim(first)}`).not.toBe(scene.w.base);
  expect(fileAt(scene, first.commit!, FILE), `${FILE} in the first claim's snapshot ${first.commit} is the session's fix`).toBe(FIXED);
  return first.commit!;
}
/** The commit the second claim covers; a second claim with no verdict names none, which fails here. */
function covered(second: ClaimRead, what: string): string {
  expect(second.commit, `${what}: the second claim's verdict must name the commit it covers, and it has ${second.verdicts.length ? 'none in it' : 'no verdict'}: ${shownClaim(second)}`).toMatch(/^[0-9a-f]{40}$/);
  return second.commit!;
}

describe(`${AC1} after a claim whose checks passed, a tracked file is changed by a process no hook saw and the session stops again with only reads in its turn: the new claim's snapshot holds the changed file and its checks run on it`, () => {
  it(`${AC1} ${FILE} rewritten by a process no hook saw, then a Read and a stop: the second claim's snapshot holds the rewritten ${FILE}, its check runs on that snapshot and fails there, and the claim is FAIL, never the first claim's PASS`, async (ctx) => verdict(ctx, async () => {
    const scene = await passingClaim();
    const one = firstPassed(scene);
    rewritesFile(scene);
    const again = await stopsAgain(scene);
    const second = claimOf(again, scene);
    const two = covered(second, `${FILE} changed since the first claim`);
    // The Proof: the changed file is in the second claim's snapshot. A hub that reuses the last snapshot on the hooks' word fails here, naming the file.
    expect(fileAt(scene, two, FILE), `${FILE} was rewritten by a process no hook saw before the second stop, so the second claim's snapshot ${two} must hold the rewritten ${FILE}; ${two === one ? `it is the first claim's snapshot, taken before ${FILE} changed` : 'it holds other bytes'}: ${shownClaim(second)}`).toBe(UNHOOKED);
    expect(two, `${FILE} changed, so the second claim covers a snapshot of its own, not the first claim's ${one}`).not.toBe(one);
    expect(parentOf(scene, two), `the second claim's snapshot ${two}, which holds the rewritten ${FILE}, sits on the worktree's HEAD`).toBe(scene.w.base);
    // Its checks run on it: the rewritten file leaves the discount on, so the check's test reads 100, not 90.
    const ran = second.runs.filter((r) => r.check === CHECK && r.commit === two);
    expect(ran.length, `${FILE} changed, so ${CHECK} must run on the second claim's snapshot ${two}, and no run of it started there: ${shownClaim(second)}`).toBeGreaterThan(0);
    expect(ran.map((r) => r.outcome), `${CHECK} must fail on the rewritten ${FILE}, in every run on ${two}: ${shownClaim(second)}`).toEqual(ran.map(() => 'failed'));
    expect(second.outcome, `the second claim must be judged on the rewritten ${FILE}, where ${CHECK} fails, so it is FAIL and never the first claim's PASS carried: ${shownClaim(second)}`).toBe('FAIL');
  }), LIMIT);
});

describe(`${AC2} the twin: with nothing changed, the second claim takes the first one's snapshot, writes nothing to the object store and starts no run`, () => {
  it(`${AC2} nothing changed, then a Read and a stop: the second claim covers the first claim's snapshot, no object is written to the store and no run starts`, async (ctx) => verdict(ctx, async () => {
    const scene = await passingClaim();
    const one = firstPassed(scene);
    const before = storeObjects(scene);
    expect(before.size, `the first claim's snapshot wrote its objects to DeepBuild's store ${scene.store}`).toBeGreaterThan(0);
    const again = await stopsAgain(scene);
    const second = claimOf(again, scene);
    expect(covered(second, 'nothing changed since the first claim'), `nothing changed since the first claim, so the second claim takes its snapshot: ${shownClaim(second)}`).toBe(one);
    const written = [...storeObjects(scene)].filter((o) => !before.has(o));
    expect(written, `nothing changed, so the second stop writes no object to the store ${scene.store}`).toEqual([]);
    const started = again.events.filter((e) => e.kind === 'run.started' && e.log_pos > again.since).map((e) => `${String(e.data.run)} (${String(e.data.check)} on ${String(e.data.commit)} for ${String(e.data.claim)})`);
    expect(started, `nothing changed, so no run starts after the second stop: ${shownClaim(second)}`).toEqual([]);
  }), LIMIT);
});

describe(`${SCOPE} a claim reuses the last snapshot only when the worktree's tree and HEAD, read at the claim inside the snapshot's budget, equal that snapshot's`, () => {
  it(`${SCOPE} HEAD: the worktree committed as it stands by a process no hook saw, then a Read and a stop: the tree is the first snapshot's and HEAD is not, so the second claim covers the new HEAD, not the first claim's snapshot`, async (ctx) => verdict(ctx, async () => {
    const scene = await passingClaim();
    const one = firstPassed(scene);
    const head = commits(scene);
    expect(head, 'the commit moved HEAD').not.toBe(scene.w.base);
    const again = await stopsAgain(scene);
    const second = claimOf(again, scene);
    const two = covered(second, 'HEAD moved since the first claim');
    expect(two, `HEAD moved from ${scene.w.base} to ${head} with the worktree clean, so the second claim covers HEAD ${head}${two === one ? `; it took the first claim's snapshot ${one}, whose parent is the old HEAD` : ''}: ${shownClaim(second)}`).toBe(head);
  }), LIMIT);

  it(`${SCOPE} budget: an untracked file no snapshot takes inside its budget is left by a process no hook saw, then a Read and a stop: the tree can't be read inside the budget, so the second claim is INCONCLUSIVE naming "snapshot over budget", none of its checks runs, and it never carries the first claim's PASS`, async (ctx) => verdict(ctx, async () => {
    const scene = await passingClaim();
    firstPassed(scene);
    leavesBigFile(scene);
    const again = await stopsAgain(scene);
    const second = claimOf(again, scene);
    expect(second.outcome, `${BIG} can't be read inside the snapshot's budget, so the second claim is INCONCLUSIVE, never the first claim's PASS on a tree no one read: ${shownClaim(second)}`).toBe('INCONCLUSIVE');
    expect(second.reasons.some((r) => r.includes('snapshot over budget')), `the INCONCLUSIVE verdict must name "snapshot over budget": its reasons are ${JSON.stringify(second.reasons)}`).toBe(true);
    expect(second.runs.map((r) => `${r.run} (${r.check} on ${r.commit})`), `a claim whose snapshot went over its budget runs none of its checks: ${shownClaim(second)}`).toEqual([]);
  }), LIMIT);
});
