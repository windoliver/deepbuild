// #3461 criterion 2 (README): `deep show --doc X --doc Y --document f.json`, `deep env up --root a --root b` and
// `deep find x --root a --root b` each print their usage and exit 2. Stand-in hubs at the home's socket and at a's and
// b's record what each command sends; on the merge base each command acts on the later value (doc Y, root b), and the
// test fails naming the command.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { SECOND, callsShown, cleanup, deep, needBuild, printsUsageOf, rootOf, shown, standIn, world, type StandIn } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.7c168213';

it(`${ID} deep show given --doc twice, deep env up and deep find given --root twice each print their usage and exit 2`, async () => {
  needBuild();
  const w = world();
  const hubs: Record<string, StandIn> = {
    home: await standIn(rootOf(w)),
    a: await standIn(join(w.tmp, 'a')),
    b: await standIn(join(w.tmp, 'b')),
  };
  const doc = join(w.tmp, 'f.json');
  writeFileSync(doc, '{}\n');
  const cases = [
    ['show', '--doc', 'X', '--doc', 'Y', '--document', doc],
    ['env', 'up', '--root', hubs.a!.dir, '--root', hubs.b!.dir],
    ['find', 'x', '--root', hubs.a!.dir, '--root', hubs.b!.dir],
  ];
  const failures: string[] = [];
  for (const args of cases) {
    const before = Object.fromEntries(Object.entries(hubs).map(([k, h]) => [k, h.calls.length]));
    const r = await deep(w, args, { timeoutMs: 60 * SECOND });
    const called = Object.entries(hubs).filter(([k, h]) => h.calls.length > before[k]!)
      .map(([k, h]) => `the hub at ${k} got ${callsShown({ ...h, calls: h.calls.slice(before[k]) })}`);
    const why = [
      r.code === 2 ? '' : `exits ${r.code}, not 2`,
      printsUsageOf(r, args[0]!) ? '' : `prints no usage of deep ${args[0]} (a line that starts Usage: and names it)`,
    ].filter(Boolean);
    if (why.length) failures.push(`deep ${args.join(' ').split(w.tmp).join('<tmp>')}: ${why.join('; ')}${called.length ? ` (${called.join('; ')})` : ''}. It printed: ${shown(r)}`);
  }
  expect(failures, `${failures.length} of ${cases.length} commands acted on a repeated flag:\n${failures.join('\n')}`).toEqual([]);
}, 240 * SECOND);
