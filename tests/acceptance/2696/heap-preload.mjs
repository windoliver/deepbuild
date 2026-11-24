// #2696 (blind): a preload for a hub the heap test starts (NODE_OPTIONS=--import), in the way of
// packages/hub/test/startup-memory.test.ts: its load hook names the thread that loads the hub's core, and that
// thread writes its own heap whole, under its name by a rename. Here the thread waits for the test's word (the file
// $DEEP_TEST_2696_GO), makes two full collections, and writes process.memoryUsage() to $DEEP_TEST_2696_HEAP.<thread>.
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { threadId } from 'node:worker_threads';

const out = process.env.DEEP_TEST_2696_HEAP, go = process.env.DEEP_TEST_2696_GO;
if (out && go) {
  let core = false;
  registerHooks({ load(url, context, next) { if (url.endsWith('/packages/hub/dist/core.js')) core = true; return next(url, context); } });
  const timer = setInterval(() => {
    if (!core || !existsSync(go)) return;
    clearInterval(timer);
    setFlagsFromString('--expose-gc');
    const collect = runInNewContext('gc');
    collect({ type: 'major', execution: 'sync' });
    collect({ type: 'major', execution: 'sync' });
    const { heapUsed, heapTotal } = process.memoryUsage();
    const file = `${out}.${threadId}`;
    writeFileSync(`${file}.part`, JSON.stringify({ thread: threadId, heapUsed, heapTotal }));
    renameSync(`${file}.part`, file);
  }, 250);
  timer.unref();
}
