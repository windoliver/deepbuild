// AC9: the key planes' guard, `node scripts/keymap-guard.mjs [--root <dir>]` (README, Pinned 17). It reads the action
// table and the last release's under the root; each plant is a copy of the checkout's table with one chord changed, in a
// root of its own, as #1460's lint plants a copy of the source. No build, no window.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canon, glyphs, ID, MIN, readTable, RELEASED, REPO, run, t26, TABLE, useCleanup, type Action } from './helpers.ts';

useCleanup();
const GUARD = 'scripts/keymap-guard.mjs';

/** The guard on the checkout, or on a root holding `table` and `released` as the checkout's files. */
async function guard(o: { table?: Action[]; released?: Action[] } = {}): Promise<{ code: number; out: string }> {
  if (!existsSync(join(REPO, GUARD))) throw Error(`${GUARD}, the key planes' guard (README, Pinned 17), doesn't exist`);
  let root = REPO;
  if (o.table || o.released) {
    root = t26.tempDir();
    for (const [path, rows] of [[TABLE, o.table ?? readTable()], [RELEASED, o.released ?? readTable(REPO, RELEASED)]] as const) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), `${JSON.stringify({ actions: rows }, null, 2)}\n`);
    }
  }
  const r = await run(process.execPath, [join(REPO, GUARD), '--root', root]);
  return { code: r.code, out: `${r.stdout}${r.stderr}` };
}
/** The guard's finding naming `chord`: a FAIL line holding it as the table writes it or as a menu draws it. */
function names(out: string, chord: string): boolean {
  const forms = [chord, canon(chord)!, glyphs(chord)!];
  return out.split('\n').some((line) => /^FAIL keymap\b/.test(line) && forms.some((f) => line.includes(f)));
}

describe(`AC9 ${ID.guard} A planted ⌘⌥X, a planted ⌃A binding and a moved shipped chord each fail the guard, naming the chord`, () => {
  it('AC9 the guard passes the checkout\'s table against the last release\'s', async () => {
    const { code, out } = await guard();
    expect(out, 'the guard prints PASS keymap on the shipped table').toMatch(/^PASS keymap/m);
    expect(code, out).toBe(0);
  }, 10 * MIN);

  it('AC9 wrong program: ⌘⌥ on a ⌘ chord whose variant_of isn\'t the ⌘ chord\'s action fails, naming the chord', async () => {
    const table = readTable();
    const used = new Set(table.map((a) => canon(a.key)));
    const base = table.find((a) => /^cmd-[a-z]$/.test(canon(a.key) ?? '') && !used.has(`alt-cmd-${canon(a.key)!.slice(4)}`) && !used.has(canon(`cmd-alt-${canon(a.key)!.slice(4)}`)));
    if (!base) throw Error('the table has no ⌘ and a letter whose ⌘⌥ is free, to plant a variant beside');
    const other = table.find((a) => a.name !== base.name)!;
    const chord = `cmd-alt-${canon(base.key)!.slice(4)}`;
    const { code, out } = await guard({ table: [...table, { name: 'Planted variant', verb: 'Plant', target: base.target, key: chord, variant_of: other.name }] });
    expect(code, out).toBe(1);
    expect(names(out, chord), `the guard names ${chord} (${glyphs(chord)}), whose variant_of is "${other.name}", not "${base.name}" on ${base.key}: ${out}`).toBe(true);
  }, 10 * MIN);

  it('AC9 wrong program: a ⌃A binding fails, naming the chord', async () => {
    const table = readTable();
    const { code, out } = await guard({ table: [...table, { name: 'Planted control', verb: 'Plant', target: 'app', key: 'ctrl-a', variant_of: null }] });
    expect(code, out).toBe(1);
    expect(names(out, 'ctrl-a'), `the guard names ctrl-a (⌃A): ${out}`).toBe(true);
  }, 10 * MIN);

  it('AC9 wrong program: a shipped chord given another action than the last release\'s table gives it fails, naming the chord', async () => {
    const table = readTable();
    const released = readTable(REPO, RELEASED);
    const shipped = released.find((a) => a.key && table.some((b) => b.name === a.name && canon(b.key) === canon(a.key)));
    if (!shipped) throw Error(`${RELEASED} shares no chord with ${TABLE}, so no shipped chord can be moved`);
    const taker = table.find((a) => a.name !== shipped.name)!;
    const moved = table.map((a) => (a.name === shipped.name ? { ...a, key: null } : a.name === taker.name ? { ...a, key: shipped.key } : a));
    const { code, out } = await guard({ table: moved, released });
    expect(code, out).toBe(1);
    expect(names(out, shipped.key!), `the guard names ${shipped.key} (${glyphs(shipped.key)}), "${shipped.name}" in the last release and "${taker.name}" now: ${out}`).toBe(true);
  }, 10 * MIN);
});
