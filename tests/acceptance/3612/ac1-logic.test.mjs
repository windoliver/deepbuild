// Criterion 1 of #3612 (#3612.77719146), on the logic module's own binary: "A fresh canvas core with the shipped
// packs answers its first call having checked each fixture's piece once: 57 piece checks for 57 pieces. The merge
// base counts 109 and fails, naming a fixture whose piece was checked twice"
//
// `deep-logic` is given each shipped pack as the canvas core gives it to the module's pack check, with the count of
// piece checks read before and after (README: The count): each check must make as many piece checks as its own
// reply lists pieces, 57 in all. Then each shipped library is linked alone (README: One fixture alone): the link
// checks the piece of its own fixture once. The second test runs the same readings and the same judge on the
// planted runner that checks a fixture's piece again for its logic.determinism run, as the merge base does (README:
// The planted runner): it counts 109, and the judge must fail, naming a fixture whose piece was checked twice.
// Run: node --test tests/acceptance/3612/ac1-logic.test.mjs
import test from 'node:test';
import { AC, BASE_CHECKS, PIECES, blocked, brief, must } from './common.mjs';
import { checkedTwice, countedChecks, everyLink, judgeCounts, logicPacks, openLogic, pieceChecks, piecesOf } from './logic.mjs';

/** README, The planted runner: `deep-logic --planted fixture_checks_piece_twice`. */
const PLANTED = 'fixture_checks_piece_twice';

/** The shipped packs' checks and their libraries' links on `deep-logic --planted …`, with the piece checks each made. */
async function readings(planted, lacks) {
  const packs = logicPacks();
  const logic = openLogic(planted);
  let checks;
  try {
    // A planted runner the binary doesn't know ends it before it answers anything.
    const about = await logic.send({ call: 'about' }, 'about');
    must(about.interface === 'logic@1', `AC1 ${AC[1]}: ${logic.name} doesn't run: ${brief(about, 300)}. ${lacks}`);
    const first = await pieceChecks(logic);
    must(first.count !== null, `AC1 ${AC[1]}: ${logic.name} keeps no count of the pieces it checked: its piece_checks call answered ${brief(first.reply, 300)}, not {"ok": true, "piece_checks": <whole number>} (README: The count). ${lacks}`);
    const counted = await countedChecks(logic, packs);
    const refused = counted.filter(({ reply }) => reply.ok !== true);
    if (refused.length) throw blocked(`${logic.name} refuses the check of ${refused.map(({ folder, reply }) => `${folder} (${brief(reply, 300)})`).join('; ')}, so its pieces can't be counted`);
    checks = counted.map(({ folder, reply, checks: made }, n) => ({ folder, checks: made, pieces: piecesOf(packs[n], reply) }));
  } finally {
    await logic.close();
  }
  const links = await everyLink(packs, planted);
  const sum = (of) => checks.reduce((total, check) => total + of(check), 0);
  return { checks, links, pieces: sum((c) => c.pieces.length), made: sum((c) => c.checks) };
}
const perPack = (checks) => checks.map(({ folder, checks: made, pieces }) => `${folder} ${made} for ${pieces.length}`).join(', ');

test(`AC1 ${AC[1]} the logic module checks each shipped fixture's piece once: ${PIECES} piece checks for the ${PIECES} pieces the shipped packs' checks make, and one for a fixture's piece at its library's link`, { timeout: 10 * 60_000 }, async (t) => {
  const read = await readings([], `Nothing shows each fixture's piece was checked once; the issue reads ${BASE_CHECKS} piece checks for ${PIECES} pieces on the merge base`);
  t.diagnostic(`piece checks for pieces, by pack: ${perPack(read.checks)}; by link: ${read.links.map((l) => `${l.library} ${l.checks}`).join(', ')}`);
  const problems = judgeCounts(read);
  const twice = checkedTwice(problems);
  must(problems.length === 0, `AC1 ${AC[1]}: the shipped packs' checks made ${read.made} piece checks for ${read.pieces} pieces.${twice ? ` A fixture whose piece was checked twice: ${twice}.` : ''}\n  ${problems.join('\n  ')}`);
  must(read.pieces === PIECES && read.made === PIECES, `AC1 ${AC[1]}: the shipped packs' checks made ${read.made} piece checks for ${read.pieces} pieces, where the issue counts ${PIECES} for ${PIECES} (${perPack(read.checks)})`);
});

test(`AC1 ${AC[1]} the merge base's fixture run, planted, counts ${BASE_CHECKS} piece checks for the same ${PIECES} pieces and fails, naming a fixture whose piece was checked twice`, { timeout: 10 * 60_000 }, async (t) => {
  const read = await readings([PLANTED], `The merge base's fixture run can't be read with a count without the planted runner ${PLANTED} (README: The planted runner)`);
  t.diagnostic(`planted, piece checks for pieces, by pack: ${perPack(read.checks)}; by link: ${read.links.map((l) => `${l.library} ${l.checks}`).join(', ')}`);
  must(read.pieces === PIECES && read.made === BASE_CHECKS, `AC1 ${AC[1]}: the planted runner ${PLANTED} made ${read.made} piece checks for ${read.pieces} pieces on the shipped packs, where the merge base makes ${BASE_CHECKS} for ${PIECES}: it isn't the merge base's fixture run (${perPack(read.checks)})`);
  const problems = judgeCounts(read);
  must(problems.length > 0, `AC1 ${AC[1]}: the judge passed the planted runner ${PLANTED}, which checks a fixture's piece again for its logic.determinism run: ${read.made} piece checks for ${read.pieces} pieces`);
  const twice = checkedTwice(problems);
  must(twice !== null, `AC1 ${AC[1]}: the planted runner ${PLANTED} fails, but no fixture is named whose piece was checked twice at its library's link:\n  ${problems.join('\n  ')}`);
  t.diagnostic(`the judge fails the planted runner, naming fixture ${twice}: ${problems.length} problems, the first: ${problems[0]}`);
});
