// A preload for the hub, loaded into every thread of it: `node --import <this file> packages/cli/dist/main.js hub run`.
// Node runs an --import module in the main thread and in each worker thread, and each thread has its own
// node:child_process, so each thread records the child processes it starts itself: one JSON line per call appended to
// $DEEP_TEST_THREADS_LOG, {pid, thread, main, call, file, args, cwd, stack}. A thread's first line says it loaded, so
// a test can tell a thread that started nothing from a preload that never ran. After #16's main-thread preload
// (tests/acceptance/16/fixtures/preload.mjs, same repo, same license), which records the main thread only.
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { isMainThread, threadId } from 'node:worker_threads';

const LOG = process.env.DEEP_TEST_THREADS_LOG;
if (LOG) {
  const cp = createRequire(import.meta.url)('node:child_process');
  const put = (line) => appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, thread: threadId, main: isMainThread, ...line })}\n`);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const original = cp[name];
    cp[name] = function (...args) {
      const options = args.find((a) => typeof a === 'object' && a !== null && !Array.isArray(a));
      put({
        call: name, file: String(args[0]), args: Array.isArray(args[1]) ? args[1].map(String) : [],
        cwd: typeof options?.cwd === 'string' ? options.cwd : null,
        stack: (new Error().stack ?? '').split('\n').slice(2, 14).map((l) => l.trim()),
      });
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
  put({ loaded: true });
}
