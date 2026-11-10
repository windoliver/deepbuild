// A small reference of the surface in ../README.md, written by the blind job from the issue alone: test code, never
// shipped. `control.mjs` is it with no fault; every other twin is it with the one fault its name says, so each planted
// wrong program compiles, runs and differs from a right one in one way.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOCK = 'scripts/fetch-lock.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const say = (line) => console.log(line);

function problems(row, fault) {
  const found = [];
  if (fault !== 'lint-any-ref' && !String(row.url ?? '').split('/').some((part) => /^[0-9a-f]{40}$/.test(part))) found.push('its URL names no commit of 40 hex characters (a branch or a tag moves)');
  if (fault !== 'lint-fields-optional' && !/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) found.push('it has no sha256');
  if (fault !== 'lint-fields-optional' && !(Number.isInteger(row.size) && row.size >= 0)) found.push('it has no size');
  if (typeof row.credit !== 'string' || !row.credit) found.push('it has no credit line');
  return found;
}

function lint(rows, fault) {
  let failed = false;
  rows.forEach((row, index) => {
    for (const problem of problems(row, fault)) {
      failed = true;
      say(`FAIL fetch-lock: ${LOCK} row ${row.path ?? `#${index + 1}`}: ${problem}\n  Fix: Pin the row to a commit by its 40 hex characters, with the file's sha256, size and credit line.`);
    }
  });
  if (!failed) say(`PASS fetch-lock: ${rows.length} rows, each pinned to a commit with its sha256, size and credit`);
  return failed ? 1 : 0;
}

async function fetchAll(rows, urls, fault) {
  const cache = join(homedir(), '.deepbuild', 'fetched');
  const allowed = process.env.DEEP_FETCH_NETWORK === '1' || fault === 'refetches-not-allowed';
  const wanted = [];
  for (const url of urls) {
    const row = rows.find((one) => one.url === url);
    if (row) wanted.push(row);
    else if (fault === 'fetches-unlisted') wanted.push({ path: `unlisted/${url.split('/').at(-1)}`, url });
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
      const matches = fault === 'uses-flipped' ? bytes.length === row.size : sha256(bytes) === row.sha256;
      if (matches && fault !== 'refetches-cached') continue;
      if (!matches) why = `${row.path} hashes to ${sha256(bytes)}, not the pinned ${row.sha256}`;
    }
    if (!allowed) {
      if (fault === 'passes-not-allowed') say(`NOTE fetch-lock: ${why}; the network isn't allowed, so it stays`);
      else blocked.push(why);
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

export async function main(fault) {
  const [command, ...args] = process.argv.slice(2);
  const rows = JSON.parse(readFileSync(join(process.cwd(), LOCK), 'utf8')).files;
  if (command === 'lint') process.exitCode = lint(rows, fault);
  else if (command === 'fetch') process.exitCode = await fetchAll(rows, args, fault);
  else { say(`INVALID fetch-lock: unknown command ${command}`); process.exitCode = 1; }
}
