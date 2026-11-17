// A preload for `deep hub run` (#2646): node --require <this file> packages/cli/dist/main.js hub run.
// It stands at one boundary the hub doesn't own, better-sqlite3, in every thread of the hub, and writes what passes
// it to $DEEP_2646_LOG, one JSON line each:
//   {t:'loaded', pid, thread, sqlite}        this thread loaded the preload over that copy of better-sqlite3
//   {t:'sql', thread, id, sql}               a statement text this thread met, once, with the id its other lines use
//   {t:'p', thread, id, w?}                  a statement compiled (Database.prepare); w: on the hub's writable ledger
//   {t:'x', thread, id, rows, first?, args?, named?, minute?}
//                                            a statement run (all or get) and the rows it gave back: written for a
//                                            text's first run (with its bound values), for a run whose text or bound
//                                            values name one of $DEEP_2646_NAMES (by index), and for a run under a
//                                            minute this preload brought on
//   {t:'fired', thread, minute, timers}      the core thread's 60,000 ms interval timers, called for that minute
// With $DEEP_2646_MINUTES set, the thread that compiles on the writable ledger (the core's) is on a test clock for its
// 60,000 ms interval timers: they no longer come by the wall clock, and the thread reads that file every 20 ms: each
// new line names a minute, and the timers' callbacks are called once for it, inside an async context, so every
// statement they lead to carries the minute. Nothing else of the hub changes, and only these tests set the variables.
'use strict';
const { openSync, readFileSync, writeSync } = require('node:fs');
const { createRequire } = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { join } = require('node:path');
const { threadId } = require('node:worker_threads');

const LOG = process.env.DEEP_2646_LOG;
const CHECKOUT = process.env.DEEP_2646_CHECKOUT;
if (LOG && CHECKOUT) {
  const out = openSync(LOG, 'a');
  const say = (line) => { writeSync(out, `${JSON.stringify(line)}\n`); };
  try {
    const NAMES = JSON.parse(process.env.DEEP_2646_NAMES || '[]');
    const MINUTES = process.env.DEEP_2646_MINUTES;
    const minute = new AsyncLocalStorage();
    // The hub's own copy: resolved from the checkout whose hub this is, never from this file's folder.
    const resolved = createRequire(join(CHECKOUT, 'package.json')).resolve('better-sqlite3');
    const Database = require(resolved);
    const probe = new Database(':memory:');
    const methods = Object.getPrototypeOf(probe.prepare('SELECT 1'));
    probe.close();

    const ids = new Map();
    const ran = new Set();
    const idOf = (sql) => {
      let id = ids.get(sql);
      if (id === undefined) {
        id = ids.size + 1;
        ids.set(sql, id);
        say({ t: 'sql', thread: threadId, id, sql });
      }
      return id;
    };
    let core = false;
    const prepare = Database.prototype.prepare;
    Database.prototype.prepare = function (sql) {
      const statement = prepare.call(this, sql);
      const ledger = typeof this.name === 'string' && this.name.endsWith('/ledger.db') && !this.readonly;
      if (ledger) core = true;
      say({ t: 'p', thread: threadId, id: idOf(String(sql)), ...(ledger ? { w: 1 } : {}) });
      return statement;
    };
    const shown = (value) => (typeof value === 'bigint' ? { $n: String(value) } : Buffer.isBuffer(value) ? { $bytes: value.length } : value);
    const record = (statement, args, rows) => {
      const sql = statement.source;
      const id = idOf(sql);
      const first = !ran.has(id);
      if (first) ran.add(id);
      const named = [];
      for (let i = 0; i < NAMES.length; i += 1) if (sql.includes(NAMES[i]) || args.some((a) => typeof a === 'string' && a.includes(NAMES[i]))) named.push(i);
      const at = minute.getStore();
      if (!first && !named.length && at === undefined) return;
      say({ t: 'x', thread: threadId, id, rows, ...(first ? { first: 1, args: args.map(shown) } : {}), ...(named.length ? { named } : {}), ...(at === undefined ? {} : { minute: at }) });
    };
    const all = methods.all;
    methods.all = function (...args) {
      const rows = all.apply(this, args);
      record(this, args, rows.length);
      return rows;
    };
    const get = methods.get;
    methods.get = function (...args) {
      const row = get.apply(this, args);
      record(this, args, row === undefined ? 0 : 1);
      return row;
    };

    if (MINUTES) {
      const every = globalThis.setInterval;
      const timers = [];
      // The core thread's 60,000 ms intervals answer to the minutes file alone: the timer the hub holds is real and,
      // on the core thread, calls nothing, so no minute comes by the wall clock beside the test's.
      globalThis.setInterval = function (callback, ms, ...args) {
        if (ms !== 60_000 || typeof callback !== 'function') return every(callback, ms, ...args);
        timers.push(() => callback(...args));
        return every(() => { if (!core) callback(...args); }, ms);
      };
      let taken = 0;
      every(() => {
        if (!core) return;
        const asked = readFileSync(MINUTES, 'utf8').split('\n').filter(Boolean);
        for (; taken < asked.length; taken += 1) {
          const at = Number(asked[taken]);
          for (const fire of timers) minute.run(at, fire);
          say({ t: 'fired', thread: threadId, minute: at, timers: timers.length });
        }
      }, 20).unref();
    }
    say({ t: 'loaded', pid: process.pid, thread: threadId, sqlite: resolved });
  } catch (error) {
    say({ t: 'failed', thread: threadId, why: String(error && error.stack ? error.stack : error) });
  }
}
