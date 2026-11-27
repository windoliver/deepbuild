// What #3429's fixture-paseo tests share (README, The worlds): #55's world with a Copilot agent whose snapshot reads a
// mode, and the session's row and page read through the hub's socket. #55's helpers are imported, never edited;
// nothing here stands in for DeepBuild's code.
// First: what you gave the suite by hand, before ../29's helpers (loaded through ../55) delete DEEP_* (#55 D1).
import '../55/env.ts';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startHub } from '../27/helpers.ts';
import { ASK_SETTINGS, Host, about, create, editConfig, fakeAgent, makeHome, needPlugin, specRepo, turnEnds, type Ev, type Fake, type Line } from '../55/helpers.ts';
import { ALLOW_ALL, ASKING } from './run.ts';

/** The modes paseo 0.15.0's Copilot provider lists for an agent (copilot-acp-agent.ts, and `paseo agent mode --list` on its real daemon). */
const COPILOT_MODES = [
  { id: ASKING, label: 'Agent', description: 'Default agent mode for conversational interactions' },
  { id: 'https://agentclientprotocol.com/protocol/session-modes#plan', label: 'Plan', description: 'Plan mode for creating and executing multi-step plans' },
  { id: ALLOW_ALL, label: 'Allow All', description: 'Automatically approves all Copilot tool, path, and URL requests.' },
];
/** A mode no release of paseo gives Copilot, so its facts entry can't list it. */
export const UNLISTED = 'dh3429-mode-no-facts-list';
/** The row's line for a session whose turn started in a mode its facts list as approving its own calls (the issue's words). */
export const UNCHECKED = /no call is checked before it runs/i;
/** The words for a mode the provider's facts entry doesn't list (the issue's words). */
export const NOT_KNOWN = /mode not known/i;

/**
 * The agent's snapshot reads `mode`, as paseo's does after `paseo run --mode`, `paseo agent mode` or a pick in its app:
 * on the real daemon currentModeId and runtimeInfo.modeId hold the same ID (README, The worlds).
 */
export function inMode(f: Fake, mode: string): void {
  f.snapshot.currentModeId = mode;
  f.snapshot.runtimeInfo.modeId = mode;
  f.snapshot.availableModes = COPILOT_MODES.some((m) => m.id === mode) ? COPILOT_MODES : [...COPILOT_MODES, { id: mode, label: 'Not listed', description: 'A mode the facts do not list' }];
}

/** #55's world: the real hub, the real plugin in paseo's stand-in, and a Copilot agent (no hooks of its own, so the plugin gates it) in #55's fixture repo, its snapshot reading `mode`. */
export interface World { home: string; repo: { dir: string; base: string }; host: Host; f: Fake; servers: Record<string, Line> }
export async function copilot(mode: string): Promise<World> {
  needPlugin();
  const { home } = makeHome();
  editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
  const repo = specRepo(home);
  await startHub(home);
  const host = await Host.start(home);
  const f = fakeAgent('copilot', repo.dir);
  f.snapshot.capabilities = { ...f.snapshot.capabilities, supportsSessionListing: true, supportsDynamicModes: true };
  inMode(f, mode);
  const servers = await create(host, f);
  return { home, repo, host, f, servers };
}
/** paseo ends the turn completed; the agent reads idle. Waits until the plugin's handlers returned. */
export async function ends(w: Pick<World, 'host' | 'f'>, turn: string, words = 'Working on it.'): Promise<void> {
  const settled = await w.host.settled(await turnEnds(w.host, w.f, turn, { words }));
  if (settled.errors?.length) throw Error(`agent.turn.after failed in the plugin: ${JSON.stringify(settled.errors)}`);
}

// ---- The hub's reads on a cli connection with the control token, as #55's helpers read the record.
export function control(home: string, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const root = join(home, '.deepbuild');
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    let step = 0;
    // deadline: a hub that never answers fails the read instead of hanging the test.
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}

/** Every string a value holds, at any depth. */
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
/**
 * The session's row (rows.read with its detail, behind every hook the hub received): the list's row every reader shows
 * (`deep`, the app) and the detail `deep status` prints under it. `lines` is every string either holds.
 */
export interface Row { list: Line | undefined; detail: Line | undefined; lines: string[] }
export async function rowOf(home: string, session: string): Promise<Row> {
  const read = await control(home, 'rows.read', { detail: true });
  const list = ((read.rows ?? []) as Line[]).find((r) => r.session === session || r.id === `session:${session}`);
  const detail = ((read.detail ?? {}) as Record<string, Line>)[`session:${session}`];
  return { list, detail, lines: [...strings(list), ...strings(detail)] };
}
/** The row's lines that say `words`. */
export const saying = (row: Row, words: RegExp): string[] => row.lines.filter((line) => words.test(line));
/** A row for a failure's message: its state and why, then all it holds. */
export const rowSays = (row: Row): string => (row.list || row.detail ? `${String(row.detail?.state ?? row.list?.word)}: ${String(row.detail?.why ?? row.list?.why)}; the row holds ${JSON.stringify({ list: row.list, detail: row.detail }).slice(0, 900)}` : 'no row');
/** The session's page: the window of its events a reader of the page gets (session.page). */
export const pageOf = async (home: string, session: string): Promise<Ev[]> => ((await control(home, 'session.page', { session })).events ?? []) as Ev[];

/** The session's readings in the record: its `session.reading` events, in log order. */
export const readingsOf = (evs: readonly Ev[], session: string): Ev[] => evs.filter((e) => e.kind === 'session.reading' && about(e, session));
/** Those whose data names `text`. */
export const naming = (evs: readonly Ev[], text: string): Ev[] => evs.filter((e) => JSON.stringify(e.data ?? {}).includes(text));
/** Those whose data says `words`. */
export const stating = (evs: readonly Ev[], words: RegExp): Ev[] => evs.filter((e) => words.test(JSON.stringify(e.data ?? {})));
