// AC2 #1829.a7d207ff: a check fails any source string passed to `raise` in `packages/` that has no row in
// `packages/asks/sources.json`, naming the source and the call site; on the merge base it names `promise.blocked`.
//
// The check is `node scripts/ask-sources-guard.mjs [--root <checkout>]` (README: The check). It runs here three ways:
// on this checkout, where every source has its row (the issue's Scope); on the merge base's packages/ (git archive),
// where it names `promise.blocked` at its raise; and on a scratch copy of this checkout's packages/ with planted
// raises, one per way a source reaches `raise` (a string literal, a named constant, a hub wrapper's `raise`, a chained
// `asks().raise`, a template) beside raises whose sources do have rows, which it must not name.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, baseTree, copyOfCheckout, guardShown, mergeBaseSha, namesSite, namesSource, removeTemps, runGuard, sitesIn, SOURCE,
} from './helpers.ts';

afterAll(removeTemps);

/** One planted raise: its file, the marker on its line, and the source the check must name (none for a covered one). */
interface Plant { path: string; marker: string; names?: string }

/** The planted hub file: each raise on one line, marked by a comment so the test finds its line number. */
const HUB = 'packages/hub/src/planted-1829.ts';
const HUB_TEXT = `// Planted by tests/acceptance/1829 into a scratch copy of the checkout; never part of the tree.
import type { Asks } from '@deepbuild/asks';

const CORE = { writer: 'core', actor: 'you', scope: 'you' } as const;
const PLANTED_CONSTANT = 'planted_constant.go';

interface Wrapper { raise(source: string, ask: object): Promise<string> }

export class Planted1829 {
  constructor(private readonly asks: Asks, private readonly d: Wrapper, private readonly o: { asks(): Asks; raise(source: string, ask: object): Promise<string> }) {}

  async literal(): Promise<string> {
    return this.asks.raise(CORE, 'planted_literal.go', { kind: 'choice', question: 'Planted literal?' }); // @literal
  }

  async constant(): Promise<string> {
    return this.asks.raise(CORE, PLANTED_CONSTANT, { kind: 'choice', question: 'Planted constant?' }); // @constant
  }

  async wrapper(): Promise<string> {
    return this.d.raise('planted_wrapper.fetch', { kind: 'choice', question: 'Planted wrapper?' }); // @wrapper
  }

  async other(): Promise<string> {
    return this.o.raise('planted_other.change', { kind: 'choice', question: 'Planted other wrapper?' }); // @other
  }

  async chained(): Promise<string> {
    return this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you' }, 'planted_chained.go', { kind: 'choice' }); // @chained
  }

  async template(kind: string): Promise<string> {
    return this.asks.raise(CORE, \`planted_template.\${kind}\`, { kind, question: 'Planted template?' }); // @template
  }

  async covered(kind: string): Promise<void> {
    await this.asks.raise(CORE, 'job.send', { kind: 'authority', question: 'Covered literal?' }); // @covered-literal
    await this.d.raise('library.fetch', { kind: 'authority', question: 'Covered wrapper?' }); // @covered-wrapper
    await this.asks.raise(CORE, \`deep_ask.\${kind}\`, { kind, question: 'Covered template?' }); // @covered-template
  }
}
`;
/** The planted extension-host file: a named constant in the extension host. */
const HOST = 'packages/extension-host/src/planted-1829.ts';
const HOST_TEXT = `// Planted by tests/acceptance/1829 into a scratch copy of the checkout; never part of the tree.
import type { Asks } from '@deepbuild/asks';

const CORE = { writer: 'core', actor: 'you', scope: 'you' } as const;
const PLANTED_HOST_SOURCE = 'planted_host.send';
const COVERED_HOST_SOURCE = 'action.send';

export async function planted1829(asks: Asks): Promise<void> {
  await asks.raise(CORE, PLANTED_HOST_SOURCE, { kind: 'authority', question: 'Planted host constant?' }); // @host
  await asks.raise(CORE, COVERED_HOST_SOURCE, { kind: 'authority', question: 'Covered host constant?' }); // @covered-host
}
`;
const PLANTS: Plant[] = [
  { path: HUB, marker: '@literal', names: 'planted_literal.go' },
  { path: HUB, marker: '@constant', names: 'planted_constant.go' },
  { path: HUB, marker: '@wrapper', names: 'planted_wrapper.fetch' },
  { path: HUB, marker: '@other', names: 'planted_other.change' },
  { path: HUB, marker: '@chained', names: 'planted_chained.go' },
  { path: HUB, marker: '@template', names: 'planted_template.${kind}' },
  { path: HUB, marker: '@covered-literal' },
  { path: HUB, marker: '@covered-wrapper' },
  { path: HUB, marker: '@covered-template' },
  { path: HOST, marker: '@host', names: 'planted_host.send' },
  { path: HOST, marker: '@covered-host' },
];
const lineOf = (text: string, marker: string): number => text.split('\n').findIndex((l) => l.includes(`// ${marker}`)) + 1;

describe(`${AC2} A check fails any source string passed to \`raise\` in \`packages/\` that has no row in \`packages/asks/sources.json\`, naming the source and the call site; on the merge base it names \`promise.blocked\``, () => {
  it(`${AC2} on this checkout every source passed to raise has its row: the check prints its PASS line and exits 0`, () => {
    const c = runGuard();
    expect(c.code, `${AC2} the check (node scripts/ask-sources-guard.mjs) runs on this checkout and exits 0: ${guardShown(c)}`).toBe(0);
    expect(c.fails, `${AC2} no FAIL line on this checkout: ${guardShown(c)}`).toEqual([]);
    expect(c.passes.length, `${AC2} one PASS ask source line: ${guardShown(c)}`).toBe(1);
  }, 120_000);

  it(`${AC2} on the merge base the check fails, naming ${SOURCE} and its call site`, () => {
    const sha = mergeBaseSha();
    const root = baseTree(sha);
    // The base's raise of promise.blocked: every line under packages/ that passes it to raise.
    const grep = execFileSync('grep', ['-rnE', '--include=*.ts', `raise\\(.*'${SOURCE.replace('.', '\\.')}'`, 'packages'], { cwd: root, encoding: 'utf8' });
    const sites = grep.split('\n').filter(Boolean).map((l) => { const m = /^([^:]+):(\d+):/.exec(l)!; return { path: m[1]!, line: Number(m[2]) }; })
      .filter((s) => !/\/test\/|\.test\.ts$/.test(s.path));
    expect(sites.length, `the merge base ${sha.slice(0, 12)} raises ${SOURCE} somewhere under packages/ (the issue's bug)`).toBeGreaterThan(0);
    const c = runGuard(root);
    expect(c.code, `${AC2} on the merge base ${sha.slice(0, 12)} (--root ${root}) the check exits 1: ${guardShown(c)}`).toBe(1);
    const named = c.fails.filter((l) => namesSource(l, SOURCE));
    expect(named.length, `${AC2} on the merge base a FAIL line names ${SOURCE}: ${guardShown(c)}`).toBeGreaterThan(0);
    for (const site of sites) {
      expect(named.some((l) => namesSite(l, site.path, site.line)), `${AC2} the merge base's FAIL lines for ${SOURCE} name its call site ${site.path}:${site.line}: ${named.join(' | ')}`).toBe(true);
    }
  }, 120_000);

  it(`${AC2} planted raises with no row fail, each naming its source and its call site, by literal, named constant, a hub wrapper's raise, a chained raise and a template; raises whose sources have rows are not named`, () => {
    const root = copyOfCheckout();
    for (const [path, text] of [[HUB, HUB_TEXT], [HOST, HOST_TEXT]] as const) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const c = runGuard(root);
    expect(c.code, `${AC2} the check exits 1 on the planted tree: ${guardShown(c)}`).toBe(1);
    for (const p of PLANTS) {
      const line = lineOf(p.path === HUB ? HUB_TEXT : HOST_TEXT, p.marker);
      const at = c.fails.filter((l) => namesSite(l, p.path, line));
      if (p.names) {
        expect(at.length, `${AC2} the planted raise ${p.marker} (${p.names}) fails, naming its call site ${p.path}:${line}: ${guardShown(c)}`).toBe(1);
        expect(namesSource(at[0]!, p.names), `${AC2} the FAIL line for ${p.path}:${line} names the source ${p.names}: ${at[0]}`).toBe(true);
      } else {
        expect(at, `${AC2} the raise ${p.marker} at ${p.path}:${line} has a row in packages/asks/sources.json, so no FAIL line names it`).toEqual([]);
      }
    }
    // Nothing else: the copy is this checkout, which passes, plus the plants.
    const expected = PLANTS.filter((p) => p.names).map((p) => ({ path: p.path, line: lineOf(p.path === HUB ? HUB_TEXT : HOST_TEXT, p.marker) }));
    const others = c.fails.filter((l) => !sitesIn(l).some((s) => expected.some((e) => e.path === s.path && e.line === s.line)));
    expect(others, `${AC2} the check names only the planted raises with no row (this checkout passes): ${others.join(' | ')}`).toEqual([]);
    expect(c.passes, `${AC2} no PASS line beside the FAIL lines`).toEqual([]);
  }, 120_000);
});
