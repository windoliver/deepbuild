// #1003 AC5: the screenshots the check run takes and the one taste call on them. No judge here reads a picture's
// pixels: a screen is checked for being the replica's at the reference window, and whether it looks right is the
// person's recorded call (README: The screenshots and the taste call). replica.test.mjs runs these on the replica's
// output; wrong.test.mjs on made-up records.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** The shots: [appearance, view, the replica's extra arguments]. */
export const SHOTS = [
  ['light', 'sidebar', ['--selected-row', '0', '--focused-row', '1']],
  ['dark', 'sidebar', ['--selected-row', '0', '--focused-row', '1']],
  ['light', 'terminal-colors', []],
  ['dark', 'terminal-colors', []],
];
/** Where the taste call is recorded, from the repo root. */
export const RECORD = 'docs/evidence/1003/taste.json';
/** The reference window in points and its scale (crates/deep-replica/src/lib.rs, WINDOW and SCALE). */
export const WINDOW = [1512, 982];
export const SCALE = 2;

export const shotKey = (appearance, view) => `${appearance}/${view}.png`;
export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** A PNG's width and height from its IHDR, or null. */
export function pngSize(path) {
  if (!existsSync(path)) return null;
  const b = readFileSync(path);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** A shot's facts that need no eye: the replica's screen and snapshot at the reference window. One line per miss. */
export function judgeShot(key, { size, snapshot }) {
  const failures = [];
  const want = WINDOW.map((v) => v * SCALE);
  if (!size) failures.push(`${key}: no PNG`);
  else if (size[0] !== want[0] || size[1] !== want[1]) failures.push(`${key}: ${size.join('x')} px, not the reference window's ${want.join('x')}`);
  const win = snapshot?.window;
  if (!win || win.size?.[0] !== WINDOW[0] || win.size?.[1] !== WINDOW[1] || win.scale !== SCALE) failures.push(`${key}: the snapshot's window is ${JSON.stringify(win)}, not ${JSON.stringify({ size: WINDOW, scale: SCALE })}`);
  return failures;
}

/**
 * The taste call against the shots just taken (`hashes`: shot key → SHA-256). `record` is the parsed record, or null when
 * there is none. Answers `{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', why }`: PASS only for a call of "right" on exactly
 * these pictures; FAIL for "wrong"; INCONCLUSIVE when there is no call, it is incomplete, or it judged other pictures.
 */
export function judgeTaste(record, hashes) {
  if (record == null) return { verdict: 'INCONCLUSIVE', why: `no taste call is recorded at ${RECORD}` };
  if (typeof record !== 'object' || record.error) return { verdict: 'INCONCLUSIVE', why: `${RECORD} isn't a taste call: ${JSON.stringify(record).slice(0, 200)}` };
  const missing = ['verdict', 'by', 'at', 'screens'].filter((k) => record[k] === undefined || record[k] === '');
  if (missing.length) return { verdict: 'INCONCLUSIVE', why: `${RECORD} has no ${missing.join(', ')}` };
  if (!['right', 'wrong'].includes(record.verdict)) return { verdict: 'INCONCLUSIVE', why: `${RECORD}'s verdict is ${JSON.stringify(record.verdict)}, not "right" or "wrong"` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.at))) return { verdict: 'INCONCLUSIVE', why: `${RECORD}'s date ${JSON.stringify(record.at)} isn't YYYY-MM-DD` };
  const off = Object.entries(hashes).filter(([key, h]) => record.screens?.[key] !== h).map(([key]) => key);
  if (off.length) return { verdict: 'INCONCLUSIVE', why: `the taste call in ${RECORD} judged other pictures than this run's ${off.join(', ')}` };
  if (record.verdict === 'wrong') return { verdict: 'FAIL', why: `the taste call (${record.by}, ${record.at}) says the screens look wrong` };
  return { verdict: 'PASS', why: `the taste call (${record.by}, ${record.at}) says these screens look right` };
}

/** The record at `path`, parsed; null when there is no file; `{error}` when it isn't JSON. */
export function readRecord(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: e.message };
  }
}
