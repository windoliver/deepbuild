// #317 AC1, AC4: the `.deepbuild/` guard is the core's floor, holding with the hub stopped and with the hub up in
// safe mode (no extension loaded), and this repo's own entries protect its repo-rules check. Each denial names
// deep_propose. The wrong programs are data: the defaults with every entry that holds the planted call left out
// (README, Wrong programs). Every decision is the real binary's; no planted call runs.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  REPO, buildDeepHook, cleanup, defaultRules, edit, expectAllowed, expectDenied, makeRepo, merged, repoRules,
  sh, without, world, write, type Call, type Mode,
} from './helpers.ts';

beforeAll(async () => { await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/** A temp repo with a committed `.deepbuild/done.yaml`, the session's cwd. */
const specRepo = () => makeRepo({ README: 'base\n', '.deepbuild/done.yaml': 'claims:\n  done:\n    checks: [unit]\n', 'src/app.ts': 'export {};\n' }).dir;
const specWrites = (repo: string): Call[] => [
  { label: 'Edit .deepbuild/done.yaml', body: (w) => edit(w.s, join(repo, '.deepbuild/done.yaml')), propose: true },
  { label: 'Write .deepbuild/done.yaml', body: (w) => write(w.s, join(repo, '.deepbuild/done.yaml')), propose: true },
  sh('sed -i s/unit/none/ .deepbuild/done.yaml', undefined, true),
];

describe('AC1 #317.24a63675 an Edit, Write or sed -i of .deepbuild/done.yaml is denied with the hub stopped and in safe mode, naming deep_propose; a guard left to the done gate extension fails', () => {
  it.each(['stopped', 'safe'] as Mode[])('AC1 the floor denies all three writes of the spec, naming deep_propose, %s; an ordinary source edit is allowed', async (mode) => {
    const repo = specRepo();
    const w = await world({ rules: defaultRules(), mode, cwd: repo });
    await expectDenied(w, specWrites(repo));
    await expectAllowed(w, [{ label: 'Edit src/app.ts', body: (x) => edit(x.s, join(repo, 'src/app.ts')) }]);
  }, 900_000);

  it('AC1 (wrong program) a build whose floor leaves the .deepbuild/ guard to the done gate extension allows the Edit with the hub stopped and in safe mode, and fails', async () => {
    const repo = specRepo();
    const plant = await without(defaultRules(), specWrites(repo)[0]!, repo);
    for (const mode of ['stopped', 'safe'] as Mode[]) {
      const w = await world({ rules: plant.rules, mode, cwd: repo });
      await expect(expectDenied(w, specWrites(repo))).rejects.toThrow(/Edit \.deepbuild\/done\.yaml.* must be denied/);
    }
  }, 900_000);
});

// In this repo: the session's cwd is this checkout. deep-hook only decides; nothing is written.
const RULES_JSON = 'scripts/repo-rules.json';
const RULES_MJS = 'scripts/repo-rules.mjs';
const ruleWrites: Call[] = [RULES_JSON, RULES_MJS].flatMap((f) => [
  { label: `Edit ${f}`, body: (w) => edit(w.s, join(REPO, f)), propose: true },
  { label: `Write ${f}`, body: (w) => write(w.s, join(REPO, f)), propose: true },
  sh(`sed -i s/a/b/ ${f}`, undefined, true),
] as Call[]);
const lanesEdit: Call = { label: 'Edit scripts/lanes.mjs', body: (w) => edit(w.s, join(REPO, 'scripts/lanes.mjs')) };

describe('AC4 #317.6536a48a in this repo an Edit, Write or sed -i of scripts/repo-rules.json or .mjs is denied with the hub stopped, naming deep_propose; scripts/lanes.mjs is allowed; a .deepbuild/-only guard fails', () => {
  it('AC4 this repo\'s own entries deny all six writes, naming deep_propose; an Edit of scripts/lanes.mjs is allowed', async () => {
    const w = await world({ rules: merged(defaultRules(), repoRules()), mode: 'stopped', cwd: REPO });
    await expectDenied(w, ruleWrites);
    await expectAllowed(w, [lanesEdit]);
  }, 900_000);

  it('AC4 (wrong program) a guard that protects only .deepbuild/ lets the Edit of scripts/repo-rules.json through and fails', async () => {
    const plant = await without(merged(defaultRules(), repoRules()), ruleWrites[0]!, REPO);
    const w = await world({ rules: plant.rules, mode: 'stopped', cwd: REPO });
    // What's left still guards .deepbuild/: the plant is the guard the criterion names, not an empty floor.
    await expectDenied(w, [{ label: 'Edit .deepbuild/done.yaml', body: (x) => edit(x.s, join(REPO, '.deepbuild/done.yaml')), propose: true }]);
    await expect(expectDenied(w, ruleWrites)).rejects.toThrow(/`Edit scripts\/repo-rules\.json`.* must be denied/);
  }, 900_000);
});
