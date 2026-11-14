// Test-side tools for the issue #1882 acceptance tests: the built CLI run on a result file, a valid
// run.finished@1 result, and the detector AC2 names (a reader of source text that reports every list of the
// five verdicts). None of them stands in for the CLI or the conformance package.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const CLI_SRC = join(REPO, 'packages', 'cli', 'src');
export const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

// ---- deep run --result ---------------------------------------------------------------------------

export interface Ran { status: number | null; stdout: string; stderr: string }
/** `deep run --result <file>`: the built CLI, as its bin runs it. */
export function deepRun(file: string): Ran {
  const ran = spawnSync(process.execPath, [CLI, 'run', '--result', file], { cwd: REPO, encoding: 'utf8' });
  if (ran.error) throw ran.error;
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** A run.finished@1 event with the given outcome and findings; the counts are a run of three tests, all passing, only when it passed. */
export function result(outcome: string, findings: string[]): Record<string, unknown> {
  const ran = outcome === 'passed' ? 3 : 0;
  return {
    v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T6Z', kind: 'run.finished', writer: 'cli', actor: 'you', scope: 'you', ts: 1760013451126,
    data: {
      run: 'run:01K74G3A5C7E9G1J3M5P7R9T1Y', outcome, tests_run: ran, passed: ran, runs: 1, evidence: [], check: 'cart.unit',
      assertion: null, expected: null, actual: null, step: null, points_to: null, findings, environment: 'node-24/linux-arm64',
    },
  };
}

// ---- The list detector (AC2) ---------------------------------------------------------------------

export const VERDICTS = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS'] as const;
/** How many other tokens may sit between two neighbouring entries of one list: a rank, a `case`, a comparison. */
export const GAP = 8;

export interface Hit { file: string; line: number; names: string[] }
export const show = (hit: Hit): string => `${hit.file}:${hit.line} lists ${hit.names.join(', ')}`;

/**
 * Every list of the five verdicts in one source text. The text is parsed as TypeScript, so comments are never
 * read and a string, a template or a regular expression is one token. A verdict is named wherever a token holds
 * its name as a whole word: a string in any quotes, a word inside a longer string, an object key, an identifier.
 * A list is five names in a row, each at most GAP tokens after the one before, that are the five verdicts; their
 * order doesn't matter. One or a few verdicts used on their own (`return verdict('INVALID', …)`) are no list.
 */
export function verdictLists(text: string, file: string): Hit[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tokens: ts.Node[] = [];
  const walk = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length > 0) return void children.forEach(walk);
    if (node.getWidth(source) > 0) tokens.push(node);
  };
  walk(source);
  const named: { at: number; name: string; line: number }[] = [];
  tokens.forEach((token, at) => {
    const start = token.getStart(source);
    for (const found of token.getText(source).matchAll(/(?<![A-Za-z0-9_$])(FAIL|INVALID|BLOCKED|INCONCLUSIVE|PASS)(?![A-Za-z0-9_$])/g)) {
      named.push({ at, name: found[1]!, line: source.getLineAndCharacterOfPosition(start + found.index).line + 1 });
    }
  });
  const hits: Hit[] = [];
  let run: typeof named = [];
  const close = (): void => {
    for (let from = 0; from + VERDICTS.length <= run.length; from += 1) {
      const five = run.slice(from, from + VERDICTS.length);
      if (new Set(five.map((entry) => entry.name)).size !== VERDICTS.length) continue;
      hits.push({ file, line: five[0]!.line, names: five.map((entry) => entry.name) });
      break;
    }
    run = [];
  };
  for (const entry of named) {
    const last = run.at(-1);
    if (last !== undefined && entry.at - last.at - 1 > GAP) close();
    run.push(entry);
  }
  close();
  return hits;
}

/** Every file under a folder, at any depth, as paths relative to `base`. */
export function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path, base) : [relative(base, path)];
  });
}

/** The detector over every file under a folder; `label` names the folder in each hit. */
export function verdictListsUnder(dir: string, label: string): { files: string[]; hits: Hit[] } {
  const files = filesUnder(dir);
  return { files, hits: files.flatMap((file) => verdictLists(readFileSync(join(dir, file), 'utf8'), `${label}/${file}`)) };
}
