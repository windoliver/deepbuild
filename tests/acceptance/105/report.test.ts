// AC2: a captured bug becomes a drafted check on its ask. With the proof line: a recorded capture from a second
// display (#400's display B), its evidence and the drafted check. You start a bug capture for alpha with your words,
// pick B in the system picker and hold the chord 2 s; the capture is saved as evidence and attached to the ask it
// opens in alpha, whose definition holds a drafted check that reproduces it, which the fix must pass. Through
// `deep-show run` (README: The surface under test). At the base `deep-show` has no `capture` call and answers every
// scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, B, Driver, MS, SEC, at, capture, capturesOf, framesOf, hid, holdProblems, newFeed, pick, storeFiles, taskOf,
  useFolders, useShow, type Planted,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();
const WORDS = 'The legend overlaps the chart on the second display';
const DOWN = 3 * SEC;
const UP = 5 * SEC;

function run(planted?: Planted): string[] {
  const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
  const dir = dirs();
  const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
  const what = `a bug captured from B${planted ? ` (planted ${planted})` : ''}`;
  const [, , , , caps] = d.step([capture(2 * SEC, ALPHA.id, WORDS), pick(2 * SEC + 500 * MS, B.uuid), hid(DOWN, 'down'), hid(UP, 'up'), at('captures', UP + SEC)], what);
  const f: string[] = [];
  const saved = capturesOf(caps, 'captures').find((c) => c.session === ALPHA.id && c.asset !== null);
  if (!saved) return ['the capture: no capture of alpha\'s saved an asset'];
  // The recording is of the second display, and only of it.
  const file = storeFiles(dir.evidence).find((e) => e.sha === saved.asset!.sha256);
  if (!file) return [`the capture: its asset ${saved.asset!.sha256} is not in the evidence store`];
  for (const p of holdProblems(framesOf(file.bytes, 'the recording'), B, feeds.b, DOWN, UP)) f.push(`the capture: ${p}`);
  if (saved.ask === null) return [...f, 'the capture is attached to no ask'];
  const [reply] = d.step([at('task', UP + 2 * SEC, { task: saved.ask })], `${what}: its ask`);
  const task = taskOf(reply, `the ask ${saved.ask}`);
  if (task.handle !== saved.ask) f.push(`the ask: task ${task.handle} answers for ${saved.ask}`);
  if (task.session !== ALPHA.id) f.push(`the ask is in session ${task.session}, not alpha's`);
  if (!task.open) f.push('the ask is not open');
  if (task.words !== WORDS) f.push(`the ask's words are ${JSON.stringify(task.words)}, not yours`);
  const ev = task.evidence.find((e) => e.sha256 === saved.asset!.sha256);
  if (!ev) f.push(`the ask's evidence ${JSON.stringify(task.evidence)} does not hold the capture ${saved.asset!.sha256}`);
  else if (ev.redaction !== 'unknown') f.push(`the ask's evidence labels the capture's redaction ${ev.redaction}, not unknown`);
  const drafted = task.checks.filter((c) => c.reproduces === saved.asset!.sha256);
  if (drafted.length !== 1) f.push(`the ask's definition holds ${drafted.length} checks that reproduce the capture, not one drafted check (checks: ${JSON.stringify(task.checks)})`);
  for (const c of drafted) {
    if (c.state !== 'drafted') f.push(`the check ${c.id} reproducing the capture is ${c.state}, not drafted`);
    if (!c.required) f.push(`the check ${c.id} reproducing the capture is not required: the fix need not pass it`);
  }
  return f;
}

describe('AC2 a captured bug becomes a drafted check on its ask', () => {
  it('AC2 a 2 s capture of the second display, started for alpha with your words, is saved as evidence labelled unknown, attached to the ask it opens in alpha, and that ask\'s definition holds one drafted, required check that reproduces it', () => {
    expect(run(), 'the capture, its evidence and the drafted check').toEqual([]);
    // Wrong program: a bug capture attached to its ask with no check drafted.
    const twin = run('drafts_no_check');
    expect(twin.some((m) => m.startsWith('the ask\'s definition holds 0 checks')), `the planted drafts_no_check fails, naming the missing drafted check: ${JSON.stringify(twin)}`).toBe(true);
  }, 900_000);
});
