// AC5: an approved check's bytes are never written through a link that leaves the claim's checkout (README).
//
// #322's world, on the real hub, deep-hook and record: a Claude Code session whose task's definition locks with one
// drafted check, .deepbuild/checks/expired-token.sh, its bytes approved and kept by digest. Its requirement is a guard
// (on_base: passes), so it needs no run on the merge base, and a run of it that never starts reads BLOCKED and nothing
// else. After the lock, the session's folder holds that check's folder, .deepbuild/checks, as a symlink to a folder
// outside the repo, which holds a file of the check's name and one more, both yours. The agent edits src/auth.js and
// stops. The stop's claim takes its snapshot from that folder, so its checkout holds the link, and the check starts.
// The outside folder must then hold what it held, byte for byte and nothing more; and the verdict the gate makes of
// the claim's checks must read the check's requirement BLOCKED, naming the check's path. On the base the hub writes
// the approved bytes through the link, over your file. (The session's folder no longer holds the check as a file, so
// the core's floor also records the claim INVALID for its changed definition, on the base and after; that verdict
// judges no requirement and is not what this test reads.)
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  BEHAVIOR, CHECK_BYTES, CHECK_FILE, claimsOf, cleanup, expectTask, FLAG, lastPos, lockedFor, makeWorld, req, Session, settle, shown, startHub, stopHub, verdictsOf,
  type Draft, type Ev, type Hub, type Line, type World,
} from '../322/helpers.ts';
import { standInAgents } from './helpers.ts';

const AC5 = 'AC5 #2118.fee60420';
const FOLDER = '.deepbuild/checks';
const NAME = 'expired-token.sh';
/** What the outside folder holds, yours: a file of the check's own name, and one more. */
const YOURS: Record<string, string> = { [NAME]: '#!/bin/sh\n# Yours, outside the repo: never the approved check.\nexit 3\n', 'notes.txt': 'kept outside the repo\n' };
/** The definition handed for BEHAVIOR: R1 alone, a guard judged by the drafted check. */
const DRAFT: Draft = { ask: BEHAVIOR, requirements: [req('R1', 'An expired token is rejected with 401', { check: CHECK_FILE, on_base: 'passes', asserts: [`${CHECK_FILE}:3`] })], deliverables: ['src/auth.js'], budget: null };

afterEach(cleanup, 120_000);

/** Every file under a folder, by its path in it, with its bytes. */
function holds(dir: string, at = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(join(dir, at), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, holds(dir, path));
    else out[path] = entry.isSymbolicLink() ? '(a link)' : readFileSync(join(dir, path), 'utf8');
  }
  return out;
}
/** The claim's verdicts that judged its requirements (the gate's own, each with the requirement the check covers). */
const judgedR1 = (events: readonly Ev[], claim: string): Line[] => verdictsOf(events, claim).flatMap((v) => ((v.data.requirements ?? []) as Line[]).filter((q) => q.check === CHECK_FILE).map((q) => ({ ...q, reasons: v.data.reasons, claim_outcome: v.data.outcome })));

test(`${AC5} a claim whose snapshot holds the approved check's folder ${FOLDER} as a symlink to a folder outside the checkout: when the check starts, nothing is written in that folder and the check is BLOCKED naming the path`, async () => {
  if (CHECK_FILE !== `${FOLDER}/${NAME}`) throw Error(`BLOCKED: ${AC5} #322's drafted check is ${CHECK_FILE}, not ${FOLDER}/${NAME}`);
  const w = makeWorld({ drafts: [DRAFT], spec: null });
  const outside = join(w.tmp, 'outside');
  mkdirSync(outside);
  for (const [name, bytes] of Object.entries(YOURS)) writeFileSync(join(outside, name), bytes);
  const restorePath = standInAgents(w.tmp);
  try {
    const hub = await startHub(w);
    try { await scene(w, hub, outside); } finally { await stopHub(hub); }
  } finally {
    restorePath();
  }
}, 900_000);

async function scene(w: World, hub: Hub, outside: string): Promise<void> {
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, AC5)).length > 0; } catch { return false; } }, 240_000);
  let task: string;
  try { task = expectTask(events, s, BEHAVIOR, AC5); } catch (error) { throw Error(`BLOCKED: ${(error as Error).message}`); }
  const lock = lockedFor(events, task)[0];
  if (!lock || !JSON.stringify(lock.data.requirements).includes(CHECK_FILE)) throw Error(`BLOCKED: ${AC5} the handed definition of ${task} must lock with its drafted check ${CHECK_FILE}: ${JSON.stringify(lock?.data ?? 'no lock').slice(0, 600)}`);

  // Given: the session's folder holds the check's folder as a symlink to a folder outside the repo.
  rmSync(join(w.repo, FOLDER), { recursive: true });
  symlinkSync(outside, join(w.repo, FOLDER));
  if (!lstatSync(join(w.repo, FOLDER)).isSymbolicLink() || JSON.stringify(holds(outside)) !== JSON.stringify(YOURS)) throw Error(`BLOCKED: ${AC5} the link ${FOLDER} -> ${outside} wasn't made, or the outside folder isn't as written`);

  // When: the agent's work ends, its stop makes the claim, and the claim's check starts.
  const since = await lastPos(hub);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const stop = await s.stop('The middleware now says it rejects expired tokens.');
  const changed = (): boolean => JSON.stringify(holds(outside)) !== JSON.stringify(YOURS);
  events = await settle(hub, (all) => { const made = claimsOf(all, task, since)[0]; return changed() || (made !== undefined && judgedR1(all, `claim:${made.id}`).length > 0); }, 420_000);
  const made = claimsOf(events, task, since)[0];
  if (!made) throw Error(`BLOCKED: ${AC5} the stop must make a claim for ${task}: no claim.made after it; its Stop hook: ${shown(stop)}`);
  const claim = `claim:${made.id}`;
  const judged = judgedR1(events, claim);
  const seen = `the outside folder holds ${JSON.stringify(holds(outside))}; ${claim}'s verdicts on ${CHECK_FILE}'s requirement: ${JSON.stringify(judged).slice(0, 1500) || 'none'}; every verdict of it: ${JSON.stringify(verdictsOf(events, claim).map((v) => ({ outcome: v.data.outcome, reasons: v.data.reasons }))).slice(0, 1500)}`;

  expect(holds(outside), `${AC5} nothing is written in the folder the link names: it holds your two files as they were, and no other; the approved bytes are ${JSON.stringify(CHECK_BYTES.slice(0, 60))}...; ${seen}`).toEqual(YOURS);
  const last = judged.at(-1);
  expect(last?.outcome, `${AC5} the check couldn't start, so its requirement reads BLOCKED; ${seen}`).toBe('BLOCKED');
  expect(JSON.stringify(last?.reasons ?? []), `${AC5} the verdict names the path, ${CHECK_FILE}; ${seen}`).toContain(CHECK_FILE);
}
