// Criterion 8: Shown to you: screenshots of the fixture panel driven to Save with its highlights in the strip, the masked
// recording mid-scroll, the scrim refusal and a dark launch, taken by the check run from the replica at the reference
// window, with a recording of the masked scroll, are attached to the PR and shown to you in the session. Whether they
// look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads
// a picture to judge it.
//
// The run takes every picture from the real replica and writes them to $DD124_SHOTS, or target/acceptance/124 (README:
// The taste call). The virtual clock makes them repeat (criterion 3), so a call on these hashes stays good until the
// pictures change. It checks their form (PNGs, the reference window, the strip outside the frame, the recording an
// animated PNG), never what they show. Then it reads TASTE.json in this folder: no call, or one on other pictures, is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these files passes. "Attached to the PR and shown to you"
// is the implementing agent's; no test can see it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Drive, PANEL, REPO, cleanup, decodePng, must, nodesOf, requireMacos, sha256, type Box, type Obj } from './helpers.ts';
import { AC, REFERENCE, REFERENCE_SCALE, SCRIM_PANEL } from './ui-helpers.ts';

afterEach(cleanup, 60_000);

const TASTE = join(REPO, 'tests', 'acceptance', '124', 'TASTE.json');
const SHOTS = process.env.DD124_SHOTS ?? join(REPO, 'target', 'acceptance', '124');
const FRAME = [REFERENCE[0] * REFERENCE_SCALE, REFERENCE[1] * REFERENCE_SCALE];
const EMAIL = { label: 'Email' };
const SAVE = { role: 'button', name: 'Save' };
const NAMES = ['saved-highlights.png', 'masked-mid-scroll.png', 'scrim-refusal.png', 'dark-launch.png', 'masked-scroll.apng'] as const;
type Name = (typeof NAMES)[number];

const boundsOf = async (drive: Drive, replica: string, locator: Obj): Promise<Box> => {
  const seen = await must(drive, { call: 'see', replica, see: { scope: 'locator', include: ['roles', 'names', 'bounds'] }, locator });
  return seen.snapshot.tree.bounds as Box;
};

async function atReference(drive: Drive, launchArgs: Obj): Promise<string> {
  const { reply } = await drive.call({ call: 'launch', launch: { from: 'fixture', clock: 'virtual', ...launchArgs } });
  expect(reply.window, `launched at the reference window: ${JSON.stringify(reply).slice(0, 300)}`).toEqual({ size: REFERENCE, scale: REFERENCE_SCALE });
  return reply.replica as string;
}

/** The fixture panel driven to Save, with Save and the field highlighted in the strip. */
async function saved(): Promise<Buffer> {
  const drive = await Drive.start();
  const replica = await atReference(drive, { panel: PANEL.form });
  await must(drive, { call: 'act', replica, locator: EMAIL, act: { kind: 'click' } });
  await must(drive, { call: 'act', replica, locator: EMAIL, act: { kind: 'type', text: 'ada@example.com' } });
  await must(drive, { call: 'act', replica, locator: SAVE, act: { kind: 'click' } });
  await must(drive, { call: 'wait_for', replica, locator: { text: 'Saved ada@example.com' }, wait_for: { state: 'visible' } });
  const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window', highlight: [SAVE, EMAIL] } });
  await drive.stop();
  return readFileSync(shot.path as string);
}

/** The masked recording: one frame from mid-scroll, and the recording itself. */
async function masked(): Promise<{ frame: Buffer; video: Buffer }> {
  const drive = await Drive.start();
  const replica = await atReference(drive, { panel: PANEL.form });
  const start = await boundsOf(drive, replica, EMAIL);
  await must(drive, { call: 'record', replica, record: { action: 'start', fps: 30, marks: 'per_action', mask: [EMAIL], mask_kind: 'fill' } });
  await must(drive, { call: 'act', replica, locator: { text: 'Email' }, act: { kind: 'scroll', dx: 0, dy: 200 } });
  await must(drive, { call: 'wait_for', replica, wait_for: { state: 'settled' } });
  const stop = await must(drive, { call: 'record', replica, record: { action: 'stop' } });
  const end = await boundsOf(drive, replica, EMAIL);
  await drive.stop();
  const mid = (stop.frames as Obj[]).filter((f) => f.masks?.[0]?.[1] < start[1] && f.masks?.[0]?.[1] > end[1]);
  expect(mid.length, `the recording holds a frame mid-scroll, between y ${end[1]} and y ${start[1]}`).toBeGreaterThan(0);
  return { frame: readFileSync(mid[Math.floor(mid.length / 2)]!.path as string), video: readFileSync(stop.path as string) };
}

/** The click on Save refused under the scrim, with Save highlighted in the strip. */
async function refusal(): Promise<Buffer> {
  const drive = await Drive.start();
  const replica = await atReference(drive, { panel: SCRIM_PANEL });
  const { reply } = await drive.call({ call: 'act', replica, locator: SAVE, act: { kind: 'click' }, timeout: 1000 });
  expect([reply.ok, reply.error?.covered_by?.name], `the picture is of a refusal: ${JSON.stringify(reply).slice(0, 300)}`).toEqual([false, 'Scrim']);
  const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window', highlight: [SAVE] } });
  await drive.stop();
  return readFileSync(shot.path as string);
}

async function dark(): Promise<Buffer> {
  const drive = await Drive.start();
  const replica = await atReference(drive, { panel: PANEL.form, theme: 'dark' });
  const seen = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
  expect(nodesOf(seen.snapshot).length, 'the dark launch draws the panel').toBeGreaterThan(1);
  const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
  await drive.stop();
  return readFileSync(shot.path as string);
}

const size = (png: Buffer): [number, number] => { const i = decodePng(png); return [i.width, i.height]; };
const chunks = (png: Buffer): string[] => {
  const found: string[] = [];
  for (let at = 8; at + 8 <= png.length; at += 12 + png.readUInt32BE(at)) found.push(png.toString('latin1', at + 4, at + 8));
  return found;
};

interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string; when?: string; files?: Record<string, string>; note?: string }
/** What a recorded call does to the run: PASS only for `looks_right`, by someone, at a time, on exactly these files. */
function tasteOutcome(call: Taste | null, hashes: Record<string, string>): { outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; why: string } {
  if (call === null || call.verdict === null || call.verdict === undefined) return { outcome: 'INCONCLUSIVE', why: 'no taste call is recorded for these pictures (no TASTE.json, or one with no verdict)' };
  if (call.issue !== 124 || call.criterion !== AC.shown) return { outcome: 'INCONCLUSIVE', why: `the recorded call is on ${String(call.issue)} ${String(call.criterion)}, not 124 ${AC.shown}` };
  if (!call.who?.trim() || !call.when || Number.isNaN(Date.parse(call.when))) return { outcome: 'INCONCLUSIVE', why: 'the taste call names no one or no time' };
  const sorted = (o: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
  if (sorted(call.files ?? {}) !== sorted(hashes)) return { outcome: 'INCONCLUSIVE', why: `the recorded call was made on other pictures than this run's: ${sorted(call.files ?? {})}` };
  if (call.verdict === 'looks_right') return { outcome: 'PASS', why: `${call.who} at ${call.when}` };
  if (call.verdict === 'looks_wrong') return { outcome: 'FAIL', why: `the taste call says they don't look right: ${call.note ?? ''}` };
  return { outcome: 'INCONCLUSIVE', why: `the taste call's verdict is ${String(call.verdict)}` };
}

describe(`${AC.shown} the pictures and the recording, and the one taste call on them`, () => {
  it(`${AC.shown} the check run takes the screenshots and the recording from the replica at the reference window, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    requireMacos();
    const { frame, video } = await masked();
    const files: Record<Name, Buffer> = { 'saved-highlights.png': await saved(), 'masked-mid-scroll.png': frame, 'scrim-refusal.png': await refusal(), 'dark-launch.png': await dark(), 'masked-scroll.apng': video };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const name of NAMES) { writeFileSync(join(SHOTS, name), files[name]); hashes[name] = sha256(files[name]); }
    console.log(`${AC.shown}: pictures from this run in ${SHOTS}:\n${Object.entries(hashes).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);

    // Their form, not what they show. A highlight goes in a strip outside the frame, so those pictures are wider and taller.
    for (const name of ['saved-highlights.png', 'scrim-refusal.png'] as const) {
      const [w, h] = size(files[name]);
      expect(w > FRAME[0]! && h > FRAME[1]!, `${name} (${w} x ${h}) holds the reference window's frame and its strip`).toBe(true);
    }
    for (const name of ['masked-mid-scroll.png', 'dark-launch.png'] as const) expect(size(files[name]), `${name} is the reference window`).toEqual(FRAME);
    expect(chunks(video), 'the recording is an animated PNG').toEqual(expect.arrayContaining(['acTL', 'fcTL', 'fdAT']));

    const call = existsSync(TASTE) ? JSON.parse(readFileSync(TASTE, 'utf8')) as Taste : null;
    const { outcome, why } = tasteOutcome(call, hashes);
    if (outcome === 'INCONCLUSIVE') expect.fail(`INCONCLUSIVE: ${AC.shown}: ${why}; this is not a pass`);
    expect(outcome, why).toBe('PASS');
  }, 900_000);

  it('the taste call\'s rule: nothing recorded, or a call on other files, is INCONCLUSIVE; looks_wrong fails; only looks_right on exactly these files passes', () => {
    const files = { 'a.png': 'aa', 'b.apng': 'bb' };
    const call: Taste = { issue: 124, criterion: AC.shown, verdict: 'looks_right', who: 'the owner', when: '2026-11-06T12:00:00Z', files };
    expect(tasteOutcome(call, files).outcome).toBe('PASS');
    expect(tasteOutcome(null, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, verdict: null }, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, files: { ...files, 'a.png': 'other' } }, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, files: { 'a.png': 'aa' } }, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, who: '' }, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, criterion: '#124.00000000' }, files).outcome).toBe('INCONCLUSIVE');
    expect(tasteOutcome({ ...call, verdict: 'looks_wrong', note: 'the strip merges' }, files).outcome).toBe('FAIL');
  });
});
