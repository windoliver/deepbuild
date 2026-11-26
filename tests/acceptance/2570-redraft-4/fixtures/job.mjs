// The scene's preload for the job the service-manager stand-in runs (REDRAFT.md: The scene). The job is the real
// `deep hub run`; this only shapes how its process ends, from $T2570_SM/behaviour.json:
//
// - `exitMs`: once the hub's process has begun to exit (process.exit, after the hub removed its socket and released
//   its lock), it stays a live process for that many milliseconds more, then ends with the hub's own exit code. The
//   gap the issue names: the socket is quiet and the job is still running.
// - `neverAnswers`: the hub's program never runs; the process stays up and never listens. A hub that never answers.
//
// Only the job's main thread is shaped, and NODE_OPTIONS is dropped, so nothing the hub starts carries this preload.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

const state = process.env.T2570_SM;
delete process.env.NODE_OPTIONS;
const behaviour = () => { try { return JSON.parse(readFileSync(join(state, 'behaviour.json'), 'utf8')); } catch { return {}; } };
const log = (o) => { try { appendFileSync(join(state, 'events.jsonl'), `${JSON.stringify({ t: Date.now(), pid: process.pid, ...o })}\n`); } catch { /* the sandbox is gone */ } };

if (isMainThread && state) {
  if (behaviour().neverAnswers) {
    log({ event: 'never-answers' });
    setInterval(() => undefined, 1 << 30);
    await new Promise(() => undefined);
  }
  process.on('exit', (code) => {
    const ms = Number(behaviour().exitMs) || 0;
    log({ event: 'exiting', code, lingerMs: ms });
    if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  });
}
