// Reads one twin's TAP run of the new suite and says whether it failed exactly the tags twins.json gives that twin.
//   node twin-tally.mjs <twins.json> <twin name> <tap log> <exit code>
import { readFileSync } from 'node:fs';

const [twinsFile, twin, log, exit] = process.argv.slice(2);
const expected = Object.entries(JSON.parse(readFileSync(twinsFile, 'utf8'))).filter(([, names]) => names.includes(twin)).map(([tag]) => tag).sort();
const top = readFileSync(log, 'utf8').split('\n').filter((line) => /^(not )?ok \d+ - /.test(line));
const failed = top.filter((line) => line.startsWith('not ok'));
const tags = failed.map((line) => line.match(/#1322\.[0-9a-f]{8}/)?.[0] ?? 'untagged');
const counts = Object.entries(tags.reduce((all, tag) => ({ ...all, [tag]: (all[tag] ?? 0) + 1 }), {})).map(([tag, n]) => `${tag} x${n}`).join(', ');
const ok = Number(exit) !== 0 && top.length === 7 && !top.some((line) => /# (SKIP|TODO)/.test(line)) && JSON.stringify([...new Set(tags)].sort()) === JSON.stringify(expected);
console.log(`  ${twin}: fails ${counts || 'nothing'}, passes ${top.length - failed.length} of ${top.length}; only tests of its twins.json tag fail: ${ok ? 'yes' : 'NO'}`);
process.exitCode = ok ? 0 : 1;
