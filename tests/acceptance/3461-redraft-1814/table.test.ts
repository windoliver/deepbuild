import { afterAll, expect, it } from 'vitest';
import { SECOND, another, cleanup, commandWords, deep, forms, help, lineFor, needBuild, normalized, printsUsageOf, shown, usageLines, valuesIn, withRepeat, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#3461.b4a5c8f4';

it(`${ID} every command deep --help lists, given a flag its usage shows once twice (two values, or one value repeated), prints its usage, exits 2 and prints nothing on stdout (redraft 1814)`, async () => {
  needBuild();
  const lines = usageLines(await help());
  expect(lines.length, 'deep --help lists its usage lines').toBeGreaterThan(30);
  const w = world();
  const all = forms(w).map((f) => ({ args: f.args, line: lineFor(lines, f.args) }));
  const at = (text: string) => normalized(w, text);
  const failures: string[] = [];
  const table: string[] = [];
  for (const line of lines) {
    for (const flag of line.flags.filter((f) => f.values > 0 && !f.repeats)) {
      if (!all.some((f) => f.line === line && f.args.includes(flag.name))) failures.push(`BLOCKED: no form of "${line.synopsis.slice(0, 60)}" gives ${flag.name}, so the table didn't read it`);
    }
  }
  for (const form of all) {
    const line = form.line;
    if (!line) continue;
    const once = line.flags.filter((f) => f.values > 0 && !f.repeats && form.args.includes(f.name));
    if (!once.length) continue;
    const name = `deep ${form.args.slice(0, commandWords(line.synopsis, form.args)).join(' ')}`;
    const fits = await deep(w, form.args);
    if (fits.code === 2) { failures.push(`BLOCKED: ${name}'s form doesn't fit its line given once, so its repeats prove nothing: deep ${at(form.args.join(' '))}: ${at(shown(fits))}`); continue; }
    for (const flag of once) {
      const given = valuesIn(form.args, flag);
      for (const [how, values] of [['two values', given.map(another)], ['one value repeated', given]] as const) {
        const args = withRepeat(form.args, flag.name, values);
        table.push(`${name} ${flag.name} (${how})`);
        const r = await deep(w, args);
        const why = [
          r.code === 2 ? '' : `exits ${r.code}, not 2`,
          r.stdout === '' ? '' : 'prints on stdout',
          printsUsageOf(r, form.args[0]!) ? '' : `prints no usage of deep ${form.args[0]}`,
        ].filter(Boolean);
        if (why.length) failures.push(`${name} ${flag.name} (${how}): ${why.join('; ')}: deep ${at(args.join(' '))}: ${at(shown(r))}`);
      }
    }
  }
  expect(table.length, 'the table ran rows').toBeGreaterThan(40);
  expect(failures, `${failures.length} of ${table.length} rows (commands and flags) took a repeated flag:\n${failures.join('\n')}\n\nThe table's rows:\n${table.join('\n')}`).toEqual([]);
}, 1500 * SECOND);
