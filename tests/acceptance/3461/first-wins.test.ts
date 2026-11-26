// #3461 criterion 1 (README): `deep land --repo A --repo B`, `deep land judge --repo A --repo B` and
// `deep work --repo A --issues 1 --once --repo B` each print their usage, exit 2 and send the hub nothing. A stand-in hub
// at the home's socket records every line a command sends; on the merge base each command calls it on repo A, and the
// test fails naming the command.
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { SECOND, callsShown, cleanup, deep, needBuild, printsUsageOf, rootOf, shown, standIn, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.bffe987a';

it(`${ID} deep land, deep land judge and deep work --once given --repo twice each print their usage, exit 2 and send the hub nothing`, async () => {
  needBuild();
  const w = world();
  const hub = await standIn(rootOf(w));
  const [a, b] = [join(w.tmp, 'A'), join(w.tmp, 'B')];
  const cases = [
    ['land', '--repo', a, '--repo', b],
    ['land', 'judge', '--repo', a, '--repo', b],
    ['work', '--repo', a, '--issues', '1', '--once', '--repo', b],
  ];
  const failures: string[] = [];
  for (const args of cases) {
    const before = { lines: hub.lines.length, calls: hub.calls.length };
    const r = await deep(w, args, { timeoutMs: 60 * SECOND });
    const sent = hub.lines.slice(before.lines);
    const called = { ...hub, calls: hub.calls.slice(before.calls) };
    const why = [
      r.code === 2 ? '' : `exits ${r.code}, not 2`,
      printsUsageOf(r, args[0]!) ? '' : `prints no usage of deep ${args[0]} (a line that starts Usage: and names it)`,
      sent.length === 0 ? '' : `sent the hub ${sent.length} line(s), calling ${callsShown(called)}`,
    ].filter(Boolean);
    if (why.length) failures.push(`deep ${args.join(' ').split(w.tmp).join('<tmp>')}: ${why.join('; ')}. It printed: ${shown(r)}`);
  }
  expect(failures, `${failures.length} of ${cases.length} commands acted on a repeated --repo:\n${failures.join('\n')}`).toEqual([]);
}, 240 * SECOND);
