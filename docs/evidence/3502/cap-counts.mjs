// #3502 AC5: #3441's tick lists played through the pin's own cap, and the counts kept beside this script.
// The lists, the rule's text and the program around it are the acceptance suite's (tests/acceptance/3502/cap.mjs):
// the rule is taken as text from vendor/gpui-pre and built by rustc. Run from the repository's root:
//   node docs/evidence/3502/cap-counts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { LISTS, listName, play, treeRule } from '../../../tests/acceptance/3502/cap.mjs';

const release = /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(readFileSync('vendor/gpui-pre/Cargo.toml', 'utf8'))?.[1];
const { rule, edition } = treeRule();
const counts = play(rule, LISTS, edition);
const lists = LISTS.map((list, index) => ({ ...list, presented: counts[index] }));
writeFileSync(new URL('./cap-counts.json', import.meta.url), `${JSON.stringify({ release, lists }, null, 2)}\n`);
for (const [index, list] of LISTS.entries()) console.log(`${listName(list)}: ${counts[index]} presented`);
console.log(`gpui-pre ${release}, the rule as ${rule.shape}`);
