const { dedupe } = require('../src/dedupe.js');
// Against the old nested-loop version.
const old = (items) => items.filter((x, i) => items.findIndex((y, j) => j <= i && y === x && JSON.stringify(y) === JSON.stringify(x)) === i);
const xs = Array.from({ length: 3000 }, (_, i) => i % 2000);
let t = process.hrtime.bigint(); old(xs); const a = process.hrtime.bigint() - t;
t = process.hrtime.bigint(); dedupe(xs); const b = process.hrtime.bigint() - t;
console.log(`${(Number(a) / Number(b)).toFixed(1)}x faster`);
