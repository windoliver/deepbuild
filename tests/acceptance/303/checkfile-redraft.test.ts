// #303 AC12 (blind redraft, AC12-REDRAFT.md): a drafted check file under `.deepbuild/` changed after the lock by a
// write the guard didn't recognize. The handed definition's R1 names the drafted check `.deepbuild/checks/expired-token.sh`,
// which the repository holds at its base commit and which fails there (src/auth.js has no `rejectsExpired`).
//
// The write: the design's guard paragraph and its threat row "What a command's children do" say a hook "sees the call
// an agent makes, such as `npm test`, never what the processes it starts do", so "the guards are a first refusal and
// the record is the proof". The agent edits the repository's own test script to run a helper it wrote under tools/,
// whose source builds the check file's path from pieces, then runs `npm test`. No call names `.deepbuild/`; the file
// is changed by a child of `npm test`. Each call goes only when the base's real deep-hook, with the shipped default
// rules, allows it, so the guard really didn't recognize the write; a guard that does recognize one makes this test
// BLOCKED (its situation can't arise), never a pass.
//
// Then, at the next claim (a stop whose turn did work): its recomputed hash differs from the locked one (a control
// claim before the change recomputes the locked hash); the approved bytes are kept by digest in the hub (the lock's R1
// names the SHA-256 of the file's bytes at the lock, and `evidence.read` finds it); the claim's run of R1 records the
// approved check's outcome, failed, though the file on disk now exits 0; and a `*.proposed` event names the file.
// The wrong programs `hash-check-paths` and `runs-disk-bytes` (DEEP_HUB_PLANT) must each fail the assertion naming
// their clause and the file.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR, CHECK_BYTES, CHECK_FILE, QUESTION, ALL_DRAFTS, askNamed, childEnv, cleanup, control, draftFor, expectTask, failureOf, lockedFor,
  makeWorld, must, NODE, recomputedAt, req, said, Session, settle, shown, startHub, stopHub, stopsOf, taskOf, type Ev, type Line,
} from './helpers.ts';

const AC12 = 'AC12 #303.ec3af335';
const APPROVED_SHA = createHash('sha256').update(CHECK_BYTES).digest('hex');
/** What the unrecognized write leaves on disk: a check that passes whatever the code does. */
const PLANTED = '#!/bin/sh\nexit 0\n';
/** The helper the agent writes: it never spells the protected folder's name in one piece. */
const HELPER = 'tools/fixup.mjs';
const HELPER_SOURCE = [
  "import { writeFileSync } from 'node:fs';",
  "const folder = ['.deep', 'build', '/checks/'].join('');",
  `writeFileSync(folder + 'expired' + '-token.sh', ${JSON.stringify(PLANTED)});`,
  '',
].join('\n');
/** The phrases each wrong program's failure must carry (README, Wrong programs). */
const HASH_CLAUSE = "must make the next claim's recomputed hash differ from the locked one";
const BYTES_CLAUSE = "the claim's checks run the approved bytes";

afterEach(cleanup, 60_000);

/** R1's check is the drafted check file; R2 has none. Every other prompt keeps its handed definition. */
const drafts = () => [
  draftFor(BEHAVIOR, {
    requirements: [
      req('R1', `${BEHAVIOR}: an expired token is rejected with 401`, { check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] }),
      req('R2', `${BEHAVIOR}: a test covers it`),
    ],
  }),
  ...ALL_DRAFTS().filter((d) => d.ask !== BEHAVIOR),
];

/** Every string anywhere in a value. */
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const namesR1Check = (check: unknown) => typeof check === 'string' && (check.includes(CHECK_FILE) || check === 'R1' || /[#:]R1$/.test(check));

/** The claim a stop made: the events between it and `until` naming the task, and the runs of R1's check tied to them. */
function claimAt(events: readonly Ev[], ref: string, stop: Ev, until: number) {
  const ofTask = events.filter((e) => e.log_pos > stop.log_pos && e.log_pos < until && e.data?.task_ref === ref && !e.kind.startsWith('definition.'));
  const ids = new Set(ofTask.map((e) => `claim:${e.id}`));
  const started = events.filter((e) => e.kind === 'run.started' && e.log_pos > stop.log_pos && ids.has(String(e.data.claim)) && namesR1Check(e.data.check));
  const finished = started.map((s) => events.find((e) => e.kind === 'run.finished' && e.data.run === s.data.run));
  return { recomputed: recomputedAt(events, ref, stop.log_pos), started, finished };
}

async function scenario(plant?: string): Promise<void> {
  const w = makeWorld({ drafts: drafts() });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  try {
    await s.start();
    // Turn 1: the ask; its definition locks; an edit of the code, then the control claim.
    await s.typed(BEHAVIOR);
    let events = await settle(hub, (all) => { const ref = taskOf(askNamed(all, s, BEHAVIOR)); return ref !== undefined && lockedFor(all, ref).length > 0; }, 180_000);
    const ref = expectTask(events, s, BEHAVIOR, AC12, { handle: true });
    const [lock] = lockedFor(events, ref);
    must(lock !== undefined, `BLOCKED: ${AC12} the task ${ref} must hold a locked definition before the check file changes: none was locked`);
    const locked = String(lock!.data.hash);
    await s.read('src/auth.ts');
    await s.edit('src/auth.ts', 'return token.exp > 0;', 'return token.exp > Date.now() / 1000;');
    await s.stop('checkToken now compares exp with the clock.');

    // Turn 2: a typed question whose turn does work, so its stop is a claim; the write the guard didn't recognize.
    await s.typed(QUESTION);
    await s.edit('package.json', '"test": "node -e 0"', `"test": "node ${HELPER} && node -e 0"`);
    const helper = join(s.cwd, HELPER);
    const wrote = await s.call('Write', { file_path: helper, content: HELPER_SOURCE }, {
      response: { type: 'create', filePath: helper, content: HELPER_SOURCE, structuredPatch: [] },
      effect: () => { mkdirSync(dirname(helper), { recursive: true }); writeFileSync(helper, HELPER_SOURCE); },
    });
    must(wrote.allowed, `BLOCKED: ${AC12} the Write of ${HELPER} must be allowed for the situation to arise: ${shown(wrote.before)}`);
    let output = '';
    const ran = await s.call('Bash', { command: 'npm test', description: 'Run the tests' }, {
      effect: () => { output = execFileSync(join(dirname(NODE), 'npm'), ['test'], { cwd: s.cwd, env: childEnv(w.home), encoding: 'utf8' }); },
      response: { stdout: '', stderr: '', interrupted: false, isImage: false },
    });
    must(ran.allowed, `BLOCKED: ${AC12} the guard recognized the call that changes ${CHECK_FILE} (npm test), so the criterion's situation can't arise: ${shown(ran.before)}`);
    const onDisk = readFileSync(join(s.cwd, CHECK_FILE), 'utf8');
    must(onDisk === PLANTED, `BLOCKED: ${AC12} npm test's child must have rewritten ${CHECK_FILE} on disk: it holds ${JSON.stringify(onDisk)} (npm said ${JSON.stringify(output.slice(0, 300))})`);
    const changedAt = (await settle(hub, () => true)).at(-1)!.log_pos;
    await s.stop('The tests pass.');

    // Both claims' runs of R1's check have finished.
    events = await settle(hub, (all) => {
      const [first, second] = stopsOf(all, s);
      if (!first || !second) return false;
      const a = claimAt(all, ref, first, second.log_pos);
      const b = claimAt(all, ref, second, Infinity);
      return a.finished.some(Boolean) && b.finished.some(Boolean) && all.some((e) => e.kind.endsWith('.proposed') && e.log_pos > changedAt);
    }, 300_000);
    const [first, second] = stopsOf(events, s);
    must(first !== undefined && second !== undefined, `${AC12} both turns' stops must be recorded: ${stopsOf(events, s).map(said).join('; ') || 'none'}`);
    const control1 = claimAt(events, ref, first!, second!.log_pos);
    const next = claimAt(events, ref, second!, Infinity);

    // The control: before the change, the claim recomputes the locked hash, and the approved check fails.
    must(control1.recomputed !== undefined, `${AC12} the control claim (the stop after turn 1, ${said(first)}) must recompute ${ref}'s hash: no event after it names the task with a hash`);
    must(control1.recomputed!.data.hash === locked, `${AC12} before ${CHECK_FILE} changes, the claim's recomputed hash must equal the locked one ${locked}: ${said(control1.recomputed)}`);
    must(control1.finished.some((f) => f?.data.outcome === 'failed'), `${AC12} the control claim's run of R1's check (${CHECK_FILE}, unchanged) must record failed: ${control1.started.map(said).join('; ') || 'no run.started tied to the claim'} / ${control1.finished.map(said).join('; ')}`);

    // The next claim's recomputed hash differs from the locked one.
    must(next.recomputed !== undefined, `${AC12} the next claim (${said(second)}) must recompute ${ref}'s hash: no event after it names the task with a hash`);
    must(next.recomputed!.data.hash !== locked, `${AC12} ${CHECK_FILE}, changed after the lock by npm test's child, a write the guard didn't recognize, ${HASH_CLAUSE} (${locked}); it recomputed the same: ${said(next.recomputed)}`);

    // The approved bytes are kept by digest in the hub.
    const r1 = ((lock!.data.requirements ?? []) as Line[]).find((r) => r.id === 'R1');
    must(r1 !== undefined && strings(r1).includes(APPROVED_SHA), `${AC12} the locked definition's R1 must name the SHA-256 of ${CHECK_FILE}'s bytes at the lock, ${APPROVED_SHA}: ${JSON.stringify(r1)}`);
    const kept = await control(hub, 'evidence.read', { sha: APPROVED_SHA }).catch((error: unknown) => {
      throw Error(`${AC12} the approved bytes of ${CHECK_FILE} must be kept in the hub by their digest ${APPROVED_SHA}: ${error instanceof Error ? error.message : String(error)}`);
    });
    must(kept.evidence !== undefined, `${AC12} evidence.read ${APPROVED_SHA} must find the approved bytes of ${CHECK_FILE}: ${JSON.stringify(kept)}`);

    // The change becomes a proposal naming the file.
    const proposals = events.filter((e) => e.kind.endsWith('.proposed') && e.log_pos > changedAt);
    must(proposals.some((e) => JSON.stringify(e.data).includes(CHECK_FILE)), `${AC12} the change to ${CHECK_FILE} must become a proposal naming the file: ${proposals.map(said).join('; ') || 'no *.proposed event after the change'}`);

    // The claim's checks run the approved bytes: the run records the approved check's outcome, though the disk's exits 0.
    must(next.started.length > 0, `${AC12} ${BYTES_CLAUSE} of ${CHECK_FILE}: the next claim must run R1's check: no run.started tied to it`);
    must(next.finished.length > 0 && next.finished.every((f) => f?.data.outcome === 'failed'), `${AC12} ${BYTES_CLAUSE} of ${CHECK_FILE} kept by digest, not the file on disk (which exits 0): R1's run must record the approved check's outcome, failed; it recorded ${next.finished.map(said).join('; ')}`);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC12} a drafted check file changed after the lock by a write the guard didn't recognize`, () => {
  it(`${AC12} npm test's child rewrites ${CHECK_FILE}: the next claim's hash differs, the claim runs the approved bytes kept by digest, and a proposal names the file`, async () => {
    await scenario();
  }, 900_000);

  it(`${AC12} a lock that hashes requirement records with check paths but not their bytes (hash-check-paths) gives the same hash and fails, naming the file`, async () => {
    const failure = await failureOf(() => scenario('hash-check-paths'));
    expect(failure, 'the planted lock must fail this test').not.toBeNull();
    expect(failure).toContain(HASH_CLAUSE);
    expect(failure).toContain(CHECK_FILE);
  }, 900_000);

  it(`${AC12} a claim whose checks run the file on disk (runs-disk-bytes) fails, naming the file`, async () => {
    const failure = await failureOf(() => scenario('runs-disk-bytes'));
    expect(failure, 'the planted claim must fail this test').not.toBeNull();
    expect(failure).toContain(BYTES_CLAUSE);
    expect(failure).toContain(CHECK_FILE);
  }, 900_000);
});
