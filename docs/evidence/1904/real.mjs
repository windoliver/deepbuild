// #1904 hand e2e: one real read-only call to api.github.com through the hub's liveFetch, with no token, as the old
// code sent none when none was set. Usage: node real.mjs <repo root>
import { join } from 'node:path';
const { liveFetch } = await import(join(process.argv[2], 'packages/hub/dist/github-source.js'));
const token = undefined;
const r = await liveFetch('https://api.github.com', token)('/repos/nodejs/node', 1);
console.log(`GET https://api.github.com/repos/nodejs/node (token sent: ${token ? 'yes' : 'no'})`);
console.log(`status ${r.status}; full_name ${r.body?.full_name}; default_branch ${r.body?.default_branch}; rate limit left ${r.headers['x-ratelimit-remaining']}/${r.headers['x-ratelimit-limit']}`);
process.exitCode = r.status === 200 && r.body?.full_name === 'nodejs/node' ? 0 : 1;
