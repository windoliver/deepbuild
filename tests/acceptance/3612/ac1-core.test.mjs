// Criterion 1 of #3612 (#3612.77719146), on the canvas core: "A fresh canvas core with the shipped packs answers its
// first call having checked each fixture's piece once: 57 piece checks for 57 pieces. The merge base counts 109 and
// fails, naming a fixture whose piece was checked twice"
//
// One fresh `deep-show canvas` is given the 21 shipped packs as the hub gives them and asked for its packs, the
// hub's own first call; the core checks every pack before that answer. Then it is asked how many pieces its logic
// module has checked (README: The count). A count that isn't 57 fails, and the failure names a fixture whose piece a
// link checks more than once, found by `deep-logic` of the same build (README: One fixture alone).
// Run: node --test tests/acceptance/3612/ac1-core.test.mjs
import test from 'node:test';
import { AC, PIECES, blocked, brief, must } from './common.mjs';
import { countOf, openCore } from './core.mjs';
import { checkedTwice, everyLink, judgeCounts, logicPacks, shippedPacks } from './logic.mjs';

test(`AC1 ${AC[1]} a fresh canvas core with the shipped packs answers its first call having checked each fixture's piece once: ${PIECES} piece checks for ${PIECES} pieces`, { timeout: 12 * 60_000 }, async (t) => {
  const shipped = shippedPacks();
  const core = await openCore(shipped.map(({ id, dir }) => ({ id, dir })));
  let count;
  try {
    const first = await core.call({ call: 'packs' });
    const rows = Array.isArray(first.reply?.packs) ? first.reply.packs : null;
    if (first.ok !== true || !rows) throw blocked(`the core's first call, packs, gave no pack rows: ${brief(first)}`);
    const left = shipped.filter(({ id, manifest }) => !rows.some((row) => row.pack === id && row.version === manifest.version && row.state === 'installed'));
    if (left.length) throw blocked(`the core didn't install ${left.length} of the ${shipped.length} shipped packs, so its count isn't the shipped packs': ${left.map(({ folder, id }) => `${folder} (${brief(rows.find((row) => row.pack === id)?.issues ?? 'no row', 300)})`).join('; ')}`);
    const answer = await core.call({ call: 'piece_checks' });
    count = countOf(answer);
    must(count !== null, `AC1 ${AC[1]}: the canvas core answered its first call, with all ${shipped.length} shipped packs installed, and keeps no count of the pieces its logic module checked for them: its piece_checks call answered ${brief(answer, 300)}, not {"ok": true, "reply": {"piece_checks": <whole number>}} (README: The count). Nothing shows each fixture's piece was checked once; the issue reads 109 piece checks for ${PIECES} pieces on the merge base`);
  } finally {
    await core.close();
  }
  t.diagnostic(`the core counted ${count} piece checks before its first answer`);
  if (count === PIECES) return;
  // Which fixture: the same build's logic module, linking each shipped library alone.
  let which;
  try {
    const problems = judgeCounts({ checks: [], links: await everyLink(logicPacks()) });
    const twice = checkedTwice(problems);
    which = problems.length
      ? `${twice ? `A fixture whose piece was checked twice: ${twice}. ` : ''}Linking each shipped library alone, ${problems.join('; ')}`
      : 'Linking each shipped library alone checks each of its own fixtures\' pieces once, so no single fixture is named: the core checked whole pieces again';
  } catch (error) {
    which = `No fixture could be named by linking each shipped library alone: ${error.message}`;
  }
  must(false, `AC1 ${AC[1]}: a fresh canvas core with the ${shipped.length} shipped packs counted ${count} piece checks before its first answer, for ${PIECES} pieces. ${which}`);
});
