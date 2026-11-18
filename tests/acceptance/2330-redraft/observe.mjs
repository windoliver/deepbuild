// Test-only preload: observe real spawn and process exit, never replace start/stop.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

export const now = () => Number(process.hrtime.bigint()) / 1e6;
export function record(kind, extra = {}) {
  appendFileSync(join(process.env.ACC2330_EVENTS, `${process.pid}.jsonl`),
    JSON.stringify({ kind, at: now(), pid: process.pid, ...extra }) + '\n');
}
process.on('exit', code => record('exit', { code }));
const spawn = childProcess.spawn;
childProcess.spawn = function (file, args, options) {
  const hub = args?.[1] === 'hub' && args?.[2] === 'run';
  const at = now();
  const child = spawn(file, args, hub ? { ...options, env: {
    ...(options?.env ?? process.env), ACC2330_START: String(at),
  } } : options);
  if (hub) record('spawn', { child: child.pid, start: at });
  return child;
};
syncBuiltinESMExports();
// Only the scheduled peer replaces hub run. The parent executes main.ts and hubCommand unchanged.
if (process.argv[2] === 'hub' && process.argv[3] === 'run') {
  const { runHub } = await import('./hub.mjs');
  await runHub();
}
