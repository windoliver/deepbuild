// Test-side tools for #1456's acceptance tests (README.md): the fixture's sessions written into a record as the hub's
// core writes them, a real hub (`deep hub run`) started on that record, each session's newest `session.state` read back
// through the hub's socket (`events.read`), and the display-text guard run over a copy of the two files it reads.
// #992's hub, socket and process helpers (../992/helpers.ts) are reused by import, never copied; the record is written
// through its public entry (@deepbuild/record).
//
// Safety: every folder is under /tmp/dh1456-* (a socket path must fit in 104 bytes on macOS); HOME is a temp folder for
// every process a test starts, so nothing reads or writes the real ~/.deepbuild or ~/.claude. Processes are stopped by
// PID only (#992's cleanup), never by name or port. No test runs a live agent or reaches the network.
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, RecordError, ulid, type Connection } from '@deepbuild/record';
import { allEvents, cleanup as cleanup992, COVERED, NODE, REPO, run, shown, sleep, startHub, type Home, type Hub, type Ran } from '../992/helpers.ts';

export { NODE, REPO, run, shown, type Ran };
export const HERE = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');

// ---- The criteria's IDs: `#1456.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and with
// its whitespace collapsed, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1456.aa4dd611';
export const AC2 = 'AC2 #1456.f70bc414';
export const AC3 = 'AC3 #1456.86f6be87';
export const AC4 = 'AC4 #1456.6799dc51';

// ---- The fixture (README: The fixture).
export interface Reading { code: string; text: string; reworded: string }
export type Step = { attention: string } | Reading;
export interface Session { name: string; id: string; expected: string; steps: Step[] }
export const SESSIONS: Session[] = (JSON.parse(readFileSync(join(HERE, 'fixtures/sessions.json'), 'utf8')) as { sessions: Session[] }).sessions;
/** README, Defined here 1: the closed set of codes a reading carries. */
export const CODES = ['hooks_cant_run', 'hooks_run_again', 'watch_only', 'denied_ran_anyway', 'mods_watch', 'mods_gone', 'ran_unleased', 'stop_not_held', 'monitor_waiting', 'monitor_ended', 'interrupted'] as const;

// ---- Temp folders: removed at cleanup, after #992's cleanup has stopped every process by PID.
const made: string[] = [];
export async function cleanup(): Promise<void> {
  await cleanup992();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1456-'));
  made.push(dir);
  return dir;
}
/** A fresh home, as #992's: `<tmp>/h` is HOME; `<tmp>/bin`, first on PATH, holds #992's stand-ins for claude, launchctl and systemctl. */
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(REPO, 'tests/acceptance/992/fixtures/stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  return { tmp, home, bin };
}

/**
 * How a record holds the fixture's readings (README: Defined here 1):
 * - `legacy`: as the merge base writes them, session.reading@1 with `{reading: text}` and no code;
 * - `coded`: session.reading@2 with `{reading: text, code}`;
 * - `reworded`: session.reading@2 with `{reading: reworded, code}`.
 * A record with no session.reading@2 (the merge base) refuses the coded ones; each is then written as @1 with its words
 * alone, and `refused` says how many were.
 */
export type Form = 'legacy' | 'coded' | 'reworded';
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
export async function writeRecord(h: Home, form: Form): Promise<{ refused: number; firstRefusal?: string }> {
  const record = await openRecord({ path: join(h.home, '.deepbuild', 'ledger.db'), now: Date.now });
  let refused = 0;
  let firstRefusal: string | undefined;
  try {
    const steps = SESSIONS.reduce((n, s) => n + s.steps.length, 0);
    // A minute apart, the newest a minute ago: every session was seen in the last day, as a live one is.
    let ts = Date.now() - (steps + 1) * 60_000;
    for (const s of SESSIONS) {
      const core: Connection = { writer: 'core', actor: 'you', scope: 'you', session: s.id };
      for (const step of s.steps) {
        ts += 60_000;
        if ('attention' in step) {
          await record.append(core, { v: 2, id: ulid(ts), kind: 'session.attention', ts, subject: `session:${letters(s.id)}`, data: { state: step.attention } });
          continue;
        }
        const words = form === 'reworded' ? step.reworded : step.text;
        if (form === 'legacy') { await record.append(core, { v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading: words } }); continue; }
        try {
          await record.append(core, { v: 2, id: ulid(ts), kind: 'session.reading', ts, data: { reading: words, code: step.code } });
        } catch (error) {
          if (!(error instanceof RecordError)) throw error;
          refused += 1;
          firstRefusal ??= error.message;
          await record.append(core, { v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading: words } });
        }
      }
    }
  } finally {
    await record.close();
  }
  return { refused, ...(firstRefusal ? { firstRefusal } : {}) };
}

/**
 * A hub started on the record `form` makes, and each fixture session's state as the hub records it: its newest
 * `session.state`, `<state>/<cause>`, read through `events.read` once every session has one and two reads 1 s apart
 * agree. BLOCKED when a session has none within 60 s.
 */
export interface States { states: Map<string, string>; refused: number; firstRefusal?: string; hub: Hub }
export async function statesOf(form: Form, plant?: string): Promise<States> {
  const h = makeHome();
  const written = await writeRecord(h, form);
  const hub = await startHub(h, plant);
  const deadline = Date.now() + 60_000;
  let last = '';
  for (;;) {
    const states = new Map<string, string>();
    for (const e of await allEvents(hub)) {
      if (e.kind === 'session.state' && typeof e.session === 'string') states.set(e.session, `${String(e.data.state)}/${String(e.data.cause)}`);
    }
    const now = JSON.stringify(SESSIONS.map((s) => states.get(s.id)));
    if (SESSIONS.every((s) => states.has(s.id)) && now === last) return { states, ...written, hub };
    if (Date.now() >= deadline) throw Error(`BLOCKED: the hub recorded no session.state for ${SESSIONS.filter((s) => !states.has(s.id)).map((s) => s.name).join(', ') || 'no session'} within 60 s; ${hub.output().slice(-1500)}`);
    last = now;
    await sleep(1000);
  }
}

/** Each session whose state isn't the fixture's expected one: `<name> (<id>): expected <state/cause>, read <state/cause>`. */
export const moved = (read: Map<string, string>): string[] =>
  SESSIONS.filter((s) => read.get(s.id) !== s.expected).map((s) => `${s.name} (${s.id}): expected ${s.expected}, read ${read.get(s.id) ?? 'none'}`);
/** Each session's state beside its expected one, a line each. */
export const beside = (label: string, read: Map<string, string>): string =>
  `${label}:\n${SESSIONS.map((s) => `  ${s.name.padEnd(18)} expected ${s.expected.padEnd(22)} read ${read.get(s.id) ?? 'none'}`).join('\n')}`;

// ---- The display-text guard (README: Defined here 3).
export const GUARD = join(REPO, 'scripts/display-text-guard.mjs');
export const STATUS_TS = 'packages/hub/src/status.ts';
export const STATES_RS = 'crates/deep-app/src/states.rs';
/**
 * A checkout of the guard's two files: a temp root holding this checkout's status.ts and states.rs at their paths, and,
 * with `plant`, one line appended to one of them. Gives the root and the planted line's number.
 */
export function guardRoot(plant?: { file: typeof STATUS_TS | typeof STATES_RS; line: string }): { root: string; line?: number } {
  const root = tempDir();
  let line: number | undefined;
  for (const file of [STATUS_TS, STATES_RS]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    let text = readFileSync(join(REPO, file), 'utf8');
    if (plant?.file === file) {
      if (!text.endsWith('\n')) text += '\n';
      line = text.split('\n').length;
      text += `${plant.line}\n`;
    }
    writeFileSync(join(root, file), text);
  }
  return { root, ...(line === undefined ? {} : { line }) };
}
/** `node scripts/display-text-guard.mjs --root <root>`. */
export const guard = (root: string): Promise<Ran> => run(NODE, [GUARD, '--root', root], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C' }, timeoutMs: 60_000 });
