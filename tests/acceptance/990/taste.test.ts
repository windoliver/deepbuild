// AC8: Shown to you: screenshots of the Chinese input method's composition at the program's cursor cell and the session
// row's working, blocked and done readings, taken by the check run from the app at the reference window, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// On the reference Mac the run composes "ni hao" into a program that hid its cursor (as ime.test.ts) and reports working,
// blocked and done from alpha's terminal (as status.test.ts), and asks the app for two screenshots of its own window
// (`screenshot`: the terminal's panel, and alpha's row), written to `target/acceptance/990/`, printing each one's
// SHA-256. It then reads the owner's recorded call, `tests/acceptance/990/TASTE.json`: none, or one made on other
// pictures, is INCONCLUSIVE; "looks wrong" fails; "looks right" on exactly these pictures passes. Anywhere but the
// reference Mac the run is INCONCLUSIVE before it starts. No other test reads these pictures or the call.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { EventInput } from '../../../packages/record/src/index.ts';
import {
  ALPHA, ESC, REPO, SESSIONS, TERMINAL, fileText, inconclusive, openFocused, openedOf, referenceMacProblem, script, seam, setup, setupOf, sleep, tmp,
  useShow, waitFor, waitScreen, withServe, type JsonObject, type Serve,
} from './helpers.ts';

const show = useShow();
const SHOTS = join(REPO, 'target', 'acceptance', '990');
const TASTE = join(REPO, 'tests', 'acceptance', '990', 'TASTE.json');
const NAMES = ['composition-at-cursor.png', 'session-row-readings.png'] as const;
const ID = 'AC8';

async function shot(s: Serve, target: JsonObject, name: string): Promise<string> {
  const path = join(SHOTS, name);
  const r = await s.call({ call: 'screenshot', ...target, path }, 120_000);
  if (r['code'] === 'unsupported_platform') inconclusive(`screenshot answered unsupported_platform for ${name}`);
  expect(r['code'], `the app takes the screenshot ${name}: ${JSON.stringify(r)}`).toBeUndefined();
  expect(r['from'], `${name} is taken from the app's own window`).toBe('app');
  expect(existsSync(path), `${name} is written`).toBe(true);
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function screenshots(bin: string): Promise<Record<string, string>> {
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  const dir = tmp('taste');
  await withServe(bin, setup(dir), async (s) => {
    await openFocused(s, script(dir, 'recorder', join(dir, 'in.log'), { out: `READY-ime${ESC}[?25l${ESC}[5;12H` }));
    await waitScreen(s, (rows) => rows.some((r) => r.includes('READY-ime')), 'the program is up');
    await s.ok(seam({ type: 'preedit', text: 'ni hao' }), 'composing "ni hao"');
    await sleep(500);
    hashes[NAMES[0]] = await shot(s, { terminal: TERMINAL }, NAMES[0]);
    await s.ok(seam({ type: 'text', text: '你好' }), 'committing 你好');
  });
  const path = join(dir, 'record.db');
  const record = await openRecord({ path, now: () => Date.now() });
  const start = (fixtures('session.start@1')[0] as { data: Record<string, JsonValue> }).data;
  await record.append({ writer: 'hook', actor: 'you', scope: 'you', session: ALPHA.id }, { v: 1, id: ulid(Date.now()), kind: 'session.start', ts: Date.now(), data: start } as EventInput);
  await record.close();
  const log = join(dir, 'status.log');
  await withServe(bin, { ...setupOf({ evidence: dir, sessions: SESSIONS }), record: path }, async (s) => {
    const ST = `${ESC}\\`;
    const o = openedOf(await s.call({ call: 'terminal_open', terminal: 'TS', session: ALPHA.id, cols: 120, rows: 36, program: script(dir, 'status', log, { query: `${ESC}]7501;?${ST}`, reports: ['working', 'blocked;waiting on your review', 'done'].map((r) => `${ESC}]7501;${r}${ST}`) }) }, 120_000), 'alpha\'s terminal');
    for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
    await waitFor(() => fileText(`${log}.done`), (t) => t !== '', 60_000);
    await sleep(1000);
    hashes[NAMES[1]] = await shot(s, { session: ALPHA.id, part: 'row' }, NAMES[1]);
  });
  return hashes;
}

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run takes the composition at the program's cursor cell and the session row's working, blocked and done readings from the app at the reference window, and the owner's recorded call on exactly those says they look right`, async () => {
    const why = referenceMacProblem();
    if (why) inconclusive(`the screenshots are taken from the app at the reference window on the reference Mac; ${why}`);
    const hashes = await screenshots(show());
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '990', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots taken from the app's window:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach the screenshots to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/990/TASTE.json (README: The taste call)`);
    let c: Record<string, JsonValue>;
    try { c = JSON.parse(readFileSync(TASTE, 'utf8')) as Record<string, JsonValue>; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(c['issue'], 'TASTE.json: issue').toBe(990);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when').toBe(true);
    const recorded = (c['screenshots'] ?? {}) as Record<string, JsonValue>;
    const same = NAMES.every((n) => recorded[n] === hashes[n]);
    if (!same) inconclusive(`the recorded taste call was made on other pictures (${JSON.stringify(recorded)}); show the owner these:\n${listed}`);
    expect(c['verdict'], 'the owner\'s taste call on these screenshots').toBe('looks_right');
  }, 900_000);
});
