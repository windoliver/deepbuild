// #1866 AC4: a claim judged to PASS, its verdict and runs read (`changes.read`) while its session lives and again after the
// hub let go of its state: its session ended, and more sessions than the hub keeps ended after it (ENDED_KEPT, 64, in
// packages/hub/src/hub-shared.ts), so it is forgotten. Both reads give what the record holds. The planted hub that reads
// them only from memory gives nothing once the state is gone, and the judge names the claim.
//
// The world, the trusted repo, the handed definition and the Claude Code session are #322's helpers (the scenario is
// #2205's: a fix that passes the spec's unit check and its definition's one check, so the claim is PASS). The later
// sessions start and end over the hub's socket, as the churn benchmark's do: nothing of them is judged.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR, FIX, Session, allEvents, askNamed, claimsOf, cleanup, control, lastPos, lockedFor, makeWorld, req, settle, shown, startHub, taskOf, trustRepo, verdictsOf,
  type Draft, type Ev, type Hub, type Line, type World,
} from '../322/helpers.ts';
import { ulid } from '../26/helpers.ts';
import { AC4, MINUTE } from './helpers.ts';

afterEach(cleanup, MINUTE);

/** Sessions ended after the claim's: more than the 64 ended sessions the hub keeps, so the claim's is forgotten. */
const LATER = 70;
const PLANT = 'claim-reads-only-memory';

// #2205's scenario: the definition's one requirement, judged by a check that fails on the base commit and passes on the fix.
const CHECK = '.deepbuild/checks/expired-rejected.sh';
const CHECK_TEST = '.deepbuild/checks/expired-rejected.test.js';
const FILES = {
  [CHECK]: `#!/bin/sh\n# Drafted check: a token whose exp has passed is rejected.\nnode --test ${CHECK_TEST}\n`,
  [CHECK_TEST]: "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../../src/auth.js');\ntest('a token whose exp has passed is rejected', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n",
};
const DRAFT: Draft = { ask: BEHAVIOR, requirements: [req('R1', 'A token whose exp has passed is rejected', { check: CHECK, asserts: [`${CHECK_TEST}:5`] })], deliverables: [FIX.file], budget: null };

/** A hub that knows the plant or none; a hub that stops at its start is the failure this names. */
async function hubOn(w: World, plant?: string): Promise<Hub> {
  const hub = await startHub(w, { plant }).catch((error: unknown) => error as Error);
  expect(hub instanceof Error ? hub.message : 'started', `the hub starts${plant ? ` with the planted program DEEP_HUB_PLANT=${plant}` : ''}`).toBe('started');
  return hub as Hub;
}
/** A session that fixes the file and stops: its claim, once every run started for it ended and it is PASS. */
async function passedClaim(w: World, hub: Hub): Promise<{ claim: string; session: Session }> {
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(FIX.file);
  const locked = (all: Ev[]): string | undefined => { const ref = taskOf(askNamed(all, s, BEHAVIOR)); return ref !== undefined && lockedFor(all, ref).length ? ref : undefined; };
  const ref = locked(await settle(hub, (all) => locked(all) !== undefined, 5 * MINUTE));
  expect(ref, `BLOCKED: the prompt's definition locks; hub stderr ${hub.stderr().slice(-600)}`).toBeDefined();
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await s.stop('Done.');
  const claimOf = (all: Ev[]): string | undefined => { const made = claimsOf(all, ref!, since)[0]; return made && `claim:${made.id}`; };
  const idle = (all: Ev[], claim: string): boolean => { const ended = new Set(all.filter((e) => e.kind === 'run.finished').map((e) => e.data.run)); return all.every((e) => e.kind !== 'run.started' || e.data.claim !== claim || ended.has(e.data.run)); };
  const all = await settle(hub, (events) => { const c = claimOf(events); return c !== undefined && verdictsOf(events, c).at(-1)?.data.outcome === 'PASS' && idle(events, c); }, 15 * MINUTE);
  const claim = claimOf(all);
  expect(claim && verdictsOf(all, claim).at(-1)?.data.outcome, `BLOCKED: the fix's claim is judged to PASS: the Stop hook ${shown(stop)}; ${JSON.stringify(all.filter((e) => e.kind === 'verdict.made').map((e) => e.data).slice(-1)).slice(0, 800)}`).toBe('PASS');
  return { claim: claim!, session: s };
}

// ---- The later sessions, over the hub's socket as the churn benchmark's: one connection per hook, this test their process.
let seq = BigInt(Date.now()) * 1_000_000n;
function fire(hub: Hub, event: string, payload: Line): Promise<Line> {
  const request = { v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [], payload: { hook_event_name: event, ...payload } };
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    // deadline: the hub answers every hook it takes, so only a hang reaches this, and it becomes a failure
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no reply to ${event} within a minute`)); }, MINUTE);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** The claim's session ended, then LATER more that did nothing, so the hub keeps none of what it kept for the first. */
async function letGo(w: World, hub: Hub, s: Session): Promise<void> {
  const last = await s.end();
  expect(last.code, `BLOCKED: the claim's session ends: ${shown(last)}`).toBe(0);
  const transcripts = join(w.home, '.claude', 'projects', 'later');
  mkdirSync(transcripts, { recursive: true });
  const ids: string[] = [];
  for (let i = 0; i < LATER; i++) {
    const id = randomUUID();
    const transcript = join(transcripts, `${id}.jsonl`);
    writeFileSync(transcript, '');
    for (const [event, more] of [['SessionStart', { source: 'startup' }], ['SessionEnd', { reason: 'other' }]] as const) {
      const reply = await fire(hub, event, { session_id: id, transcript_path: transcript, cwd: w.tmp, ...more });
      expect(reply.error, `BLOCKED: the hub takes a later session's ${event}`).toBeUndefined();
    }
    ids.push(id);
  }
  const ended = (all: Ev[]): number => new Set(all.filter((e) => e.kind === 'session.end' && ids.includes(String(e.session))).map((e) => e.session)).size;
  expect(ended(await settle(hub, (all) => ended(all) === LATER, MINUTE)), 'BLOCKED: every later session\'s end is recorded').toBe(LATER);
}

// ---- The reads, and their judge.
/** `changes.read` of the claim: what it gives, or why it gave nothing. */
const readClaim = (hub: Hub, claim: string): Promise<Line | string> => control(hub, 'changes.read', { id: claim }).then((r) => r.change as Line, (error: unknown) => (error as Error).message);
const PARTS = ['verdicts', 'runs', 'checks', 'line'] as const;
const rows = (change: Line, key: string): Line[] => (Array.isArray(change[key]) ? (change[key] as Line[]) : []);
/**
 * What a read of the claim lost of what the record holds: each verdict.made of it, by its handle and outcome, and each
 * run of it, by its handle and how it ended. Every line names the claim.
 */
function lost(claim: string, all: readonly Ev[], change: Line | string): string[] {
  if (typeof change === 'string') return [`${claim} reads nothing: ${change}`];
  const ended = new Map(all.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), String(e.data.outcome)]));
  const verdicts = rows(change, 'verdicts').map((v) => `${String(v.handle)} ${String(v.outcome)}`);
  const runs = rows(change, 'runs').map((r) => `run:${String(r.id)} ${String(r.outcome)}`);
  return [
    ...verdictsOf(all, claim).map((e) => `${String(e.data.verdict)} ${String(e.data.outcome)}`).filter((v) => !verdicts.includes(v)).map((v) => `${claim} reads no ${v} among its ${verdicts.length} verdicts`),
    ...all.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => `${String(e.data.run)} ${ended.get(String(e.data.run))}`).filter((r) => !runs.includes(r)).map((r) => `${claim} reads no ${r} among its ${runs.length} runs`),
  ];
}

describe(`${AC4} A claim's verdict and runs read after its state was let go read the same as before, from the record. A hub that reads them only from memory reads nothing and fails this test, naming the claim`, () => {
  it(`${AC4} a claim judged to PASS reads the same once its session is forgotten as it did while it lived`, async () => {
    const w = makeWorld({ drafts: [DRAFT], files: FILES });
    await trustRepo(w, true);
    const hub = await hubOn(w);
    const { claim, session } = await passedClaim(w, hub);
    const before = await readClaim(hub, claim);
    const record = await allEvents(hub);
    expect(lost(claim, record, before), 'while its session lives, the claim reads what the record holds').toEqual([]);
    expect(rows(before as Line, 'runs').length, 'the claim has runs to read').toBeGreaterThan(0);
    await letGo(w, hub, session);
    const after = await readClaim(hub, claim);
    expect(lost(claim, record, after), 'after its state was let go, the claim reads what the record holds').toEqual([]);
    for (const part of PARTS) expect((after as Line)[part], `${claim}'s ${part} reads the same after its state was let go as before`).toEqual((before as Line)[part]);
  }, 30 * MINUTE);

  it(`${AC4} ${PLANT}, a hub that reads a claim's verdicts and runs only from memory, reads nothing once its state is let go, and the judge names the claim`, async () => {
    const w = makeWorld({ drafts: [DRAFT], files: FILES });
    await trustRepo(w, true);
    const hub = await hubOn(w, PLANT);
    const { claim, session } = await passedClaim(w, hub);
    const record = await allEvents(hub);
    await letGo(w, hub, session);
    const said = lost(claim, record, await readClaim(hub, claim));
    expect(said.length, `${PLANT}: the hub must read nothing of the claim, so the judge has something to say`).toBeGreaterThan(0);
    for (const line of said) expect(line, 'the judge names the claim').toContain(claim);
  }, 30 * MINUTE);
});
