// Throwaway diagnostic (round 2, Defect 1). Not part of the acceptance suite. It opens what probe/pass.mjs opens
// (the built record, evidence store, asks core and archive, in a temp home), collects as pass.mjs does, and prints
// the three readings of resident memory side by side at the point where a pass would start, then while a touched
// buffer is held in steps:
//   rss     process.memoryUsage.rss()                   what pass.mjs samples on its 5 ms timer, and its rssStart
//   ps      `ps -o rss= -p <pid>` * 1024                what heavy/run.ts samples from outside
//   maxRSS  process.resourceUsage().maxRSS * 1024       the process's lifetime maximum
//   node --expose-gc repair-evidence/round2/three-counters.mjs <home>
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const home = process.argv[2];
const dist = (pkg) => import(pathToFileURL(join(REPO, 'packages', pkg, 'dist', 'index.js')).href);
const [{ shipped }, { openAsks }, { openEvidenceStore }, { openRecord }, { openArchive }] = await Promise.all([dist('adapters'), dist('asks'), dist('evidence'), dist('record'), dist('archive')]);
const now = () => 1791190800000;
const root = join(home, '.deepbuild');
const store = await openEvidenceStore({ root: join(root, 'evidence'), now });
const record = await openRecord({ path: join(root, 'ledger.db'), now, evidence: store });
const asks = await openAsks({ record, now, deliver: () => undefined });
await openArchive({ record, evidence: store, asks, adapters: shipped(), env: { HOME: home }, now, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' } });

const mb = (n) => (n / 1e6).toFixed(1).padStart(6);
const ps = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(process.pid)], { encoding: 'utf8' }).trim()) * 1024;
const show = (what) => {
  const rss = process.memoryUsage.rss();
  const max = process.resourceUsage().maxRSS * 1024;
  console.log(`${what.padEnd(34)} rss ${mb(rss)}  ps ${mb(ps())}  maxRSS ${mb(max)}  maxRSS-rss ${mb(max - rss)}`);
};
show('loaded, before the collection');
globalThis.gc?.();
show('after gc (where a pass starts)');
await new Promise((done) => setTimeout(done, 300));
show('300 ms idle');
const held = [];
for (let k = 1; k <= 5; k++) { const b = Buffer.allocUnsafeSlow(20_000_000); b.fill(1); held.push(b); show(`holding ${k * 20} MB`); }
await record.close();
