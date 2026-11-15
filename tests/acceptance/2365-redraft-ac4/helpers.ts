// Test-side tools for #2365 AC4, blind redraft: a Claude Code transcript archived once, whose first megabyte is then
// rewritten (and which then gains 20 lines), passed again; what the record and the evidence store hold after that pass;
// and the criterion's check, which names the first line where the archived transcript and the file differ.
//
// Nothing here stands in for the archive: the real one is reached only through `openArchive` (#20's `openArchiveOn`),
// the wrong program is in wrong.ts. What the archive left is read only through public surfaces that exist at the base
// and that the issue says must work across parts: the record's `transcript(session)` and `resolve(handle)`, the events
// in the record, and the evidence store's `get` and `read`. How a part is recorded is the implementer's (Scope), so no
// event shape beyond "an event the pass appended links the evidence" is assumed (README, Readings).
//
// Safety: every file is synthetic (generated words, no keys), under the /tmp/dh20-* folders #20's helpers make and
// remove; HOME is a temp folder; nothing reads the real ~/.claude; no network.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import type { Event, Message } from '../../../packages/record/src/index.ts';
import { allEvents, claudeFolder, claudeLine, handle, HOUR, letters, mulberry32, redacted, SECOND, sessionId, T0, type Said, type World } from '../20/helpers.ts';

// ---- The criterion and its ID: `#2365.<first 8 hex of the SHA-256 of its text>`, trimmed, whitespace collapsed.
export const CRITERION = "A transcript whose first megabyte was rewritten after its last copy is copied again from its start, and the session's handles resolve through the new parts. A planted archive that appends the rewritten file's tail to the old parts fails, naming the first line that differs";
export const AC4 = `#2365.${createHash('sha256').update(CRITERION.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

// ---- The transcript. Every line is one message with text, so line n is message m<n> (its `uuid`), and the record's
// reading of the archived transcript lists the messages in line order, one per line.
export const MIB = 1_048_576;
/** Lines when first archived: about 2.2 MB, so the first megabyte is under half of it. */
export const LINES = 480;
/** Lines the session gains after the rewrite, so the rewritten file is longer than its last copy and has a tail. */
export const GAINED = 20;
export const TOTAL = LINES + GAINED;
/** Characters of each message's text: the same in both versions of a line, so a rewritten line keeps its length. */
const TEXT = 4000;
const CWD = '/tmp/dh2365-work/shop';
const WORDS = ['checkout', 'basket', 'shipping', 'invoice', 'coupon', 'refund', 'catalog', 'search', 'filter', 'banner', 'footer', 'header', 'button', 'layout', 'render', 'widget', 'pricing', 'address', 'order', 'cart', 'summary', 'review', 'rating', 'stock', 'variant', 'colour', 'image', 'gallery', 'quantity', 'delivery'];

export type Version = 'draft' | 'final';
/**
 * Message n in a version: user and assistant turns alternating, its text `message <n>: <version> notes …` followed by
 * seeded words, cut to TEXT characters. The two versions differ from their sixth word on and have the same length.
 */
export function said(n: number, version: Version): Said {
  const rng = mulberry32((version === 'draft' ? 1 : 2) * 100_000 + n);
  let text = `message ${n}: ${version} notes on the shop's checkout page,`;
  while (text.length < TEXT) text += ` ${WORDS[Math.floor(rng() * WORDS.length)]}`;
  return { uuid: `m${n}`, role: n % 2 === 1 ? 'user' : 'assistant', text: text.slice(0, TEXT) };
}
export interface Session { id: string; path: string }
/** Line n of a session's transcript in a version, as Claude Code writes it; its time and parent don't depend on the version. */
const lineOf = (s: Session, n: number, version: Version): string =>
  claudeLine(s.id, CWD, said(n, version), T0 + n * SECOND, n > 1 ? `m${n - 1}` : null);
const linesOf = (s: Session, from: number, to: number, version: (n: number) => Version): string =>
  Array.from({ length: to - from + 1 }, (_, k) => `${lineOf(s, from + k, version(from + k))}\n`).join('');

/** The version of line n after the rewrite: final for the rewritten lines and the lines gained, draft for the rest. */
export const versionAfter = (rewritten: readonly number[]) => (n: number): Version => (n > LINES || rewritten.includes(n) ? 'final' : 'draft');

/** Writes a new session's transcript, m1…m480, every line its draft, where Claude Code keeps it. */
function startSession(w: World): Session {
  const id = sessionId();
  const s = { id, path: join(claudeFolder(w.env, CWD), `${id}.jsonl`) };
  mkdirSync(dirname(s.path), { recursive: true });
  writeFileSync(s.path, linesOf(s, 1, LINES, () => 'draft'));
  return s;
}
/**
 * Rewrites the first megabyte of the transcript in place: every line from m3 on that starts within the first MiB is
 * written again as its final version, of the same length. Lines 1 and 2 stay, so the first line that differs is line 3.
 * Then the session gains m481…m500. Returns the rewritten lines' numbers and the file's bytes before and after.
 */
function rewriteFirstMegabyte(s: Session): { rewritten: number[]; before: Buffer; after: Buffer } {
  const before = readFileSync(s.path);
  const rewritten: number[] = [];
  let at = 0;
  for (let n = 1; n <= LINES; n++) {
    if (n >= 3 && at < MIB) rewritten.push(n);
    at += Buffer.byteLength(lineOf(s, n, 'draft')) + 1;
  }
  writeFileSync(s.path, linesOf(s, 1, LINES, versionAfter(rewritten)));
  appendFileSync(s.path, linesOf(s, LINES + 1, TOTAL, () => 'final'));
  return { rewritten, before, after: readFileSync(s.path) };
}

/** Each message of the transcript as the file holds it, in line order: `m<n>` and its text. */
export const messagesOf = (count: number, version: (n: number) => Version): { id: string; text: string }[] =>
  Array.from({ length: count }, (_, k) => ({ id: `m${k + 1}`, text: said(k + 1, version(k + 1)).text }));

// ---- The scenario.
export interface Archiver { pass(): Promise<void> }
/** A message handle the test resolves after the rewrite, and the text the record gave for it. */
export interface Probe { n: number; handle: string; text: string | undefined }
export interface Rewritten {
  s: Session;
  rewritten: number[];
  /** The rewritten file, scrubbed as the store's ingestion scrubs it: what its copy must hold. */
  scrubbed: Buffer;
  /** The record's reading of the session's archived transcript after the first pass, and after the one following the rewrite. */
  firstReading: Message[] | undefined;
  reading: Message[] | undefined;
  /** What the pass after the rewrite threw, if it did. */
  passError: unknown;
  probes: Probe[];
  /** The evidence the pass after the rewrite linked from the events it appended, in log order, with its bytes. */
  linked: { sha: string; bytes: Buffer }[];
}

const SHA = /^[0-9a-f]{64}$/;
/** Every SHA-256 an event names, in order, once each: its `evidence` list first, then its data, depth first. */
function shasOf(e: Event): string[] {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (SHA.test(v) && !found.includes(v)) found.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  const { evidence, data } = e as unknown as { evidence?: unknown; data?: unknown };
  walk(evidence);
  walk(data);
  return found;
}

/**
 * Archives a 480-line session, rewrites its first megabyte an hour later and has it gain 20 lines, then passes again
 * an hour after that, and reads what the record and the store hold for it.
 */
export async function rewriteAfterCopy(w: World, archive: Archiver): Promise<Rewritten> {
  const s = startSession(w);
  await archive.pass();
  const firstReading = await w.record.transcript(letters(s.id));

  w.clock.tick(HOUR);
  const { rewritten, before, after } = rewriteFirstMegabyte(s);
  // The fixture, as this test means it (else the test proves nothing and is BLOCKED, not passed).
  const last = rewritten[rewritten.length - 1]!;
  const startOf = (n: number) => Buffer.byteLength(linesOf(s, 1, n - 1, () => 'draft'));
  expect(rewritten[0], 'BLOCKED: the rewrite starts at line 3').toBe(3);
  expect(startOf(last) < MIB && startOf(last + 1) >= MIB, 'BLOCKED: the rewritten lines are those that start in the first megabyte').toBe(true);
  expect(after.length, 'BLOCKED: the rewrite keeps every line\'s length, and the file then gains 20 lines').toBe(before.length + Buffer.byteLength(linesOf(s, LINES + 1, TOTAL, () => 'final')));
  expect(after.subarray(0, startOf(3)).equals(before.subarray(0, startOf(3))) && !after.subarray(0, MIB).equals(before.subarray(0, MIB)), 'BLOCKED: lines 1 and 2 are unchanged and the first megabyte is not').toBe(true);
  expect(after.subarray(startOf(last + 1), before.length).equals(before.subarray(startOf(last + 1))), 'BLOCKED: past the rewritten lines, the file\'s old bytes are unchanged').toBe(true);
  const text = after.toString('utf8');
  expect(redacted(text) === text, 'BLOCKED: the synthetic transcript holds nothing the scrub changes, so its copy is its own bytes').toBe(true);

  const [row] = (await w.record.raw('SELECT coalesce(max(log_pos), 0) AS pos FROM events')) as { pos: number | bigint }[];
  const mark = Number(row?.pos ?? 0);
  w.clock.tick(HOUR);
  let passError: unknown;
  try { await archive.pass(); } catch (error) { passError = error; }

  const linked: Rewritten['linked'] = [];
  for (const e of (await allEvents(w.record)).filter((e) => e.log_pos > mark)) {
    for (const sha of shasOf(e)) if (await w.store.get(sha)) linked.push({ sha, bytes: Buffer.from(await w.store.read(sha)) });
  }
  const reading = await w.record.transcript(letters(s.id));
  // A rewritten line, the last rewritten line, the first line past the rewrite, the old last line, the new last line.
  const probes: Probe[] = [];
  for (const n of [3, last, last + 1, LINES, TOTAL]) {
    const h = `${handle(s.id)}#m${n}`;
    probes.push({ n, handle: h, text: (await w.record.resolve(h))?.text });
  }
  return { s, rewritten, scrubbed: Buffer.from(redacted(text), 'utf8'), firstReading, reading, passError, probes, linked };
}

// ---- The criterion's check.
const clip = (t: string) => JSON.stringify(t.length > 60 ? `${t.slice(0, 60)}…` : t);
/**
 * The first line where the archived transcript, as the record reads it, differs from the file, named by its number
 * and its handle; undefined when every line matches and there are no more and no fewer.
 */
export function firstDifference(reading: readonly Message[] | undefined, file: readonly { id: string; text: string }[], session: string): string | undefined {
  if (!reading) return `line 1 (${session}#m1): the record reads no archived transcript for ${session}`;
  for (let i = 0; i < Math.max(reading.length, file.length); i++) {
    const got = reading[i];
    const want = file[i];
    if (got?.id === want?.id && got?.text === want?.text) continue;
    const at = `line ${i + 1} (${session}#${want?.id ?? got?.id})`;
    if (!got) return `${at} differs: the archived transcript ends after line ${i}, the file holds ${clip(want!.text)}`;
    if (!want) return `${at} differs: the archived transcript holds ${clip(got.text)} past the file's last line`;
    return `${at} differs: the archived transcript holds ${got.id} ${clip(got.text)}, the file holds ${clip(want.text)}`;
  }
  return undefined;
}
/** How many bytes from the start of `target` the pieces, matched in order, cover: a piece that isn't next is passed over. */
function covered(pieces: readonly { bytes: Buffer }[], target: Buffer): number {
  let at = 0;
  for (const { bytes } of pieces) {
    if (bytes.length && at + bytes.length <= target.length && target.subarray(at, at + bytes.length).equals(bytes)) at += bytes.length;
  }
  return at;
}
const lineAt = (buf: Buffer, at: number) => buf.subarray(0, at).toString('utf8').split('\n').length;

/**
 * AC4 on what a run left: the pass after the rewrite completed; the archived transcript reads as the rewritten file,
 * line for line (else it fails naming the first line that differs); each probed handle resolves to the rewritten
 * file's message; and the evidence that pass linked holds the rewritten file from its first byte to its last.
 */
export function copiedAgainFromStart(r: Rewritten): void {
  const session = handle(r.s.id);
  expect(r.passError === undefined ? undefined : String((r.passError as Error)?.message ?? r.passError), `${session}: the pass after the rewrite completes`).toBeUndefined();
  expect(firstDifference(r.firstReading, messagesOf(LINES, () => 'draft'), session), `${session}: before the rewrite, the archived transcript reads as the file first written`).toBeUndefined();
  expect(firstDifference(r.reading, messagesOf(TOTAL, versionAfter(r.rewritten)), session), `${session}: after its first megabyte was rewritten, the archived transcript reads as the rewritten file, line for line`).toBeUndefined();
  for (const p of r.probes) {
    expect(p.text, `${p.handle} resolves through the new parts to message ${p.n} of the rewritten file (${versionAfter(r.rewritten)(p.n)})`).toBe(said(p.n, versionAfter(r.rewritten)(p.n)).text);
  }
  const upTo = covered(r.linked, r.scrubbed);
  expect(upTo === r.scrubbed.length ? undefined : `the evidence the pass linked, joined in order, matches the rewritten file from its start only up to line ${lineAt(r.scrubbed, upTo)} of ${TOTAL} (${r.linked.length} evidence files linked)`,
    `${session}: copied again from its start: the evidence the pass after the rewrite linked holds the rewritten file, scrubbed, from its first byte to its last`).toBeUndefined();
}
