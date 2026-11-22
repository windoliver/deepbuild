// The recorder's preload (#3065, scripts/reach.mjs record): every node process of a recorded test file notes itself
// and the words of each command it starts in the file DEEP_REACH names, and hands the recording on to its children
// whatever environment the test gives them, so a hub started with a cleaned environment is still seen. The recorder
// keeps only the words that name a workspace binary; none reaches the record. A node process stopped by a signal
// writes no coverage, so on SIGTERM, SIGINT and SIGHUP, where the program listens for none of its own, it writes its
// coverage first and then ends by the signal as it would have: a program that signals itself runs on until that is done.
const cp = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const { isMainThread, threadId } = require('node:worker_threads');
const { takeCoverage } = require('node:v8');

const KEEP = Object.fromEntries(['DEEP_REACH', 'NODE_V8_COVERAGE'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
const REQUIRE = `--require ${JSON.stringify(__filename)}`;
const write = (lines) => { try { appendFileSync(KEEP.DEEP_REACH, lines.map((line) => `${line}\n`).join('')); } catch {} };
// The recorder asks each thread noted here for its coverage, which node writes a thread, so one that left none, as a
// worker alive when its process is stopped, leaves its test with no row. A `node --test` runner writes none of its
// own, so it isn't noted: it starts each file's process, which notes itself, and what the runner loads, a reporter
// or a setup file, reaches no row.
if (!(process.execArgv.includes('--test') && !process.env.NODE_TEST_CONTEXT)) write([`pid ${process.pid}-${threadId}`]);

// A command's words: the program, and each word of its arguments, since a shell, env, sandbox-exec or the lease
// starts what its arguments name.
const note = (words) => write(words.filter((word) => typeof word === 'string').flatMap((word) => word.split(/[^\w@.\/+-]+/)).filter(Boolean));
// The child's environment with the recording in it.
function carried(env) {
  const options = env.NODE_OPTIONS ?? '';
  return { ...env, ...KEEP, NODE_OPTIONS: options.includes(__filename) ? options : `${options} ${REQUIRE}`.trim() };
}

const spawn = cp.ChildProcess.prototype.spawn;
cp.ChildProcess.prototype.spawn = function (settings) {
  note([settings.file, ...settings.args ?? []]);
  if (Array.isArray(settings.envPairs)) {
    const env = carried(Object.fromEntries(settings.envPairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])));
    settings.envPairs = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }
  return spawn.call(this, settings);
};
// The synchronous calls share no method, so each is wrapped: its command, and its options' env.
for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
  const real = cp[name];
  cp[name] = function (file, ...rest) {
    note([file, ...Array.isArray(rest[0]) ? rest[0] : []]);
    // The options are the last argument when it is an object; without them the child takes this process's environment.
    while (rest.length && rest.at(-1) === undefined) rest.pop();
    const options = rest.at(-1) && typeof rest.at(-1) === 'object' && !Array.isArray(rest.at(-1)) ? rest.pop() : {};
    return real.call(this, file, ...rest, { ...options, env: carried(options.env ?? process.env) });
  };
}
syncBuiltinESMExports();

if (isMainThread && KEEP.NODE_V8_COVERAGE) for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  const stop = () => {
    // With a listener of the program's, the program decides: it may run on and load more, so its coverage is what it
    // writes as it exits, and none if it is killed. Alone on the signal, this process was to end by it.
    if (process.listenerCount(signal) > 1) return;
    try { takeCoverage(); } catch {}
    process.off(signal, stop);
    process.kill(process.pid, signal);
  };
  process.on(signal, stop);
}
