// #19.18335781 (AC25): the canary sweep. A scrub-list value and a pattern-shaped key go into a prompt, a command and
// its output, with the hub up and then down (deep-hook spools, #315) and back up; once the hub has synced (the spool
// replayed into the record), every file under the state folder (the ledger, its WAL, any spool left, logs, evidence
// and a debug bundle) is searched for each scrubbed form. Any hit fails, naming the file. A planted hub that scrubs
// evidence but writes the raw command to its log fails the sweep, naming the log (README: The canary sweep).
//
// The scrub-list value is one the hub holds by handle, given to it through DEEP_HUB_TEST_HELD (README: Additions),
// since nothing merged lets a test hand the hub a held secret that outlives a restart; the key is a GitHub token,
// which the pinned gitleaks rules match. Everything else is real: deep-hook as a settings entry runs it, the hub as
// `deep hub run` with its output going to <root>/logs/hub.log as its login service sends it, `deep debug bundle`.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  base64Of, buildDeepHook, callId, cleanup, deep, events, everyForm, hook, makeHome, newSession, payload, shown, startHub, stopHub, sweep, transcriptTurn,
  urlEncodedOf, waitFor, walk, type Canary, type Ev, type Home, type Session,
} from './helpers.ts';

afterEach(cleanup, 60_000);
beforeAll(async () => { await buildDeepHook(); }, 900_000);

const ID = 'AC25 #19.18335781';

/** The two canaries: a value on the hub's scrub list (every form) and a key shaped like a GitHub token (raw). */
function canaries(): { value: string; key: string; list: Canary[] } {
  const value = `plum+${randomBytes(8).toString('hex')}=orchid/${randomBytes(3).toString('hex')}`;
  const key = `ghp_${randomBytes(27).toString('base64').replace(/[^A-Za-z0-9]/g, 'q').slice(0, 36)}`;
  return { value, key, list: [{ name: 'the scrub-list value', forms: everyForm(value) }, { name: 'the pattern-shaped key', forms: [{ name: 'raw', text: key }] }] };
}

/** One turn through deep-hook: a prompt, a Bash command and its output, each holding both canaries in their forms. */
async function turn(h: Home, s: Session, phase: string, value: string, key: string): Promise<void> {
  const prompt = `${phase}: deploy with ${value} and ${key}`;
  const command = `${phase} curl -H 'X-Plum: ${value}' -d 'k=${urlEncodedOf(value)}' -d 'b=${base64Of(value, ':')}' https://example.invalid/${key}`;
  const output = `${phase} ok\nheader ${value}\nkey ${key}\nencoded ${base64Of(value)}\n`;
  const call = callId();
  transcriptTurn(s, prompt, command, output, call);
  for (const [event, body] of [
    ['UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt, prompt_id: callId() })],
    ['PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: call })],
    ['PostToolUse', payload(s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: output, stderr: '', interrupted: false }, tool_use_id: call })],
  ] as const) {
    const r = await hook(h.home, s, event, body);
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook claude-code ${event} (${phase}): ${shown(r)}`);
  }
}
/** The phase's prompt and command, as the record holds them: found by the phase's marker, which the scrub leaves. */
const recorded = (all: readonly Ev[], phase: string): string[] => [
  ...(all.some((e) => e.kind === 'user.ask' && String(e.data?.text ?? '').includes(`${phase}:`)) ? [] : [`no user.ask for the ${phase} prompt`]),
  ...(all.some((e) => e.kind === 'tool.before' && String(e.data?.command ?? '').includes(`${phase} curl`)) ? [] : [`no tool.before for the ${phase} command`]),
];
const spoolLines = (root: string): number => walk(join(root, 'spool')).reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length, 0);

/**
 * The sweep's run: hub up, a turn; hub down, a turn (spooled); hub up again and synced; `deep debug bundle`; the
 * sweep with the hub up (its WAL there), then again once it stops. Returns every hit, `<file>: <canary> (<form>)`.
 */
async function sweepRun(plant?: string): Promise<{ hits: string[]; root: string }> {
  const h = makeHome();
  const { value, key, list } = canaries();
  const held = join(h.tmp, 'held');
  writeFileSync(held, `${value}\n`, { mode: 0o600 });
  const env = { DEEP_HUB_TEST_HELD: held };
  mkdirSync(h.root, { recursive: true, mode: 0o700 });
  writeFileSync(join(h.root, 'rules.json'), `${JSON.stringify({ v: 1, entries: {} })}\n`, { flag: 'w', mode: 0o600 });
  const s = newSession(h.home, h.tmp);

  // Up.
  let hub = await startHub(h.home, { env, ...(plant ? { plant } : {}) });
  const started = await hook(h.home, s, 'SessionStart', payload(s, 'SessionStart', { source: 'startup', model: 'claude-haiku-5-5' }));
  if (started.code !== 0) throw Error(`BLOCKED: deep-hook claude-code SessionStart: ${shown(started)}`);
  await turn(h, s, 'phase-up', value, key);
  // On a loaded Mac deep-hook can give up on the hub at its 50 ms and spool a call marked late (#315); that call
  // reaches the record at the next start instead, and the sweep below still covers it. Either way it is settled here.
  const upPath = await waitFor(async () => (recorded(await events(h.root), 'phase-up').length === 0 ? 'recorded by the hub' : spoolLines(h.root) > 0 && 'spooled late'), 15_000,
    'the hub to record the prompt and command sent with it up, or deep-hook to spool them late');
  if (upPath !== 'recorded by the hub') console.log(`AC25: the hub-up turn was ${upPath} (machine load ${loadavg()[0]!.toFixed(1)}); it is recorded from the spool at the restart`);

  // Down: deep-hook finds no hub and spools.
  await stopHub(hub);
  await turn(h, s, 'phase-down', value, key);
  expect(spoolLines(h.root), 'with the hub down, deep-hook spooled the turn\'s hooks').toBeGreaterThanOrEqual(3);

  // Back up, and synced: the spooled turn is in the record and no spooled line is left.
  hub = await startHub(h.home, { env, ...(plant ? { plant } : {}) });
  await waitFor(async () => { const all = await events(h.root); return [...recorded(all, 'phase-up'), ...recorded(all, 'phase-down')].length === 0 && spoolLines(h.root) === 0; }, 30_000,
    'the restarted hub to replay the spool: both turns\' prompts and commands recorded and no spooled line left');

  const made = await deep(h.home, ['debug', 'bundle'], { env });
  expect(made.code, `deep debug bundle exits 0: ${shown(made)}`).toBe(0);
  const bundle = made.stdout.trim().split('\n').at(-1) ?? '';
  expect(existsSync(bundle), `deep debug bundle prints the bundle's path last: ${made.stdout}`).toBe(true);

  const hits = sweep(h.root, list, [bundle]);
  await stopHub(hub);
  hits.push(...sweep(h.root, list, [bundle]).map((x) => `${x} (after the hub stopped)`));
  return { hits: [...new Set(hits)], root: h.root };
}

describe(`${ID} the canary sweep`, () => {
  it(`${ID} with the hub up, then down and back up, no file under the state folder holds any scrubbed form of the scrub-list value or the key`, async () => {
    const { hits, root } = await sweepRun();
    // The ledger, its WAL, a spool left behind, a log, an evidence file or the bundle holding a form fails here,
    // naming the file and the form.
    expect(hits, `canary forms found under ${root}:\n${hits.join('\n')}`).toEqual([]);
  }, 300_000);

  it(`${ID} (wrong program) a hub that scrubs evidence but writes the raw command to its log, DEEP_HUB_PLANT=log-raw-command, fails the sweep, naming the log`, async () => {
    const { hits, root } = await sweepRun('log-raw-command');
    const inLogs = hits.filter((x) => x.startsWith(`${join(root, 'logs')}/`) && x.includes('the scrub-list value (raw)'));
    expect(inLogs.length, `the sweep names a log under ${join(root, 'logs')} holding the raw command's value; it found:\n${hits.join('\n')}`).toBeGreaterThan(0);
  }, 300_000);
});
