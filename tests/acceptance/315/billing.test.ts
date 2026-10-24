// #315 AC3: at SessionStart deep-hook sends whether each billing key is set in the environment it inherits from
// the agent, as true or false, never a value. A value made at run time stands in for an API key; the test looks
// for it, raw and in every form #15 names, on the wire, in deep-hook's and the hub's output, and in every file
// under the test's home (the ledger and its WAL, the spool, logs, evidence, transcripts), with the hub up and
// with it stopped and then started.
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, cleanup, forwarder, hook, jsonLines, makeHome, newSession, payload, readSpool, setAddress, settleEvents, startHub,
  stopHub, tempDir, type Ev, type Line, type Session,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The forms #15 names for a scrub-list value: raw, URL-encoded with hex of either case, base64 at each offset in both alphabets. */
function forms(value: string): { name: string; core: string }[] {
  const bytes = Buffer.from(value, 'utf8');
  const pct = (upper: boolean) => [...bytes].map((b) => (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')[upper ? 'toUpperCase' : 'toLowerCase']()}`)).join('');
  const out = [{ name: 'raw', core: value }, { name: 'URL-encoded, upper-case hex', core: pct(true) }, { name: 'URL-encoded, lower-case hex', core: pct(false) }];
  for (const k of [0, 1, 2]) {
    const std = Buffer.concat([Buffer.from('r:'.slice(2 - k)), bytes]).toString('base64');
    const core = std.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    out.push({ name: `base64 standard at offset ${k}`, core });
    out.push({ name: `base64 url-safe at offset ${k}`, core: core.replace(/\+/g, '-').replace(/\//g, '_') });
  }
  return out;
}
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
}
const sessionStartOf = (events: Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'session.start' && (e.session === s.id || e.data?.thread === s.id));

describe('AC3 #315.c8a3b16d with ANTHROPIC_API_KEY set, the SessionStart event carries true for it, and no log, spool or record row holds its value', () => {
  it('AC3 hub up and hub stopped: the request and the recorded session.start carry billing.ANTHROPIC_API_KEY true (false where unset), and the value is nowhere', async () => {
    const binary = await buildDeepHook();
    const value = `sk-ant-api03-${randomBytes(30).toString('base64url')}`;
    const withKey = { ANTHROPIC_API_KEY: value };
    const home = makeHome();
    const outputs: string[] = [];
    const keep = (r: { stdout: string; stderr: string }) => outputs.push(r.stdout, r.stderr);

    // Hub up: one session with the key, one without.
    let hub = await startHub({ home });
    const f = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${f.path}`);
    const keyed = newSession(home);
    const unkeyed = newSession(home);
    keep(await hook(home, keyed, 'SessionStart', payload(keyed, 'SessionStart'), { binary, env: withKey }));
    keep(await hook(home, keyed, 'PreToolUse', bash(keyed, 'ls'), { binary, env: withKey }));
    keep(await hook(home, unkeyed, 'SessionStart', payload(unkeyed, 'SessionStart'), { binary }));
    await f.close();
    const wire = `${f.upText()}\n${f.downText()}`;
    const starts = jsonLines(f.upText()).filter((l) => l.event === 'SessionStart');
    const sent = (s: Session): Line | undefined => starts.find((l) => l.payload?.session_id === s.id);
    expect(sent(keyed)?.billing?.ANTHROPIC_API_KEY, `the SessionStart request with the key set carries billing.ANTHROPIC_API_KEY true: ${JSON.stringify(sent(keyed)).slice(0, 600)}`).toBe(true);
    expect(sent(unkeyed)?.billing?.ANTHROPIC_API_KEY, 'the SessionStart request with the key unset carries billing.ANTHROPIC_API_KEY false').toBe(false);
    await stopHub(hub);
    outputs.push(hub.proc.stdout(), hub.proc.stderr());

    // Hub stopped: the SessionStart is spooled with the same mark, and recorded once the hub starts.
    setAddress(home, undefined);
    const spooledSession = newSession(home);
    keep(await hook(home, spooledSession, 'SessionStart', payload(spooledSession, 'SessionStart'), { binary, env: withKey }));
    keep(await hook(home, spooledSession, 'PreToolUse', bash(spooledSession, 'ls'), { binary, env: withKey }));
    const spooled = readSpool(home).requests.find((r) => r.json.event === 'SessionStart' && r.json.payload?.session_id === spooledSession.id);
    expect(spooled?.json.billing?.ANTHROPIC_API_KEY, `the spooled SessionStart carries billing.ANTHROPIC_API_KEY true: ${JSON.stringify(spooled?.json).slice(0, 600)}`).toBe(true);
    const spoolBytes = readSpool(home).files.map((name) => readFileSync(join(home, '.deepbuild/spool', name), 'utf8')).join('\n');

    hub = await startHub({ home });
    const events = await settleEvents(hub, (all) => sessionStartOf(all, spooledSession).length > 0);
    await stopHub(hub);
    outputs.push(hub.proc.stdout(), hub.proc.stderr());
    for (const [s, want] of [[keyed, true], [unkeyed, false], [spooledSession, true]] as const) {
      const recorded = sessionStartOf(events, s);
      expect(recorded.length, `one session.start recorded for ${s.id}`).toBe(1);
      expect(recorded[0]!.data?.billing?.ANTHROPIC_API_KEY, `the recorded session.start of ${s.id} carries billing.ANTHROPIC_API_KEY ${want}: ${JSON.stringify(recorded[0]!.data)}`).toBe(want);
    }

    // The value is nowhere: the wire, the spool as it was, deep-hook's and the hub's output, and every file left under the home.
    const places: [string, string][] = [['the socket, both ways', wire], ['the spool before replay', spoolBytes], ['deep-hook\'s and the hub\'s output', outputs.join('\n')]];
    for (const file of files(home)) if (statSync(file).size < 64 * 1024 * 1024) places.push([file, readFileSync(file).toString('latin1')]);
    const hits = places.flatMap(([where, text]) => forms(value).filter((form) => text.includes(form.core)).map((form) => `${where}: ${form.name}`));
    expect(hits, `the key's value was found: ${hits.join('; ')}`).toEqual([]);
  }, 600_000);
});
