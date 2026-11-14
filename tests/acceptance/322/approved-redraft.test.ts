// #322 AC12, redrafted blind (AC12-REDRAFT.md): the gate runs each drafted check from the bytes you approved, kept by
// digest in the hub, and the definition covers each drafted check's bytes and each expected output it references; a
// drafted check rewritten to `exit 0` by a write the guard didn't recognize still runs its approved bytes on the claim,
// and the edit becomes a proposal naming the file. A gate that runs the file on disk runs the rewritten check, which
// exits 0 (the runner records it `uncounted`), so R1's run doesn't fail. The claim's recomputed hash (claim.made's
// `hash`) differs from the locked one after the rewrite, and after a rewrite of the expected output alone too: the
// hash covers both files' bytes. A hub whose hash leaves them out (DEEP_HUB_PLANT=hash-check-paths) fails there.
//
// Design: Protection ("A write the guard didn't recognize changes no check: the claim is judged on the approved bytes,
// and the difference becomes a proposal naming the files"), and Threats, What a command's children do ("A hook sees
// the call an agent makes ... never what the processes it starts do ... For them the guards are a first refusal and
// the record is the proof"). The write chosen is a `node -e` program that finds the drafted check at run time by
// walking the tree for a `.sh` file holding the check's words, so its text spells no path under `.deepbuild/`: what
// the guard sees is a command, and what it writes is decided only when it runs.
//
// The criterion's "each spec" is not driven here (AC12-REDRAFT.md): this file covers the drafted check and the
// expected output it references. The approved bytes are not the commit's: the base commit holds earlier drafts of R1's check and its expected
// output that judge the other way, so only the hub's copy by digest gives the runs this file requires.
//
// The world (helpers.ts): R1, "An expired token is rejected with 401", judged by the drafted check
// `.deepbuild/checks/expired-status.sh`, which compares the status `src/auth.js` gives with the expected output it
// references, `.deepbuild/checks/expired-token.expected` (`401`). At the base `rejectsExpired` is false, so the
// approved check fails; FLAG makes it pass.
import { ok } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC12, BEHAVIOR, EXPECTED_BYTES, EXPECTED_FILE, FIX, FLAG, REF_CHECK_BYTES, REF_CHECK_FILE, byId, childEnv, claimsOf, cleanup, control, decision,
  expectTask, failureOf, git, lastPos, listed, lockedFor, makeWorld, proposalsNaming, replyText, req, runOf, runsOf, Session, settle, sha256, shown,
  startHub, stopHub, taskVerdicts, trustRepo, verdict, type Draft, type Ev, type Hub, type Line, type World,
} from './helpers.ts';

// The criterion's assertions are node:assert's, so a failing one is the framework's own assertion failure, thrown in
// this file (the proof lane's before run reads only those); a BLOCKED setup still throws a plain Error.
function must(cond: boolean, message: string): asserts cond {
  ok(cond, message);
}

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
const REWRITE_CHECK = `node -e "const fs=require('fs'),p=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.name==='.git'||e.name==='node_modules'?[]:e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);for(const f of walk('.'))if(f.endsWith('.sh')&&fs.readFileSync(f,'utf8').includes('equals the expected output'))fs.writeFileSync(f,'#!/bin/sh\\nexit 0\\n');"`;
/** The same kind of write over the expected output the check references: a `.expected` file holding `401` gets `200`. */
const REWRITE_EXPECTED = `node -e "const fs=require('fs'),p=require('path');const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.name==='.git'||e.name==='node_modules'?[]:e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);for(const f of walk('.'))if(f.endsWith('.expected')&&fs.readFileSync(f,'utf8')==='401\\n')fs.writeFileSync(f,'200\\n');"`;
/** What an arm rewrites: the file, what it holds after, the command, and how the claim's message names the change. */
interface Rewrite { file: string; after: string; command: string; how: string }
const CHECK_TO_EXIT_0: Rewrite = { file: REF_CHECK_FILE, after: REWRITTEN, command: REWRITE_CHECK, how: 'rewritten on disk to `exit 0`' };
const EXPECTED_TO_200: Rewrite = { file: EXPECTED_FILE, after: '200\n', command: REWRITE_EXPECTED, how: 'with its expected output rewritten on disk to `200`, the status the unfixed code gives,' };

/**
 * What the repo's base commit holds at R1's check and its expected output: earlier drafts you never approved, each
 * judging the other way from the bytes you approve. The committed check passes while rejectsExpired is false and fails
 * once FLAG is made; the committed expected output is a status the code never gives. So a gate that takes a file from
 * the commit (`git show <base>:<path>`), not from the hub's copy by digest, runs something that is neither the approved
 * bytes nor the file on disk, and its runs come out differently. The spec is as helpers.ts commits it.
 */
const COMMITTED: Record<string, string> = {
  [REF_CHECK_FILE]: '#!/bin/sh\n# An earlier draft, never approved.\nnode -e "process.exit(require(\'./src/auth.js\').rejectsExpired ? 1 : 0)"\n',
  [EXPECTED_FILE]: '403\n',
};
/** What you approve: the bytes each drafted file holds in the working tree when the definition locks. */
const APPROVED: Record<string, string> = { [REF_CHECK_FILE]: REF_CHECK_BYTES, [EXPECTED_FILE]: EXPECTED_BYTES };

/**
 * The world: the base commit holds COMMITTED, and the working tree holds APPROVED before the project is trusted, the
 * hub starts or a session opens. A commit that holds the approved bytes after all is BLOCKED: the three copies must differ.
 */
function world(): World {
  const w = makeWorld({ drafts: [DRAFT], files: { ...COMMITTED } });
  for (const [file, bytes] of Object.entries(APPROVED)) {
    writeFileSync(join(w.repo, file), bytes);
    const committed = git(w.tmp, w.repo, ['show', `${w.base}:${file}`]);
    if (committed !== COMMITTED[file]!.trim()) throw Error(`BLOCKED: the base commit must hold the earlier draft of ${file}, not the approved bytes: it holds ${JSON.stringify(committed.slice(0, 200))}`);
  }
  return w;
}

const HEX64 = /\b[0-9a-f]{64}\b/g;
const r1Run = (r: { started: Ev }): boolean => runOf(REF_CHECK_FILE)(r) || runOf('R1')(r);
const finishedR1 = (events: Ev[], ref: string, since: number) => runsOf(events, ref, since).find((r) => r1Run(r) && r.finished !== undefined);

/**
 * The criterion's scenario on a hub (planted or not), up to the proposal: the lock keeps the check's and the expected
 * output's bytes by digest, the check is rewritten to `exit 0` by the unrecognized write, and the claim's run of R1 runs
 * the approved bytes and fails. Throws an Error naming the criterion at the first assertion that doesn't hold.
 */
async function scenario(plant?: string, rw: Rewrite = CHECK_TO_EXIT_0): Promise<{ hub: Hub; s: Session; ref: string }> {
  const w = world();
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
  const rewrite = await s.bash(rw.command, () => { execFileSync('/bin/sh', ['-c', rw.command], { cwd: w.repo, env: childEnv(w.home), stdio: 'ignore' }); });
  if (!rewrite.allowed) throw Error(`BLOCKED: the guard recognized the rewrite (it was refused), so a write the guard didn't recognize never happened: ${shown(rewrite.before)}`);
  const onDisk = readFileSync(join(w.repo, rw.file), 'utf8');
  if (onDisk !== rw.after) throw Error(`BLOCKED: the rewrite didn't land, ${rw.file} holds ${JSON.stringify(onDisk.slice(0, 200))}`);

  const stop = await s.stop('checkToken now rejects a token whose exp has passed; the checks pass.');
  events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && finishedR1(all, ref, since) !== undefined, 150_000);
  must(claimsOf(events, ref, since).length > 0, `${AC12} the stop must make a claim for ${ref}: no claim.made after it`);
  const run = finishedR1(events, ref, since);
  must(run !== undefined, `${AC12} the claim's checks still run R1's drafted check ${REF_CHECK_FILE}: no finished run of it; the claim's runs are ${runsOf(events, ref, since).map((r) => JSON.stringify(r.started.data).slice(0, 200)).join('; ') || 'none'}`);
  must(run.finished!.data.outcome === 'failed', `${AC12} the claim's checks still run the approved bytes: R1's check ${REF_CHECK_FILE}, ${rw.how} by a write the guard didn't recognize (${rw.file}), must run as you approved it and fail (rejectsExpired is false, so the status isn't the approved 401), but its run finished ${JSON.stringify(run.finished!.data.outcome)}: ${JSON.stringify(run.finished!.data).slice(0, 500)}`);
  const passed = taskVerdicts(events, ref, since).filter((v) => v.data.outcome === 'PASS');
  must(passed.length === 0, `${AC12} no PASS while R1's approved check fails, whatever ${REF_CHECK_FILE} holds on disk: ${listed(passed)}`);
  must(decision(stop) === 'deny', `${AC12} the stop is sent back while R1's approved check fails: deep-hook let it through (${replyText(stop).slice(0, 300) || 'no reason'})`);

  // The definition's hash covers the rewritten file's bytes: the claim's recomputed hash differs from the locked one.
  const made = claimsOf(events, ref, since)[0]!;
  must(typeof made.data.hash === 'string' && /^[0-9a-f]{64}$/.test(made.data.hash) && made.data.hash !== lock.data.hash, `${AC12} the definition's hash covers ${rw.file}'s bytes: after the rewrite the claim's recomputed hash must differ from the locked one, ${String(lock.data.hash)}; the claim carries ${JSON.stringify(made.data.hash)}`);

  // The difference becomes a proposal naming the file.
  events = await settle(hub, (all) => proposalsNaming(all, since, rw.file).length > 0, 60_000);
  must(proposalsNaming(events, since, rw.file).length > 0, `${AC12} the edit the guard didn't recognize becomes a proposal naming ${rw.file}: the proposals since are ${listed(events.filter((e) => e.log_pos > since && /\.proposed$/.test(e.kind)))}`);
  return { hub, s, ref };
}

/**
 * Control for a drafted-file arm: the approved bytes are what runs and they can pass. With FLAG made the approved
 * check's status is the approved expected output, 401, so R1's run passes on the next claim, whatever the rewritten
 * file holds on disk and whatever the base commit holds.
 */
async function passesOnceFlagged(hub: Hub, s: Session, ref: string): Promise<void> {
  const since = await lastPos(hub);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.stop('The middleware now says it rejects expired tokens.');
  const events = await settle(hub, (all) => finishedR1(all, ref, since) !== undefined, 150_000);
  const run = finishedR1(events, ref, since);
  must(run?.finished?.data.outcome === 'passed', `${AC12} control: with FLAG made, R1's approved check ${REF_CHECK_FILE} passes on the next claim: ${JSON.stringify(run?.finished?.data ?? 'no finished run')}`);
}

describe(`${AC12} the gate runs drafted checks from the bytes you approved, kept by digest, and an unrecognized write becomes a proposal`, () => {
  it(`${AC12} with ${REF_CHECK_FILE} rewritten to exit 0 by a write the guard didn't recognize, the claim runs the approved bytes and the edit becomes a proposal naming the file`, async (ctx) => {
    await verdict(ctx, async () => {
      const { hub, s, ref } = await scenario();
      await passesOnceFlagged(hub, s, ref);
      await stopHub(hub);
    });
  }, 480_000);

  it(`${AC12} with ${EXPECTED_FILE} rewritten to 200 by a write the guard didn't recognize, the claim runs the approved expected output, its hash differs from the lock's and the edit becomes a proposal naming the file`, async (ctx) => {
    await verdict(ctx, async () => {
      const { hub, s, ref } = await scenario(undefined, EXPECTED_TO_200);
      await passesOnceFlagged(hub, s, ref);
      await stopHub(hub);
    });
  }, 480_000);

  for (const rw of [CHECK_TO_EXIT_0, EXPECTED_TO_200]) {
    it(`${AC12} a hub whose definition hash leaves out the checks' bytes and references (DEEP_HUB_PLANT=hash-check-paths) fails at the recomputed hash, naming ${rw.file}`, async (ctx) => {
      await verdict(ctx, async () => {
        const failure = await failureOf(() => scenario('hash-check-paths', rw));
        must(failure !== null, `${AC12} the planted hub whose hash leaves out ${rw.file}'s bytes must fail the scenario: every assertion held`);
        expect(failure, `${AC12} the planted hub fails at the recomputed hash, naming the file`).toMatch(/the definition's hash covers .*the claim's recomputed hash must differ/);
        expect(failure).toContain(rw.file);
      });
    }, 300_000);
  }

  it(`${AC12} with the expected output rewritten, a gate that runs the files on disk (DEEP_HUB_PLANT=runs-disk-bytes) fails this test, naming ${EXPECTED_FILE}`, async (ctx) => {
    await verdict(ctx, async () => {
      const failure = await failureOf(() => scenario('runs-disk-bytes', EXPECTED_TO_200));
      must(failure !== null, `${AC12} the planted gate that reads ${EXPECTED_FILE} from disk must fail the scenario: every assertion held`);
      expect(failure, `${AC12} the planted gate fails at the approved-bytes run, naming the file`).toMatch(/the claim's checks still run the approved bytes/);
      expect(failure).toContain(EXPECTED_FILE);
    });
  }, 300_000);

  it(`${AC12} a gate that runs the file on disk (DEEP_HUB_PLANT=runs-disk-bytes) runs the rewritten check, whose exit 0 doesn't fail R1, and fails this test, naming ${REF_CHECK_FILE}`, async (ctx) => {
    await verdict(ctx, async () => {
      const failure = await failureOf(() => scenario('runs-disk-bytes'));
      must(failure !== null, `${AC12} the planted gate that runs ${REF_CHECK_FILE} from disk must fail the scenario: every assertion held`);
      expect(failure, `${AC12} the planted gate fails at the approved-bytes run, naming the file`).toMatch(/the claim's checks still run the approved bytes/);
      expect(failure).toContain(REF_CHECK_FILE);
    });
  }, 300_000);
});
