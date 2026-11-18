// Preloaded by --import into a command a benchmark measures (process-reader.mjs: loadedModules): each module the
// command then loads is written, by its URL, to the file DEEP_BENCH_MODULES names. It imports nothing itself: a
// module this file had imported would already be loaded when the command asks for it, and go unlisted.
const { appendFileSync } = process.getBuiltinModule('node:fs');

process.getBuiltinModule('node:module').registerHooks({
  load(url, context, nextLoad) {
    appendFileSync(process.env.DEEP_BENCH_MODULES, `${url}\n`);
    return nextLoad(url, context);
  },
});
