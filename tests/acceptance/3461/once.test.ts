// #3461 criterion 5 (README, The forms): every command, given each of its flags once, prints and exits as on the merge
// base. Each form in helpers.ts runs in a fresh set-up home with no hub; its exit code, stdout and stderr (paths, ULIDs,
// clock times and durations written as placeholders) must equal what the merge base printed for it, recorded by this
// job in fixtures/base-once.json. Every flag each usage line of `deep --help` shows is given once by some form, but the
// two NOT_RUN names. A difference fails the test, which lists every one. The merge base passes; the twin `once-refused`
// fails it.
import { readFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { NOT_RUN, SECOND, cleanup, deep, forms, help, lineOf, needBuild, normalized, usageLines, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.a80d1545';

interface Recorded { args: string[]; code: number | null; stdout: string; stderr: string }
const BASE = JSON.parse(readFileSync(new URL('./fixtures/base-once.json', import.meta.url), 'utf8')) as Recorded[];

it(`${ID} every command given each of its flags once prints and exits as on the merge base`, async () => {
  needBuild();
  const lines = usageLines(await help());
  const failures: string[] = [];
  const probe = world();
  const all = forms(probe);
  for (const line of lines) {
    for (const flag of line.flags) {
      if (NOT_RUN.some((n) => lineOf(lines, n.line) === line && n.flag === flag.name)) continue;
      if (!all.some((f) => lineOf(lines, f.line) === line && f.args.includes(flag.name))) failures.push(`BLOCKED: no form of "${line.synopsis.slice(0, 60)}" gives ${flag.name}`);
    }
  }
  const deltas: string[] = [];
  for (const [i, form] of all.entries()) {
    // A fresh world for each form, so one form's files never change another's output.
    const w = world();
    const args = forms(w)[i]!.args;
    const key = JSON.stringify(args.map((a) => normalized(w, a)));
    const base = BASE.find((b) => JSON.stringify(b.args) === key);
    if (!base) { failures.push(`BLOCKED: the merge base's record has no run of deep ${key}`); continue; }
    const r = await deep(w, args);
    const now = { code: r.code, stdout: normalized(w, r.stdout), stderr: normalized(w, r.stderr) };
    const diff = (['code', 'stdout', 'stderr'] as const).filter((k) => now[k] !== base[k]);
    if (diff.length) deltas.push(`deep ${base.args.join(' ')} (${form.line}): ${diff.map((k) => `${k} ${JSON.stringify(base[k])} on the merge base, ${JSON.stringify(now[k])} now`).join('; ')}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
  expect(deltas, `${deltas.length} of ${all.length} commands given each flag once print or exit otherwise than on the merge base:\n${deltas.join('\n')}`).toEqual([]);
}, 1200 * SECOND);
