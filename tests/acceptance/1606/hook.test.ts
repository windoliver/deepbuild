// #1606 AC1 and AC7: with the hub stopped, an agent session's `cat` and Read of the files that hold a credential are
// denied by deep-hook, naming the guard. Each call is the PreToolUse payload Claude Code sends, run through
// `deep-hook claude-code PreToolUse` as the agent's hook entry runs it, on a home whose hub was started and then
// stopped by its PID, with the shipped default entries as its rules.json; no call is ever executed. AC1's wrong program
// is deep-hook as the pinned merge base has it, with the merge base's own default entries.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bashCall, decision, guardsNamed, hook, preToolUse, shown, told, type Ran } from '../1503/helpers.ts';
import { AC, baseHook, cleanup, newSession, readGuards, shippedRules, stoppedHome, TOKEN } from './helpers.ts';
import { DEEP_HOOK } from '../16/helpers.ts';

afterEach(cleanup, 60_000);

interface Seen { cat: { line: string; ran: Ran }; read: { file: string; ran: Ran }; guards: string[] }
/**
 * A session's `cat` (Bash) and Read of `rel` under ~/.deepbuild, as `binary` decides them with the hub stopped and
 * `rules` as rules.json; `plant` writes the file first.
 */
async function observe(binary: string, rules: string, rel: string, plant: (root: string) => void): Promise<Seen> {
  const { home, root } = await stoppedHome(rules, plant);
  const s = newSession(home);
  const line = `cat ~/.deepbuild/${rel}`;
  const file = join(root, rel);
  const cat = await hook(home, preToolUse(s, bashCall(line)), binary);
  const read = await hook(home, preToolUse(s, { tool_name: 'Read', tool_input: { file_path: file } }), binary);
  return { cat: { line, ran: cat }, read: { file, ran: read }, guards: readGuards(rules) };
}
/** What's wrong: a call allowed, or denied without naming a fail_closed read entry of the rules it ran under. */
function failures(seen: Seen): string[] {
  const out: string[] = [];
  for (const [what, ran] of [[`\`${seen.cat.line}\``, seen.cat.ran], [`Read ${seen.read.file}`, seen.read.ran]] as const) {
    if (decision(ran) !== 'deny') out.push(`${what} was allowed with the hub stopped: ${shown(ran)}`);
    else if (!guardsNamed(told(ran)).some((g) => seen.guards.includes(g))) out.push(`${what} was denied without naming the guard (one of ${seen.guards.join(', ')}): ${shown(ran)}`);
  }
  return out;
}

/** A channels file as the hub reads it at the base, holding a bot token in plain text (#65's shape). */
const channels = (root: string): void => {
  writeFileSync(join(root, 'channels.json'), `${JSON.stringify({ channels: { chat: { api: 'https://chat.example.invalid', token: TOKEN } }, routes: [], quiet: null }, null, 2)}\n`, { mode: 0o600 });
};
/** The app's device file as the base's app writes it: the device's ID and its key's seed, readable only by you. */
const device = (root: string): void => {
  mkdirSync(join(root, 'app'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'app', 'device.json'), JSON.stringify({ device: 'device:01JZ8Q1T4B9V6C2M7X3N5P0R8S', seed: Buffer.alloc(32, 7).toString('base64url') }), { mode: 0o600 });
};

describe(`${AC[1]} With a planted channels.json holding a token and the hub stopped, a session's cat and Read of it are denied, naming the guard`, () => {
  it(`${AC[1]} a session's cat of ~/.deepbuild/channels.json and its Read of it are each denied with the hub stopped, naming the guard`, async () => {
    expect(failures(await observe(DEEP_HOOK, shippedRules(), 'channels.json', channels))).toEqual([]);
  }, 900_000);

  it(`${AC[1]} wrong program: deep-hook on the merge base allows both and fails this test`, async () => {
    const base = await baseHook();
    const seen = await observe(base.binary, base.rules, 'channels.json', channels);
    const said = failures(seen);
    expect(decision(seen.cat.ran), `the merge base allows ${seen.cat.line} with the hub stopped: ${shown(seen.cat.ran)}`).toBe('allow');
    expect(decision(seen.read.ran), `the merge base allows the Read of ${seen.read.file} with the hub stopped: ${shown(seen.read.ran)}`).toBe('allow');
    expect(said.join('\n'), 'the merge base fails the criterion, naming both calls').toContain(seen.cat.line);
    expect(said.join('\n')).toContain(`Read ${seen.read.file}`);
  }, 900_000);
});

describe(`${AC[7]} With the hub stopped, a session's Read and cat of ~/.deepbuild/app/device.json are each denied, naming the guard`, () => {
  it(`${AC[7]} a session's Read of ~/.deepbuild/app/device.json and its cat of it are each denied with the hub stopped, naming the guard`, async () => {
    expect(failures(await observe(DEEP_HOOK, shippedRules(), 'app/device.json', device))).toEqual([]);
  }, 900_000);
});
