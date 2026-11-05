// AC6: Shown to you: screenshots of the bound values for expected 18.01 and received 18 on the return card and in a
// panel, and the missing case, taken by the check run from the app at the reference window, are attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The run draws the app's session view headless at the reference window (1512 × 982 points at 2×) through
// `deep-replica --bound` twice: over the failing Vitest run (expected 18.01, received 18) and over the Playwright run
// whose received value is "N/A" (expected 18.01, received missing), each with the two bound values on the session's
// return card and in a panel. It holds the replica's own text listing of them to the values (never the pictures),
// writes the two screenshots to `target/acceptance/629/` and prints their SHA-256s, then reads the owner's recorded call,
// `tests/acceptance/629/TASTE.json` (README: AC6). Off macOS, with no call, or with a call on other pictures, it fails
// with a message starting `INCONCLUSIVE:`; it never passes there.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSERTION, PLAYWRIGHT_NA_RUN, REPO, VITEST_RUN, arr, copied, inconclusive, isObject, numbersIn, obj, readJson, requireMac, sha256, str,
  ulidOf, useBuilds, useTemp, type Bind, type JsonObject, type JsonValue, type Rect,
} from './helpers.ts';

const SHOTS = join(REPO, 'target', 'acceptance', '629');
const TASTE = join(REPO, 'tests', 'acceptance', '629', 'TASTE.json');
const NAMES = ['bound-present.png', 'bound-missing.png'] as const;
/** The reference window in device pixels: 1512 × 982 points at 2× (technical design: The reference window). */
const REFERENCE: [number, number] = [3024, 1964];

// The replica draws pixels on macOS only, so it is built only there.
const build = useBuilds(process.platform === 'darwin' ? ['deep-replica'] : []);
const temp = useTemp();

interface Shown { surface: string; id: string; text: string; missing: JsonObject | null; bounds: Rect }

/** One `deep-replica --view session --bound <file>` run: the screenshot's path and the bound values it lists. */
function draw(name: string, run: JsonObject, unit?: string): { png: string; shown: Shown[] } {
  const dir = join(temp(), name);
  mkdirSync(dir, { recursive: true });
  const binds = (sel: 'expected' | 'received'): Bind => ({ source: `${String(run['run'])}#${ASSERTION}`, select: sel, ...(unit ? { format: { unit } } : {}) });
  const values = [{ id: 'expected', bind: binds('expected') }, { id: 'received', bind: binds('received') }] as unknown as JsonValue;
  const file = join(dir, 'bound.in.json');
  writeFileSync(file, JSON.stringify({ runs: [run], card: values, panel: values }));
  const out = join(dir, 'out');
  const r = spawnSync(build('deep-replica'), ['--view', 'session', '--out', out, '--appearance', 'light', '--bound', file], { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' });
  expect(r.status, `deep-replica --view session --bound draws ${name} (README: AC6): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const listed = obj(readJson(join(out, 'bound.json'), 'the replica\'s bound.json'), 'bound.json');
  const shown = arr(listed['bound'], 'bound.json: bound').map((v, i): Shown => {
    const b = obj(v, `bound.json: bound[${i}]`);
    const box = arr(b['bounds'], `bound[${i}].bounds`).map(Number);
    return { surface: str(b['surface'], `bound[${i}].surface`), id: str(b['id'], `bound[${i}].id`), text: str(b['text'], `bound[${i}].text`), missing: isObject(b['missing']) ? b['missing'] : null, bounds: [box[0]!, box[1]!, box[2]!, box[3]!] };
  });
  return { png: join(out, 'screens', 'session.png'), shown };
}

/** The values each screenshot must hold, by the replica's listing: a surface's bound value shows `shows`, or reads missing. */
function holds(shown: Shown[], surface: string, id: string, shows: string | null, run: string, what: string): void {
  const b = shown.find((s) => s.surface === surface && s.id === id);
  expect(b, `${what}: the ${surface}'s bound value ${id} is drawn: ${JSON.stringify(shown)}`).toBeDefined();
  const [x, y, w, h] = b!.bounds;
  expect(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= REFERENCE[0] && y + h <= REFERENCE[1], `${what}: the ${surface}'s ${id} lies in the window: ${JSON.stringify(b!.bounds)}`).toBe(true);
  if (shows === null) {
    expect(b!.missing?.['cause'], `${what}: the ${surface}'s ${id} reads missing with not_reported`).toBe('not_reported');
    expect(JSON.stringify(b!.missing), `${what}: the missing value names the run`).toContain(ulidOf(run));
    expect(numbersIn(b!.text), `${what}: the ${surface}'s ${id} shows no number: ${JSON.stringify(b!.text)}`).toEqual([]);
  } else {
    expect(numbersIn(b!.text), `${what}: the ${surface}'s ${id} shows ${shows}: ${JSON.stringify(b!.text)}`).toEqual([shows]);
  }
}

const pngSize = (bytes: Buffer): [number, number] => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

describe('AC6 the screenshots on the return card and in a panel, and the one taste call on them', () => {
  it('AC6 the run draws expected 18.01 and received 18, and the missing case, on the return card and in a panel at the reference window, and the owner\'s recorded call on exactly those screenshots says they look right', () => {
    requireMac('deep-replica');
    const present = draw('present', { run: VITEST_RUN, check: 'cart', tool: 'vitest', report: copied(temp(), 'vitest-cart-failed.json') });
    const missing = draw('missing', { run: PLAYWRIGHT_NA_RUN, check: 'cart-e2e', tool: 'playwright', report: copied(temp(), 'playwright-cart-na.json') }, 'USD');
    for (const surface of ['card', 'panel']) {
      holds(present.shown, surface, 'expected', '18.01', VITEST_RUN, 'the failing run');
      holds(present.shown, surface, 'received', '18', VITEST_RUN, 'the failing run');
      holds(missing.shown, surface, 'expected', '18.01', PLAYWRIGHT_NA_RUN, 'the N/A run');
      holds(missing.shown, surface, 'received', null, PLAYWRIGHT_NA_RUN, 'the N/A run');
    }
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, shot] of [[NAMES[0], present], [NAMES[1], missing]] as const) {
      const bytes = readFileSync(shot.png);
      expect(pngSize(bytes), `${name} is the reference window at 2×`).toEqual(REFERENCE);
      copyFileSync(shot.png, join(SHOTS, name));
      hashes[name] = sha256(bytes);
    }
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '629', n)}  ${hashes[n]}`).join('\n');
    console.log(`AC6: screenshots written from this run's app:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach and show the owner the screenshots\n${listed}\nand record the answer in tests/acceptance/629/TASTE.json (README: AC6)`);
    const c = obj(readJson(TASTE, 'TASTE.json'), 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(629);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('AC6');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    if (typeof c['who'] !== 'string' || c['who'].trim() === '') inconclusive('the recorded taste call names no person');
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = obj(c['screenshots'], 'TASTE.json: screenshots');
    for (const n of NAMES) if (recorded[n] !== hashes[n]) inconclusive(`the recorded taste call was made on other screenshots: ${n} is ${hashes[n]} in this run, ${JSON.stringify(recorded[n])} in TASTE.json`);
    expect(c['verdict'], `the recorded taste call says the screenshots look right${typeof c['note'] === 'string' ? `; its note: ${c['note']}` : ''}`).toBe('looks_right');
  });
});
