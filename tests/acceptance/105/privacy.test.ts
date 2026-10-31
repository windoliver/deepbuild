// AC4: while a hold runs, no record row, event or log line holds a captured frame or sample, and a crash mid-hold
// leaves no asset; after release one asset arrives by hash with redaction `unknown`, and a Send that attaches it waits
// for your approval; a planted capture that writes frames to the record as they arrive fails, naming the row. Each
// display's frames carry a feed token (README: Frames), so a frame is found in any file or line by its feed, raw, in
// hex or in base64 at any offset. The record is #96's `record.jsonl` in the hub's state folder, the log the run's
// stderr. Through `deep-show run` (README: The surface under test). At the base `deep-show` has no `capture` call and
// answers every scenario here `bad_input`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALPHA, B, Driver, Listener, MS, SEC, at, capture, capturesOf, filesUnder, frameIn, framesHeld, framesOf, hid,
  holdProblems, newFeed, pick, recordLines, runRaw, runShow, scenario, sendOf, sha256, storeFiles, useFolders, useShow,
  type Planted,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();
const WORDS = 'The legend overlaps the chart on the second display';
const DOWN = 3 * SEC;
const UP = 6 * SEC;
const HOLD = [capture(2 * SEC, ALPHA.id, WORDS), pick(2 * SEC + 500 * MS, B.uuid), hid(DOWN, 'down'), hid(UP, 'up')];

/** A 3 s capture of B, released, then `captures` 1 s after the release: what is wrong with the record, the log and
 * the evidence it leaves, split into frames held where they mustn't be and the asset's problems. */
function full(planted?: Planted): { held: string[]; asset: string[] } {
  const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
  const dir = dirs();
  const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
  const [caps] = d.step([...HOLD, at('captures', UP + SEC)], `a 3 s capture of B${planted ? ` (planted ${planted})` : ''}`).slice(-1);
  const held = framesHeld(dir.state, d.stderr, [feeds.a, feeds.b]);
  const asset: string[] = [];
  const files = storeFiles(dir.evidence);
  if (files.length !== 1) asset.push(`the evidence store holds ${files.length} files after the release, not one asset (${files.map((e) => e.path).join(', ')})`);
  for (const e of files) if (sha256(e.bytes) !== e.sha) asset.push(`the store file ${e.path} doesn't hash to its name`);
  const saved = capturesOf(caps, 'captures 1 s after the release').filter((c) => c.asset !== null);
  if (saved.length !== 1) { asset.push(`1 s after the release ${saved.length} captures have an asset, not one`); return { held, asset }; }
  const a = saved[0]!.asset!;
  const file = files.find((e) => e.sha === a.sha256);
  if (!file) asset.push(`the asset ${a.sha256} is not in the evidence store by that hash`);
  if (a.redaction !== 'unknown') asset.push(`the asset's redaction is ${a.redaction}, not unknown`);
  if (a.origin !== 'deepbuild') asset.push(`the asset's origin is ${a.origin}, not deepbuild (a capture DeepBuild made)`);
  if (!recordLines(dir.state).some((r) => r.text.includes(a.sha256))) asset.push(`no record row names the asset ${a.sha256} by its hash`);
  if (file) for (const p of holdProblems(framesOf(file.bytes, 'the recording'), B, feeds.b, DOWN, UP)) asset.push(`the recording: ${p}`);
  return { held, asset };
}

describe('AC4 no record row, event or log line holds a frame; one asset arrives by hash, redaction unknown', () => {
  it('AC4 after a 3 s capture of B and its release, no line of the record, no other file in the state folder and no log line holds a frame of either display', () => {
    expect(full().held, 'no frame in the record, the state folder or the log').toEqual([]);
    // Wrong program: a capture that appends each frame to the record as it arrives.
    const twin = full('frames_to_record').held;
    expect(twin.some((m) => /^record\.jsonl line \d+ \(log_pos .+, kind .+\) holds a frame/.test(m)), `the planted frames_to_record fails, naming the row: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);

  it('AC4 1 s after the release one asset is in the evidence store by its hash, labelled redaction unknown and origin deepbuild, named by the record, holding every frame of the hold from B', () => {
    expect(full().asset, 'one asset by hash, redaction unknown').toEqual([]);
    // Wrong program: a capture saved with its redaction labelled complete.
    const twin = full('labels_redaction_complete').asset;
    expect(twin, `the planted labels_redaction_complete fails, naming the label: ${JSON.stringify(twin)}`).toContain('the asset\'s redaction is complete, not unknown');
  }, 900_000);
});

describe('AC4 a crash mid-hold leaves no asset', () => {
  /** A hold of B killed 1.5 s in, then a restart on the same evidence store and state folder. */
  function crash(planted?: Planted): string[] {
    const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
    const dir = dirs();
    const world = { ...dir, feeds, ...(planted ? { planted } : {}) };
    const killAt = DOWN + 1500 * MS;
    const killed = runRaw(show(), scenario({ ...world, fault: { kill_at: killAt } }, [...HOLD, at('captures', UP + SEC)]));
    const f: string[] = [];
    if (killed.status === 0 && killed.signal === null) f.push('the run was not killed mid-hold: it exited 0');
    if (killed.stdout.trim() !== '') f.push(`the killed run answered: ${killed.stdout.slice(0, 300)}`);
    for (const m of framesHeld(dir.state, killed.stderr, [feeds.a, feeds.b])) f.push(`mid-hold, ${m}`);
    for (const e of storeFiles(dir.evidence)) f.push(`the crash left an asset in the evidence store: ${e.path}`);
    // Restarted: the capture the crash cut short has no asset, and nothing in the store holds a frame of it.
    const { replies, stderr } = runShow(show(), scenario(world, [at('captures', 10 * SEC)]), `the restart${planted ? ` (planted ${planted})` : ''}`);
    for (const c of capturesOf(replies[0], 'captures after the restart')) {
      if (c.asset !== null) f.push(`after the restart the capture ${c.capture} has an asset ${c.asset.sha256}`);
      if (c.state === 'saved') f.push(`after the restart the capture ${c.capture} reads saved`);
    }
    for (const e of storeFiles(dir.evidence)) f.push(`after the restart the evidence store holds an asset: ${e.path}`);
    for (const rel of filesUnder(dir.evidence)) {
      const text = readFileSync(join(dir.evidence, rel)).toString('latin1');
      if (frameIn(text, feeds.b) || frameIn(text, feeds.a)) f.push(`after the restart the evidence folder's ${rel} holds a frame of the cut hold`);
    }
    for (const m of framesHeld(dir.state, stderr, [feeds.a, feeds.b])) f.push(`after the restart, ${m}`);
    return f;
  }

  it('AC4 a hold of B killed 1.5 s in leaves no asset and no frame in the record or the evidence store, and after a restart the capture has no asset', () => {
    expect(crash(), 'a crash mid-hold leaves nothing').toEqual([]);
    // Wrong programs: one that stores the frames so far as an asset as they arrive, and one that appends each frame to
    // the record as it arrives.
    const kept = crash('keeps_asset_after_crash');
    expect(kept.some((m) => m.startsWith('the crash left an asset in the evidence store: ')), `the planted keeps_asset_after_crash fails, naming the file: ${JSON.stringify(kept.slice(0, 3))}`).toBe(true);
    const logged = crash('frames_to_record');
    expect(logged.some((m) => /^mid-hold, record\.jsonl line \d+ \(log_pos .+, kind .+\) holds a frame/.test(m)), `the planted frames_to_record fails mid-hold, naming the row: ${JSON.stringify(logged.slice(0, 3))}`).toBe(true);
  }, 900_000);
});

describe('AC4 a Send that attaches the capture waits for your approval', () => {
  const listeners: Listener[] = [];
  afterEach(() => { for (const l of listeners.splice(0)) l.stop(); });

  async function send(planted?: Planted): Promise<string[]> {
    const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
    const dir = dirs();
    const listener = new Listener(join(dir.state, 'requests.log'));
    listeners.push(listener);
    const port = await listener.start();
    const to = `http://127.0.0.1:${port}/bugs`;
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const what = `a send of the capture${planted ? ` (planted ${planted})` : ''}`;
    const f: string[] = [];
    const [caps] = d.step([...HOLD, at('captures', UP + SEC)], `${what}: the capture`).slice(-1);
    const a = capturesOf(caps, 'captures').find((c) => c.asset !== null)?.asset;
    if (!a) return ['no capture saved an asset to send'];
    const bytes = storeFiles(dir.evidence).find((e) => e.sha === a.sha256)?.bytes;
    // Alpha's agent sends the bug to a tracker, attaching the capture by hash; you haven't answered.
    listener.clear();
    const [sent] = d.step([at('send', UP + 2 * SEC, { session: ALPHA.id, to, files: [a.sha256] })], `${what}: the send`);
    const s = sendOf(sent, 'the send');
    if (s.state !== 'waiting') f.push(`the send of ${a.sha256} is ${s.state} before your approval, not waiting`);
    for (const r of listener.requests()) f.push(`the send delivered ${r.sha === a.sha256 ? a.sha256 : `a body hashing ${r.sha}`} to ${r.path} before your approval`);
    // Your approval: then the capture goes, once, by its bytes.
    listener.clear();
    const [approved] = d.step([at('approve', UP + 10 * SEC, { send: s.id })], `${what}: your approval`);
    const after = sendOf(approved, 'the approved send');
    if (after.state !== 'sent') f.push(`after your approval the send is ${after.state}, not sent`);
    const got = listener.requests();
    if (got.length !== 1) f.push(`after your approval the destination got ${got.length} requests, not one`);
    for (const r of got) {
      if (r.method !== 'POST' || r.path !== '/bugs') f.push(`the delivery was ${r.method} ${r.path}, not POST /bugs`);
      if (r.sha !== a.sha256 || r.length !== bytes?.length) f.push(`the delivered body hashes ${r.sha} (${r.length} bytes), not the capture ${a.sha256}`);
    }
    return f;
  }

  it('AC4 alpha\'s send of the capture to a tracker waits, delivering nothing, until your approval, and then delivers the capture\'s bytes once', async () => {
    expect(await send(), 'the send waits for your approval').toEqual([]);
    // Wrong program: a send that delivers its attachments without asking.
    const twin = await send('sends_without_approval');
    expect(twin.some((m) => /^the send delivered [0-9a-f]{64} to \/bugs before your approval/.test(m)), `the planted sends_without_approval fails, naming the hash: ${JSON.stringify(twin)}`).toBe(true);
  }, 900_000);
});
