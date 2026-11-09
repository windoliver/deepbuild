// #1579 AC5's design half: the threats table in docs/technical-design.md (Threats, and what stops each one) has a row
// for a paired device's signature used again, for another method or on another hub, and its mitigation says what the
// issue's Scope does (README, Pinned here: 7). Docs are read as text; the judge is held to a table without the row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.ts';

/** The rows of the table under "## Threats, and what stops each one", as [threat, mitigation]. */
export function threatRows(design: string): [string, string][] {
  const start = design.indexOf('\n## Threats, and what stops each one');
  if (start < 0) return [];
  const end = design.indexOf('\n## ', start + 5);
  const section = design.slice(start, end < 0 ? undefined : end);
  return section.split('\n').filter((l) => /^\|[^|]/.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()) as [string, string]).filter((c) => c.length >= 2 && c[0] !== 'Threat');
}
/** Null when one row is this issue's: its threat a signature used again, its mitigation each part of the Scope. */
export function judgeRow(rows: [string, string][]): string | null {
  const row = rows.find(([threat]) => /signature|signed answer/i.test(threat) && /again|replay|reuse|another method|elsewhere/i.test(threat));
  if (!row) return `no threat row is about a signed answer used again: the threats are ${rows.map(([t]) => t).join('; ')}`;
  const m = row[1];
  const needs: [string, RegExp][] = [
    ['the method', /\bmethod\b/i], ['the hub\'s ID', /\bhub(?:'s)? ID\b/i], ['the time', /\btime\b/i], ['a once-only ID', /once-only ID/i],
    ['the hash of the params', /hash of the params|params(?:'s)? hash/i], ['10 minutes', /\b10 minutes\b/i], ['one verifier', /one verifier/i],
    ['a spent ID kept', /spent/i],
  ];
  const missing = needs.filter(([, re]) => !re.test(m)).map(([what]) => what);
  return missing.length ? `the row "${row[0]}" doesn't say ${missing.join(', ')}: ${m.slice(0, 600)}` : null;
}

describe('AC5 #1579 the threats table has this row', () => {
  it('AC5 the design\'s threats table has a row for a signed answer used again, naming what the signature covers, its 10 minutes, the spent IDs and the one verifier', () => {
    const design = readFileSync(join(REPO, 'docs/technical-design.md'), 'utf8');
    const rows = threatRows(design);
    expect(rows.length, 'the threats table is found and read').toBeGreaterThan(10);
    expect(judgeRow(rows)).toBeNull();
  });

  it('AC5 (wrong program) the judge fails a row that names the threat but leaves out the time', () => {
    const rows: [string, string][] = [['A signed answer used again', 'A paired device\'s signature covers the method, the hub\'s ID, a once-only ID and the hash of the params, checked by one verifier; a spent ID is kept.']];
    expect(judgeRow(rows)).toMatch(/the time, 10 minutes/);
    expect(judgeRow([])).toMatch(/no threat row/);
  });
});
