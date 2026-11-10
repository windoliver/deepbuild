// #1824's judges: each runs a fetcher script as a process, as a lane would, in a sandbox, and answers its failures, one
// line each. An empty list means the script met the criterion. The tests hold the real script (scripts/fetch-lock.mjs)
// to an empty list, and each planted twin to the failure its criterion names.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, FILES, HERE, NETWORK, sandbox, sha256, UNLISTED } from './helpers.mjs';

const missing = (script) => (existsSync(script) ? [] : [`no fetcher: ${script} doesn't exist (README: The surface)`]);
const outside = (run) => run.requests.filter((r) => r.outside).map((r) => `a request left for another host: ${r.method} ${r.url}`);
const holds = (file, bytes) => existsSync(file) && readFileSync(file).equals(bytes);

/** A cold fetch with the network allowed caches every row at `<cache>/<path>`; else what it missed. */
async function cold(box, script) {
  box.writeLock();
  const run = await box.run(script, ['fetch'], { network: true });
  const failures = outside(run);
  if (run.status !== 0) failures.push(`a first fetch with the network allowed exits ${run.status}: ${clip(run.output)}`);
  for (const file of FILES) if (!holds(box.cached(file), file.bytes)) failures.push(`a first fetch with the network allowed leaves ${file.path} out of the cache (~/.deepbuild/fetched/${file.path})`);
  return failures;
}

async function within(script, judge) {
  const failures = missing(script);
  if (failures.length) return failures;
  const box = await sandbox();
  try {
    return await judge(box);
  } finally {
    await box.done();
  }
}

/** AC1: with every file in the lock cached and matching, a fetch makes 0 network requests. A failure names the path. */
export const judgeWarm = (script) => within(script, async (box) => {
  const failures = await cold(box, script);
  if (failures.length) return failures;
  const warm = await box.run(script, ['fetch'], { network: true });
  if (warm.status !== 0) failures.push(`a warm fetch exits ${warm.status}: ${clip(warm.output)}`);
  for (const r of warm.requests) failures.push(`a warm fetch made a network request for ${r.path ?? r.url}, a cached, matching file (${r.method} ${r.url}); expected 0 requests`);
  return failures;
});

/** The cache after a first fetch, with one byte of one file flipped: the file keeps its size. */
async function flipped(box, script) {
  const failures = await cold(box, script);
  const file = FILES[1], at = box.cached(file);
  if (failures.length) return { failures };
  const bytes = Buffer.from(file.bytes);
  bytes[3] ^= 0x01;
  writeFileSync(at, bytes);
  return { failures, file, at, pinned: sha256(file.bytes), found: sha256(bytes), bytes };
}
const names = (line, plant) => line.includes(plant.file.path) && line.includes(plant.pinned) && line.includes(plant.found);

/** AC2, the network allowed: the flipped file is reported with both hashes and fetched again, alone. */
export const judgeFlippedAllowed = (script) => within(script, async (box) => {
  const plant = await flipped(box, script);
  if (plant.failures.length) return plant.failures;
  const run = await box.run(script, ['fetch'], { network: true });
  const failures = outside(run);
  if (run.status !== 0) failures.push(`with the network allowed, a fetch over the flipped ${plant.file.path} exits ${run.status}: ${clip(run.output)}`);
  if (!holds(plant.at, plant.file.bytes)) failures.push(`with the network allowed, ${plant.file.path} wasn't fetched again: the cache ${existsSync(plant.at) ? 'still holds bytes that don\'t hash to the pin' : 'no longer holds it'}, so a lane would read the flipped file`);
  if (!run.lines.some((line) => names(line, plant))) failures.push(`no line of the report names ${plant.file.path} with both hashes (pinned ${plant.pinned}, found ${plant.found}): ${clip(run.output)}`);
  const wanted = box.url(plant.file.path);
  if (!run.requests.some((r) => r.url === wanted)) failures.push(`no request reached ${wanted}`);
  for (const r of run.requests.filter((r) => r.url !== wanted)) failures.push(`a fetch for one flipped file also requested ${r.path ?? r.url}, a cached, matching file`);
  return failures;
});

/** AC2, the network not allowed: no refetch, the flipped file isn't passed, BLOCKED with one unblock ask. */
export const judgeFlippedBlocked = (script) => within(script, async (box) => {
  const plant = await flipped(box, script);
  if (plant.failures.length) return plant.failures;
  const run = await box.run(script, ['fetch']);
  const failures = outside(run);
  for (const r of run.requests) failures.push(`with the network not allowed, a fetch requested ${r.path ?? r.url} (${r.method} ${r.url}); expected 0 requests`);
  if (run.status === 0) failures.push(`with the network not allowed, a fetch over the flipped ${plant.file.path} exits 0, so a lane goes on to read the flipped file: ${clip(run.output)}`);
  const blocked = run.lines.filter((line) => line.startsWith('BLOCKED '));
  if (blocked.length !== 1) failures.push(`expected 1 line starting BLOCKED, found ${blocked.length}: ${clip(run.output)}`);
  else if (!names(blocked[0], plant)) failures.push(`the BLOCKED line doesn't name ${plant.file.path} with both hashes (pinned ${plant.pinned}, found ${plant.found}): ${blocked[0]}`);
  const asks = run.lines.filter((line) => /^\s*Unblock: \S/.test(line));
  if (asks.length !== 1) failures.push(`expected 1 unblock ask (a line "  Unblock: ..."), found ${asks.length}: ${clip(run.output)}`);
  else if (!asks[0].includes(`${NETWORK}=1`) || !asks[0].includes('scripts/fetch-lock.mjs fetch')) failures.push(`the unblock ask doesn't say what to do (${NETWORK}=1) and the check that proves it done (node scripts/fetch-lock.mjs fetch): ${asks[0]}`);
  return failures;
});

/** AC3's planted rows: each is a good row of its own path, broken in one way. */
export const PLANTED_ROWS = [
  ['a URL that names a branch', 'planted/branch.js', (row, box) => ({ ...row, url: box.url(row.path, 'main') })],
  ['a URL that names a tag', 'planted/tag.js', (row, box) => ({ ...row, url: box.url(row.path, 'v1.4.0') })],
  ['no size', 'planted/no-size.js', ({ size: _, ...row }) => row],
  ['no sha256', 'planted/no-sha256.js', ({ sha256: _, ...row }) => row],
];

/** AC3: the lint passes a lock of good rows, and fails each planted row, naming it by its path, with 0 requests. */
export const judgeLint = (script) => within(script, async (box) => {
  box.writeLock();
  const clean = await box.run(script, ['lint']);
  if (clean.status !== 0 || clean.lines.some((line) => line.startsWith('FAIL'))) return [`the lint fails a lock of three good rows (exit ${clean.status}): ${clip(clean.output)}`];
  const failures = [], good = FILES.map(box.row);
  for (const [what, path, plant] of PLANTED_ROWS) {
    const bytes = Buffer.from(`// ${path}\n`);
    box.writeLock([good[0], plant({ path, url: box.url(path), sha256: sha256(bytes), size: bytes.length, credit: 'Fixture Library authors, MIT' }, box), good[1], good[2]]);
    const run = await box.run(script, ['lint']);
    const fails = run.lines.filter((line) => line.startsWith('FAIL'));
    if (run.status === 0) failures.push(`a row with ${what} (${path}) passes the lint`);
    else if (!fails.some((line) => line.includes(path))) failures.push(`a row with ${what} fails the lint with no FAIL line naming the row, ${path}: ${clip(run.output)}`);
    for (const row of good) if (fails.some((line) => line.includes(row.path))) failures.push(`with a planted row with ${what}, the lint also fails the good row ${row.path}`);
    for (const r of [...run.requests]) failures.push(`the lint made a network request: ${r.method} ${r.url}`);
  }
  return failures;
});

/** The planted lane: test code that asks the fetcher for one URL, as a lane would, and ends as the fetcher does. */
export const LANE = join(HERE, 'plants', 'lane.mjs');

/** AC3: a lane that fetches a listed file passes; the planted lane that fetches an unlisted one fails, naming the URL. */
export const judgeUnlisted = (script) => within(script, async (box) => {
  box.writeLock();
  const listed = FILES[0], failures = [];
  const honest = await box.run(LANE, [script, box.url(listed.path)], { network: true });
  failures.push(...outside(honest));
  if (honest.status !== 0 || !holds(box.cached(listed), listed.bytes)) return [...failures, `a lane that fetches a file the lock lists (${box.url(listed.path)}) fails, or leaves it out of the cache (exit ${honest.status}): ${clip(honest.output)}`];
  const url = box.url(UNLISTED.path);
  const planted = await box.run(LANE, [script, url], { network: true });
  failures.push(...outside(planted));
  if (planted.status === 0) failures.push(`the planted lane that fetches ${url}, which the lock doesn't list, passes`);
  else if (!planted.lines.some((line) => line.startsWith('FAIL') && line.includes(url))) failures.push(`the planted lane fails with no FAIL line naming the URL ${url}: ${clip(planted.output)}`);
  if (planted.requests.some((r) => r.url === url)) failures.push(`the fetcher requested ${url}, which the lock doesn't list`);
  return failures;
});
