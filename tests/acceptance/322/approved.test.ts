// #322 AC12: the gate runs each spec and drafted check from the bytes you approved, kept by digest in the hub, and the
// definition's hash covers each drafted check's bytes and each expected output it references: with a drafted check
// rewritten to `exit 0` by a write the guard didn't recognize, the claim's checks still run the approved bytes and the
// edit becomes a proposal naming the file; a gate that runs the file on disk (DEEP_HUB_PLANT=runs-disk-bytes) passes
// the rewritten check and fails this test (design: Protection; #303's AC12, which this one extends to the expected
// outputs a check references).
//
// The handed definition's R1 is judged by `.deepbuild/checks/expired-token.sh`, and R3 by
// `.deepbuild/checks/expired-status.sh`, which compares the status an expired token gets with the expected output it
// references, `.deepbuild/checks/expired-token.expected` (`401`), named in R3's `references` (README). Both fail until
// FLAG is made. After the lock, a control claim runs both from the approved bytes (each records failed). Then the
// agent runs `python3 -c`, a write deep-hook's guards can't read in the command's text, rewriting the check to
// `exit 0` and the expected output to `200`, so both files on disk would pass; the next claim's recomputed hash
// differs from the locked one, the hub keeps the approved bytes of both files by digest (`evidence.read`), each change
// is a proposal naming its file, and the claim's runs of R1's and R3's checks record the approved checks' outcome,
// failed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC12, BEHAVIOR, BEHAVIOR_DRAFT, CHECK_BYTES, CHECK_FILE, EXPECTED_BYTES, EXPECTED_FILE, REF_CHECK_BYTES, REF_CHECK_FILE, claimsOf, cleanup, control,
  expectTask, failureOf, lastPos, lockedFor, makeWorld, must, proposalsNaming, R1, req, runOf, runsOf, said, Session, settle, sha256, shown, startHub, trustRepo,
  type Ev, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const APPROVED = { check: sha256(CHECK_BYTES), refCheck: sha256(REF_CHECK_BYTES), expected: sha256(EXPECTED_BYTES) };
const CHANGE = `open('${CHECK_FILE}', 'w').write('#!/bin/sh\\nexit 0\\n'); open('${EXPECTED_FILE}', 'w').write('200\\n')`;
const PYTHON = `python3 -c "${CHANGE}"`;
type Run = { started: Ev; finished: Ev | undefined } | undefined;
interface Done { hub: Hub; lock: Ev; ref: string; control: { r1: Run; r3: Run; claim: Ev | undefined }; after: { r1: Run; r3: Run; claim: Ev | undefined }; changedAt: number; events: Ev[] }

const both = (events: readonly Ev[], ref: string, since: number) => { const runs = runsOf(events, ref, since); return { r1: runs.find(runOf(CHECK_FILE)), r3: runs.find(runOf(REF_CHECK_FILE)) }; };
const bothFinished = (events: readonly Ev[], ref: string, since: number) => { const b = both(events, ref, since); return b.r1?.finished !== undefined && b.r3?.finished !== undefined; };

async function changedAfterLock(plant?: string): Promise<Done> {
  const draft = BEHAVIOR_DRAFT({ requirements: [R1(), req('R2', 'A token that has not expired is accepted', { on_base: 'passes' }), req('R3', 'An expired token gets the expected status', { check: REF_CHECK_FILE, asserts: [`${REF_CHECK_FILE}:3`], references: [EXPECTED_FILE] })] });
  const w = makeWorld({ drafts: [draft] });
  await trustRepo(w, true);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(CHECK_FILE);
  let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, AC12)).length > 0; } catch { return false; } });
  const ref = expectTask(events, s, BEHAVIOR, AC12);
  const [lock] = lockedFor(events, ref);
  must(lock !== undefined, `${AC12} the task ${ref} must hold a definition.locked: none was recorded`);

  let since = await lastPos(hub);
  await s.edit('src/auth.js', 'module.exports = {', '// auth middleware\nmodule.exports = {');
  await s.stop('Added a note; the checks run.');
  events = await settle(hub, (all) => bothFinished(all, ref, since), 90_000);
  const controlClaim = claimsOf(events, ref, since).at(-1);
  const control = { ...both(events, ref, since), claim: controlClaim };

  since = await lastPos(hub);
  const call = await s.bash(PYTHON, () => execFileSync('python3', ['-c', CHANGE], { cwd: w.repo }));
  if (!call.allowed) throw Error(`BLOCKED: the criterion's write by python -c must run, as an allowed Bash call; deep-hook denied it: ${shown(call.before)}`);
  must(readFileSync(join(w.repo, CHECK_FILE), 'utf8') !== CHECK_BYTES && readFileSync(join(w.repo, EXPECTED_FILE), 'utf8') !== EXPECTED_BYTES, 'BLOCKED: python -c must have changed both files');
  await s.stop('The checks pass now.');
  events = await settle(hub, (all) => bothFinished(all, ref, since) && proposalsNaming(all, since, CHECK_FILE).length > 0 && proposalsNaming(all, since, EXPECTED_FILE).length > 0, 90_000);
  return { hub, lock: lock!, ref, control, after: { ...both(events, ref, since), claim: claimsOf(events, ref, since).at(-1) }, changedAt: since, events };
}

/** The claim's runs of R1's and R3's checks record the approved checks' outcome, failed, before and after the rewrite. */
function runsApproved(t: Done): void {
  for (const [name, file, c, a] of [['R1', CHECK_FILE, t.control.r1, t.after.r1], ['R3', REF_CHECK_FILE, t.control.r3, t.after.r3]] as const) {
    must(c !== undefined, `${AC12} the control claim after the lock must run ${name}'s check ${file}: no run.started of it names a claim of ${t.ref} made after that stop`);
    must(c.finished?.data.outcome === 'failed', `${AC12} the approved ${file} fails (rejectsExpired is false), so the control claim's run of ${name}'s check records failed: ${said(c.finished)}`);
    must(a !== undefined, `${AC12} the claim after python -c rewrote ${file === CHECK_FILE ? 'it' : EXPECTED_FILE} must run ${name}'s check ${file}: no run.started of it names a claim of ${t.ref} made after that stop`);
    must(a.finished !== undefined, `${AC12} the claim's run of ${name}'s check (${String(a.started.data.run)}) must finish: no run.finished for it`);
    must(a.finished.data.outcome === 'failed', `${AC12} the claim's checks run the approved bytes of ${file} and ${EXPECTED_FILE} kept by digest, not the files python -c rewrote: ${name}'s run must record the approved check's outcome, failed; it recorded ${String(a.finished.data.outcome)}: ${said(a.finished)}`);
  }
}

describe(`${AC12} approved bytes by digest, the expected outputs a check references included`, () => {
  it(`${AC12} the lock's hash covers ${CHECK_FILE}, ${REF_CHECK_FILE} and the ${EXPECTED_FILE} it references; after python -c rewrites the check and the expected output the hash differs, both are proposals, and the claim's runs record the approved checks' outcome`, async () => {
    const t = await changedAfterLock();
    const locked = String(t.lock.data.hash);
    must(t.control.claim !== undefined && t.control.claim.data.hash === locked, `${AC12} the claim after the lock, the files untouched, must recompute the locked hash ${locked}: ${said(t.control.claim)}`);
    const r3 = ((t.lock.data.requirements ?? []) as { id: string }[]).find((r) => r.id === 'R3');
    must(r3 !== undefined && JSON.stringify(r3).includes(APPROVED.expected), `${AC12} the locked definition's R3 must name the expected output it references by digest, sha256 ${APPROVED.expected} of ${EXPECTED_FILE}, so the hash covers its bytes: ${JSON.stringify(r3)}`);
    for (const [file, sha] of [[CHECK_FILE, APPROVED.check], [REF_CHECK_FILE, APPROVED.refCheck], [EXPECTED_FILE, APPROVED.expected]] as const) {
      let kept: unknown;
      try { kept = await control(t.hub, 'evidence.read', { sha }); } catch (error) { kept = error instanceof Error ? error.message : String(error); }
      must(typeof kept === 'object' && kept !== null, `${AC12} the hub must keep the approved bytes of ${file} by digest (${sha}), so the claim's checks run them: evidence.read says ${String(kept)}`);
    }
    must(t.after.claim !== undefined && t.after.claim.data.hash !== locked, `${AC12} ${CHECK_FILE} and ${EXPECTED_FILE}, rewritten by python -c after the lock, must make the next claim's recomputed hash differ from the locked ${locked}: ${said(t.after.claim)}`);
    for (const file of [CHECK_FILE, EXPECTED_FILE]) must(proposalsNaming(t.events, t.changedAt, file).length > 0, `${AC12} the write to ${file} must become a proposal naming the file: no *.proposed event after it names ${file}`);
    runsApproved(t);
  }, 360_000);

  it(`${AC12} (wrong program) a gate that runs the files on disk (DEEP_HUB_PLANT=runs-disk-bytes) passes the rewritten check and fails this test, naming the file`, async () => {
    const t = await changedAfterLock('runs-disk-bytes');
    // The plant differs from the gate only in what its runs read: its lock still covers the expected output by digest.
    let kept: unknown;
    try { kept = await control(t.hub, 'evidence.read', { sha: APPROVED.expected }); } catch (error) { kept = error instanceof Error ? error.message : String(error); }
    must(typeof kept === 'object' && kept !== null, `${AC12} the planted gate still keeps the approved bytes of ${EXPECTED_FILE} by digest (${APPROVED.expected}): evidence.read says ${String(kept)}`);
    const failure = await failureOf(() => runsApproved(t));
    must(failure !== null, `${AC12} the planted gate must fail this test: it passed`);
    must(failure.includes(CHECK_FILE) || failure.includes(REF_CHECK_FILE), `${AC12} the failure names the file the gate ran from disk; it said: ${failure}`);
  }, 360_000);
});
