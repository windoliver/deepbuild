// #322 AC12, redrafted blind (AC12-REDRAFT.md): the gate runs each drafted check from the bytes you approved, kept by
// digest in the hub, and the definition covers each drafted check's bytes and each expected output it references; a
// drafted check rewritten to `exit 0` by a write the guard didn't recognize still runs its approved bytes on the claim,
// and the edit becomes a proposal naming the file. A gate that runs the file on disk passes the rewritten check.
//
// Design: Protection ("A write the guard didn't recognize changes no check: the claim is judged on the approved bytes,
// and the difference becomes a proposal naming the files"), and Threats, What a command's children do ("A hook sees
// the call an agent makes ... never what the processes it starts do ... For them the guards are a first refusal and
// the record is the proof"). The write chosen is a `node -e` program that finds the drafted check at run time by
// walking the tree for a `.sh` file holding the check's words, so its text spells no path under `.deepbuild/`: what
// the guard sees is a command, and what it writes is decided only when it runs.
//
// The world (helpers.ts): R1, "An expired token is rejected with 401", judged by the drafted check
// `.deepbuild/checks/expired-status.sh`, which compares the status `src/auth.js` gives with the expected output it
// references, `.deepbuild/checks/expired-token.expected` (`401`). At the base `rejectsExpired` is false, so the
// approved check fails; FLAG makes it pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC12, BEHAVIOR, EXPECTED_BYTES, EXPECTED_FILE, FIX, FLAG, REF_CHECK_BYTES, REF_CHECK_FILE, byId, childEnv, claimsOf, cleanup, control, decision,
  expectTask, failureOf, lastPos, listed, lockedFor, makeWorld, must, proposalsNaming, replyText, req, runOf, runsOf, Session, settle, sha256, shown,
  startHub, stopHub, taskVerdicts, trustRepo, verdict, type Draft, type Ev, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The definition handed for BEHAVIOR: R1 alone, judged by the drafted check that references the expected output. */
const DRAFT: Draft = {
  ask: BEHAVIOR,
  requirements: [req('R1', 'An expired token is rejected with 401', { check: REF_CHECK_FILE, references: [EXPECTED_FILE], asserts: [`${REF_CHECK_FILE}:3`] })],
  deliverables: ['src/auth.js'], budget: null,
};
/** What the rewrite leaves on disk: a check that passes whatever the code does. */
const REWRITTEN = '#!/bin/sh\nexit 0\n';
/**
 * The write the guard doesn't recognize: an interpreter's program that finds the drafted check at run time (a `.sh`
 * file holding the check's own words) and writes `exit 0` over it. No path under `.deepbuild/` is spelled in it.
 */
const REWRITE = `node -e "const fs=require('fs'),p=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.name==='.git'||e.name==='node_modules'?[]:e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);for(const f of walk('.'))if(f.endsWith('.sh')&&fs.readFileSync(f,'utf8').includes('equals the expected output'))fs.writeFileSync(f,'#!/bin/sh\\nexit 0\\n');"`;

const HEX64 = /\b[0-9a-f]{64}\b/g;
const r1Run = (r: { started: Ev }): boolean => runOf(REF_CHECK_FILE)(r) || runOf('R1')(r);
const finishedR1 = (events: Ev[], ref: string, since: number) => runsOf(events, ref, since).find((r) => r1Run(r) && r.finished !== undefined);

/**
 * The criterion's scenario on a hub (planted or not), up to the proposal: the lock keeps the check's and the expected
 * output's bytes by digest, the check is rewritten to `exit 0` by the unrecognized write, and the claim's run of R1 runs
 * the approved bytes and fails. Throws an Error naming the criterion at the first assertion that doesn't hold.
 */
async function scenario(plant?: string): Promise<{ hub: Hub; s: Session; ref: string }> {
  const w = makeWorld({ drafts: [DRAFT] });
  await trustRepo(w, true);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, AC12)).length > 0; } catch { return false; } }, 60_000);
  const ref = expectTask(events, s, BEHAVIOR, AC12);
  const lock = lockedFor(events, ref)[0];
  must(lock !== undefined, `${AC12} the handed definition of ${ref} must lock: none was recorded`);

  // The lock keeps each drafted check's bytes and each expected output it references by digest, among the fields of
  // the definition its hash covers, and the hub holds both by those digests.
  const r1 = byId(lock, 'R1');
  const r1Text = JSON.stringify(r1 ?? {});
  const digests = new Set(r1Text.match(HEX64) ?? []);
  const checkSha = sha256(REF_CHECK_BYTES);
  const expectedSha = sha256(EXPECTED_BYTES);
  must(typeof lock.data.hash === 'string' && /^[0-9a-f]{64}$/.test(lock.data.hash), `${AC12} the locked definition carries its hash: ${JSON.stringify(lock.data.hash)}`);
  must(digests.has(checkSha), `${AC12} the locked definition keeps R1's drafted check ${REF_CHECK_FILE} by the digest of its approved bytes (${checkSha}): R1 is ${r1Text.slice(0, 900)}`);
  must(digests.has(expectedSha) && r1Text.includes(EXPECTED_FILE), `${AC12} the locked definition keeps the expected output R1's check references, ${EXPECTED_FILE}, by the digest of its bytes (${expectedSha}): R1 is ${r1Text.slice(0, 900)}`);
  for (const [file, sha, bytes] of [[REF_CHECK_FILE, checkSha, REF_CHECK_BYTES], [EXPECTED_FILE, expectedSha, EXPECTED_BYTES]] as const) {
    const held: Line = await control(hub, 'evidence.read', { sha }).catch((error: Error) => ({ error: error.message }));
    must(held.evidence?.sha256 === sha && held.evidence?.size === Buffer.byteLength(bytes), `${AC12} the hub keeps ${file}'s approved bytes by digest: evidence.read ${sha} answered ${JSON.stringify(held).slice(0, 600)}`);
  }

  // The agent makes the spec's unit test pass, then rewrites the drafted check to `exit 0` by a write the guard
  // doesn't recognize. A guard that refuses it, or a write that doesn't land, means the criterion's situation never
  // arose: BLOCKED, never read as either program's result.
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const rewrite = await s.bash(REWRITE, () => { execFileSync('/bin/sh', ['-c', REWRITE], { cwd: w.repo, env: childEnv(w.home), stdio: 'ignore' }); });
  if (!rewrite.allowed) throw Error(`BLOCKED: the guard recognized the rewrite (it was refused), so a write the guard didn't recognize never happened: ${shown(rewrite.before)}`);
  const onDisk = readFileSync(join(w.repo, REF_CHECK_FILE), 'utf8');
  if (onDisk !== REWRITTEN) throw Error(`BLOCKED: the rewrite didn't land, ${REF_CHECK_FILE} holds ${JSON.stringify(onDisk.slice(0, 200))}`);

  const stop = await s.stop('checkToken now rejects a token whose exp has passed; the checks pass.');
  events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && finishedR1(all, ref, since) !== undefined, 150_000);
  must(claimsOf(events, ref, since).length > 0, `${AC12} the stop must make a claim for ${ref}: no claim.made after it`);
  const run = finishedR1(events, ref, since);
  must(run !== undefined, `${AC12} the claim's checks still run R1's drafted check ${REF_CHECK_FILE}: no finished run of it; the claim's runs are ${runsOf(events, ref, since).map((r) => JSON.stringify(r.started.data).slice(0, 200)).join('; ') || 'none'}`);
  must(run.finished!.data.outcome === 'failed', `${AC12} the claim's checks still run the approved bytes: ${REF_CHECK_FILE}, rewritten on disk to \`exit 0\` by a write the guard didn't recognize, must run as you approved it and fail (rejectsExpired is false, so the status isn't the expected 401), but its run finished ${JSON.stringify(run.finished!.data.outcome)}: ${JSON.stringify(run.finished!.data).slice(0, 500)}`);
  const passed = taskVerdicts(events, ref, since).filter((v) => v.data.outcome === 'PASS');
  must(passed.length === 0, `${AC12} no PASS while R1's approved check fails, whatever ${REF_CHECK_FILE} holds on disk: ${listed(passed)}`);
  must(decision(stop) === 'deny', `${AC12} the stop is sent back while R1's approved check fails: deep-hook let it through (${replyText(stop).slice(0, 300) || 'no reason'})`);

  // The difference becomes a proposal naming the file.
  events = await settle(hub, (all) => proposalsNaming(all, since, REF_CHECK_FILE).length > 0, 60_000);
  must(proposalsNaming(events, since, REF_CHECK_FILE).length > 0, `${AC12} the edit the guard didn't recognize becomes a proposal naming ${REF_CHECK_FILE}: the proposals since are ${listed(events.filter((e) => e.log_pos > since && /\.proposed$/.test(e.kind)))}`);
  return { hub, s, ref };
}

describe(`${AC12} the gate runs drafted checks from the bytes you approved, kept by digest, and an unrecognized write becomes a proposal`, () => {
  it(`${AC12} with ${REF_CHECK_FILE} rewritten to exit 0 by a write the guard didn't recognize, the claim runs the approved bytes and the edit becomes a proposal naming the file`, async (ctx) => {
    await verdict(ctx, async () => {
      const { hub, s, ref } = await scenario();
      // Control: the approved bytes are what runs and they can pass. With FLAG made the approved check's status is the
      // expected 401, so R1's run passes, the rewritten file on disk notwithstanding.
      const since = await lastPos(hub);
      await s.edit(FLAG.file, FLAG.from, FLAG.to);
      await s.stop('The middleware now says it rejects expired tokens.');
      const events = await settle(hub, (all) => finishedR1(all, ref, since) !== undefined, 150_000);
      const run = finishedR1(events, ref, since);
      must(run?.finished?.data.outcome === 'passed', `${AC12} control: with FLAG made, R1's approved check ${REF_CHECK_FILE} passes on the next claim: ${JSON.stringify(run?.finished?.data ?? 'no finished run')}`);
      await stopHub(hub);
    });
  }, 480_000);

  it(`${AC12} a gate that runs the file on disk (DEEP_HUB_PLANT=runs-disk-bytes) passes the rewritten check and fails this test, naming ${REF_CHECK_FILE}`, async (ctx) => {
    await verdict(ctx, async () => {
      const failure = await failureOf(() => scenario('runs-disk-bytes'));
      must(failure !== null, `${AC12} the planted gate that runs ${REF_CHECK_FILE} from disk must fail the scenario: every assertion held`);
      expect(failure, `${AC12} the planted gate fails at the approved-bytes run, naming the file`).toMatch(/the claim's checks still run the approved bytes/);
      expect(failure).toContain(REF_CHECK_FILE);
    });
  }, 300_000);
});
