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
// event of a `*.proposed` kind after the change whose data names the file.
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

interface Run { hub: Hub; lock: Ev; ref: string; control: Ev | undefined; after: Ev | undefined; changedAt: number; events: Ev[] }

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
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined);
  const controlClaim = recomputedAt(events, ref, since);

  // The change by python -c, as Claude Code runs an allowed Bash call, then the next claim.
  since = await lastPos(hub);
  const call = await s.call('Bash', { command: PYTHON, description: 'Make the check pass' }, {
    effect: () => execFileSync('python3', ['-c', CHANGE], { cwd: w.repo }),
  });
  if (!call.allowed) throw Error(`BLOCKED: the criterion's change by python -c must run, as an allowed Bash call; deep-hook denied it: ${shown(call.before)}`);
  must(readFileSync(join(w.repo, CHECK_FILE), 'utf8') !== CHECK_BYTES, 'BLOCKED: python -c must have changed the check file');
  await s.stop('The check passes now.');
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined && all.some((e) => e.log_pos > since && /\.proposed$/.test(e.kind) && JSON.stringify(e.data).includes(CHECK_FILE)));
  return { hub, lock: lock!, ref, control: controlClaim, after: recomputedAt(events, ref, since), changedAt: since, events };
}

/** The criterion's hash half: the control claim recomputes the locked hash; the claim after python -c recomputes another. */
function hashDiffers(t: Run): void {
  const locked = String(t.lock.data.hash);
  must(t.control !== undefined && t.control.data.hash === locked, `${AC12} the claim after the lock, ${CHECK_FILE} untouched, must recompute the locked hash ${locked} for ${t.ref}: ${said(t.control)}`);
  must(t.after !== undefined, `${AC12} the claim after ${CHECK_FILE} was changed by python -c must recompute the hash for ${t.ref}: no event after its stop names the task with a hash`);
  must(t.after!.data.hash !== locked, `${AC12} ${CHECK_FILE}, changed by python -c after the lock, must make the next claim's recomputed hash differ from the locked ${locked}; it recomputed the same: ${said(t.after)}`);
}

describe(`${AC12} a drafted check file changed after the lock`, () => {
  it(`${AC12} ${CHECK_FILE} changed by python -c after the lock: the next claim's recomputed hash differs, the hub keeps the approved bytes by digest, and the change is a proposal naming the file`, async () => {
    const t = await changedAfterLock();
    hashDiffers(t);
    const r1 = ((t.lock.data.requirements ?? []) as { id: string }[]).find((r) => r.id === 'R1');
    must(r1 !== undefined && JSON.stringify(r1).includes(APPROVED), `${AC12} the locked definition's R1 must name its check's approved bytes by digest, sha256 ${APPROVED} of ${CHECK_FILE} as it stood at the lock: ${JSON.stringify(r1)}`);
    let kept: unknown;
    try { kept = await control(t.hub, 'evidence.read', { sha: APPROVED }); } catch (error) { kept = error instanceof Error ? error.message : String(error); }
    must(typeof kept === 'object' && kept !== null, `${AC12} the hub must keep the approved bytes of ${CHECK_FILE} by digest, so the claim's checks run them: evidence.read of ${APPROVED} says ${String(kept)}`);
    const proposal = t.events.find((e) => e.log_pos > t.changedAt && /\.proposed$/.test(e.kind) && JSON.stringify(e.data).includes(CHECK_FILE));
    must(proposal !== undefined, `${AC12} the change to ${CHECK_FILE} must become a proposal naming the file: no *.proposed event after it names ${CHECK_FILE}`);
  }, 240_000);

  it(`${AC12} (wrong program) a lock that hashes requirement records with check paths but not their bytes (DEEP_HUB_PLANT=hash-check-paths) gives the same hash and fails this test`, async () => {
    const t = await changedAfterLock('hash-check-paths');
    const failure = await failureOf(() => hashDiffers(t));
    must(failure !== null, `${AC12} the planted lock must fail this test: it passed`);
    must(t.after?.data.hash === t.lock.data.hash, `${AC12} the planted lock recomputes the same hash after the change: locked ${String(t.lock.data.hash)}, recomputed ${said(t.after)}`);
    must(failure.includes(CHECK_FILE), `${AC12} the failure names the changed file ${CHECK_FILE}; it said: ${failure}`);
  }, 240_000);
});
