// A lane, as test code: it asks the fetcher for the one file it needs, by its URL, and ends as the fetcher does. Given a
// URL the lock doesn't list, it is #1824 AC3's planted lane. Usage: node lane.mjs <fetcher script> <url>
import { spawnSync } from 'node:child_process';

const [script, url] = process.argv.slice(2);
const fetched = spawnSync(process.execPath, [script, 'fetch', url], { stdio: 'inherit' });
if (fetched.status !== 0) process.exit(fetched.status ?? 1);
console.log(`PASS planted lane: fetched ${url}`);
