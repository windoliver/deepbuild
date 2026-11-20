// One claim in a process of its own, measured, for #2645 AC1 and AC2: the hub's own claim code, OpenItems.atClaim from
// the built hub (packages/hub/dist/open-items.js), as the hub's claim lane calls it at a stop, on one Claude Code
// transcript, with Claude Code's task-list facts from the built adapters, as the hub's core reads them. The record is
// answered as a hub with nothing open yet answers it, and the events the claim appends are kept. Nothing else runs in
// the process while the claim reads: a 5 ms timer that reads resident memory, and the read counter only when asked.
//
//   node --expose-gc claim.mjs <transcript> [--reads]
//
// It first makes one claim on a small transcript of its own beside <transcript>, so the measured claim runs on loaded,
// compiled code, as in a hub that has been running; then a full GC; then the claim. stdout, one JSON line:
//   items     the text of each open_item.opened the claim recorded from the task list (`from: 'task'`)
//   bytes     bytes the claim read from <transcript>, counted by #2365's instrument (tests/acceptance/2365/reads.ts:
//             node:fs, node:fs/promises and FileHandle reads in this process), with --reads; else null
//   reads     those reads by kind: [{ how, calls, bytes }]
//   rssStart  resident memory when the claim starts, after the GC (process.memoryUsage.rss())
//   rise      what the claim added: the larger of how far the timer's samples of rss() rose above rssStart, and how far
//             the claim raised the process's lifetime maximum (resourceUsage().maxRSS at its end less at its start),
//             each a difference within one counter, as #2365's probe reads a pass
//   peakRss   rssStart + rise
//   ms        the claim's wall time
//   error     the claim's error, or null
//   blocked   why no claim ran (no build, no --expose-gc), and nothing else
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const [transcript, ...flags] = process.argv.slice(2);
const counting = flags.includes('--reads');
const done = (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); };
if (!transcript) {
  console.error('usage: node --expose-gc claim.mjs <transcript> [--reads]');
  process.exit(2);
}
if (typeof globalThis.gc !== 'function') {
  done({ blocked: 'the probe needs node --expose-gc' });
  process.exit(0);
}
let modules;
try {
  modules = await Promise.all([
    import(pathToFileURL(join(REPO, 'packages/hub/dist/open-items.js')).href),
    import(pathToFileURL(join(REPO, 'packages/adapters/dist/index.js')).href),
  ]);
} catch (error) {
  done({ blocked: `the built hub can't be loaded (npm run build --workspaces): ${error?.message ?? error}` });
  process.exit(0);
}
const [{ OpenItems }, { shipped }] = modules;
const facts = shipped().get('claude').facts.taskList;
const events = [];
const openItems = new OpenItems({
  raw: async () => [],
  append: async (_connection, input) => { events.push(input); },
  now: () => Date.now(),
  connection: (session, agent) => ({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}), ...(agent ? { agent } : {}) }),
  asks: () => ({ raise: async () => { throw new Error('a task list raises no ask'); } }),
  pin: async () => null,
  github: async () => { throw new Error('this claim names no pull request'); },
  taskList: () => facts,
});
const claim = (path, session) => openItems.atClaim({ session, agent: 'claude-code', task: 'task:dh2645', cwd: '/tmp/dh2645-work/shop', base: 'HEAD', message: '', transcript: path, pr: undefined, same: true });

// The warm-up: a typed prompt and one TodoWrite call.
const warm = `${transcript}.warm.jsonl`;
writeFileSync(warm, [
  { type: 'user', sessionId: 'dh2645-warm', uuid: 'w1', message: { role: 'user', content: 'list the steps' } },
  { type: 'assistant', sessionId: 'dh2645-warm', uuid: 'w2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_warm', name: 'TodoWrite', input: { todos: [{ content: 'Warm the claim — once', status: 'pending', activeForm: 'Warming' }] } }] } },
].map((l) => `${JSON.stringify(l)}\n`).join(''));
await claim(warm, 'dh2645-warm');
rmSync(warm, { force: true });
events.length = 0;

const watch = counting ? await (await import(pathToFileURL(join(REPO, 'tests/acceptance/2365/reads.ts')).href)).watchReads([transcript]) : null;
globalThis.gc();
globalThis.gc();
const rssStart = process.memoryUsage.rss();
const maxStart = process.resourceUsage().maxRSS * 1024;
let sampled = rssStart;
const timer = setInterval(() => { sampled = Math.max(sampled, process.memoryUsage.rss()); }, 5);
const t0 = performance.now();
let error = null;
try {
  await claim(transcript, 'dh2645-long');
} catch (e) {
  error = String(e?.stack ?? e);
}
const ms = performance.now() - t0;
clearInterval(timer);
sampled = Math.max(sampled, process.memoryUsage.rss());
const maxEnd = process.resourceUsage().maxRSS * 1024;
watch?.stop();
const rise = Math.max(sampled - rssStart, maxEnd - maxStart);
const reads = watch ? [...watch.reads.reduce((by, r) => by.set(r.how, { how: r.how, calls: (by.get(r.how)?.calls ?? 0) + 1, bytes: (by.get(r.how)?.bytes ?? 0) + r.bytes }), new Map()).values()] : null;
done({
  items: events.filter((e) => e.kind === 'open_item.opened' && e.data?.from === 'task').map((e) => e.data.text),
  bytes: watch ? watch.bytes(transcript) : null, reads, rssStart, rise, peakRss: rssStart + rise, ms, error,
});
