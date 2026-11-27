// #3429's criteria and the recorded run every one of them waits for (README, The recorded run). Criterion 1: "Until
// the run exists, every criterion below reads BLOCKED, never PASS", and "If it fires, this issue closes on that run".
// The run is a real-daemon recording in the corpus (#47); this file reads it, with node's own modules alone, so the
// real-daemon test needs no build.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Line = { [key: string]: any };
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Each criterion's tag: `#3429.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC = {
  run: '#3429.c0361f49',
  reading: '#3429.97f78b7f',
  switched: '#3429.51266e12',
  unlisted: '#3429.d3ca9d44',
  gate: '#3429.9ecaeb87',
  claude: '#3429.0888aab7',
} as const;

// ---- Copilot's modes as paseo 0.15.0 names them (packages/server/src/server/agent/providers/copilot-acp-agent.ts).
/** Allow All: "Automatically approves all Copilot tool, path, and URL requests." */
export const ALLOW_ALL = 'allow-all';
/** Agent, the mode that asks: each tool call goes through ACP's session/request_permission. paseo's default for Copilot. */
export const ASKING = 'https://agentclientprotocol.com/protocol/session-modes#agent';

/** The paseo version the facts pin: the newest they cover, as #55's helpers read it. */
export function pinned(): string {
  const file = join(REPO, 'adapters/paseo.facts.json');
  if (!existsSync(file)) throw Error("BLOCKED: paseo's facts are missing: no adapters/paseo.facts.json names the paseo version these tests run on");
  return String((JSON.parse(readFileSync(file, 'utf8')) as { versions: string[] }).versions.at(-1));
}

/** The corpus session that holds the run: one turn of a scripted ACP agent whose call it approved itself. */
export const SCENARIO = 'self-approved-call';
/**
 * The run as the corpus holds it: where, what is wrong with it (nothing, for a run that exists), the hooks of the
 * plugin's requests in the order paseo fired them, whether agent.permission.before is among them, and the mode
 * paseo's own record of the agent names.
 */
export interface Recorded { at: string; problems: string[]; hooks: string[]; fired: boolean; mode: string | undefined }
const parsed = (text: string): Line | undefined => { try { const value = JSON.parse(text) as unknown; return value && typeof value === 'object' ? value as Line : undefined; } catch { return undefined; } };
export function recordedRun(): Recorded {
  const version = pinned();
  const at = `adapters/corpus/paseo/${version}/${SCENARIO}`;
  const problems: string[] = [];
  const text = (name: string): string | undefined => {
    if (existsSync(join(REPO, at, name))) return readFileSync(join(REPO, at, name), 'utf8');
    problems.push(`the corpus holds no ${at}/${name}`);
    return undefined;
  };
  const jsonLines = (name: string): Line[] | undefined => text(name)?.split('\n').filter((l) => l.trim()).map((l) => parsed(l) ?? {});

  const session = text('session.json');
  const meta = session === undefined ? undefined : parsed(session) ?? {};
  if (meta && !(meta.schema === 'corpus.session@1' && meta.agent === 'paseo' && meta.version === version && meta.scenario === SCENARIO)) {
    problems.push(`${at}/session.json must read schema corpus.session@1, agent paseo, version ${version}, scenario ${SCENARIO}: it reads ${JSON.stringify(meta).slice(0, 300)}`);
  }
  const payloads = (jsonLines('events.jsonl') ?? []).map((l) => (l.payload ?? {}) as Line);
  const hooks = payloads.map((p) => String(p.hook_event_name));
  if (payloads.length || existsSync(join(REPO, at, 'events.jsonl'))) {
    const sessions = new Set(payloads.map((p) => String(p.session_id)));
    const started = hooks.indexOf('agent.turn.before');
    if (sessions.size !== 1) problems.push(`${at}/events.jsonl must hold one session, the turn in the mode that approves its own calls, alone: it holds ${sessions.size}`);
    if (started < 0 || !hooks.slice(started).includes('agent.turn.after')) problems.push(`${at}/events.jsonl must hold the turn from its agent.turn.before to its agent.turn.after: it holds ${hooks.join(', ') || 'no payload'}`);
  }
  const transcript = jsonLines('transcript.jsonl');
  const mode = (transcript ?? []).map((entry) => entry.Mode).find((m): m is string => typeof m === 'string' && m !== '');
  if (transcript && !mode) problems.push(`${at}/transcript.jsonl, paseo's own record of the agent (paseo inspect), must name the Mode the agent ran in`);
  return { at, problems, hooks, fired: hooks.includes('agent.permission.before'), mode };
}

/**
 * The gate criterion 1 puts on criteria 2 to 6. Each of their tests calls this once its own assertions hold, so a
 * program that fails them fails at its assertion, naming what the criterion names, and one that passes them reads
 * BLOCKED, never PASS, until the corpus holds the run, or for good when the run shows the hook firing.
 */
export function needRun(tag: string): void {
  const run = recordedRun();
  if (run.problems.length) {
    throw Error(`BLOCKED: ${tag} holds on this program, and reads BLOCKED, never PASS, until ${AC.run}'s run exists: ${run.problems.join('; ')}. Record it on the pinned paseo's real daemon and add it to the corpus (tests/acceptance/3429/README.md, The recorded run)`);
  }
  if (run.fired) {
    throw Error(`BLOCKED: ${tag} isn't to be built: the run recorded at ${run.at} shows paseo firing agent.permission.before for a call the agent approved itself in mode ${run.mode} (${run.hooks.join(', ')}), so the call is seen before it runs and #3429 closes on that run`);
  }
}
