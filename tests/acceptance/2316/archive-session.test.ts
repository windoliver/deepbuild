// #2316.e3f1d78c: copying a single active session via archive.session(id) with 2,000 unrelated transcript files in
// sibling project/date folders completes well within ARCHIVE_WAIT_MS and archives only the target session. The real
// archive, from its public entry, over the shipped adapters' facts, in a temp HOME holding real transcript files.

import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  allEvents, appendClaude, ARCHIVE_WAIT_MS, BOUND_MS, claudeHome, claudeTranscript, codexHome, codexTranscript, dataOf, expectArchived, handle,
  median, numbered, openArchiveOn, openWorld, removeTemps, siblings, timed, type Transcript, type World,
} from './archive.ts';

afterAll(removeTemps);

/** Transcript files under a folder, counted on disk. */
function filesUnder(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += filesUnder(join(dir, entry.name));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) n++;
  }
  return n;
}

/**
 * The target session's copy taken five times while it runs: the first copy, then after each of four more turns of
 * it lands in its transcript, as the hub copies it before each held push. Each copy must read back as the
 * transcript; the time is each call's, by the wall clock.
 */
async function copies(w: World, target: Transcript, grow: (turn: number) => void): Promise<number[]> {
  const archive = await openArchiveOn(w);
  const times: number[] = [];
  for (let turn = 0; turn < 5; turn++) {
    if (turn) grow(turn);
    times.push(await timed(() => archive.session(target.id)));
    await expectArchived(w, target, `after archive.session(${target.id}), turn ${turn}`);
  }
  return times;
}

async function onlyTarget(w: World, target: Transcript): Promise<void> {
  const named = (await allEvents(w.record, ['transcript.archived'])).map((e) => String(dataOf(e).session));
  expect(named.length, 'a transcript.archived event for each of the five copies of the target').toBe(5);
  expect([...new Set(named)], 'the sessions archive.session(id) archived: only the target').toEqual([handle(target.id)]);
}

function judge(times: readonly number[], what: string): void {
  const shown = times.map((t) => t.toFixed(1)).join(', ');
  expect(Math.max(...times), `${what}: every copy finishes inside ARCHIVE_WAIT_MS (${ARCHIVE_WAIT_MS} ms); took ${shown} ms`).toBeLessThan(ARCHIVE_WAIT_MS);
  expect(median(times), `${what}: the median copy is well within ARCHIVE_WAIT_MS, at most ${BOUND_MS} ms; took ${shown} ms`).toBeLessThanOrEqual(BOUND_MS);
}

function controls(w: World): void {
  const claude = filesUnder(join(claudeHome(w.env), 'projects'));
  const codex = filesUnder(join(codexHome(w.env), 'sessions'));
  if (claude + codex !== 2001) throw Error(`BLOCKED: the temp HOME holds ${claude} Claude Code and ${codex} Codex transcripts, not the target and 2,000 others`);
}

test('#2316.e3f1d78c Copying a single active session via `archive.session(id)` with 2,000 unrelated transcript files in sibling project/date folders completes well within `ARCHIVE_WAIT_MS` and archives only the target session (a Claude Code session)', async () => {
  const w = await openWorld();
  try {
    const target = claudeTranscript(w.env, numbered(1, 6, 'target'), { cwd: '/tmp/dh20-work/shop' });
    siblings(w.env);
    controls(w);
    const times = await copies(w, target, (turn) => appendClaude(target, numbered(6 + turn * 2 - 1, 6 + turn * 2, 'target')));
    await onlyTarget(w, target);
    judge(times, 'a Claude Code session beside 2,000 other transcripts');
  } finally {
    await w.close();
  }
}, 600_000);

test('#2316.e3f1d78c Copying a single active session via `archive.session(id)` with 2,000 unrelated transcript files in sibling project/date folders completes well within `ARCHIVE_WAIT_MS` and archives only the target session (a Codex session)', async () => {
  const w = await openWorld();
  try {
    const target = codexTranscript(w.env, ['fix the checkout page', 'run the tests']);
    siblings(w.env);
    controls(w);
    const times = await copies(w, target, (turn) => growCodex(target, turn));
    await onlyTarget(w, target);
    judge(times, 'a Codex session beside 2,000 other transcripts');
  } finally {
    await w.close();
  }
}, 600_000);

/** A Codex rollout gains a user turn, as the agent appends it while the session runs. */
function growCodex(t: Transcript, turn: number): void {
  const line = JSON.stringify({ timestamp: new Date(Date.parse(JSON.parse(t.lines[0]!).timestamp as string) + (t.next + 1) * 1000).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `turn ${turn}: and the cart page` }] } });
  t.lines.push(line);
  t.next++;
  appendFileSync(t.path, `${line}\n`);
}
