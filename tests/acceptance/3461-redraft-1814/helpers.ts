import { flagsOf, type Flag } from '../3461/helpers.ts';

export { SECOND, another, cleanup, commandWords, deep, forms, help, needBuild, normalized, printsUsageOf, shown, valuesIn, withRepeat, world } from '../3461/helpers.ts';

const MARK = /^[^\p{L}\p{N}<>[\]|.-]+$/u;

export interface Line { synopsis: string; flags: Flag[] }

export function usageLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?(?:[^\p{L}\p{N}\s<[-]+\s+)?(deep\s+[a-z].*)$/u.exec(raw);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.split(/\s+/).filter((token) => !MARK.test(token)).join(' ');
    out.push({ synopsis, flags: flagsOf(synopsis) });
  }
  return out;
}

const PLAIN = /^[a-z][a-z-]*$/;

const literals = (synopsis: string): string[] => synopsis.replace(/"?<[^>]*>"?/g, ' ').replace(/[[\]|]/g, ' ').split(/\s+/).filter((word) => PLAIN.test(word)).slice(1);

export function lineFor(lines: readonly Line[], args: readonly string[]): Line | undefined {
  const own = lines.filter((line) => line.synopsis.split(/\s+/)[1] === args[0]);
  const second = args[1] !== undefined && PLAIN.test(args[1]) && own.some((line) => literals(line.synopsis).slice(1).includes(args[1]!)) ? args[1] : undefined;
  const given = args.filter((arg) => /^--[a-z]/.test(arg));
  const fitting = own
    .filter((line) => second === undefined || literals(line.synopsis).slice(1).includes(second))
    .filter((line) => given.every((flag) => line.flags.some((f) => f.name === flag)));
  const extra = (line: Line) => line.flags.filter((f) => !given.includes(f.name)).length;
  return fitting.sort((a, b) => extra(a) - extra(b))[0];
}
