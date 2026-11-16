// #2331's preload (README): loaded with NODE_OPTIONS=--require into a process, it counts every date or number
// formatter that process constructs, through `Intl.DateTimeFormat` and `Intl.NumberFormat` (with or without `new`) and
// the toLocale*String methods of Date, Number and BigInt, each with where it was called from. It changes no result.
// At exit it writes { pid, argv, made } to <$DEEP_2331_FORMATTERS>/<pid>.json, so a process that never loaded it leaves
// no record, and the test reads that as nothing counted, never as zero.
'use strict';
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = process.env.DEEP_2331_FORMATTERS;
const made = [];
const note = (what) => {
  const where = String(new Error().stack ?? '').split('\n').slice(3, 8).map((line) => line.trim()).join(' < ');
  made.push({ what, where });
};

for (const name of ['DateTimeFormat', 'NumberFormat']) {
  const Original = Intl[name];
  const Counted = new Proxy(Original, {
    construct(target, args, newTarget) {
      note(`Intl.${name}`);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, self, args) {
      note(`Intl.${name}`);
      return Reflect.apply(target, self, args);
    },
  });
  Object.defineProperty(Original.prototype, 'constructor', { value: Counted, writable: true, configurable: true });
  Object.defineProperty(Intl, name, { value: Counted, writable: true, configurable: true });
}

for (const [proto, owner, names] of [
  [Date.prototype, 'Date', ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']],
  [Number.prototype, 'Number', ['toLocaleString']],
  [BigInt.prototype, 'BigInt', ['toLocaleString']],
]) {
  for (const name of names) {
    const original = proto[name];
    const counted = {
      [name](...args) {
        note(`${owner}.prototype.${name}`);
        return Reflect.apply(original, this, args);
      },
    }[name];
    Object.defineProperty(proto, name, { value: counted, writable: true, configurable: true });
  }
}

process.on('exit', () => {
  if (!dir) return;
  try {
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, argv: process.argv.slice(1), made }));
  } catch {
    // No record: the test reads a missing record as nothing counted.
  }
});
