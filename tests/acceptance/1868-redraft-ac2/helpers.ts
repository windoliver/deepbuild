// Test-side tools for #1868's criterion 2 (README): a real hub (`deep hub run`) in a temporary home; a Claude Code
// stand-in (the "board" session) whose own `deep mcp` carries deep_show and deep_query; two more Claude Code sessions in
// two worktrees cut from one commit, driven through the real deep-hook, whose claims share a check, so the hub records
// the carried check's readings while it runs (#1018); and the hub's socket for `ask.answer` and `events.read`. Nothing
// here imports the hub or the canvas core: every value the test compares comes back through deep_show, deep_query or
// the hub's socket.
//
// Reused by import, as #806's suite reuses #26's and #393's and #1018's reuses #29's: #806's agent stand-in (Stand),
// world file (World) and deep_show through `deep mcp`; #26's MCP client, record seeding (before the hub starts) and
// socket; #393's document builders; #29's world layout (default guards, ask settings, confirmation stub, handed
// definitions) and #1018's sessions (open, writes, stop, settled). Neither #806's nor #29's startHub hands the hub both
// the world file and the handed definitions, so this file starts it.
//
// Safety: every folder is under /tmp/dh1868-* (and the /tmp/dh806-* folders #806's helpers make), removed after each
// test; processes are stopped by PID only; no network, no model, no secret.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { cleanup as cleanup806, Stand, World, deepShow, own, showArgs, showSchema, t26, t393, type JsonObject, type Line } from '../806/helpers.ts';
import { git, SEEDED } from '../31/helpers.ts';
import { DEFAULT_RULES, SETTINGS, allEvents, req, cleanup as cleanup29, type Draft, type Ev, type Hub, type World as SessionsWorld } from '../29/h-d.ts';
import { open, settled, stop, writes } from '../1018/helpers.ts';

export type { JsonObject };

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = process.execPath;

// ---------------------------------------------------------------------------------------------------
// Temporary folders and processes

const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1868-'));
  made.push(dir);
  return dir;
}
/** Stops every process the helpers started, by PID, and removes their folders. */
export async function cleanup(): Promise<void> {
  await cleanup806();
  await cleanup29();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// The world

/** The prompt both worker sessions type, and the definition the hub is handed for it: one check, on a file both claims hold alike. */
const PROMPT = 'make the cart total take the discount off for the release numbers';
const CHECK = '.deepbuild/checks/release-gate.sh';
/** The file the check reads: a run that reads only its own check file never carries (#1018), so it reads this one. */
const GATE_FILE = 'src/release.json';
/** One command line, which the command check kind runs as it is: it reads src/release.json and passes. */
const CHECK_LINE = `node -e "JSON.parse(require('node:fs').readFileSync('${GATE_FILE}', 'utf8'))"\n`;
const DRAFTS: Draft[] = [{ ask: PROMPT, requirements: [req('R1', 'The release gate passes', { check: CHECK, on_base: 'passes' })], deliverables: ['src/cart.ts'], budget: null }];
/** The fix both workers write: the two claims hold the same files, so the second reads the first's run as carried. */
const CART = `export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  return cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n}\n`;

export interface Opened {
  tmp: string;
  home: string;
  hub: Hub & t26.Hub;
  sessions: SessionsWorld & { trees: string[] };
  /** The board session: the one that calls deep_show and deep_query. */
  board: Stand;
  /** The board session's ask still open when the hub starts, which the test answers through the hub. */
  open: string;
  /** The board session's ask answered before the hub starts: what an answered ask's status mark shows. */
  answered: string;
}

const BOARD_SESSION = (() => {
  const h = createHash('sha256').update('dh1868:board-session').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
})();
const BOARD_NAME = 'Claude Code: release numbers';
/** Each board has its own document, so one board's revision never leaves out the other's items. */
const ASK_DOC = t393.DOC.a;
const READING_DOC = t393.DOC.b;

/**
 * #29's layout under /tmp/dh1868-*: a home with the shipped default guards and your ask settings, a repo on `main` holding
 * #31's sample and the check in one commit, two worktrees cut from it, and a third folder, a repo of its own, where the
 * board session works. Before the hub starts the record holds two asks of the board session, one open and one answered,
 * appended through the real record and asks core as the hub's core would.
 */
export async function openWorld(): Promise<Opened> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  for (const [path, bytes] of Object.entries({ ...SEEDED, [GATE_FILE]: '{ "release": "1.4.0" }\n', [CHECK]: CHECK_LINE })) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'the sample repo and its check']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const trees: string[] = [];
  for (const n of [1, 2]) {
    const tree = join(tmp, `w${n}`);
    git(repo, ['worktree', 'add', '-q', '-b', `worker-${n}`, tree, 'main']);
    trees.push(realpathSync(tree));
  }
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: DRAFTS }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  const sessions = { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base, trees };

  let open = '';
  let answered = '';
  await t26.seed(home, async (s) => {
    open = await s.raise(BOARD_SESSION, 'taste', 'Which header colour should the release numbers board use?');
    s.at(s.now() + 1);
    answered = await s.raise(BOARD_SESSION, 'taste', 'Which font should the release numbers board use?');
    s.at(s.now() + 1);
    await s.asks.answer({ writer: 'cli', actor: 'you', scope: 'you', session: BOARD_SESSION, project: t26.PROJECT }, answered, { option: 'green' });
  });

  const world = new World(join(tmp, 'world.json'), { names: { [BOARD_SESSION]: BOARD_NAME }, panels: t393.PANELS, docs: { [ASK_DOC]: { panel: 'main' }, [READING_DOC]: { panel: 'main' } } });
  const hub = await startHub(sessions, world.path);
  const boardTree = t26.makeWorktree(join(tmp, 'board'));
  const board = Stand.start(home, boardTree.path, 'claude-code', BOARD_SESSION);
  await board.establish(hub);
  await t26.initialize(board);
  return { tmp, home, hub, sessions, board, open, answered };
}

/** `deep hub run` with #29's test settings and the world file; BLOCKED when it doesn't start. */
async function startHub(w: SessionsWorld, worldFile: string): Promise<Hub & t26.Hub> {
  const env = t26.childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_SHOW: worldFile });
  const child = spawn(NODE, [t26.CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-20_000)));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
    });
    void exit.then(() => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start: ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: String(ready.socket ?? join(w.root, 'hub.sock')), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => err, output: () => `${out}${err}` };
}

/** One method on a `cli` connection with the control token, as `deep` makes it; throws with the hub's refusal. */
export async function hubCall(hub: t26.Hub, method: string, params: Line = {}): Promise<Line> {
  const conn = await t26.control(hub);
  try {
    const reply = await conn.call(method, params, 120_000);
    if ('error' in reply) throw Error(`the hub refused ${method}: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  } finally {
    conn.close();
  }
}

/**
 * The two worker sessions claim the same check on one commit, one after the other: the first runs it, the second reads
 * it as carried, and the hub records that carry's readings (#1018). Returns once both claims have settled.
 */
export async function carryOnce(o: Opened): Promise<void> {
  const [a, b] = [await open(o.hub, o.sessions, o.sessions.trees[0]!, PROMPT), await open(o.hub, o.sessions, o.sessions.trees[1]!, PROMPT)];
  await writes(a, { 'src/cart.ts': CART });
  await stop(a);
  await settled(o.hub, o.sessions, [a]);
  await writes(b, { 'src/cart.ts': CART });
  await stop(b);
  await settled(o.hub, o.sessions, [a, b]);
}

/** Every event in the record, through `events.read`. */
export const eventsOf = (o: Opened): Promise<Ev[]> => allEvents(o.hub);

// ---------------------------------------------------------------------------------------------------
// The boards: one with a status mark bound to an ask, one with a count bound to a reading (#393's refs.test.ts shapes).

export const STATE_PATH = 'items/state/params/paint/fill';
export const VALUE_PATH = 'items/value/params/text';
const backdrop = (): JsonObject => t393.rect('back', 'Backdrop', [0, 0, 320, 160], 'a0', 'ground');

/** A board: the document it goes to and the whole revision. */
export interface Board { doc: string; document: JsonObject }

/** A status mark whose fill is bound to the ask's state. */
export const askBoard = (title: string, ask: string): Board => ({ doc: ASK_DOC, document: t393.board(title, [320, 160], [
  backdrop(),
  { id: 'state', kind: 'rect@1', name: 'Ask state', order: 'a1', params: { box: [16, 16, 96, 24] } },
], { status_bindings: { 'ask-state': { target: STATE_PATH, source: ask } } }) });

/** A count whose text is bound to the reading's value. */
export const readingBoard = (title: string, reading: string): Board => ({ doc: READING_DOC, document: t393.board(title, [320, 160], [
  backdrop(),
  { id: 'value', kind: 'text@1', name: 'Reading value', order: 'a1', params: { text: '', font: 'body', size: 13, numerals: 'tabular', widest: '99999999', box: { w: 160, h: 20 } }, at: { pos: [16, 96, 0] } },
], { bound_values: { 'reading-value': { target: VALUE_PATH, source: reading } } }) });

/** The board session's deep_show of a whole revision, through its own `deep mcp`. */
export async function show(o: Opened, { doc, document }: Board, what: string): Promise<JsonObject> {
  const call = { doc, document, t: '0s', size: [320, 160], include: ['issues'] };
  await o.board.stamp(o.hub, 'deep_show', showArgs(call, await showSchema(o.board)));
  return (await deepShow(o.board, call, what)).reply;
}

/** The board session's deep_query of the current revision of `board`'s document, its values at `paths`, at 0 s. */
export async function query(o: Opened, board: Board, paths: string[], what: string): Promise<JsonObject> {
  const args = { doc: board.doc, what: 'rows', rev: null, items: null, paths, at: ['0s'], cap: null, cursor: null, expect: null, path: null, t: null, target: null, by: null };
  const got = await t26.callTool(o.board, 'deep_query', args);
  expect(got.protocolError, `${what}: deep mcp has deep_query: ${JSON.stringify(got.reply).slice(0, 600)}`).toBe(false);
  expect(got.isError, `${what}: deep_query answers: ${JSON.stringify(got.reply).slice(0, 1500)}`).toBe(false);
  return got.value as JsonObject;
}
