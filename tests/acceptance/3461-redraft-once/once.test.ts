// #3461 criterion a80d1545, redrafted blind (REDRAFT.md): every command, given each of its flags once, prints and exits
// as on the merge base, and any leftover delta is listed. The merge base is run, not recalled: its tree, pinned at BASE,
// is built beside this checkout and finds the same Rust builds (helpers.ts, baseProgram). Each form runs twice, once
// under each program, each in a fresh world of the same shape; their exit codes, stdout and stderr, normalized, must be
// equal. Every flag each usage line of the merge base's `deep --help` shows is given once by some form, but the two
// NOT_RUN names. The failure lists every delta. Passes on the merge base; the twin `once-refused` fails it.
import { afterAll, expect, it } from 'vitest';
import { NOT_RUN, SECOND, TESTED, baseProgram, cleanup, deep, forms, help, lineOf, needBuild, normalized, usageLines, world, type Program } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.a80d1545';

it(`${ID} every command given each of its flags once prints and exits as on the merge base, and any leftover delta is listed`, async () => {
  needBuild(TESTED);
  const base = baseProgram();
  needBuild(base);
  const lines = usageLines(await help(base));
  const failures: string[] = [];
  if (lines.length === 0) failures.push(`BLOCKED: ${base.name}'s deep --help shows no usage line`);
  const all = forms(world());
  for (const line of lines) {
    for (const flag of line.flags) {
      if (NOT_RUN.some((n) => lineOf(lines, n.line) === line && n.flag === flag)) continue;
      if (!all.some((f) => lineOf(lines, f.line) === line && f.args.includes(flag))) failures.push(`BLOCKED: no form of "${line.synopsis.slice(0, 60)}" gives ${flag}`);
    }
  }
  for (const f of all) if (!lineOf(lines, f.line)) failures.push(`BLOCKED: ${base.name}'s deep --help has no usage line starting "${f.line}"`);
  expect(failures, failures.join('\n')).toEqual([]);

  const deltas: string[] = [];
  const once = async (p: Program, i: number) => {
    // A fresh world for each run, so neither program's files change the other's output.
    const w = world();
    const args = forms(w)[i]!.args;
    const r = await deep(p, w, args);
    return { args: args.map((a) => normalized(p, w, a)), code: r.timedOut ? `killed at the timeout (${r.code ?? r.signal})` : r.code, stdout: normalized(p, w, r.stdout), stderr: normalized(p, w, r.stderr) };
  };
  for (const [i, form] of all.entries()) {
    // Which program goes first alternates, so neither always meets the machine a moment earlier.
    let then: Awaited<ReturnType<typeof once>>;
    let now: Awaited<ReturnType<typeof once>>;
    if (i % 2 === 0) { then = await once(base, i); now = await once(TESTED, i); } else { now = await once(TESTED, i); then = await once(base, i); }
    const diff = (['code', 'stdout', 'stderr'] as const).filter((k) => now[k] !== then[k]);
    if (diff.length) deltas.push(`deep ${then.args.join(' ')} (${form.line}): ${diff.map((k) => `${k} ${JSON.stringify(then[k])} on the merge base, ${JSON.stringify(now[k])} in this checkout`).join('; ')}`);
  }
  expect(deltas, `${deltas.length} of ${all.length} commands given each flag once print or exit otherwise than on the merge base:\n${deltas.join('\n')}`).toEqual([]);
}, 3600 * SECOND);
