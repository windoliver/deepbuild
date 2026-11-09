// Test-side tools for the redraft of #1550's C1 and C3 (REDRAFT.md): the redraft probe built once and fed JSON lines,
// the reading of a `shape_text` row's text the dispute asks for (DISPUTE.md: "The reading asked for"), and C3's judge
// over that reading, shared with its planted program. Everything else comes from the original suite (`../helpers.ts`).
// Every cargo and probe process is run to its end by spawnSync, so no process outlives a call.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect } from 'vitest';
import { REPO, caseProblems, interleave, type Case, type Measure } from '../helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The redraft probe (probe.rs here): an example target of crates/deep-replica (REDRAFT.md: What the implementer adds).

const ROWS_PROBE = 'acceptance_1550_redraft_probe';
const rowsBin = (): string => join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', 'examples', ROWS_PROBE);
const BUILD = ['build', '--locked', '-p', 'deep-replica', '--features', 'env-plants', '--example', ROWS_PROBE];

/** Builds the redraft probe before the file's tests; a test whose build failed fails with cargo's own words. */
export function useRowsProbe(): void {
  let error = '';
  beforeAll(() => {
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0 || !existsSync(rowsBin())) {
      error = `cargo ${BUILD.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => /error|warning: unused/.test(l) || /^\s+-->/.test(l)).slice(0, 40).join('\n')}`;
    }
  }, 3_600_000);
  beforeEach(() => {
    if (error) expect.fail(`BLOCKED: the redraft probe isn't built: ${error}`);
  });
}

/** For each item, for each of its widths, `shape_text`'s rows in the order they are drawn, each the code point offset
 * of each of its glyphs in glyph order (-1 for a byte inside a code point). */
export function rowsAll(items: { text: string; widths: number[] }[]): number[][][][] {
  if (!items.length) return [];
  const run = spawnSync(rowsBin(), [], {
    cwd: REPO, input: `${items.map(({ text, widths }) => JSON.stringify({ call: 'rows', text, widths })).join('\n')}\n`,
    encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_800_000,
  });
  if (run.error) expect.fail(`BLOCKED: the redraft probe could not run: ${run.error.message}`);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  if (run.status !== 0 || lines.length !== items.length) {
    expect.fail(`BLOCKED: the redraft probe answered ${lines.length} of ${items.length} calls and exited ${run.status} ${run.signal ?? ''}:\n${run.stderr.slice(-2000)}`);
  }
  return lines.map((line, i) => {
    const reply = JSON.parse(line) as { ok: boolean; rows: number[][][] };
    if (reply.ok !== true) expect.fail(`BLOCKED: the redraft probe refused ${JSON.stringify(items[i]).slice(0, 300)}: ${line.slice(0, 300)}`);
    return reply.rows;
  });
}

// ---------------------------------------------------------------------------------------------------
// The reading: where each later line starts, and whether the rows are the text cut in order.

/** One wrap as read: each later line's start, and, when the rows aren't the text cut into consecutive pieces in text
 * order, what they hold instead. `wrap_line` gives its starts directly and always in order. */
export interface RowRead { starts: number[]; order?: string }

/** `shape_text`'s rows read as text (DISPUTE.md): each glyph covers its offset up to the next larger glyph offset in
 * the whole line (the text's end after the last), a row's text is what its glyphs cover, the rows must cover the text
 * as consecutive ranges in text order, and a row's start is the smallest offset it covers. Where the glyphs sit on the
 * row, and which of them is the boundary's, isn't read. */
export function readRows(rows: number[][], length: number): RowRead {
  const starts = rows.slice(1).map((row) => Math.min(...row));
  const offsets = [...new Set(rows.flat())].sort((a, b) => a - b);
  const stray = offsets.find((k) => k < 0 || k >= length);
  if (stray !== undefined) return { starts, order: stray < 0 ? 'a glyph sits at a byte inside a code point' : `a glyph sits at offset ${stray}, past the text` };
  if (offsets[0] !== 0) return { starts, order: `offsets 0 to ${offsets[0]! - 1} are in no row` };
  const rank = new Map(offsets.map((k, i) => [k, i]));
  let next = 0;
  for (const row of rows) {
    const ranks = [...new Set(row.map((k) => rank.get(k)!))].sort((a, b) => a - b);
    if (ranks[0] !== next || ranks[ranks.length - 1] !== next + ranks.length - 1) return { starts, order: held(rows, offsets, rank, length) };
    next += ranks.length;
  }
  return { starts };
}

/** What each row covers, as code point ranges: `row 1 holds 12–20, row 2 holds 0–11`. */
function held(rows: number[][], offsets: number[], rank: Map<number, number>, length: number): string {
  return rows.map((row, r) => {
    const ranges: [number, number][] = [];
    for (const i of [...new Set(row.map((k) => rank.get(k)!))].sort((a, b) => a - b)) {
      const [from, to] = [offsets[i]!, (offsets[i + 1] ?? length) - 1];
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === from) last[1] = to;
      else ranges.push([from, to]);
    }
    return `row ${r + 1} holds ${ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')}`;
  }).join(', ');
}

/** A wrap given as line starts, as rows of every code point offset: the planted twin read the way `shape_text` is. */
export const rowsOf = (starts: number[], length: number): number[][] => {
  const edges = [0, ...starts, length];
  return edges.slice(0, -1).map((at, i) => Array.from({ length: edges[i + 1]! - at }, (_, j) => at + j));
};

// ---------------------------------------------------------------------------------------------------
// Criterion 3's judge over the reading, shared with its planted twin.

/** A wrapper over LineBreakTest's cases: for each case, for each width, its wrap as read. */
export type RowWrapper = { name: string; read: (cases: Case[], widths: number[][], measures: Measure[]) => RowRead[][] };

/** Every line start a wrapper picks over the file that the file doesn't allow (the original judge, `caseProblems`),
 * and every wrap whose rows aren't the case cut in text order, each naming its line in the file. */
export function caseRowProblems(cases: Case[], widths: number[][], measures: Measure[], wrapper: RowWrapper): string[] {
  const reads = wrapper.read(cases, widths, measures);
  const starts = caseProblems(cases, widths, measures, { name: wrapper.name, wrap: () => reads.map((r) => r.map((x) => x.starts)) });
  const order: string[] = [];
  cases.forEach((c, i) => widths[i]!.forEach((w, j) => {
    const what = reads[i]![j]!.order;
    if (what) order.push(`LineBreakTest.txt:${c.line}: ${wrapper.name} at ${w} px draws rows that aren't the case cut in text order (${what}): ${c.source.split('#')[0]!.trim()}`);
  }));
  return interleave([starts, order]);
}
