// #1123 AC4, a reading: the unit lane's own two vitest blocks, narrowed to the folders the change moves, run through
// this side's own runLanes. A moved folder runs in the serial block while the side's `alone` list names it, else in
// the parallel block. Usage, from the checkout: node reports/1123/ac4-reading/driver.mjs <before|after> <round>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [side, round] = process.argv.slice(2);
const cwd = process.cwd(), out = dirname(fileURLToPath(import.meta.url));
const { alone, checks, exactTree, runLanes } = await import(pathToFileURL(join(cwd, 'scripts/lanes.mjs')).href);
const moved = ['tests/acceptance/374/', 'tests/acceptance/375/'];
const [parallel, serial] = checks.find(({ name }) => name === 'unit').commands;
const flag = serial.indexOf('--no-file-parallelism');
if (flag < 0 || !parallel.includes('--exclude')) throw Error('BLOCKED: the unit lane is not the two vitest blocks this reading narrows');
const inAlone = moved.filter((path) => alone.includes(path)), inParallel = moved.filter((path) => !alone.includes(path));
const commands = [...(inParallel.length ? [[...parallel, ...inParallel]] : []), ...(inAlone.length ? [[...serial.slice(0, flag + 1), ...inAlone]] : [])];
const lane = `unit-moved-${side}`, tree = exactTree(cwd), loadBefore = loadavg(), started = performance.now();
const laneStatus = runLanes([{ name: lane, commands, fix: 'A reading: nothing to fix.' }], { cwd });
const wallSeconds = Number(((performance.now() - started) / 1000).toFixed(2));
// The lane's own evidence record, kept beside the log with the machine's name left out.
const record = join(homedir(), '.deepbuild', 'lanes', `${tree}-${lane}.json`);
if (tree && existsSync(record)) writeFileSync(join(out, `${side}-${round}-record.json`), `${JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), host: '<host>' }, null, 2)}\n`);
console.log(`READING ${JSON.stringify({ side, round: Number(round), tree, aloneBlock: inAlone, parallelBlock: inParallel, laneStatus, wallSeconds, loadBefore, loadAfter: loadavg(), at: new Date().toISOString() })}`);
process.exitCode = laneStatus;
