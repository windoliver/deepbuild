// #1906: copies inside the hub fold into one owner each. These tests read the sources, as the issue asks, and find a
// copy by what it does, never by a helper's name: the issue names no helper.
//
//   AC1 "`core.ts` ... holds one forge URL default and one `done.yaml` reader"
//   AC2 "A test that reads the hub's sources finds one shell quote, one `duration` and one listener probe, and fails
//        on the merge base"
//
// "The hub's sources" are packages/hub/src, and packages/env-local/src where the issue names it (the listener probe
// "in `env-local` and `stacks.ts`"). A copy counts once per place it is written; the owner may live in the hub or in a
// package the hub imports, so each test asks for at most one in the hub's sources and at least one somewhere.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGES = join(REPO, 'packages');
const HUB = join(PACKAGES, 'hub', 'src');
const ENV_LOCAL = join(PACKAGES, 'env-local', 'src');
const CORE = join(HUB, 'core.ts');

/** Every production TypeScript source under a folder: no tests, no declarations. */
function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(dir, f)).sort();
}
/** Every package's production sources. */
const everywhere = (): string[] => readdirSync(PACKAGES).flatMap((name) => { try { return sources(join(PACKAGES, name, 'src')); } catch { return []; } });

/** Where a pattern is written in the files given, as `path:line`, one per place. */
function sites(files: string[], pattern: RegExp, keep: (m: RegExpExecArray) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(new RegExp(pattern.source, 'g'))) {
      if (keep(m as RegExpExecArray)) out.push(`${relative(REPO, file)}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
  return out;
}

// A shell quote, as a function: its whole result is its argument between single quotes, with each single quote in it
// written '\'' . The quote inside may be spelled with replace, replaceAll or split and join, and the wrap as a
// template or as a sum.
const ESCAPED = String.raw`["\`]'\\\\''["\`]`;
const A_QUOTE = String.raw`(?:\/'\/g|["'\`]'["'\`])`;
const REPLACED = String.raw`\w+\s*(?:\.replace(?:All)?\(\s*${A_QUOTE}\s*,\s*${ESCAPED}\s*\)|\.split\(\s*["'\`]'["'\`]\s*\)\s*\.join\(\s*${ESCAPED}\s*\))`;
const WRAPPED = String.raw`(?:\`'\$\{\s*${REPLACED}\s*\}'\`|["'\`]'["'\`]\s*\+\s*${REPLACED}\s*\+\s*["'\`]'["'\`])`;
const SHELL_QUOTE = new RegExp(String.raw`(?:=>|\breturn\b)\s*\(?\s*${WRAPPED}`);

// A duration reader: a pattern that reads a whole number and then a unit letter, with m, h and d among the units.
const DURATION = /\(\\d\+\)\s*(\(\[[a-z]+\]\)|\((?:[a-z]+\|)+[a-z]+\)|\[[a-z]+\])/;
const minutesHoursDays = (m: RegExpExecArray): boolean => ['m', 'h', 'd'].every((unit) => m[1]!.replace(/[^a-z]/g, '').includes(unit));

// A listener probe: lsof asked for the TCP sockets in the LISTEN state.
const LISTENER_PROBE = /["'`]-sTCP:LISTEN["'`]/;

describe('#1906 AC2: the hub\'s sources hold one shell quote, one duration and one listener probe', () => {
  it('one shell quote', () => {
    const hub = sites(sources(HUB), SHELL_QUOTE);
    expect(sites(everywhere(), SHELL_QUOTE).length, 'a shell quote is written somewhere the hub can call').toBeGreaterThanOrEqual(1);
    expect(hub.slice(1), `the hub's sources write the shell quote once, not also at: ${hub.slice(1).join(', ')} (first: ${hub[0]})`).toEqual([]);
  });

  it('one duration', () => {
    const hub = sites(sources(HUB), DURATION, minutesHoursDays);
    expect(sites(everywhere(), DURATION, minutesHoursDays).length, 'a duration reader is written somewhere the hub can call').toBeGreaterThanOrEqual(1);
    expect(hub.slice(1), `the hub's sources read a duration once, not also at: ${hub.slice(1).join(', ')} (first: ${hub[0]})`).toEqual([]);
  });

  it('one listener probe, across env-local and the hub', () => {
    const hub = sites([...sources(ENV_LOCAL), ...sources(HUB)], LISTENER_PROBE);
    expect(sites(everywhere(), LISTENER_PROBE).length, 'a listener probe is written somewhere the hub can call').toBeGreaterThanOrEqual(1);
    expect(hub.slice(1), `env-local and the hub probe a port's listeners once, not also at: ${hub.slice(1).join(', ')} (first: ${hub[0]})`).toEqual([]);
  });
});

describe('#1906 AC1: core.ts holds one forge URL default and one done.yaml reader', () => {
  it('one forge URL default', () => {
    // The default is the GitHub API's address, taken when no forge is given: the address written once, and the
    // "no forge given" fallback applied once.
    const address = sites([CORE], /["'`]https:\/\/api\.github\.com\/?["'`]/);
    const fallback = sites([CORE], /\bforge\s*\?\?(?!=)/);
    expect(address, 'core.ts writes the forge URL default once').toHaveLength(1);
    expect(fallback.slice(1), `core.ts falls back to the forge URL default once, not also at: ${fallback.slice(1).join(', ')} (first: ${fallback[0]})`).toEqual([]);
  });

  it('one done.yaml reader', () => {
    // A reader is a place that names the file `done.yaml` in the call that reads or parses it.
    const readers = sites([CORE], /\b(?:readFileSync|readFile|parseYaml|parse)\s*\([^;\n]*done\.yaml/);
    expect(readers, 'core.ts reads .deepbuild/done.yaml in one place').toHaveLength(1);
  });
});
