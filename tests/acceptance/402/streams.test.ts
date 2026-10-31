// AC6: a 30 fps video stream to a panel paused for 1 s drops and counts 30 frames and shows none of them late; a stream of
// 10,000 lines holding a planted marker leaves no event in the record carrying the marker.
//
// The video half runs on the virtual display clock (`deep-show run`): a source emitting 30 frames a second, the panel's
// window paused for one second; the dropped frames are the 30 whose times fall in the pause, counted by the stream, and
// every frame that is shown is shown within a frame of its time. A stream that shows the queued frames when the panel
// resumes (late), and one that drops without counting, fail, naming the frame. The record half runs a real program
// through `deep-show serve` against a real record (SQLite, @deepbuild/record's file), and reads its events back with
// SQLite; a stream that writes its lines to the record fails, naming the event. At the base `deep-show` has no
// `stream_open` call and no `serve`.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import {
  CHECK, Driver, FLICKS, LEAD, MS, PERIOD_A, SEC, SLOTS, allRows, arr, at, gridOf, installCall, num, obj, openCall, openedOf, program, readBytes, setupOf,
  terminalPlugin, tmp, useOut, useShow, waitFor, withServe, type JsonObject, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();

// ---------------------------------------------------------------------------------------------------
// Video (and sound): drop and count

const FROM = 5 * SEC;
const UNTIL = 20 * SEC;
const PAUSE: [number, number] = [10 * SEC + MS, 11 * SEC + MS];
const world = (planted?: string): World => ({ evidence: out(), panels: { view: SLOTS[0]!, other: SLOTS[1]! }, plugins: { player: { panels: { view: { tree: [{ id: 'title', component: 'text', text: 'Player' }] }, other: { tree: [{ id: 'title', component: 'text', text: 'Other' }] } } } }, ...(planted ? { planted } : {}) });

interface Frame { seq: number; pts: number; presented: number }
interface Streamed { emitted: number; shown: Frame[]; droppedCount: number; droppedSeqs: number[] }
function streamOf(reply: JsonObject | undefined, what: string): Streamed {
  const r = obj(reply, what);
  const dropped = obj(r['dropped'], `${what}: dropped`);
  return {
    emitted: num(r['emitted'], `${what}: emitted`),
    shown: arr(r['shown'], `${what}: shown`).map((v, i) => { const f = obj(v, `${what}: shown[${i}]`); return { seq: num(f['seq'], 'seq'), pts: num(f['pts'], 'pts'), presented: num(f['presented'], 'presented') }; }),
    droppedCount: num(dropped['count'], `${what}: dropped.count (the stream's count of frames it dropped)`),
    droppedSeqs: arr(dropped['seqs'], `${what}: dropped.seqs`).map((v, i) => num(v, `${what}: dropped.seqs[${i}]`)),
  };
}

/** Frame `seq` (from 1) of a source of `rate` a second starting at FROM. */
const ptsOf = (seq: number, rate: number): number => FROM + ((seq - 1) * FLICKS) / rate;
/** The frames whose time falls in the pause. */
const inPause = (rate: number): number[] => {
  const out: number[] = [];
  for (let s = 1; ptsOf(s, rate) <= UNTIL; s++) if (ptsOf(s, rate) >= PAUSE[0] && ptsOf(s, rate) < PAUSE[1]) out.push(s);
  return out;
};

function play(bin: string, kind: 'video' | 'sound', rate: number, planted?: string): Streamed {
  const d = new Driver(bin, world(planted));
  const source = kind === 'video' ? { fps: rate, from: FROM, until: UNTIL } : { packets_per_second: rate, from: FROM, until: UNTIL };
  const r = d.step([{ call: 'stream_open', at: SEC, stream: 'S1', kind, panel: 'view', source, pauses: [{ from: PAUSE[0], until: PAUSE[1] }] }, at('stream', UNTIL + SEC, { stream: 'S1' })], `a ${rate}/s ${kind} stream paused for 1 s${planted ? ` (planted ${planted})` : ''}`);
  return streamOf(r[1], `the ${kind} stream`);
}

/** "Drops and counts N frames and shows none of them late". */
function dropProblems(s: Streamed, rate: number, kind: string): string[] {
  const f: string[] = [];
  const want = inPause(rate);
  if (s.droppedCount !== want.length) f.push(`the ${kind} stream counts ${s.droppedCount} dropped frames, not ${want.length}`);
  if (JSON.stringify(s.droppedSeqs) !== JSON.stringify(want)) f.push(`the ${kind} stream drops frames ${JSON.stringify(s.droppedSeqs.slice(0, 4))}…, not ${want[0]}…${want[want.length - 1]}`);
  const shownSeqs = new Set(s.shown.map((x) => x.seq));
  for (const seq of want) if (shownSeqs.has(seq)) { f.push(`frame ${seq}, which the pause dropped, is shown`); break; }
  if (s.shown.length + s.droppedSeqs.length !== s.emitted) f.push(`${s.shown.length} shown and ${s.droppedSeqs.length} dropped of ${s.emitted} sent: a frame is neither`);
  const late = s.shown.filter((x) => x.presented > x.pts + PERIOD_A + LEAD + CHECK || x.presented < x.pts);
  if (late.length) f.push(`frame ${late[0]!.seq} is shown ${((late[0]!.presented - late[0]!.pts) / MS).toFixed(1)} ms after its time (${late.length} frames off time), more than a frame`);
  if (s.shown.length === 0) f.push('no frame is shown');
  return f;
}

describe('AC6 a video stream paused for 1 s drops and counts 30 frames and shows none late', () => {
  it('AC6 a 30 fps stream whose panel is paused for 1 s drops exactly the 30 frames in the pause, counts 30, and shows every other frame on time; one that shows the queue late, and one that drops uncounted, fail, naming the frame', () => {
    const s = play(show(), 'video', 30);
    expect(inPause(30).length, 'a second of 30 fps is 30 frames').toBe(30);
    expect(s.emitted, 'the source sent every frame to its end').toBe(Math.floor(((UNTIL - FROM) / FLICKS) * 30) + 1);
    expect(dropProblems(s, 30, 'video'), '30 dropped and counted, none late').toEqual([]);
    const late = dropProblems(play(show(), 'video', 30, 'video_shows_late'), 30, 'video');
    expect(late.some((m) => /^frame \d+ is shown \d+\.\d ms after its time/.test(m)), `the planted video_shows_late fails, naming the frame: ${JSON.stringify(late.slice(0, 3))}`).toBe(true);
    const mute = dropProblems(play(show(), 'video', 30, 'video_drops_uncounted'), 30, 'video');
    expect(mute.some((m) => m.includes('counts 0 dropped frames, not 30')), `the planted video_drops_uncounted fails: ${JSON.stringify(mute.slice(0, 3))}`).toBe(true);
  }, 600_000);

  it('SCOPE a sound stream drops late packets and counts them as video does: 50 packets a second, 1 s paused, 50 dropped and counted', () => {
    const s = play(show(), 'sound', 50);
    expect(dropProblems(s, 50, 'sound'), '50 dropped and counted, none late').toEqual([]);
    expect(s.droppedCount).toBe(50);
  }, 600_000);

  it('SCOPE only the panels a stream was opened for read it: the panel it was opened for reads it, another plug-in\'s panel is refused', () => {
    const d = new Driver(show(), world());
    const open = { call: 'stream_open', at: SEC, stream: 'S1', kind: 'video', panel: 'view', source: { fps: 30, from: FROM, until: UNTIL }, pauses: [] };
    const [, mine, theirs] = d.step([open, at('stream_read', 6 * SEC, { stream: 'S1', panel: 'view' }), at('stream_read', 6 * SEC, { stream: 'S1', panel: 'other' })], 'two readers');
    expect(obj(mine, 'the panel it was opened for')['code'], 'its own panel reads it').toBeUndefined();
    expect(typeof obj(theirs, 'another panel')['code'], 'another panel is refused').toBe('string');
  });
});

// ---------------------------------------------------------------------------------------------------
// A stream of 10,000 lines, and the record

const MARKER = 'MARKER-7d4f2a91-c3b8-4e50-9a16';
const EVERY = 250;
const COUNT = 10_000;
const APP: Connection = { writer: 'app', actor: 'you', scope: 'you' };

interface Carry { id: string; kind: string }
/** Every event of the record at `path` that carries the marker in any column. */
function carrying(path: string): { events: number; carrying: Carry[]; control: boolean } {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT * FROM events ORDER BY log_pos').all() as Record<string, unknown>[];
    return {
      events: rows.length,
      carrying: rows.filter((r) => JSON.stringify(r).includes(MARKER)).map((r) => ({ id: String(r['id']), kind: String(r['kind']) })),
      control: rows.some((r) => String(r['subject'] ?? '') === 'task:CONTROL' || JSON.stringify(r).includes('task:01K74FX2B4D6F8H0K2M4P6R8T0')),
    };
  } finally {
    db.close();
  }
}

async function playRecord(bin: string, planted?: string): Promise<{ streamed: number; scan: ReturnType<typeof carrying> }> {
  const dir = tmp('rec');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'record.db');
  const record = await openRecord({ path, now: () => Date.now() });
  const at0 = Date.now();
  await record.append(APP, { v: 1, id: ulid(at0), kind: 'claim.made', ts: at0, data: { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', attempt: 1, commit: 'a'.repeat(40), scope: 'session' } });
  await record.close();
  const done = join(dir, 'done');
  const setup: JsonObject = { ...setupOf({ evidence: dir, panels: { term: SLOTS[0]! }, ...(planted ? { planted } : {}) }), record: path };
  const streamed = await withServe(bin, setup, async (s) => {
    await s.ok(installCall(0, 'terminals', terminalPlugin({ term: 'T1' })), 'the terminals plug-in installs');
    const opened = openedOf(await s.call(openCall(0, 'T1', { panel: 'term', cols: 120, rows: 36, history: COUNT + 100, program: program(dir, 'marker', String(COUNT), MARKER, String(EVERY), done) }), 120_000), 'T1');
    for (const p of [opened.host, opened.program]) if (p) s.known.add(p.pid);
    await waitFor(() => readBytes(done).length, (n) => n > 0, 120_000);
    // The stream reached the grid whole: every line, the marker in every 250th.
    const stats = await waitFor(() => s.call({ call: 'stream_stats', stream: opened.stream }, 30_000), (r) => r['buffered'] === 0 && r['delivered'] === r['sent'] && Number(r['sent']) > 0, 120_000, 100);
    expect(stats['dropped'], 'a terminal\'s stream drops nothing').toMatchObject({ bytes: 0 });
    const grid = gridOf(await s.ok({ call: 'cells', terminal: 'T1' }, 'the grid'), 'the grid');
    const rows = await allRows(s, 'T1', grid.history + grid.rows);
    return rows.filter((r) => r.includes(MARKER)).length;
  });
  return { streamed, scan: carrying(path) };
}

describe('AC6 a stream of 10,000 lines holding a planted marker leaves no event in the record carrying it', () => {
  it('AC6 10,000 lines, every 250th holding the marker, reach the grid (40 of them), and no event in the record carries the marker; the record is the one the run started with, readable and intact; a stream that writes its lines to the record fails, naming the event', async () => {
    const p = await playRecord(show());
    expect(p.streamed, 'the 40 marked lines of the stream reached the grid, so the stream ran').toBe(COUNT / EVERY);
    expect(p.scan.control, 'the record is readable and holds the event the test put in it').toBe(true);
    expect(p.scan.carrying, 'no event carries the marker').toEqual([]);
    const twin = await playRecord(show(), 'stream_to_record');
    expect(twin.scan.carrying.length, `the planted stream_to_record writes events carrying the marker`).toBeGreaterThan(0);
    expect(twin.scan.carrying[0]!.id.length, 'and the check names the first event').toBeGreaterThan(0);
  }, 900_000);
});

