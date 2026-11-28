import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO, same } from './common.mjs';
import { hashesInGoldenFile, hashesMovedFromRecording, keptFixturesAndGoldens, hashesMoved, hashesReached } from './goldens.mjs';
import { openLogic } from './logic.mjs';

const MERGE_BASE = '11404f91002549703d3eed81d16f6a988923b7b7';
const RECORDING_FILE = fileURLToPath(new URL('./base.json', import.meta.url));
const say = (text) => process.stderr.write(`${text}\n`);

const check = process.argv.includes('--check');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
if (!check && head !== MERGE_BASE) {
  say(`BLOCKED: base.json holds the merge base's values (${MERGE_BASE}); this checkout is at ${head}. Record in a checkout at the merge base, or compare with --check.`);
  process.exit(2);
}

const all = keptFixturesAndGoldens();
const reached = {}, goldenFileAgrees = {};
let hashesAGoldenFileHoldsOtherwise = 0;
const logic = openLogic();
try {
  for (const one of all) {
    const { items, keys } = await hashesReached(logic, one);
    reached[one.key] = items;
    const hashes = Object.values(items).reduce((n, item) => n + item.steps.filter((hash) => hash !== null).length, 0);
    if (!one.golden) {
      say(`${one.name}: ${Object.keys(items).length} items, ${hashes} step hashes`);
      continue;
    }
    const differs = hashesMoved(one, hashesInGoldenFile(one.golden), items, 'in its own file');
    goldenFileAgrees[one.key] = { hashes: differs.length === 0, bake_keys: same(keys, one.golden.bake_key) };
    say(`${one.name}: ${Object.keys(items).length} items, ${hashes} step hashes; ${differs.length ? `${differs.length} differ from its own file` : 'as its own file holds them'}; its bake keys ${goldenFileAgrees[one.key].bake_keys ? 'are' : "aren't"} its file's`);
    for (const difference of differs) say(`  DIFFERS ${difference}`);
    hashesAGoldenFileHoldsOtherwise += differs.length;
  }
} finally {
  await logic.close();
}

const files = Object.fromEntries(all.map((one) => [one.file, one.sha]));
if (check) {
  const held = JSON.parse(readFileSync(RECORDING_FILE, 'utf8'));
  let problems;
  try {
    problems = hashesMovedFromRecording(all, held, reached);
    if (!same(held.kept, goldenFileAgrees)) problems.push(`what the kept goldens' own files hold differs: ${JSON.stringify(held.kept)} recorded, ${JSON.stringify(goldenFileAgrees)} now`);
  } catch (error) {
    problems = [error.message];
  }
  for (const problem of problems) console.log(`DIFFERS ${problem}`);
  console.log(problems.length ? `${problems.length} differences from base.json (recorded at ${held.commit}; this checkout is at ${head})` : `same as base.json (recorded at ${held.commit}; this checkout is at ${head}): ${all.length} runs, ${Object.values(reached).reduce((n, items) => n + Object.keys(items).length, 0)} items`);
  process.exit(problems.length ? 1 : 0);
}
if (hashesAGoldenFileHoldsOtherwise) {
  say(`BLOCKED: ${hashesAGoldenFileHoldsOtherwise} of a kept golden's hashes aren't the ones the merge base reaches, so nothing is recorded.`);
  process.exit(2);
}

const lines = ['{', `"commit": ${JSON.stringify(head)},`, '"command": "node tests/acceptance/3529/record.mjs",', `"files": ${JSON.stringify(files)},`, `"kept": ${JSON.stringify(goldenFileAgrees)},`, '"reached": {'];
all.forEach((one, n) => {
  lines.push(`${JSON.stringify(one.key)}: {`, Object.entries(reached[one.key]).map(([id, item]) => `${JSON.stringify(id)}: ${JSON.stringify(item)}`).join(',\n'), `}${n + 1 < all.length ? ',' : ''}`);
});
lines.push('}', '}');
writeFileSync(RECORDING_FILE, `${lines.join('\n')}\n`);
say(`wrote ${RECORDING_FILE.slice(REPO.length + 1)}`);
