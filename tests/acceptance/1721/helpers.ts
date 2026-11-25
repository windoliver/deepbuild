// Test-side tools for the #1721 acceptance tests (README): a real hub (`deep hub run`) in a temporary home with no world
// file, Claude Code sessions bound by their hooks (#806's agent stand-ins, whose `deep mcp` is their child), deep_show through
// each one's own `deep mcp` (#26's MCP client), the canvas core's `read` through the hub's app connection, and the one-box 3D
// scene. Nothing here stands in for the hub, `deep mcp` or the canvas core. Processes are stopped by PID only.
//
// Imported, not copied: #26's socket and MCP client, #806's hub, stand-ins and record readers, #96's readers of a `read` reply.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, expect } from 'vitest';
import { Stand, aboutDoc, cleanup, events, makeHome, readEvidence, showArgs, showSchema, startHub, t26, threadOf, uuidOf, type JsonObject, type Line } from '../806/helpers.ts';
import * as t96 from '../96/helpers.ts';

export { aboutDoc, events, readEvidence, t26, t96, type JsonObject };

// No child of these tests reaches this checkout's repository by its environment (the hub and the stand-ins inherit this one).
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete process.env[name];

// ---- The criteria: `#1721.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed,
// the leading `- [ ] ` dropped (criterionId in scripts/proof-change.mjs).
export const AC = { patch: '#1721.ec24a571', layers: '#1721.d05285db', restart: '#1721.560ffc8c' } as const;

export const TEST_MS = 300_000;
export const HOOK_MS = 900_000;

// ---- The scene: one box, 1 m a side, seen square on from 6 m away. Metres, +Y up; a `mark.box@1` is centred on `at.pos`.

export const BOX = 'box';
/** The issue's patch: `items/box/at/pos` to [1, 0.5, 0], 1 m to the right of where the revision put it. */
export const MOVE: JsonObject = { op: 'set', id: BOX, path: `items/${BOX}/at/pos`, value: [1, 0.5, 0] };
const FROM = [0, 0.5, 0];
const SIZE = [320, 240];

/** A whole revision as an agent sends it: no id, no layers, no item layer. */
export const oneBox = (): JsonObject => ({
  format: 1, profile: 'scene', title: 'One box', description: 'One box: a #1721 acceptance fixture.', size: SIZE,
  requires: { modules: { scene3d: '^1' } }, camera: 'cam',
  items: {
    cam: { id: 'cam', name: 'Camera', kind: 'camera@1', order: 'a0', params: { projection: 'perspective', position: [0, 0.5, 6], target: [0, 0.5, 0], fov: 45, near: 0.1, far: 50 } },
    sun: { id: 'sun', name: 'Sun', kind: 'light.sun@1', order: 'a1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-50, 30, 0] } },
    [BOX]: { id: BOX, name: 'Box', kind: 'mark.box@1', order: 'a2', params: { size: [1, 1, 1] }, at: { pos: FROM } },
  },
});
/** The second session's item, as #96's patches create one: a 2D rect, in the frame's top-left corner, clear of the box. */
export const SECOND = 'second-label';
export const CREATE: JsonObject = t96.create(t96.node(SECOND, 'Second session\'s label', [8, 8]));

// ---- The world: a hub with no world file, and the sessions the test names, each established through its hooks.

export interface Session { stand: Stand; id: string; /** The writer text its layer holds: `agent:<thread>`. */ writer: string }
export interface World { home: string; hub: t26.Hub; sessions: Session[] }

async function openSession(home: string, cwd: string, hub: t26.Hub, label: string): Promise<Session> {
  const id = uuidOf(`1721:${label}`);
  const stand = Stand.start(home, cwd, 'claude-code', id);
  await stand.establish(hub);
  await t26.initialize(stand);
  return { stand, id, writer: `agent:${await threadOf(hub, id)}` };
}

/** Before each test a hub with no world file and one Claude Code session per label; after it, every process stopped by PID. */
export function useWorld(...labels: string[]): () => World {
  let world: World | undefined;
  beforeEach(async () => {
    const { tmp, home } = makeHome();
    const work = join(tmp, 'work');
    mkdirSync(work);
    const hub = await startHub(home);
    const sessions: Session[] = [];
    for (const label of labels) sessions.push(await openSession(home, work, hub, label));
    world = { home, hub, sessions };
  }, HOOK_MS);
  afterEach(async () => { world = undefined; await cleanup(); }, HOOK_MS);
  return () => world!;
}

/** The hub stopped by its own PID and started again on the same home, with no world file. */
export async function restartHub(w: World): Promise<void> {
  const { pid } = w.hub;
  process.kill(pid, 'SIGTERM');
  for (const until = Date.now() + 120_000; t26.alive(pid) && Date.now() < until;) await sleep(50);
  if (t26.alive(pid)) throw Error(`BLOCKED: the hub (the test's own process ${pid}) didn't stop within 120 s of SIGTERM`);
  w.hub = await startHub(w.home);
  expect(w.hub.pid, 'another hub process').not.toBe(pid);
}

// ---- deep_show through a session's own deep mcp.

const brief = (v: unknown): string => (JSON.stringify(v) ?? 'undefined').slice(0, 900);
/** A refusal's codes and the paths it refused at, for a failure to name. */
export const refusalOf = (reply: JsonObject): string => t96.issues(reply).map((i) => `${i.code} at ${i.path ?? '?'}`).join(', ');

/**
 * One deep_show call: its reply, a refusal's included. A call `deep mcp` answers as not having reached the hub (it waits 1 s
 * for the socket, less than a loaded machine may take, and nothing was recorded) is made again for up to 90 s.
 */
async function show(s: Session, call: Line, what: string): Promise<JsonObject> {
  const args = showArgs(call, await showSchema(s.stand));
  for (const until = Date.now() + 90_000; ;) {
    const o = await t26.callTool(s.stand, 'deep_show', args);
    const reply = o.value as Line | undefined;
    if (reply?.code === 'unavailable' && /nothing was recorded/.test(String(reply.remediation)) && Date.now() < until) { await sleep(1000); continue; }
    expect(o.protocolError, `${what}: answered as a tool result, not a JSON-RPC error: ${brief(o.reply)}`).toBe(false);
    expect(t96.isObject(reply as JsonObject | undefined), `${what}: answers an object: ${brief(o.reply)}`).toBe(true);
    return reply as JsonObject;
  }
}

/** The session draws the scene on `doc` as a whole revision: presented at revision 1. */
export async function draw(s: Session, doc: string): Promise<void> {
  const reply = await show(s, { doc, document: oneBox(), t: '0s', size: SIZE, include: ['issues', 'pixels'] }, 'deep_show of the whole revision');
  expect(reply['outcome'], `the whole revision is presented: ${brief(reply)}`).toBe('presented');
  expect(reply['rev'], 'at revision 1').toBe(1);
}
/** The session's patch of `ops` on `base` is applied as revision `rev`; a refusal fails the test naming its code and path. Its patch ID. */
export async function patched(s: Session, doc: string, base: number, ops: JsonObject[], rev: number): Promise<string> {
  const id = t26.ulid();
  const reply = await show(s, { doc, patch: { patch: id, doc, base, reason: 'a #1721 acceptance patch', ops } }, 'deep_show of the patch');
  const said = refusalOf(reply);
  expect(reply['outcome'], `deep_show of the patch on base ${base} is applied; it is ${String(reply['outcome'])}${said ? `, with ${said}` : ''}: ${brief(reply)}`).toBe('applied');
  expect(reply['rev'], `the patch is applied at revision ${rev}: ${brief(reply)}`).toBe(rev);
  return id;
}

/** An item's `visible` box in px, [x, y, w, h], in a render-back of `rev` at 0 s: deep_show with no document and no patch. */
export async function visibleBox(s: Session, doc: string, rev: number, id: string): Promise<number[]> {
  const reply = await show(s, { doc, rev, t: '0s', size: SIZE, include: ['pixels'] }, `render-back of revision ${rev}`);
  expect(reply['outcome'], `the render-back of revision ${rev} is presented: ${brief(reply)}`).toBe('presented');
  expect(reply['rev'], `the render-back is of revision ${rev}`).toBe(rev);
  const rows = t96.arr(reply['visible'], `the visible table of the render-back of revision ${rev}`).map((r) => t96.obj(r, 'a visible row'));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `the render-back of revision ${rev} shows ${id}: its visible table is ${brief(rows)}`).toBeDefined();
  return t96.arr(row!['box'], `${id}'s visible box`).map((v) => t96.num(v, 'a number of the box'));
}
/**
 * The box moved 1 m right: 64 px (its far face's left edge) to 70 px (its near face's right edge) at this camera and size, so
 * both its edges are more than 40 px right of where they were.
 */
export function expectShiftedRight(before: number[], after: number[], what: string): void {
  const said = `${what}: the box's visible box was ${JSON.stringify(before)} at revision 1 and is ${JSON.stringify(after)}`;
  expect(after[0]! - before[0]!, `${said}; its left edge is right of it`).toBeGreaterThan(40);
  expect(after[0]! + after[2]! - before[0]! - before[2]!, `${said}; its right edge is right of it`).toBeGreaterThan(40);
}

// ---- The canvas core's `read`, as the app plays a canvas call on the hub (`canvas.user` on an app connection), read by #96's reader.

export async function readDoc(w: World, doc: string): Promise<t96.Shown> {
  const token = readFileSync(join(t26.rootOf(w.home), 'control.token'), 'utf8').trim();
  const { conn, answer } = await t26.Conn.open(w.hub.socket, { hello: 'app', token });
  try {
    if (answer?.role !== 'app') throw Error(`BLOCKED: the hub refused the app hello: ${brief(answer)}`);
    const reply = await conn.call('canvas.user', { call: t96.read(doc) }, 120_000);
    expect(reply.error, `canvas.user read of ${doc} is answered`).toBeUndefined();
    return t96.shown(reply.result as JsonObject, `read of ${doc}`);
  } finally {
    conn.close();
  }
}
