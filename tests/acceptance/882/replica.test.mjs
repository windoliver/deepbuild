// #882 AC3: "With macOS set to dark, a replica (#124) of Needs you and a session page draws every chrome color from
// the dark roles, and every ink tier passes its contrast floor on ground, raised and hover; a build that keeps the
// light ground in dark fails, naming the view". Proof: "replica screenshots of Needs you and a session page in light
// and dark". The replica is `deep-replica --view <view> --out <dir> --appearance <light|dark>`, the base's binary
// with the appearance macOS reports; the roles come from `deep-canvas-render look` (look.test.mjs). README.md, The
// surface, pins both. Needs macOS (the replica renders with Metal); elsewhere each test fails INCONCLUSIVE.
// Run: node --test tests/acceptance/882/replica.test.mjs
// Set DA882_SCREENS=<dir> to keep the screenshots there for the proof; otherwise they go to /tmp/da882-* and are removed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, FLOORS, buildBin, contrast, ensureDir, readPng, remove, repoRoot, tempRoot } from './common.mjs';
import { inkProblems, judgeScreen } from './replica-judge.mjs';

const VIEWS = { 'needs-you': 'Needs you', session: 'Session ' };
const keep = process.env.DA882_SCREENS;
const out = keep ?? tempRoot('screens');
if (!keep) process.on('exit', () => remove(out));

function inconclusive() {
  return process.platform === 'darwin' ? null : `INCONCLUSIVE: the replica renders with Metal on macOS only; this is ${process.platform}`;
}

let roles;
/** The shipped look's roles per appearance, as the guard resolves them. */
function lookRoles() {
  if (roles) return roles;
  const bin = buildBin('deep-marks-render', 'deep-canvas-render');
  if (bin.error) return { error: bin.error };
  const run = spawnSync(bin.path, ['look'], { cwd: repoRoot, input: '{"look":"clean"}\n', encoding: 'utf8', timeout: 120_000 });
  try {
    const answer = JSON.parse(run.stdout.split('\n')[0]);
    roles = answer.roles?.light && answer.roles?.dark ? answer.roles : { error: `the look's answer has no roles per appearance: ${JSON.stringify({ ...answer, look: '(the definition)' }).slice(0, 400)}` };
  } catch {
    roles = { error: `deep-canvas-render look answered no JSON (exit ${run.status}): ${run.stderr.slice(0, 400)}` };
  }
  return roles;
}

/** The replica's screen and snapshot of `view`, with `appearance` (or none: the replica's own default). */
function screen(view, appearance) {
  const bin = buildBin('deep-replica', 'deep-replica');
  if (bin.error) return { error: bin.error };
  const dir = join(out, appearance ?? 'default');
  ensureDir(dir);
  const args = ['--view', view, '--out', dir, ...(appearance ? ['--appearance', appearance] : [])];
  const run = spawnSync(bin.path, args, { cwd: repoRoot, encoding: 'utf8', timeout: 300_000 });
  const png = join(dir, 'screens', `${view}.png`);
  if (run.status !== 0 || !existsSync(png)) return { error: `deep-replica ${args.join(' ')} exited ${run.status}: ${`${run.stderr}${run.stdout}`.trim().slice(0, 600)}` };
  return { image: readPng(png), snapshot: readFileSync(join(dir, 'snapshots', `${view}.json`), 'utf8') };
}

/** Each view in `appearance` judged by that appearance's roles, and its snapshot showing the view's title. */
function judgeAppearance(appearance) {
  const why = inconclusive();
  if (why) return [why];
  const all = lookRoles();
  const other = appearance === 'dark' ? 'light' : 'dark';
  const failures = all.error ? [all.error] : [];
  for (const [view, title] of Object.entries(VIEWS)) {
    const shot = screen(view, appearance);
    if (shot.error) {
      failures.push(`${view} (${appearance}): ${shot.error}`);
      continue;
    }
    if (!shot.snapshot.includes(`"${title}`)) failures.push(`${view} (${appearance}): its snapshot has no node named ${JSON.stringify(title)}`);
    if (!all.error) failures.push(...judgeScreen({ view, appearance, image: shot.image, roles: all[appearance], other: all[other] }));
  }
  return failures;
}

test(`${AC[3]} with macOS set to dark, the replica's Needs you and session page draw every chrome color from the dark roles`, () => {
  assert.deepEqual(judgeAppearance('dark'), []);
});

test(`${AC[3]} (proof) in light, the same views draw every chrome color from the light roles`, () => {
  assert.deepEqual(judgeAppearance('light'), []);
});

test(`${AC[3]} every ink tier passes its contrast floor on ground, raised and hover, in dark and in light`, () => {
  const all = lookRoles();
  assert.deepEqual(all.error ? [all.error] : [...inkProblems('dark', all.dark, FLOORS, contrast), ...inkProblems('light', all.light, FLOORS, contrast)], []);
});

test(`${AC[3]} a build that keeps the light ground in dark fails the dark judge, naming the view`, () => {
  const why = inconclusive();
  const all = why ? null : lookRoles();
  const failures = [];
  if (why) failures.push(why);
  else if (all.error) failures.push(all.error);
  else {
    for (const view of Object.keys(VIEWS)) {
      // The replica without an appearance draws as macOS's default, light: a build that never follows dark draws this.
      const shot = screen(view, null);
      if (shot.error) {
        failures.push(`${view}: ${shot.error}`);
        continue;
      }
      const verdict = judgeScreen({ view, appearance: 'dark', image: shot.image, roles: all.dark, other: all.light });
      if (!verdict.some((line) => line.startsWith(`${view} (dark): a fill of `) && line.includes("the other appearance's ground"))) {
        failures.push(`${view}: the light screen judged as dark isn't failed for the light ground: ${verdict.join(' | ') || 'no failure'}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
