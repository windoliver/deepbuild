// #2655 acceptance, AC2's reading. A preload for the hub's process (NODE_OPTIONS=--import=<this file>): each thread
// appends `<thread> armed` to $DEEP_2655_TLS when it starts, and `<thread> <how>` the first time it loads node:tls:
// - through a load hook, as packages/hub/test/startup-memory.test.ts reads its lists (an import or a require);
// - through the thread's own list of loaded built-ins, looked at every 100 ms on a timer that keeps nothing alive, since
//   process.getBuiltinModule and a built-in's own requires pass no load hook.
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { threadId } from 'node:worker_threads';

const log = process.env.DEEP_2655_TLS;
if (log) {
  const said = new Set();
  const say = (how) => { if (!said.has(how)) { said.add(how); appendFileSync(log, `${threadId} ${how}\n`); } };
  registerHooks({ load(url, context, next) { if (url === 'node:tls' || url === 'tls') say('load-hook node:tls'); return next(url, context); } });
  const look = () => { if (process.moduleLoadList.some((m) => /^NativeModule (tls|_tls_wrap|_tls_common)$/.test(m))) say('built-ins node:tls'); };
  look();
  setInterval(look, 100).unref();
  appendFileSync(log, `${threadId} armed\n`);
}
