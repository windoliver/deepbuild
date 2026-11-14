// A planted wrong program for #1824's acceptance tests (../../../README.md, The plants): the blind job's own small
// fetcher, written from the issue alone, with one fault. The before lane lays it over scripts/fetch-lock.mjs.
// Wrong: with the network allowed, it fetches every row on every run, cached and matching or not.
//   node scripts/fetch-lock.mjs lint | fetch [<url> ...]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOCK = 'scripts/fetch-lock.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const say = (line) => console.log(line);

function problems(row) {
  const found = [];
  if (!String(row.url ?? '').split('/').some((part) => /^[0-9a-f]{40}$/.test(part))) found.push('its URL names no commit of 40 hex characters (a branch or a tag moves)');
  if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) found.push('it has no sha256');
  if (!(Number.isInteger(row.size) && row.size >= 0)) found.push('it has no size');
  if (typeof row.credit !== 'string' || !row.credit) found.push('it has no credit line');
  return found;
}

function lint(rows) {
  let failed = false;
  rows.forEach((row, index) => {
    for (const problem of problems(row)) {
      failed = true;
      say(`FAIL fetch-lock: ${LOCK} row ${row.path ?? `#${index + 1}`}: ${problem}\n  Fix: Pin the row to a commit by its 40 hex characters, with the file's sha256, size and credit line.`);
    }
  });
  if (!failed) say(`PASS fetch-lock: ${rows.length} rows, each pinned to a commit with its sha256, size and credit`);
  return failed ? 1 : 0;
}

async function fetchAll(rows, urls) {
  const cache = join(homedir(), '.deepbuild', 'fetched');
  const allowed = process.env.DEEP_FETCH_NETWORK === '1';
  const wanted = [];
  for (const url of urls) {
    const row = rows.find((one) => one.url === url);
    if (row) wanted.push(row);
    else {
      say(`FAIL fetch-lock: ${url} isn't a row of ${LOCK}\n  Fix: Add its row (path, URL at a commit, sha256, size, credit), or fetch a file the lock lists.`);
      return 1;
    }
  }
  const blocked = [];
  for (const row of urls.length ? wanted : rows) {
    const file = join(cache, row.path);
    let why = `${row.path} isn't cached`;
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      const matches = sha256(bytes) === row.sha256;
      if (matches && !allowed) continue;
      if (!matches) why = `${row.path} hashes to ${sha256(bytes)}, not the pinned ${row.sha256}`;
    }
    if (!allowed) {
      blocked.push(why);
      continue;
    }
    if (why.includes('hashes to')) say(`NOTE fetch-lock: ${why}; fetching it again`);
    const response = await fetch(row.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || (row.sha256 && sha256(bytes) !== row.sha256)) {
      say(`FAIL fetch-lock: ${row.url} answered HTTP ${response.status} with bytes that hash to ${sha256(bytes)}, not the pinned ${row.sha256}`);
      return 1;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.part`, bytes);
    renameSync(`${file}.part`, file);
  }
  if (!blocked.length) return 0;
  for (const why of blocked) say(`BLOCKED fetch-lock: ${why}, and the network isn't allowed`);
  say('  Unblock: allow the network for this run, then fetch again: DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch');
  return 3;
}

const [command, ...args] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(join(process.cwd(), LOCK), 'utf8')).files;
if (command === 'lint') process.exitCode = lint(rows);
else if (command === 'fetch') process.exitCode = await fetchAll(rows, args);
else { say(`INVALID fetch-lock: unknown command ${command}`); process.exitCode = 1; }
