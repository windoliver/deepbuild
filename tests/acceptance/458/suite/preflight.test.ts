// #458 criterion 4: nothing in the repo runs the suite on push or pull request; it runs in the local preflight. The
// local preflight is scripts/preflight, which runs the `checks` of scripts/lanes.mjs and, at release, its
// `releaseLanes`; the design's Decided row has the quick lane run during work and everything at release. At the base
// no lane runs the suite, since there is none. The wrong programs are the base, a suite no preflight lane starts, and
// a workflow that starts on a push or a pull request and runs the suite or the preflight.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT } from './helpers.ts';

interface LaneEntry { name: string; commands: string[][] }
/** A workflow that names one of these starts on every push to a branch or on a pull request. */
const ON_PUSH = /\b(push|pull_request|pull_request_target|merge_group)\b/;
/** What runs the suite, or a lane that does: its two scripts, the preflight and the lane tables. */
const RUNS_SUITE = /parity-suite|fixture-scan|scripts\/preflight|preflight\.mjs|checks\.mjs|lanes\.mjs/;

describe(`${AC[4]} the suite runs in the local preflight, never on push or pull request`, () => {
  it(`${AC[4]} a check of the local preflight runs the quick lane, a release lane runs the full lane and the release report, and no workflow that starts on a push or a pull request runs the suite or the preflight`, async () => {
    const lanes = (await import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href)) as { checks: LaneEntry[]; releaseLanes: LaneEntry[] };
    const runs = (list: LaneEntry[], ...words: string[]): string[] =>
      list.filter((lane) => lane.commands.some((command) => command.some((part) => part.endsWith('scripts/parity-suite.mjs')) && words.every((word) => command.includes(word)))).map((lane) => lane.name);
    expect(runs(lanes.checks, 'run', 'quick').length, 'a check in scripts/lanes.mjs runs `scripts/parity-suite.mjs run quick`, so the quick lane runs in the local preflight').toBeGreaterThan(0);
    expect(runs(lanes.releaseLanes, 'run', 'full').length, 'a release lane in scripts/lanes.mjs runs `scripts/parity-suite.mjs run full`').toBeGreaterThan(0);
    expect(runs(lanes.releaseLanes, 'report').length, 'a release lane in scripts/lanes.mjs runs `scripts/parity-suite.mjs report`, so the bar is applied in the release preflight').toBeGreaterThan(0);
    // The checks run on every change: the full lane and the report stay out of them.
    expect([...runs(lanes.checks, 'run', 'full'), ...runs(lanes.checks, 'report')], 'no check of the per-change preflight runs the full lane or the release report').toEqual([]);

    // Nothing on push or pull request: the workflows git lists, tracked or new, and any on disk.
    const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '.github'], { cwd: REPO, encoding: 'utf8' });
    expect(listed.status, `git lists the checkout's files: ${listed.stderr}`).toBe(0);
    const folder = join(REPO, '.github', 'workflows');
    const onDisk = existsSync(folder) ? readdirSync(folder, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(REPO.length + 1)) : [];
    const workflows = [...new Set([...listed.stdout.split('\n').filter((path) => path.startsWith('.github/workflows/')), ...onDisk])].filter((path) => existsSync(join(REPO, path)));
    const offenders = workflows.filter((path) => {
      const text = readFileSync(join(REPO, path), 'utf8');
      return ON_PUSH.test(text) && RUNS_SUITE.test(text);
    });
    expect(offenders, 'no workflow that starts on a push or a pull request runs the suite, the fixture scan or the preflight').toEqual([]);
  }, TIMEOUT);
});
