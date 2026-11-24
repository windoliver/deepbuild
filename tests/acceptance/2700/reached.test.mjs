// #2700 criterion #2700.dad8fae2: "A patch whose `reached` names no member outside `items` is revised without the
// whole load, even when another member differs. A planted `revise_items` that compares every member fails, naming
// the member"
//   node --test tests/acceptance/2700/reached.test.mjs
// The probe (probe-reached/, REVISE-ITEMS.md) loads a board in a session and hands
// `deep_canvas::schedule::Session::revise_items` a revision that changes item `a` and one member outside `items`
// (`data`, then `assets`), with `reached` empty. "Revised without the whole load" is `revise_items` answering
// (`Some`), not `None`, which sends its caller to `load`, and the session's revision (`Session::document`) then
// holding the patched item. The same patch with the member named in `reached` must answer `None` (Scope: "compares
// only those"). The probe is a release build with debug assertions off:
// `revise_items` debug-asserts that no member outside `reached` changed, and this is that case on purpose.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CHANGE, HERE, shown } from './lib.mjs';

const AC_REACHED = '#2700.dad8fae2';
const PROBE = join(HERE, 'probe-reached');
const TARGET = 'target/acceptance-2700-reached';
const COPY = `${TARGET}/probe`;
const BINARY = join(CHANGE, TARGET, 'release', 'acceptance-2700-reached-probe');
const tail = (text, n = 3000) => String(text ?? '').slice(-n);

/** Builds and runs the probe; a probe that can't be built, run or report fails the test as BLOCKED. */
function probe() {
  // As lib.mjs does: build a copy under the target folder, so cargo never rewrites probe-reached/Cargo.lock.
  const put = (path, text) => {
    const to = join(CHANGE, COPY, path);
    mkdirSync(dirname(to), { recursive: true });
    if (!existsSync(to) || readFileSync(to, 'utf8') !== text) writeFileSync(to, text);
  };
  const manifest = readFileSync(join(PROBE, 'Cargo.toml'), 'utf8');
  const there = 'path = "../../../../crates/deep-canvas"';
  if (!manifest.includes(there)) assert.fail(`BLOCKED: probe-reached/Cargo.toml no longer names the canvas core as ${there}`);
  put('Cargo.toml', manifest.replace(there, 'path = "../../../crates/deep-canvas"'));
  put('src/main.rs', readFileSync(join(PROBE, 'src/main.rs'), 'utf8'));
  if (!existsSync(join(CHANGE, COPY, 'Cargo.lock'))) put('Cargo.lock', readFileSync(join(PROBE, 'Cargo.lock'), 'utf8'));
  const args = ['build', '--release', '--quiet', '--manifest-path', `${COPY}/Cargo.toml`, '--target-dir', TARGET];
  const b = spawnSync('cargo', args, { cwd: CHANGE, encoding: 'utf8', timeout: 2_400_000, maxBuffer: 1 << 26 });
  if (b.error) assert.fail(`BLOCKED: cargo ${args.join(' ')} did not run: ${b.error.message}`);
  if (b.status !== 0) assert.fail(`BLOCKED: the probe does not build against this checkout's canvas core (exit ${b.status}):\n${tail(b.stderr)}`);
  const r = spawnSync(BINARY, [], { cwd: CHANGE, encoding: 'utf8', timeout: 600_000 });
  if (r.error) assert.fail(`BLOCKED: the probe did not run: ${r.error.message}`);
  if (r.status !== 0) assert.fail(`BLOCKED: the probe exited ${r.status ?? r.signal}: ${tail(r.stderr) || tail(r.stdout)}`);
  let report = null;
  try {
    report = JSON.parse(r.stdout.trim().split('\n').at(-1));
  } catch {
    report = null;
  }
  if (!report || typeof report !== 'object') assert.fail(`BLOCKED: the probe printed no report: ${tail(r.stdout, 500)}`);
  if (report.blocked) assert.fail(`BLOCKED: ${report.blocked}`);
  return report;
}

test(`${AC_REACHED} a patch whose reached names no member outside items is revised without the whole load, even when another member differs`, { timeout: 3_600_000 }, () => {
  const report = probe();
  assert.equal(report.debug_assertions, false, 'BLOCKED: the probe was built with debug assertions on, so revise_items asserts instead of answering');
  assert.deepEqual(report.cases?.map((c) => c.member), ['data', 'assets'], `BLOCKED: the probe did not run both members: ${shown(report)}`);
  for (const c of report.cases) {
    // The scenario itself: the revision changes item `a` and this one member, and nothing else.
    assert.equal(c.member_differs, true, `BLOCKED: the revision does not change \`${c.member}\`: ${shown(c)}`);
    assert.deepEqual([...(c.only_item_and_member_differ ?? [])].sort(), ['items', c.member].sort(), `BLOCKED: the revision changes more than \`items\` and \`${c.member}\`: ${shown(c)}`);
    console.log(`${AC_REACHED} \`${c.member}\` differs, reached []: ${c.not_reached.revised ? 'revised' : 'not revised (the whole load)'}; reached [${c.member}]: ${c.reached.revised ? 'revised' : 'not revised (the whole load)'}`);
    assert.equal(c.not_reached.revised, true,
      `revise_items answered None (the whole load) for a patch whose reached names no member outside items: ` +
      `it compared the member \`${c.member}\`, which differs from the revision before and which the patch did not name as reached`);
    // Revised, not merely answered: the session's revision now holds the patched item.
    assert.deepEqual(c.not_reached.box_after, c.box_patched,
      `revise_items answered Some for the patch with reached [] (\`${c.member}\` differs), but the session's revision (Session::document) ` +
      `holds item \`a\` with box ${shown(c.not_reached.box_after)}, not the patched ${shown(c.box_patched)} (before: ${shown(c.box_before)}): it was not revised`);
    // Compares those it names: the same patch with the member named as reached takes the whole load.
    assert.equal(c.reached.revised, false,
      `revise_items revised a patch whose reached names the member \`${c.member}\`, which differs from the revision before: it did not compare the member it was told the patch reached`);
  }
});
