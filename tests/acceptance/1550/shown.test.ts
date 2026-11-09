// Criterion 5 of #1550: a question card in Arabic and one in Chinese at a narrow width, taken by the check run from
// the replica, then one taste call on them, recorded in TASTE.json (README.md: The taste call). The run checks the
// pictures' form (PNGs of the narrow window, a card up when each was taken), never what they show: no criterion reads a
// picture to judge it. No call, or one on other pictures, is INCONCLUSIVE, never PASS; `looks_wrong` fails.
//
// The replica, its driver and its process handling are #124's, imported (deep-drive, built once; stopped by PID).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Drive, cleanup, decodePng, launch, must, nodesOf, requireMacos, sha256 } from '../124/helpers.ts';
import { AC, FIXTURES, REPO } from './helpers.ts';

afterEach(cleanup, 60_000);

const TASTE = join(REPO, 'tests', 'acceptance', '1550', 'TASTE.json');
const SHOTS = process.env['DD1550_SHOTS'] ?? join(REPO, 'target', 'acceptance', '1550');
/** The narrow window, in points: the card's own 480 and a margin, against the reference window's 1512. */
const NARROW = [560, 760] as const;
const SCALE = 2;
const CARDS = {
  'card-arabic.png': join(FIXTURES, 'card-arabic.events.jsonl'),
  'card-chinese.png': join(FIXTURES, 'card-chinese.events.jsonl'),
} as const;
type Name = keyof typeof CARDS;

/** The ask's question and its last option's label (the first, recommended, gets a suffix on the card). */
function askOf(fixture: string): { question: string; option: string } {
  const created = readFileSync(fixture, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).event).find((e) => e.kind === 'ask.created');
  return { question: created.data.question, option: created.data.options.at(-1).label };
}

/** The replica launched on the fixture at the narrow width, its ask's row clicked, and the window taken with the card up. */
async function card(fixture: string): Promise<Buffer> {
  const { question, option } = askOf(fixture);
  const drive = await Drive.start();
  try {
    const replica = await launch(drive, { from: 'fixture', fixture, clock: 'virtual', size: [...NARROW], scale: SCALE });
    const seen = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
    const row = nodesOf(seen.snapshot).find((n) => n.role === 'button' && n.name?.includes(question));
    expect(row, `Needs you shows the ask's row, a button named by its question: ${JSON.stringify(nodesOf(seen.snapshot).map((n) => [n.role, n.name])).slice(0, 1500)}`).toBeDefined();
    await must(drive, { call: 'act', replica, locator: { role: row!.role, name: row!.name }, act: { kind: 'click' } });
    await must(drive, { call: 'wait_for', replica, locator: { role: 'button', name: option }, wait_for: { state: 'visible' } });
    const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
    return readFileSync(shot.path as string);
  } finally {
    await drive.stop();
  }
}

interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string; when?: string; files?: Record<string, string>; note?: string }
/** PASS only for `looks_right`, by someone, at a time, on exactly this run's pictures; `looks_wrong` FAIL; else INCONCLUSIVE. */
function tasteOutcome(call: Taste | null, hashes: Record<string, string>): { outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; why: string } {
  if (!call?.verdict) return { outcome: 'INCONCLUSIVE', why: 'no taste call is recorded for these pictures (no TASTE.json, or one with no verdict)' };
  if (call.issue !== 1550 || call.criterion !== AC.shown) return { outcome: 'INCONCLUSIVE', why: `the recorded call is on ${String(call.issue)} ${String(call.criterion)}, not 1550 ${AC.shown}` };
  if (!call.who?.trim() || !call.when || Number.isNaN(Date.parse(call.when))) return { outcome: 'INCONCLUSIVE', why: 'the taste call names no one or no time' };
  const sorted = (o: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
  if (sorted(call.files ?? {}) !== sorted(hashes)) return { outcome: 'INCONCLUSIVE', why: `the recorded call was made on other pictures than this run's: ${sorted(call.files ?? {})}` };
  if (call.verdict === 'looks_right') return { outcome: 'PASS', why: `${call.who} at ${call.when}` };
  if (call.verdict === 'looks_wrong') return { outcome: 'FAIL', why: `the taste call says they don't look right: ${call.note ?? ''}` };
  return { outcome: 'INCONCLUSIVE', why: `the taste call's verdict is ${String(call.verdict)}` };
}

it('#1550.54f5f264 (C5) the check run takes a question card in Arabic and one in Chinese at a narrow width, and reads INCONCLUSIVE unless a recorded taste call on exactly these pictures says they look right', async () => {
  requireMacos();
  const files = {} as Record<Name, Buffer>;
  for (const [name, fixture] of Object.entries(CARDS) as [Name, string][]) files[name] = await card(fixture);
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); }
  console.log(`${AC.shown}: pictures from this run in ${SHOTS}:\n${Object.entries(hashes).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);

  // Their form only: each is a PNG of the narrow window at the launch's scale.
  for (const [name, bytes] of Object.entries(files)) {
    const image = decodePng(bytes);
    expect([image.width, image.height], `${name} is the narrow window`).toEqual([NARROW[0] * SCALE, NARROW[1] * SCALE]);
  }

  const call = existsSync(TASTE) ? JSON.parse(readFileSync(TASTE, 'utf8')) as Taste : null;
  const { outcome, why } = tasteOutcome(call, hashes);
  if (outcome === 'INCONCLUSIVE') expect.fail(`INCONCLUSIVE: ${AC.shown}: ${why}; this is not a pass`);
  expect(outcome, why).toBe('PASS');
}, 30 * 60_000);
