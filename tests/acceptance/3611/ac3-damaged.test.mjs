// Criterion 3 of #3611 (#3611.ce0f9025): "A row that is missing, unreadable, cut short or whose kept hash doesn't match
// runs the check and never reads as installed. A planted core that admits on an unreadable row fails, naming the pack"
//
// Six test packs in one store, three fresh cores in turn, all on one launch key (`sequence`, judged by judge.mjs
// `judgeDamaged`):
//   1. the first core checks all six and keeps a row for each;
//   2. then five rows are damaged, each its own way: one file removed; one made unreadable (bytes that are no text,
//      under a mode that lets nobody read it); one cut short inside its first line; one cut short before its mark, its
//      first line whole; one whose `left_sha256` is another hash than its `left`'s, marked with the launch key, so
//      nothing but the kept hash is wrong with it. The sixth is left whole;
//   3. the next core runs the five checks again (`checks` 1, installed) and takes the whole row (`checks` 0): none of
//      the five reads as installed on its row's word;
//   4. the core after it takes all six (`checks` 0): each damaged row was replaced whole.
// The same sequence runs with every core started as the planted core that admits on an unreadable row, which must fail
// the same judge, naming the pack whose row can't be read (README: The planted cores).
//
// A third test holds the last case of the issue's Scope, which no criterion lists: evidence the check kept that is
// gone. The release's lanes pack carries a library, and its check keeps the library's bytes in the evidence store. A
// second core given that store takes the row; a third given an empty evidence store, with the same row, runs the check.
// Wrong programs it fails on: the merge base (no row kept); the planted core; a core that doesn't compare the kept
// hash; a core that takes a row with no mark; a core that takes a row whose evidence is gone.
// Run: node --test tests/acceptance/3611/ac3-damaged.test.mjs
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_MS, blocked, emptyEvidence, failsNaming, inconclusive, none, openCore, packsOf, packsOnce, removeRoot, showBinary, tempRoot, worldOf } from './core.mjs';
import { judgeDamaged, judgeEvidence, rowOf } from './judge.mjs';
import { shippedPack, testPack } from './packs.mjs';
import { cutBeforeMark, cutInsideRow, fileAt, remove, rowProblems, unreadable, withAnotherHash } from './store.mjs';

const UNREADABLE = 'can\'t be read';

/** The criterion's sequence, every core started with `planted` (none for the shipped core): what `judgeDamaged` reads. */
async function sequence(planted) {
  const at = tempRoot();
  try {
    const own = planted === undefined ? {} : { planted };
    const what = planted === undefined ? 'core' : `core with ${planted} planted`;
    const damage = [
      ['kept3611missing', 'is missing', (file) => remove(file)],
      ['kept3611unreadable', UNREADABLE, (file) => unreadable(file)],
      ['kept3611cutrow', 'is cut short inside its first line', (file) => cutInsideRow(file)],
      ['kept3611cutmark', 'is cut short before its mark', (file) => cutBeforeMark(file)],
      ['kept3611hash', 'holds a kept hash that doesn\'t match what its check left', (file) => { if (!withAnotherHash(file, at.key)) throw blocked(`${file.ref}: its row's first line holds no top-level \`left_sha256\` to rewrite`); }],
    ].map(([name, how, stage]) => ({ pack: testPack(at, name), how, stage }));
    const whole = testPack(at, 'kept3611whole');
    const all = [...damage.map(({ pack }) => pack), whole];
    const world = worldOf(at, all.map((pack) => pack.offer), own);

    const fill = await packsOnce(world, `the first ${what}`);
    const unchecked = all.filter((pack) => rowOf(fill.rows, pack.ref)?.state !== 'installed');
    if (unchecked.length) throw blocked(`the test packs don't pass their check on the first ${what}: ${JSON.stringify(unchecked.map((pack) => rowOf(fill.rows, pack.ref) ?? pack.ref)).slice(0, 800)}`);
    const files = all.map((pack) => [pack, fileAt(at.checked, pack.ref)]);
    none(files.flatMap(([pack, file]) => rowProblems(file, { key: at.key, pack: pack.id, version: pack.version, outcome: 'installed' })), `AC3 #3611.ce0f9025: the first ${what} checked ${all.length} test packs and keeps each result as the design step says, under <root>/packs/checked/, for a row of each to be damaged`);

    for (const { pack, stage } of damage) stage(fileAt(at.checked, pack.ref));
    const after = await packsOnce(world, `the ${what} started on the damaged rows`);
    const again = await packsOnce(world, `the ${what} after it`);
    return { cases: damage.map(({ pack, how }) => ({ ref: pack.ref, what: how })), whole: whole.ref, unreadable: damage[1].pack.ref, after: after.rows, again: again.rows };
  } finally {
    removeRoot(at);
  }
}

test('AC3 #3611.ce0f9025 a row that is missing, unreadable, cut short or whose kept hash doesn\'t match runs the check and never reads as installed', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  none(judgeDamaged(await sequence(undefined)), 'AC3 #3611.ce0f9025: a row that is missing, unreadable, cut short or whose kept hash doesn\'t match runs the check, and never reads as installed');
});

test('AC3 #3611.ce0f9025 a planted core that admits on an unreadable row fails, naming the pack', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  if (process.getuid?.() === 0) throw inconclusive('this process runs as root, whom no file\'s mode keeps from reading it, so no row here is one the planted core can\'t read');
  const seen = await sequence('admits_on_unreadable_row');
  failsNaming(judgeDamaged(seen), [seen.unreadable, UNREADABLE], 'AC3 #3611.ce0f9025: the planted core admits_on_unreadable_row');
});

/** Each object an evidence store holds, by its hash: `<2 hex>/<62 hex>` under the folder. */
function hashesIn(evidence) {
  const out = new Set();
  const names = (dir) => { try { return readdirSync(dir); } catch { return []; } };
  for (const head of names(evidence)) {
    if (!/^[0-9a-f]{2}$/.test(head)) continue;
    for (const rest of names(join(evidence, head))) if (/^[0-9a-f]{62}$/.test(rest)) out.add(head + rest);
  }
  return out;
}

test('AC3 #3611.ce0f9025 a row whose check kept evidence that is gone runs the check: a core given an empty evidence store doesn\'t take it', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  const lanes = shippedPack('lanes');
  const at = tempRoot();
  try {
    const world = worldOf(at, [lanes.offer]);
    const first = await packsOnce(world, 'the first core');
    const same = await packsOnce(world, 'the second core, given the first core\'s evidence store');
    const empty = emptyEvidence(at, 'evidence-gone');
    const core = await openCore({ ...world, evidence: empty }, 'the third core, given an empty evidence store');
    let gone;
    try { gone = await packsOf(core, 'the third core, given an empty evidence store', ANSWER_MS); } finally { await core.close(); }
    const here = hashesIn(empty);
    const lost = [...hashesIn(at.evidence)].filter((hash) => !here.has(hash));
    const row = rowOf(gone.rows, lanes.ref);
    // A third core that took the row with nothing missing from its store: this pack's check kept nothing there.
    if (row?.checks === 0 && lost.length === 0) throw blocked(`${lanes.ref}: its check kept nothing in the evidence store that an empty store lacks, so no evidence of its is gone`);
    none(judgeEvidence({ ref: lanes.ref, first: rowOf(first.rows, lanes.ref), same: rowOf(same.rows, lanes.ref), gone: row, lost }), 'AC3 #3611.ce0f9025: a row whose check kept evidence that is gone runs the check');
  } finally {
    removeRoot(at);
  }
});
