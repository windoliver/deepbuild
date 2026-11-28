import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('./', import.meta.url));
const helpers = fileURLToPath(new URL('../helpers.mjs', import.meta.url));
const suite = fileURLToPath(new URL('../same-failures.test.mjs', import.meta.url));
const checkout = fileURLToPath(new URL('../../../../', import.meta.url));
const names = readdirSync(folder).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort();
const [name] = process.argv.slice(2);

if (!names.includes(name)) {
  console.error(`usage: node tests/acceptance/3066-redraft-3699/wrong-checks/lay.mjs <${names.join('|')}>`);
  process.exit(2);
}

const held = readFileSync(helpers, 'utf8');
const lines = held.split('\n');
const edits = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8')).map(({ find, wrong }) => {
  const places = [...lines.keys()].filter((at) => find.every((line, index) => lines[at + index] === line));
  if (places.length !== 1) {
    console.error(`${name}: its find lines match helpers.mjs at ${places.length} places, so it can't be laid`);
    process.exit(2);
  }
  return { at: places[0], find, wrong };
}).sort((a, b) => b.at - a.at);
for (const { at, find, wrong } of edits) lines.splice(at, find.length, ...wrong);

const restore = () => writeFileSync(helpers, held);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { restore(); process.exit(130); });
writeFileSync(helpers, lines.join('\n'));
console.log(`laid the wrong check ${name} over helpers.mjs`);
let status = 1;
try {
  status = spawnSync(process.execPath, ['--test', suite], { cwd: checkout, stdio: 'inherit' }).status ?? 1;
} finally {
  restore();
}
process.exit(status);
