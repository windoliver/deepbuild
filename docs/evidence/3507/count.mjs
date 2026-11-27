// How #3507's report was counted. Run from the checkout's root on a reference Mac, with `deep-show` built as the
// acceptance helpers build it:
//
//   DEEP_BIN_DIR=target/debug node docs/evidence/3507/count.mjs
//
// It reads the overdraw mode as the acceptance suite does, through the suite's own driver (`deep-show run`, a
// `deep_show` call that shows the document, then one `mode: "overdraw"` call a frame, under the machine's GPU
// lease): the two walls both ways, shipped and under the planted count; then each class's fixture and #3031's
// every-pass fixture, frame k at k ÷ 5 s, k from 0 to 299. It keeps every frame's row in `counts.json` beside
// itself, as [max, shaded, covered], and prints the report's lines and table.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_FRAMES, NO_DEPTH_TEST, allow, classFixture, counted, everyPass, listed, showBinary, underLease, walls } from '../../../tests/acceptance/3507/drive.mjs';
import { CLASSES, countOf } from '../../../tests/acceptance/3507/judge.mjs';

allow(240);
const bin = showBinary();
const kept = { walls: {}, fixtures: {} };
await underLease('the count', async () => {
  for (const [order, wall] of Object.entries(walls())) {
    for (const planted of [null, NO_DEPTH_TEST]) {
      const { max, shaded, covered, ok, why } = (await counted(bin, { ...wall, frames: [0], planted })).get(0);
      if (!ok) throw Error(`${wall.name}${planted ? `, ${planted}` : ''}: ${why}`);
      (kept.walls[order] ??= {})[planted ?? 'shipped'] = { max, shaded, covered };
    }
  }
  for (const fixture of [...CLASSES.map(classFixture), everyPass()]) {
    const rows = listed(await counted(bin, { ...fixture, frames: ALL_FRAMES, processes: 4 }));
    const mean = countOf(fixture.name, rows);
    if (mean.problems.length) throw Error(mean.problems.slice(0, 5).join('\n'));
    const each = rows.map((r) => r.shaded / r.covered);
    kept.fixtures[fixture.name] = {
      size: fixture.size, frames: rows.length, a_covered_pixel: mean.aCoveredPixel, a_pixel: mean.aPixel,
      least: Math.min(...each), most: Math.max(...each), largest_own: Math.max(...rows.map((r) => r.max)),
      rows: rows.map((r) => [r.max, r.shaded, r.covered]),
    };
    console.error(`counted ${fixture.name}`);
  }
});
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'counts.json'), `${JSON.stringify(kept)}\n`);

const every = kept.fixtures.every_pass;
console.log(`Shaded on \`every_pass\`: ${every.a_covered_pixel.toFixed(3)} a covered pixel, ${every.a_pixel.toFixed(3)} a pixel, over ${every.frames} frames\n`);
console.log('| Fixture | Size | Frames | Shaded a pixel | Shaded a covered pixel | Least to most in a frame | The mode\'s own largest |');
console.log('|---|---|---|---|---|---|---|');
for (const [name, f] of Object.entries(kept.fixtures)) {
  console.log(`| \`${name}\` | ${f.size.join(' × ')} | ${f.frames} | ${f.a_pixel.toFixed(3)} | ${f.a_covered_pixel.toFixed(3)} | ${f.least.toFixed(3)} to ${f.most.toFixed(3)} | ${f.largest_own} |`);
}
console.log('\n| Two walls | Shipped: shaded over covered | Planted count: shaded over covered |');
console.log('|---|---|---|');
for (const [order, w] of Object.entries(kept.walls)) {
  console.log(`| ${order} | ${w.shipped.shaded} over ${w.shipped.covered} | ${w[NO_DEPTH_TEST].shaded} over ${w[NO_DEPTH_TEST].covered} |`);
}
