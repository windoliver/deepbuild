// #2339 criteria 1 and 4, live: the real design links lane on this checkout passes on the section and on the canvas
// reference's link to it, reading the open issues once through gh. Offline or signed out it skips as INCONCLUSIVE,
// never a pass (README: How to run them).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CANVAS, CHECKOUT, CONVENTIONS, DESIGN, principles, read, runLane, shown } from './helpers.mjs';

let run;
/** One fetch of the open issues and one lane run for the file, or a reason to skip. */
function lane(t) {
  if (!run) {
    const dir = mkdtempSync(join(tmpdir(), 'deep-2339-live-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    const gh = spawnSync('gh', ['issue', 'list', '--repo', 'windoliver/deepbuild', '--state', 'open', '--limit', '5000', '--json', 'number,body'], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (gh.status !== 0) run = { skip: `INCONCLUSIVE: gh could not list the open issues: ${(gh.error?.message ?? gh.stderr).trim()}` };
    else {
      const issues = join(dir, 'open-issues.json');
      writeFileSync(issues, gh.stdout);
      run = runLane(CHECKOUT, issues);
      if (run.lines.some((l) => /^INCONCLUSIVE\b/.test(l))) run.skip = `INCONCLUSIVE: the lane could not read what it needs: ${run.output.trim()}`;
    }
  }
  if (run.skip) t.skip(run.skip);
  return run;
}

test('#2339.2ae5a05d criterion 1: the design links lane passes on this checkout, with the Principles section in the design', (t) => {
  assert.ok(principles(read(CHECKOUT, DESIGN)), `${DESIGN} has no heading "Principles", so the lane has no section to pass on`);
  const r = lane(t);
  if (!r) return;
  assert.equal(r.status, 0, `the design links lane fails on this checkout: ${shown(r)}`);
});

test('#2339.6eaafe21 criterion 4: the design links lane passes on this checkout, with the canvas reference\'s link to the section landing', (t) => {
  const section = principles(read(CHECKOUT, DESIGN));
  assert.ok(section, `${DESIGN} has no heading "Principles", so no link to it can land`);
  const canvas = read(CHECKOUT, CANVAS);
  const linked = [...section.anchors].some((id) => canvas.includes(`technical-design.md#${id})`));
  assert.ok(linked, `${CANVAS} has no link to technical-design.md#${[...section.anchors].join(' or #')} (under "${CONVENTIONS}")`);
  const r = lane(t);
  if (!r) return;
  assert.equal(r.status, 0, `the design links lane fails on this checkout: ${shown(r)}`);
});
