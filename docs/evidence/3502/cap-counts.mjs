import { readFileSync, writeFileSync } from 'node:fs';
import { LISTS, listName, play, treeRule } from '../../../tests/acceptance/3502/cap.mjs';

const release = /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(readFileSync('vendor/gpui-pre/Cargo.toml', 'utf8'))?.[1];
const { rule, edition } = treeRule();
const counts = play(rule, LISTS, edition);
const lists = LISTS.map((list, index) => ({ ...list, presented: counts[index] }));
writeFileSync(new URL('./cap-counts.json', import.meta.url), `${JSON.stringify({ release, lists }, null, 2)}\n`);
for (const [index, list] of LISTS.entries()) console.log(`${listName(list)}: ${counts[index]} presented`);
console.log(`gpui-pre ${release}, the rule as ${rule.shape}`);
