// AC3: a test program that writes the device-attributes, cursor-position, mode, keyboard-flags and color queries in one
// write, then waits 2 s for answers, gets all five answers in that order within 50 ms, and a clipboard read query gets
// nothing; a planted emulator that drops them makes the program print "timeout" and fails, naming the first query.
// Proof: the base fails at the first query. The SCOPE test: the answers reach the program through the host's input ahead
// of any later key.
//
// A real Node program on a real PTY through `deep-show serve`. Before asking it clears the screen, puts its cursor at row
// 5, column 10, turns bracketed paste on and pushes keyboard flags 1, so each answer has one right value. Then ONE
// write holds, in order: DA1 `CSI c`; CPR `CSI 6 n`; DECRQM for bracketed paste `CSI ? 2004 $ p`; the keyboard flags
// query `CSI ? u`; the foreground and background color queries `OSC 10 ; ? BEL` and `OSC 11 ; ? BEL` (the issue's fifth
// kind, colors, is the pair: six answers); and last a clipboard read `OSC 52 ; c ; ? BEL`, which must get nothing. The
// program logs each chunk it reads with its time since that write, and prints "timeout" if any answer is missing after
// 2 s.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESC, fileText, grid, inconclusive, keyEvent, openFocused, readJsonLines, referenceMacProblem, script, setup, shown, tmp, useShow, waitFor, withServe,
  type JsonObject,
} from './helpers.ts';

const show = useShow();
const BEL = '\x07';
const PRE = `${ESC}[2J${ESC}[5;10H${ESC}[?2004h${ESC}[>1u`;
const COLOR = '([0-9a-fA-F]{2,4})/([0-9a-fA-F]{2,4})/([0-9a-fA-F]{2,4})';
/** The queries, in the order of the one write, each with the answer it must get (a regex source for what follows). */
const QUERIES: { name: string; query: string; answer: string; spec: string }[] = [
  { name: 'device attributes (DA1, CSI c)', query: `${ESC}[c`, answer: '\\x1b\\[\\?[0-9;]+c', spec: 'CSI ? Ps ; … c' },
  { name: 'cursor position (CPR, CSI 6 n)', query: `${ESC}[6n`, answer: '\\x1b\\[5;10R', spec: 'CSI 5 ; 10 R (row 5, column 10)' },
  { name: 'mode report (DECRQM ?2004, CSI ? 2004 $ p)', query: `${ESC}[?2004$p`, answer: '\\x1b\\[\\?2004;1\\$y', spec: 'CSI ? 2004 ; 1 $ y (set)' },
  { name: 'keyboard flags (CSI ? u)', query: `${ESC}[?u`, answer: '\\x1b\\[\\?1u', spec: 'CSI ? 1 u (flags 1 pushed)' },
  { name: 'foreground color (OSC 10 ; ?)', query: `${ESC}]10;?${BEL}`, answer: `\\x1b\\]10;rgb:${COLOR}(?:\\x07|\\x1b\\\\)`, spec: 'OSC 10 ; rgb:R/G/B, BEL or ST' },
  { name: 'background color (OSC 11 ; ?)', query: `${ESC}]11;?${BEL}`, answer: `\\x1b\\]11;rgb:${COLOR}(?:\\x07|\\x1b\\\\)`, spec: 'OSC 11 ; rgb:R/G/B, BEL or ST' },
];
const CLIPBOARD_READ = `${ESC}]52;c;?${BEL}`;
const ONE_WRITE = QUERIES.map((q) => q.query).join('') + CLIPBOARD_READ;

interface Chunk { ms: number; bytes: Buffer }
interface Played { chunks: Chunk[]; timeout: boolean; oneWrite: string; screen: string[]; fg: string; bg: string }

/** Matches what the program read against the answers in order: each answer's text and the ms by which it had arrived. */
function parse(chunks: Chunk[]): { got: { name: string; text: string; ms: number; rgb: string | null }[]; rest: string; firstMissing: string | null } {
  const all = Buffer.concat(chunks.map((c) => c.bytes)).toString('latin1');
  const ends: { end: number; ms: number }[] = [];
  let at = 0;
  for (const c of chunks) { at += c.bytes.length; ends.push({ end: at, ms: c.ms }); }
  let pos = 0;
  const got: { name: string; text: string; ms: number; rgb: string | null }[] = [];
  for (const q of QUERIES) {
    const m = new RegExp(`^${q.answer}`).exec(all.slice(pos));
    if (!m) return { got, rest: all.slice(pos), firstMissing: q.name };
    pos += m[0].length;
    const rgb = m[1] ? `#${[m[1], m[2]!, m[3]!].map((h) => h.slice(0, 2).toLowerCase()).join('')}` : null;
    got.push({ name: q.name, text: m[0], ms: ends.find((e) => e.end >= pos)!.ms, rgb });
  }
  return { got, rest: all.slice(pos), firstMissing: null };
}

async function play(bin: string, o: { planted?: string; filler?: number; key?: boolean } = {}): Promise<Played> {
  const dir = tmp('queries');
  const log = join(dir, 'in.log');
  return withServe(bin, setup(dir, o.planted), async (s) => {
    await openFocused(s, script(dir, 'asker', log, { pre: PRE, query: ONE_WRITE, answers: QUERIES.map((q) => q.answer), wait_ms: o.key ? 15_000 : 2000, ...(o.filler ? { filler: o.filler } : {}) }));
    if (o.key) {
      // A key you type right after the program asked: it must reach the program after the answers.
      await waitFor(() => fileText(`${log}.asked`), (t) => t !== '', 120_000, 2);
      await s.ok(keyEvent('k', [], 'KeyK'), 'the key k, right after the queries');
    }
    await waitFor(() => fileText(`${log}.done`), (t) => t !== '', 180_000, 50);
    const g = await grid(s, 'the program\'s screen');
    // The terminal's own default colors: a cell the program never wrote (row 0 after the clear).
    const blank = await s.ok({ call: 'cell', terminal: 'T1', x: 0, y: 0 }, 'an empty cell');
    return {
      chunks: readJsonLines(log).map((c: JsonObject) => ({ ms: Number(c['ms']), bytes: Buffer.from(String(c['hex']), 'hex') })),
      timeout: fileText(`${log}.timeout`) !== '', oneWrite: fileText(`${log}.asked`), screen: g.text, fg: String(blank['fg']), bg: String(blank['bg']),
    };
  });
}

/** What "gets all five answers in that order, and the clipboard read nothing" asks; the first failure names the first query missing. */
function answerProblems(p: Played): string[] {
  const f: string[] = [];
  const r = parse(p.chunks.filter((c) => c.ms >= 0));
  if (r.firstMissing) {
    const q = QUERIES.find((x) => x.name === r.firstMissing)!;
    f.push(`no answer to the ${r.firstMissing} query in its place: wanted ${q.spec}, the program read "${shown(r.rest.slice(0, 80))}"${p.timeout ? ' and printed "timeout"' : ''}`);
  }
  if (!r.firstMissing && r.rest.length > 0) f.push(`the program read more than the six answers: "${shown(r.rest.slice(0, 80))}"${r.rest.includes(']52') ? ' (an answer to the clipboard read)' : ''}`);
  if (p.timeout && f.length === 0) f.push('the program printed "timeout"');
  return f;
}

describe('AC3 the emulator answers the queries a program waits on, in order, and never a clipboard read', () => {
  it('AC3 device attributes, cursor position, a mode report, keyboard flags and the foreground and background colors, asked in one write, are answered in that order within 50 ms of it; the clipboard read gets nothing; the colors are the terminal\'s own', async () => {
    const p = await play(show());
    expect(p.oneWrite, 'the program asked in one write').toBe('one write');
    expect(answerProblems(p), 'every answer, in order, and nothing for the clipboard read').toEqual([]);
    expect(p.screen.some((r) => r.includes('timeout')), 'the program did not print "timeout"').toBe(false);
    const r = parse(p.chunks.filter((c) => c.ms >= 0));
    const [fg, bg] = [r.got[4]!.rgb, r.got[5]!.rgb];
    expect([fg, bg], 'the colors answered are the ones the terminal draws an empty cell with (the high byte of each channel)').toEqual([p.fg.toLowerCase(), p.bg.toLowerCase()]);
    const last = Math.max(...r.got.map((g) => g.ms));
    const reading = `the last answer arrived ${last.toFixed(1)} ms after the write`;
    console.log(`AC3: ${reading}; each: ${r.got.map((g) => `${g.name} ${g.ms.toFixed(1)} ms`).join(', ')}`);
    if (last > 50) {
      const why = referenceMacProblem();
      if (why) inconclusive(`${reading}, over 50 ms, on a machine whose timing is not a result (${why})`);
      expect.fail(`FAIL: ${reading}, over 50 ms, on the reference Mac`);
    }
  }, 600_000);

  it('AC3 a planted emulator that drops the queries makes the program print "timeout" and fails, naming the first query', async () => {
    const p = await play(show(), { planted: 'queries_dropped' });
    expect(p.timeout, 'the program got no answers in 2 s and says so').toBe(true);
    expect(p.screen.some((r) => r.includes('timeout')), 'the program printed "timeout" on its screen').toBe(true);
    const f = answerProblems(p);
    expect(f[0] ?? '', `the planted queries_dropped fails, naming the first query: ${JSON.stringify(f)}`).toContain('device attributes (DA1, CSI c)');
  }, 600_000);
});

describe('SCOPE the answers reach the program through the host\'s input, ahead of any later key', () => {
  it('SCOPE with 20,000 lines of output still ahead of the queries in the stream, a key typed right after the program asked reaches it after all six answers', async () => {
    const p = await play(show(), { filler: 20_000, key: true });
    const all = Buffer.concat(p.chunks.map((c) => c.bytes)).toString('latin1');
    // No answer holds the letter k, so the first k is the key.
    const k = all.indexOf('k');
    expect(k, `the key reached the program: it read "${shown(all.slice(0, 120))}"`).toBeGreaterThanOrEqual(0);
    const answered = parse([{ ms: 0, bytes: Buffer.from(all.slice(0, k), 'latin1') }]);
    expect(answered.firstMissing, `every answer came before the key k, the first missing being named: the program read "${shown(all.slice(0, 160))}"`).toBeNull();
    expect(answered.rest, 'nothing else before the key').toBe('');
    expect(all.slice(k), 'nothing but the key after the answers').toBe('k');
  }, 900_000);
});
