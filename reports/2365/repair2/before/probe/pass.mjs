// One archive pass in a process of its own, measured, as the issue's probe ran it: "the archive in a process of its
// own, with its record and evidence store". It opens the record, the evidence store and the asks core of a hub's
// folder (<home>/.deepbuild), the archive over the shipped adapters with HOME=<home>, and runs one pass (or the copy
// of one session on demand), while a 5 ms timer runs. It needs the built packages (npm run build --workspaces).
//
//   node --expose-gc pass.mjs <home> pass|session <now-ms> [session-id] [--archive <module.js>]
//
// stdout: {"at":"start",…} when the pass starts, {"at":"end"} when it ends, then one result line:
//   ms        the pass's wall time
//   maxGapMs  the longest stretch the 5 ms timer went unserved, from the pass's start to its end
//   rssStart  resident memory at the pass's start, after a full GC; peakRss the highest seen during the pass (the
//             timer's samples, and the process's max RSS when the pass raised it); rise = peakRss - rssStart
//   evidenceBefore / evidenceAfter / added   bytes of files under the evidence store's folder
//   error     the pass's error, with its causes, or null
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const args = process.argv.slice(2);
const flag = args.indexOf('--archive');
const archivePath = flag >= 0 ? resolve(args.splice(flag, 2)[1]) : join(REPO, 'packages/archive/dist/index.js');
const [home, mode, nowArg, id] = args;
if (!home || !['pass', 'session'].includes(mode) || !Number.isFinite(Number(nowArg)) || (mode === 'session' && !id)) {
  console.error('usage: node --expose-gc pass.mjs <home> pass|session <now-ms> [session-id] [--archive <module.js>]');
  process.exit(2);
}
const dist = (pkg) => import(pathToFileURL(join(REPO, 'packages', pkg, 'dist', 'index.js')).href);
const [{ shipped }, { openAsks }, { openEvidenceStore }, { openRecord }, { openArchive }] = await Promise.all([
  dist('adapters'), dist('asks'), dist('evidence'), dist('record'), import(pathToFileURL(archivePath).href),
]);

const bytesUnder = (dir) => {
  let total = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += bytesUnder(p);
    else if (e.isFile()) total += statSync(p).size;
  }
  return total;
};
const describe = (e) => {
  if (!e) return null;
  const inner = Array.isArray(e.errors) ? e.errors.map((x) => describe(x)).join('; ') : '';
  const cause = e.cause ? ` (cause: ${describe(e.cause)})` : '';
  return `${e.message ?? String(e)}${inner ? `: ${inner}` : ''}${cause}`;
};

const now = () => Number(nowArg);
const root = join(home, '.deepbuild');
const evidenceRoot = join(root, 'evidence');
const store = await openEvidenceStore({ root: evidenceRoot, now });
const record = await openRecord({ path: join(root, 'ledger.db'), now, evidence: store });
const asks = await openAsks({ record, now, deliver: () => undefined });
const archive = await openArchive({
  record, evidence: store, asks, adapters: shipped(), env: { HOME: home }, now,
  connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' },
});

globalThis.gc?.();
const evidenceBefore = bytesUnder(evidenceRoot);
const rssStart = process.memoryUsage.rss();
const maxBefore = process.resourceUsage().maxRSS * 1024;
let peakRss = rssStart;
let maxGapMs = 0;
let ticks = 0;
process.stdout.write(`${JSON.stringify({ at: 'start', pid: process.pid, rss: rssStart })}\n`);
const t0 = performance.now();
let last = t0;
const timer = setInterval(() => {
  const t = performance.now();
  maxGapMs = Math.max(maxGapMs, t - last);
  last = t;
  ticks++;
  const rss = process.memoryUsage.rss();
  if (rss > peakRss) peakRss = rss;
}, 5);
let error = null;
try {
  if (mode === 'session') await archive.session(id);
  else await archive.pass();
} catch (e) {
  error = describe(e);
}
const t1 = performance.now();
maxGapMs = Math.max(maxGapMs, t1 - last);
clearInterval(timer);
process.stdout.write(`${JSON.stringify({ at: 'end' })}\n`);
const maxAfter = process.resourceUsage().maxRSS * 1024;
if (maxAfter > maxBefore) peakRss = Math.max(peakRss, maxAfter);
const evidenceAfter = bytesUnder(evidenceRoot);
await record.close();
process.stdout.write(`${JSON.stringify({ at: 'result', ms: t1 - t0, maxGapMs, ticks, rssStart, peakRss, rise: peakRss - rssStart, evidenceBefore, evidenceAfter, added: evidenceAfter - evidenceBefore, error })}\n`);
process.exit(0);
