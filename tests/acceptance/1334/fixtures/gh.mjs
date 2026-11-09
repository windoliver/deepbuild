// The stand-in for gh (README: Stand-ins): every call is a line of $T1334_GH/gh.jsonl. `issue create` and `pr create`
// print a new URL, `pr view` exits 1, and anything else exits 0 having done nothing. Only a red tick of main watch calls
// it, to open and "merge" its revert, which so never reaches origin: main stays red.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.env.T1334_GH;
const args = process.argv.slice(2);
appendFileSync(join(folder, 'gh.jsonl'), `${JSON.stringify({ t: Date.now(), args })}\n`);
const counter = join(folder, 'gh-counter');
const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 9901;
if (args[1] === 'create') {
  writeFileSync(counter, String(n + 1));
  console.log(`https://github.com/fixture/watched/${args[0] === 'pr' ? 'pull' : 'issues'}/${n}`);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'view') process.exit(1);
process.exit(0);
