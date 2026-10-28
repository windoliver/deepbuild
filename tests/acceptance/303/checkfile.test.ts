// #303 AC12: a drafted check file under `.deepbuild/` changed by `python -c` after the lock makes the next claim's
// recomputed hash differ from the locked one: the claim's checks run the approved bytes kept by digest in the hub, and
// the change becomes a proposal naming the file; a lock that hashes requirement records with check paths but not their
// bytes (DEEP_HUB_PLANT=hash-check-paths) gives the same hash and fails this test.
//
// The repo holds the drafted check `.deepbuild/checks/expired-token.sh` at its base commit, and the handed definition's
// R1 names it as its check. After the lock, a claim with an unrelated edit recomputes the locked hash (the control).
// Then the agent runs `python3 -c "open(...).write(...)"`, a write deep-hook's guards can't read in the command's text;
// Claude Code runs it, and the next claim (its stop) recomputes the hash (README, The claim's recomputed hash). "The
// approved bytes kept by digest in the hub": the locked definition names the SHA-256 of the file's bytes as approved at
// the lock, and the hub's evidence store holds those bytes under it (`evidence.read`). "A proposal naming the file": an
// event of a `*.proposed` kind after the change whose data names the file. "The claim's checks run the approved bytes"
// (README, The claim's run of R1's check): the claim's run of R1's check is a run.started after the claim's stop whose
// `claim` names a claim of the task made after that stop and whose `check` names R1's check, and its run.finished with
// the same `run`. The approved file fails (src/auth.js has no rejectsExpired) and the rewritten one exits 0, so the run
// must record `failed`, the approved check's outcome, as the control claim's run of the untouched file does. A claim
// whose checks run the file on disk (DEEP_HUB_PLANT=runs-disk-bytes) fails that assertion, naming the file.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC12, ALL_DRAFTS, BEHAVIOR, CHECK_BYTES, CHECK_FILE, askNamed, cleanup, control, draftFor, expectTask, failureOf, lastPos,
  lockedFor, makeWorld, must, recomputedAt, req, said, Session, settle, shown, startHub, taskOf, type Ev, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const APPROVED = createHash('sha256').update(CHECK_BYTES).digest('hex');
const CHANGE = `open('${CHECK_FILE}', 'w').write('#!/bin/sh\\nexit 0\\n')`;
const PYTHON = `python3 -c "${CHANGE}"`;

interface CheckRun { started: Ev | undefined; finished: Ev | undefined }
interface Run { hub: Hub; lock: Ev; ref: string; control: Ev | undefined; after: Ev | undefined; controlRun: CheckRun; afterRun: CheckRun; changedAt: number; events: Ev[] }

/**
 * The claim's run of R1's check: a run.started after `since` (the claim's stop) whose `claim` is `claim:<id>` of an event
 * after `since` naming the task in `task_ref`, a claim of the task, and whose `check` names R1's check (its file, or
 * R1); and the run.finished with its `run`.
 */
function claimRun(events: readonly Ev[], ref: string, since: number): CheckRun {
  const claims = new Set(events.filter((e) => e.log_pos > since && e.data?.task_ref === ref).map((e) => `claim:${e.id}`));
  const started = events.find((e) => e.kind === 'run.started' && e.log_pos > since && claims.has(String(e.data.claim)) && (String(e.data.check).includes(CHECK_FILE) || /(^|[#:])R1$/.test(String(e.data.check))));
  const finished = started && events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run);
  return { started, finished };
}
const ranAndFinished = (events: readonly Ev[], ref: string, since: number) => claimRun(events, ref, since).finished !== undefined;

async function changedAfterLock(plant?: string): Promise<Run> {
  const drafts = ALL_DRAFTS().filter((d) => d.ask !== BEHAVIOR);
  drafts.push(draftFor(BEHAVIOR, {
    requirements: [
      req('R1', 'An expired token is rejected with 401', { check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] }),
      req('R2', 'A token that has not expired is accepted', { on_base: 'passes' }),
    ],
  }));
  const w = makeWorld({ drafts });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(CHECK_FILE);
  await s.stop('I have read the drafted check.');
  let events = await settle(hub, (all) => { const ref = taskOf(askNamed(all, s, BEHAVIOR)); return ref !== undefined && lockedFor(all, ref).length > 0; });
  const ref = expectTask(events, s, BEHAVIOR, AC12);
  const [lock] = lockedFor(events, ref);
  must(lock !== undefined, `${AC12} the task ${ref} must hold a definition.locked: none was recorded`);

  // The control: a claim after the lock with the check file untouched.
  let since = await lastPos(hub);
  await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
  await s.stop('checkToken now rejects a token whose exp has passed.');
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined && ranAndFinished(all, ref, since), 90_000);
  const controlClaim = recomputedAt(events, ref, since);
  const controlRun = claimRun(events, ref, since);

  // The change by python -c, as Claude Code runs an allowed Bash call, then the next claim.
  since = await lastPos(hub);
  const call = await s.call('Bash', { command: PYTHON, description: 'Make the check pass' }, {
    effect: () => execFileSync('python3', ['-c', CHANGE], { cwd: w.repo }),
  });
  if (!call.allowed) throw Error(`BLOCKED: the criterion's change by python -c must run, as an allowed Bash call; deep-hook denied it: ${shown(call.before)}`);
  must(readFileSync(join(w.repo, CHECK_FILE), 'utf8') !== CHECK_BYTES, 'BLOCKED: python -c must have changed the check file');
  await s.stop('The check passes now.');
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined && ranAndFinished(all, ref, since) && all.some((e) => e.log_pos > since && /\.proposed$/.test(e.kind) && JSON.stringify(e.data).includes(CHECK_FILE)), 90_000);
  return { hub, lock: lock!, ref, control: controlClaim, after: recomputedAt(events, ref, since), controlRun, afterRun: claimRun(events, ref, since), changedAt: since, events };
}

/** The criterion's hash half: the control claim recomputes the locked hash; the claim after python -c recomputes another. */
function hashDiffers(t: Run): void {
  const locked = String(t.lock.data.hash);
  must(t.control !== undefined && t.control.data.hash === locked, `${AC12} the claim after the lock, ${CHECK_FILE} untouched, must recompute the locked hash ${locked} for ${t.ref}: ${said(t.control)}`);
  must(t.after !== undefined, `${AC12} the claim after ${CHECK_FILE} was changed by python -c must recompute the hash for ${t.ref}: no event after its stop names the task with a hash`);
  must(t.after!.data.hash !== locked, `${AC12} ${CHECK_FILE}, changed by python -c after the lock, must make the next claim's recomputed hash differ from the locked ${locked}; it recomputed the same: ${said(t.after)}`);
}

/** The clause "the claim's checks run the approved bytes": R1's run at the claim after python -c records the approved check's outcome. */
function runsApproved(t: Run): void {
  const c = t.controlRun;
  must(c.started !== undefined, `${AC12} the claim after the lock, ${CHECK_FILE} untouched, must run R1's check: no run.started of it names a claim of ${t.ref} made after that stop`);
  must(c.finished?.data.outcome === 'failed', `${AC12} the approved ${CHECK_FILE} fails (src/auth.js has no rejectsExpired), so the control claim's run of R1's check records failed: ${said(c.started)}; ${said(c.finished)}`);
  const a = t.afterRun;
  must(a.started !== undefined, `${AC12} the claim after ${CHECK_FILE} was changed by python -c must run R1's check: no run.started of it names a claim of ${t.ref} made after that stop`);
  must(a.finished !== undefined, `${AC12} the claim's run of R1's check (${String(a.started!.data.run)}) must finish: no run.finished for it`);
  must(a.finished!.data.outcome === 'failed', `${AC12} the claim's checks run the approved bytes of ${CHECK_FILE} kept by digest (sha256 ${APPROVED}), not the file python -c rewrote to exit 0: R1's run must record the approved check's outcome, failed; it recorded ${String(a.finished!.data.outcome)}: ${said(a.finished)}`);
}

describe(`${AC12} a drafted check file changed after the lock`, () => {
  it(`${AC12} ${CHECK_FILE} changed by python -c after the lock: the next claim's recomputed hash differs, the hub keeps the approved bytes by digest, the change is a proposal naming the file, and the claim's run of R1's check records the approved check's outcome`, async () => {
    const t = await changedAfterLock();
    hashDiffers(t);
    const r1 = ((t.lock.data.requirements ?? []) as { id: string }[]).find((r) => r.id === 'R1');
    must(r1 !== undefined && JSON.stringify(r1).includes(APPROVED), `${AC12} the locked definition's R1 must name its check's approved bytes by digest, sha256 ${APPROVED} of ${CHECK_FILE} as it stood at the lock: ${JSON.stringify(r1)}`);
    let kept: unknown;
    try { kept = await control(t.hub, 'evidence.read', { sha: APPROVED }); } catch (error) { kept = error instanceof Error ? error.message : String(error); }
    must(typeof kept === 'object' && kept !== null, `${AC12} the hub must keep the approved bytes of ${CHECK_FILE} by digest, so the claim's checks run them: evidence.read of ${APPROVED} says ${String(kept)}`);
    const proposal = t.events.find((e) => e.log_pos > t.changedAt && /\.proposed$/.test(e.kind) && JSON.stringify(e.data).includes(CHECK_FILE));
    must(proposal !== undefined, `${AC12} the change to ${CHECK_FILE} must become a proposal naming the file: no *.proposed event after it names ${CHECK_FILE}`);
    runsApproved(t);
  }, 300_000);

  it(`${AC12} (wrong program) a lock that hashes requirement records with check paths but not their bytes (DEEP_HUB_PLANT=hash-check-paths) gives the same hash and fails this test`, async () => {
    const t = await changedAfterLock('hash-check-paths');
    const failure = await failureOf(() => hashDiffers(t));
    must(failure !== null, `${AC12} the planted lock must fail this test: it passed`);
    must(t.after?.data.hash === t.lock.data.hash, `${AC12} the planted lock recomputes the same hash after the change: locked ${String(t.lock.data.hash)}, recomputed ${said(t.after)}`);
    must(failure.includes(CHECK_FILE), `${AC12} the failure names the changed file ${CHECK_FILE}; it said: ${failure}`);
  }, 300_000);

  it(`${AC12} (wrong program) a claim whose checks run the file on disk (DEEP_HUB_PLANT=runs-disk-bytes) fails the approved-bytes assertion, naming the file`, async () => {
    const t = await changedAfterLock('runs-disk-bytes');
    hashDiffers(t);
    must(t.controlRun.finished?.data.outcome === 'failed', `${AC12} the planted claim still runs the untouched file at the control claim, which fails: ${said(t.controlRun.finished)}`);
    const failure = await failureOf(() => runsApproved(t));
    must(failure !== null, `${AC12} the planted claim must fail this test: it passed`);
    must(failure.includes(CHECK_FILE), `${AC12} the failure names the file the claim ran from disk, ${CHECK_FILE}; it said: ${failure}`);
  }, 300_000);
});
