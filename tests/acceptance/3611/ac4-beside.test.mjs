// Criterion 4 of #3611 (#3611.f11db91d): "A row written beside the hub, by a process that is not the hub, is not taken:
// the check runs. The test writes one as an agent's child would"
//
// Three test packs in one store under one launch key, which this test holds as the hub holds it: in memory, given to
// each core on its input pipe and to nothing else. The first core checks all three and keeps a row for each: `open`,
// which its own check refuses, and `shut` and `kept`, which pass. Then forger.mjs runs, a process of its own that no
// core started and that is given nothing of the key: its arguments are the root and the rows to write, its environment
// holds PATH alone, and its input is closed. It reads every file under the root for the key, finds none, and writes
// two rows beside the hub's (README: The process that is not the hub):
//   - `open`'s row rewritten to say installed, with no issues, under a mark it made with a key of its own;
//   - `shut`'s row, the hub's own, changed to say refused, with the hub's mark left on it.
// The next core, on the same launch key, runs both checks (`checks` 1): `open` reads refused with the issues its check
// gave, `shut` installed. `kept`'s row, which nobody touched, is taken (`checks` 0), so the core that refused the two
// is one that takes a row (judge.mjs `judgeBeside`).
// Wrong programs it fails on: the merge base (no row kept); a core that verifies no mark (`open` reads installed: a
// version its own check refuses, admitted on the word of a file any command's child can write); a core whose mark
// covers less than the whole first line (`shut` reads refused); a core that writes the key it was given to a file
// under the root, where the process that is not the hub reads it.
// Run: node --test tests/acceptance/3611/ac4-beside.test.mjs
import test from 'node:test';
import { blocked, brief, must, none, notTheHub, packsOnce, removeRoot, showBinary, tempRoot, worldOf } from './core.mjs';
import { judgeBeside, rowOf } from './judge.mjs';
import { testPack } from './packs.mjs';
import { fileAt, marked, rowProblems } from './store.mjs';

test('AC4 #3611.f11db91d a row written beside the hub\'s by a process that is not the hub, as an agent\'s child would write it, is not taken: the check runs, and the hub\'s own row beside it is taken', { timeout: 15 * 60_000 }, async (t) => {
  showBinary();
  const at = tempRoot();
  try {
    const open = testPack(at, 'kept3611open', { fallback: 0 });
    const shut = testPack(at, 'kept3611shut');
    const kept = testPack(at, 'kept3611kept');
    const all = [open, shut, kept];
    const world = worldOf(at, all.map((pack) => pack.offer));

    const fill = await packsOnce(world, 'the first core');
    const wanted = { [open.ref]: 'refused', [shut.ref]: 'installed', [kept.ref]: 'installed' };
    const off = all.filter((pack) => rowOf(fill.rows, pack.ref)?.state !== wanted[pack.ref]);
    if (off.length) throw blocked(`the test packs' checks don't read as written on the first core (${JSON.stringify(wanted)}): ${brief(off.map((pack) => rowOf(fill.rows, pack.ref) ?? pack.ref), 800)}`);
    none(all.flatMap((pack) => rowProblems(fileAt(at.checked, pack.ref), { key: at.key, pack: pack.id, version: pack.version, outcome: wanted[pack.ref] })), 'AC4 #3611.f11db91d: the first core keeps each result as the design step says, under <root>/packs/checked/, marked with the launch key: the hub\'s rows, beside which another process writes its own');

    const report = await notTheHub(at.root, [{ ref: open.ref, say: 'installed', mark: 'own' }, { ref: shut.ref, say: 'refused', mark: 'keep' }]);
    t.diagnostic(`the process that is not the hub read ${report.files} files under the root and tried ${report.candidates} keys on ${report.rows} rows; it wrote ${brief(report.wrote, 600)}`);
    if (report.problems?.length || report.wrote?.length !== 2) throw blocked(`the process that is not the hub didn't write its two rows: ${brief(report, 800)}`);
    // This test is the hub here and wrote its key nowhere: a key found under the root is one a core wrote to disk.
    must(!report.key, `AC4 #3611.f11db91d: the launch key, which the test gave each core on its input pipe and wrote nowhere, is in a file under the root, ${report.key?.file} (${report.key?.form}): a process that is not the hub read it there and marked its row with it`);
    for (const pack of [open, shut]) {
      const written = fileAt(at.checked, pack.ref);
      if (!written.two || marked(at.key, written)) throw blocked(`${pack.ref}: the row written beside the hub's is not a row whose mark fails under the launch key`);
    }

    const after = await packsOnce(world, 'the core started once the rows were written');
    none(judgeBeside({ open: open.ref, shut: shut.ref, kept: kept.ref, fill: fill.rows, after: after.rows }), 'AC4 #3611.f11db91d: a row written beside the hub\'s by a process that is not the hub is not taken, and the check runs');
    must(rowOf(fill.rows, open.ref).issues.length > 0, `AC4 #3611.f11db91d: ${open.ref}: refused by its check, it has no issue to stay refused with`);
  } finally {
    removeRoot(at);
  }
});
