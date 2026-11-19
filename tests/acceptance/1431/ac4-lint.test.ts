// AC4 #1431.415d33d4: a cache with a byte bound and no entry bound fails the lint lane, naming the cache.
//
// The lint is `node scripts/cache-lint.mjs [--root <checkout>]`, which the lint lane (scripts/lanes.mjs's `lint`
// check) runs (README: The cache lint). It passes over this checkout, where every long-lived cache declares both bounds.
// The wrong program is a planted crate in a scratch checkout: a struct field and a static, each a cache that declares a
// byte bound and no entry bound; the lint must fail, naming each, at its file. Its twin, the same caches with both
// bounds, passes, so the bound alone is what fails it.
import { describe, expect, it } from 'vitest';
import { ID, LINT, lanes, lint, lintRoot, none } from './helpers.ts';

const PLANTED = 'crates/planted-1431/src/lib.rs';

/** The planted crate: two caches, each with `bytes` and, in the twin, `entries` too. */
function plantedCrate(entries: boolean): string {
  const bound = (bytes: string): string => `// cache: ${entries ? 'entries 1_024, ' : ''}bytes ${bytes}`;
  return [
    '//! A planted crate for #1431\'s acceptance tests: two long-lived caches.',
    'use std::collections::HashMap;',
    'use std::sync::{LazyLock, Mutex};',
    '',
    '/// Decoded pictures by their hash.',
    'pub struct PlantedHolder {',
    '    /// Each picture\'s pixels.',
    `    ${bound('268_435_456')}`,
    '    planted_cache: HashMap<[u8; 32], Vec<u8>>,',
    '}',
    '',
    '/// Proxies by content key, for the whole process.',
    bound('64 << 20'),
    'static PLANTED_STATIC: LazyLock<Mutex<HashMap<u64, Vec<u8>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));',
    '',
  ].join('\n');
}
/** The 1-based lines of the planted declaration comment and of its holder, for each planted cache. */
function plantedLines(text: string): Record<string, number[]> {
  const lines = text.split('\n');
  const of = (holder: RegExp): number[] => { const at = lines.findIndex((l) => holder.test(l)); return [at, at + 1]; };
  return { planted_cache: of(/^\s*planted_cache:/), PLANTED_STATIC: of(/^static PLANTED_STATIC/) };
}

describe(`${ID.ac4} the lint lane fails a cache bounded in bytes alone`, () => {
  it(`${ID.ac4} a cache with a byte bound and no entry bound fails the lint lane, naming the cache`, async () => {
    const here = lint();
    none(here.fails.map((f) => `${f.path}:${f.line}: ${f.message}`), `over this checkout the lint finds no cache with one bound and not the other:\n${here.output}`);
    expect(here.status, `over this checkout the lint exits 0:\n${here.output}`).toBe(0);
    expect(here.passes, `and prints one PASS cache line:\n${here.output}`).toBe(1);
    const { checks } = await lanes();
    const lane = checks.find(({ name }) => name === 'lint');
    expect(lane?.commands.some((command) => command.some((part) => String(part).replaceAll('\\', '/').endsWith(LINT))), `the lint lane (scripts/lanes.mjs checks, name lint) runs ${LINT}`).toBe(true);

    const planted = plantedCrate(false);
    const planting = lint(lintRoot({ [PLANTED]: planted }));
    console.log(`PROOF ${ID.ac4} the planted caches:\n${planting.output}`);
    expect(planting.status, `the planted caches, each with a byte bound and no entry bound, fail the lint:\n${planting.output}`).toBe(1);
    expect(planting.passes, `no PASS line beside a finding:\n${planting.output}`).toBe(0);
    for (const [name, lines] of Object.entries(plantedLines(planted))) {
      const named = planting.fails.filter((f) => f.path === PLANTED && lines.includes(f.line) && new RegExp(`\\b${name}\\b`).test(f.message));
      expect(named.length, `one FAIL line names the cache ${name} at ${PLANTED}:${lines.join(' or ')}:\n${planting.output}`).toBe(1);
    }
    expect(planting.fails.length, `and the lint names nothing else:\n${planting.output}`).toBe(2);

    const twin = lint(lintRoot({ [PLANTED]: plantedCrate(true) }));
    expect(twin.fails, `the same caches with an entry bound beside the byte bound pass the lint:\n${twin.output}`).toEqual([]);
    expect(twin.status, twin.output).toBe(0);
    expect(twin.passes, twin.output).toBe(1);
  }, 600_000);
});
