// One lock file for every outside input (#1824). Each file the reference lane (#461) and the pack census (#1493) fetch
// on first use is a row of scripts/fetch-lock.json, `{path, url, sha256, size, credit}`, its URL at a commit named by
// its 40 hex characters, never a branch or a tag. One fetcher reads the rows into one cache outside the checkout,
// ~/.deepbuild/fetched/<path>. It skips a file whose hash already matches and never passes one whose hash doesn't. The
// blind acceptance suites that fetch on first use keep their own pin tables.
//
//   node scripts/fetch-lock.mjs lint              the lint lane's check: FAIL names each row that can move or can't be checked
//   node scripts/fetch-lock.mjs fetch [<url> …]   every row, or the rows of these URLs; a URL the lock doesn't list FAILs
//
// The fetcher reaches the network only with DEEP_FETCH_NETWORK=1. A file it can't have, missing or with a hash other
// than its pin, is BLOCKED, named with its hashes, under one unblock line for the run. Exit 0 means every file asked
// for is in the cache at its pinned hash, and only then may a lane read it. It reads the lock of the folder it runs in
// and imports only node: built-ins.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOCK = 'scripts/fetch-lock.json';
const CACHE = '~/.deepbuild/fetched';
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FIX = '  Fix: Pin the row to a commit by its 40 hex characters, with the file\'s sha256, its size in bytes and the credit line its source gives, under a relative path no other row has.';
const UNBLOCK = '  Unblock: let this machine fetch what the lock lists, checked against its pinned hashes: DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch';
const say = (line) => console.log(line);

/** The lock's rows, or null once it has said why the lock can't be read. */
function readLock() {
  let files;
  try {
    ({ files } = JSON.parse(readFileSync(LOCK, 'utf8')));
  } catch (error) {
    say(`INVALID fetch-lock: ${LOCK} can't be read: ${error.code ?? error.message}`);
    return null;
  }
  if (Array.isArray(files)) return files;
  say(`INVALID fetch-lock: ${LOCK} has no files list`);
  return null;
}

/** What keeps a row from pinning one file the cache can hold, with `paths` the paths of the rows before it. */
function problems(row, paths) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return ['it is no object'];
  const { path, url, sha256, size, credit } = row, found = [];
  if (typeof path !== 'string' || !path) found.push('it has no path');
  else if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => ['', '.', '..'].includes(part))) found.push('its path is no plain relative path, so it could leave the cache');
  else if (paths.has(path)) found.push('another row has its path');
  const link = typeof url === 'string' ? URL.parse(url) : null;
  if (!['http:', 'https:'].includes(link?.protocol)) found.push('it has no http or https URL');
  else if (!link.pathname.split('/').some((part) => COMMIT.test(part))) found.push('its URL names no commit by its 40 hex characters, so a branch or a tag can move it');
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) found.push('it has no sha256 of 64 lowercase hex characters');
  if (!Number.isSafeInteger(size) || size < 0) found.push('it has no size in bytes');
  if (typeof credit !== 'string' || !credit.trim()) found.push('it has no credit line');
  return found;
}

/** Says FAIL for each row with a problem, naming it; answers how many. */
function lint(rows) {
  const paths = new Set();
  let failed = 0;
  rows.forEach((row, index) => {
    const found = problems(row, paths);
    const path = typeof row?.path === 'string' && row.path ? row.path : null;
    if (path) paths.add(path);
    if (!found.length) return;
    failed += 1;
    say(`FAIL fetch-lock: ${LOCK} row ${index + 1}${path ? `, ${path}` : ''}: ${found.join('; ')}\n${FIX}`);
  });
  return failed;
}

/** The SHA-256 of a cached file, or null when there is none. */
async function hashOf(file) {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return hash.digest('hex');
}

/** Fetches one row into the cache, whole at its pin or not at all; answers why it couldn't, or null. */
async function download(row, file) {
  const part = `${file}.${process.pid}.part`, hash = createHash('sha256');
  let size = 0, handle;
  try {
    const response = await fetch(row.url);
    if (!response.ok) {
      await response.body?.cancel();
      return `BLOCKED fetch-lock: ${row.url} answered HTTP ${response.status}, so ${row.path} can't be had`;
    }
    mkdirSync(dirname(file), { recursive: true });
    handle = await open(part, 'w');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > row.size) break;
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    rmSync(part, { force: true });
    return `BLOCKED fetch-lock: ${row.url} can't be fetched (${error.cause?.code ?? error.message}), so ${row.path} can't be had`;
  } finally {
    await handle?.close();
  }
  const got = hash.digest('hex');
  if (size === row.size && got === row.sha256) {
    renameSync(part, file);
    return null;
  }
  rmSync(part, { force: true });
  const gave = size > row.size ? `more than ${row.size} bytes` : `${size} bytes that hash to ${got}`;
  return `FAIL fetch-lock: ${row.url} gave ${gave}, not ${row.path}'s pinned ${row.size} bytes that hash to ${row.sha256}\n  Fix: Pin the row to the bytes its source gives at that commit, or point its URL at the file its path names.`;
}

/** Brings each row asked for into the cache at its pinned hash; answers the exit code. */
async function fetchRows(rows, urls) {
  if (lint(rows)) return 1;
  const unlisted = urls.filter((url) => !rows.some((row) => row.url === url));
  for (const url of unlisted) say(`FAIL fetch-lock: ${url} is no row of ${LOCK}, so it isn't fetched\n  Fix: Fetch only a file the lock lists, or give this one a row: its path, its URL at a commit, its sha256, size and credit.`);
  if (unlisted.length) return 1;
  const wanted = urls.length ? rows.filter((row) => urls.includes(row.url)) : rows;
  const allowed = process.env.DEEP_FETCH_NETWORK === '1', cache = join(homedir(), '.deepbuild', 'fetched');
  let fetched = 0, blocked = 0, failed = 0;
  for (const row of wanted) {
    const file = join(cache, row.path), found = await hashOf(file);
    if (found === row.sha256) continue;
    const why = found ? `${row.path} in the cache hashes to ${found}, not its pinned ${row.sha256}` : `${row.path} isn't in the cache`;
    if (!allowed) {
      blocked += 1;
      say(`BLOCKED fetch-lock: ${why}, and the network isn't allowed, so it isn't fetched`);
      continue;
    }
    if (found) say(`NOTE fetch-lock: ${why}; fetching it again from its pinned commit`);
    const refused = await download(row, file);
    if (!refused) fetched += 1;
    else {
      say(refused);
      if (refused.startsWith('BLOCKED')) blocked += 1;
      else failed += 1;
    }
  }
  if (blocked) say(UNBLOCK);
  if (blocked || failed) return 1;
  say(`PASS fetch-lock: ${wanted.length} of the lock's ${rows.length} files in ${CACHE} at their pinned hashes, ${fetched} fetched now`);
  return 0;
}

const [command, ...urls] = process.argv.slice(2);
if (command !== 'lint' && command !== 'fetch') {
  say('INVALID fetch-lock: usage: node scripts/fetch-lock.mjs lint | fetch [<url> …]');
  process.exitCode = 1;
} else {
  const rows = readLock();
  if (!rows) process.exitCode = 1;
  else if (command === 'fetch') process.exitCode = await fetchRows(rows, urls);
  else if (lint(rows)) process.exitCode = 1;
  else say(`PASS fetch-lock: ${LOCK} pins ${rows.length} files, each at a commit with its sha256, size and credit`);
}
