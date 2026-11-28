export interface Told { test: string; message: string }
export interface Shown { outcome: string; testsRun: number; failures: Told[] }
export interface Break { step: number; values: Record<string, number> }

const withPlainMinus = (text: string): string => text.replace(/\u2212/g, '-');
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const names = (message: string, text: string): boolean => new RegExp(`(^|[^0-9A-Za-z_])${escaped(text)}($|[^0-9A-Za-z_])`).test(message);

export function stepsNamed(text: string): number[] {
  return [...text.matchAll(/(?:^|[^0-9A-Za-z_])step (\d+)/g)].map((m) => Number(m[1]));
}
function aroundReplay(message: string): { before: string; after: string } {
  const at = /(?:^|[^0-9A-Za-z_])replay/.exec(message);
  return at ? { before: message.slice(0, at.index), after: message.slice(at.index) } : { before: message, after: '' };
}
export const runStepNamed = (message: string): number | undefined => stepsNamed(aroundReplay(message).before)[0];
export const replayStepNamed = (message: string): number | undefined => stepsNamed(aroundReplay(message).after)[0];

export function valuesNamed(message: string, name: string): number[] {
  const value = new RegExp(`(?:^|[^0-9A-Za-z_])${escaped(name)}(?![0-9A-Za-z_.])["'\`]?\\s*(?:=|:|is|was|reads)?\\s*["'\`[(]?\\s*(-?\\d+(?:\\.\\d+)?)(?![0-9])`, 'g');
  return [...withPlainMinus(message).matchAll(value)].map((m) => Number(m[1]));
}

export function firstBelow(series: readonly number[], floor: number): { step: number; value: number } | undefined {
  const step = series.findIndex((v) => v < floor);
  return step < 0 ? undefined : { step, value: series[step]! };
}

export function orderBreak(first: readonly number[], then: readonly number[]): { step: number } | 'together' | undefined {
  const thenAt = then.findIndex((v) => v !== 0);
  if (thenAt < 0) return undefined;
  const firstAt = first.findIndex((v) => v !== 0);
  if (firstAt >= 0 && firstAt < thenAt) return undefined;
  return firstAt === thenAt ? 'together' : { step: thenAt };
}

const brief = (r: Shown): string => `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 2000) || '(none)'}`;

function oneOf(r: Shown, code: string, rule: string, test: string, out: string[]): string | undefined {
  const mine = r.failures.filter((f) => f.test === test && f.message.startsWith(code) && names(f.message, rule));
  if (mine.length !== 1) out.push(`${mine.length} failures of ${test} start ${code} and name ${rule}, not 1: ${brief(r)}`);
  return mine.length === 1 ? withPlainMinus(mine[0]!.message) : undefined;
}
function strangers(r: Shown, code: string, tests: ReadonlySet<string>, out: string[]): void {
  for (const f of r.failures) if (f.message.startsWith(code) && !tests.has(f.test)) out.push(`${f.test} fails ${code}, and its run keeps the rule: ${f.message}`);
}

export function alwaysWrong(r: Shown, rule: string, breaks: ReadonlyMap<string, Break>): string[] {
  const out: string[] = [];
  if (r.outcome !== 'failed') out.push(`the outcome is ${r.outcome}, not failed: ${brief(r)}`);
  for (const [test, want] of breaks) {
    const m = oneOf(r, 'playtest.always', rule, test, out);
    if (m === undefined) continue;
    if (runStepNamed(m) !== want.step) out.push(`${test}: it names step ${runStepNamed(m)}, not step ${want.step}, before any word of its replay: ${m}`);
    for (const [name, value] of Object.entries(want.values)) {
      const said = valuesNamed(m, name);
      if (!said.length || said.some((v) => v !== value)) out.push(`${test}: it names ${name} as ${said.join(', ') || 'nothing'}, not ${value}: ${m}`);
    }
    if (replayStepNamed(m) !== want.step) out.push(`${test}: after the word replay it names step ${replayStepNamed(m)}, not step ${want.step}: ${m}`);
  }
  strangers(r, 'playtest.always', new Set(breaks.keys()), out);
  return out;
}

export function orderWrong(r: Shown, rule: string, breaks: ReadonlyMap<string, number>): string[] {
  const out: string[] = [];
  if (r.outcome !== 'failed') out.push(`the outcome is ${r.outcome}, not failed: ${brief(r)}`);
  for (const [test, step] of breaks) {
    const m = oneOf(r, 'playtest.order', rule, test, out);
    if (m === undefined) continue;
    if (runStepNamed(m) !== step) out.push(`${test}: it names step ${runStepNamed(m)}, not step ${step}, before any word of its replay: ${m}`);
    if (replayStepNamed(m) !== step) out.push(`${test}: after the word replay it names step ${replayStepNamed(m)}, not step ${step}: ${m}`);
  }
  strangers(r, 'playtest.order', new Set(breaks.keys()), out);
  return out;
}

export function unseenWrong(r: Shown, rule: string): string[] {
  const out: string[] = [];
  if (r.outcome !== 'uncounted') out.push(`the outcome is ${r.outcome}, not uncounted, the outcome that reads INCONCLUSIVE: ${brief(r)}`);
  const said = r.failures.filter((f) => f.message.startsWith('INCONCLUSIVE:') && names(f.message, rule));
  if (said.length !== 1) out.push(`${said.length} failures start INCONCLUSIVE: and name ${rule}, not 1: ${brief(r)}`);
  const others = r.failures.filter((f) => !said.includes(f));
  if (others.length) out.push(`it also reports ${others.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 1000)}`);
  return out;
}

export function missingWrong(r: Shown, name: string): string[] {
  const out: string[] = [];
  if (r.outcome === 'passed') out.push(`the outcome is passed: ${brief(r)}`);
  if (r.testsRun !== 0) out.push(`it counts ${r.testsRun} runs, not 0: ${brief(r)}`);
  if (!r.failures.some((f) => f.message.startsWith('play.missing') && names(f.message, name))) out.push(`no failure starts play.missing and names ${name}: ${brief(r)}`);
  return out;
}

export const addedMs = (withRules: number, without: number): number => Math.max(0, withRules - without);
