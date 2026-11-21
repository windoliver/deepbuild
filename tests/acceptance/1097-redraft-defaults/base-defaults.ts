// The redraft's one addition to the frozen suite's helpers (tests/acceptance/1097/helpers.ts, imported unchanged):
// the defaults the pinned merge base shipped, seeded as the first rules.json of a home the merge base's deep-hook
// reads. The frozen `seedDefaults` copies the checkout's crates/deep-hook/default-rules.json, which now holds every
// default entry added since the pin whose match the pinned reader doesn't know (the first on 2026-11-05, #1294), so it
// fails closed on every call and never shows the fault the wrong-program tests are about (REDRAFT.md).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, REPO, rootOf } from '../1097/helpers.ts';

/** Copies `BASE`'s own crates/deep-hook/default-rules.json, read with `git show`, verbatim in as <home>/.deepbuild/rules.json. */
export function seedBaseDefaults(home: string): void {
  const text = execFileSync('git', ['-C', REPO, 'show', `${BASE}:crates/deep-hook/default-rules.json`], { encoding: 'utf8' });
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'rules.json'), text);
}
