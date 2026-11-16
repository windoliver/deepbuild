// An agent's sign-in (#1349; design: Sign-in is one task per agent). It is read only by its probe, the `signIn` command
// the agent's facts name, whose output is read here and never kept: no record, no log, no evidence. The agent's own
// sign-in command, from adapters/sign-in.json, is started for you detached, its output ignored; it closes nothing.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { readFacts } from '@deepbuild/adapters';
import { signInCommands } from './hub-shared.js';
import type { Plant } from './plant.js';

type Obj = Record<string, unknown>;
export type SignedIn = 'signed_in' | 'signed_out' | 'not_checked';
/** A probe's reading as the asks core takes it: null when it couldn't run, with the account the agent then records. */
export interface SignInReading { signedIn: boolean | null; account: string | null; at: number }

/** How long a probe may take before it reads not checked. */
const PROBE_MS = 10_000;
/** How often an open sign-in task's probe runs (design: every 5 s). */
const CHECK_MS = 5000;

/** How each agent's probe reads signed in, as its facts' `signIn.signedIn` says, by the agent. */
const SIGNED_IN: Readonly<Record<string, (out: string, code: number | null) => boolean>> = {
  'claude-code': (out) => { try { return (JSON.parse(out) as Obj).loggedIn === true; } catch { return false; } },
  codex: (_out, code) => code === 0,
};

/** The agent's program and its probe's arguments, from its facts; undefined for an agent with no probe. */
function probeOf(agent: string): { binary: string; args: string[] } | undefined {
  try {
    const facts = readFacts<Obj>(`${agent}.facts.json`);
    const signIn = facts.signIn as Obj | undefined;
    return typeof facts.agent === 'string' && signIn && Array.isArray(signIn.args) ? { binary: facts.agent, args: signIn.args.map(String) } : undefined;
  } catch { return undefined; }
}

/** The first `binary` on `path`, as `Agents.installed()` finds it. */
const onPath = (binary: string, path: string): string | undefined => path.split(delimiter).filter(isAbsolute).map((d) => join(d, binary)).find((f) => existsSync(f));

/**
 * The agent's sign-in probe, once: `program`, the agent's own as the caller found it, with its facts' `signIn` args,
 * under a short limit. Not checked when the agent has no probe, its program wasn't found, or the probe didn't end.
 */
export function probeSignIn(agent: string, program: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<SignedIn> {
  const probe = probeOf(agent);
  const reads = SIGNED_IN[agent];
  if (!probe || !reads || !program) return Promise.resolve('not_checked');
  return new Promise((done) => {
    const child = execFile(program, probe.args, { timeout: PROBE_MS, encoding: 'utf8', env }, (error, out) => {
      const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
      // Not found, killed at the limit: no reading.
      if (code === null) return done('not_checked');
      done(reads(String(out), code) ? 'signed_in' : 'signed_out');
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end();
  });
}

/** The agent's probe on `path`, the recorded login PATH, as DeepBuild's jobs would find its program. */
export const probeOnPath = (agent: string, path: string): Promise<SignedIn> => {
  const probe = probeOf(agent);
  return probeSignIn(agent, probe ? onPath(probe.binary, path) : undefined, { ...process.env, PATH: path });
};

/** Agents whose sign-in command, started by `signin.open`, has ended: read only under the planted `closes-on-return`. */
const returned = new Set<string>();

/**
 * An open sign-in task's check: called on every tick for each agent with one open, it starts the agent's probe at
 * most once every 5 s and hands each reading over once, with when it started by the hub's clock. Never waits.
 */
export function signInCheck(loginPath: () => string, account: (agent: string) => string | null, now: () => number): { read(agent: string): SignInReading | null } {
  const seen = new Map<string, { result: SignInReading | null; busy: boolean; last: number }>();
  return {
    read(agent) {
      const s = seen.get(agent) ?? { result: null, busy: false, last: 0 };
      seen.set(agent, s);
      const done = s.result;
      s.result = null;
      // The planted wrong program: the sign-in command's end taken for a signed-in reading, with no probe.
      if (returned.delete(agent)) return { signedIn: true, account: account(agent), at: now() };
      if (!done && !s.busy && Date.now() - s.last >= CHECK_MS) {
        s.busy = true;
        s.last = Date.now();
        const at = now();
        void probeOnPath(agent, loginPath()).then((read) => {
          s.result = { signedIn: read === 'not_checked' ? null : read === 'signed_in', account: read === 'signed_in' ? account(agent) : null, at };
          s.busy = false;
        });
      }
      return done;
    },
  };
}

/**
 * Starts the agent's own sign-in command from adapters/sign-in.json on `path`, detached, with no input and its output
 * going nowhere, and returns at once: the agent opens its own window or browser page. False when it isn't found.
 */
export function openSignIn(agent: string, path: string, plant: Plant | undefined): boolean {
  const probe = probeOf(agent);
  const [binary, ...args] = (probe ? signInCommands()[probe.binary] ?? '' : '').split(' ').filter(Boolean);
  const program = binary ? onPath(binary, path) : undefined;
  if (!program) return false;
  const child = spawn(program, args, { detached: true, stdio: 'ignore', env: { ...process.env, PATH: path } });
  child.on('error', () => undefined);
  if (plant === 'closes-on-return') child.once('exit', () => returned.add(agent));
  child.unref();
  return true;
}
