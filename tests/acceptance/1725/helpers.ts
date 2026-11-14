// Test-side tools for the #1725 acceptance tests (README): a real hub (`deep hub run`) with #806's world file, a Claude Code
// session and a Codex session bound by their hooks as #806's suite binds them (its agent stand-ins, whose `deep mcp` is their
// child), the deep_* calls through each one's own `deep mcp` (#26's MCP client), the canvas core the hub runs driven as
// `deep-show run` with the same world and calls (#393's scenario), the documents the criteria name, and the readers of the
// replies. Nothing here stands in for the hub, `deep mcp` or the canvas core. Processes are stopped by PID (#806's cleanup).
//
// Imported, not copied: #26's MCP client and strict-schema check, #806's hub, world file, stand-ins and figure world, #1723's
// lookup of the canvas core the hub runs, and #1732's `deep-show run` driver.

import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { Stand, World, cleanup, events, makeHome, readEvidence, startHub, t26, t393, type JsonObject, type JsonValue, type Line } from '../806/helpers.ts';
import { CLAUDE, CODEX, sessionId, threadOf, type Who } from '../806/figure.ts';
import { hubCanvasCore } from '../1723/helpers.ts';
import { runShow } from '../1732/helpers.ts';

export { CLAUDE, CODEX, cleanup, events, readEvidence, sessionId, t26, threadOf, type JsonObject, type JsonValue, type Line, type Who };

// ---- The criteria: `#1725.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed,
// the leading `- [ ] ` dropped (tests/acceptance/48/README.md).
export const AC = {
  summary: '#1725.6bd3c6a3',
  bounds: '#1725.cdf8a813',
  binding: '#1725.9bb6c26d',
  strict: '#1725.fb4e8d7a',
  sheet: '#1725.8867fb84',
  gap: '#1725.52debd6c',
} as const;

export const TEST_MS = 600_000;

// ---- The documents.

/** The documents the hub minted (#806's world file names them, each on the main panel). */
export const DOC = t393.DOC;

type V3 = [number, number, number];
/** One item of a document an agent sends: its ID, a name, its order key and its own fields, never a layer. */
const item = (id: string, kind: string, order: string, rest: JsonObject): JsonObject => ({ id, kind, name: id, order, ...rest });
const boxAt = (size: V3, pos: V3, rest: JsonObject = {}): JsonObject => ({ params: { size }, at: { pos }, ...rest });

/** The red box's ID, the slab's, their sizes and where they sit. Metres, +Y up; a `mark.box@1` is centred on `at.pos`. */
export const BOX = 'red-box';
export const SLAB = 'slab';
export const SLAB_SIZE: V3 = [2, 0.1, 2];
export const SLAB_POS: V3 = [0, 0.05, 0];
export const BOX_SIZE: V3 = [0.4, 0.3, 0.2];
/** Resting on the slab, whose top is at y 0.1 m; off the slab's centre on x and z, so no two named views see the same frame. */
export const BOX_POS: V3 = [0.5, 0.25, 0.3];
/** How far the planted twin lifts the red box: its bottom 0.2 m above the slab's top. */
export const LIFT = 0.2;

/**
 * The red-box fixture (README: The fixture): one red box resting on a slab, with a camera, a sun and the box's red material,
 * as an agent's own 3D document (no layers, no item layer: its layer comes from its connection). Five items.
 */
export function redBox(lift = 0): JsonObject {
  return {
    format: 1, profile: 'scene', title: 'A red box on a slab', description: 'One red box on a slab: a #1725 acceptance fixture.',
    size: [640, 480], requires: { modules: { scene3d: '^1' } }, camera: 'cam',
    items: {
      cam: item('cam', 'camera@1', 'a0', { params: { projection: 'perspective', position: [2.6, 1.8, 3.4], target: [0, 0.2, 0], fov: 45, near: 0.1, far: 50 } }),
      sun: item('sun', 'light.sun@1', 'a1', { params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-50, 30, 0] } }),
      red: item('red', 'material@1', 'a2', { params: { base_color: [0.8, 0.05, 0.05, 1] } }),
      [SLAB]: item(SLAB, 'mark.box@1', 'a3', boxAt(SLAB_SIZE, SLAB_POS)),
      [BOX]: item(BOX, 'mark.box@1', 'a4', boxAt(BOX_SIZE, [BOX_POS[0], BOX_POS[1] + lift, BOX_POS[2]], { material: 'red' })),
    },
  };
}

/** The six named views of the contact sheet (README: Assumed surfaces). */
export const VIEWS = ['front', 'back', 'left', 'right', 'top', 'three_quarter'] as const;

/** The gate's fill, which a status binding writes from an ask's state (#411's AC5, here on an agent's own board). */
export const GATE = 'gate';
export const GATE_FILL = `items/${GATE}/params/paint/fill`;
/** A board an agent draws as its own document: a gate whose fill shows `ask`'s state, and a caption. */
export function gateBoard(ask: string): JsonObject {
  return t393.board('Gate', [320, 120], [
    t393.rect(GATE, 'Ask state', [16, 16, 96, 24], 'a0'),
    t393.label('caption', 'Caption', 'Gate', [128, 18], 'a1'),
  ], { status_bindings: { 'gate-state': { target: GATE_FILL, source: ask } } });
}

// ---- The world: #806's, both sessions established by their hooks; for criterion 3, an open ask of the Claude Code session
// seeded in the record before the hub starts (#26's seed), as #806's scenarios seed theirs.

export interface Opened {
  tmp: string;
  home: string;
  hub: t26.Hub;
  stands: Map<string, Stand>;
  /** The Claude Code session's open ask, when one was seeded. */
  ask: string | undefined;
}

export async function openWorld(o: { askFor?: Who } = {}): Promise<Opened> {
  const { tmp, home } = makeHome();
  const world = new World(join(tmp, 'world.json'), {
    names: { [sessionId(CLAUDE)]: CLAUDE.name, [sessionId(CODEX)]: CODEX.name },
    panels: t393.PANELS,
    docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' } },
  });
  const work = t26.makeWorktree(join(tmp, 'work'));
  let ask: string | undefined;
  if (o.askFor) {
    const who = o.askFor;
    await t26.seed(home, async (s) => {
      await s.start(sessionId(who), work.path);
      ask = await s.raise(sessionId(who), 'taste', 'Which border for the gate?');
    });
  }
  const hub = await startHub(home, { world: world.path });
  const stands = new Map<string, Stand>();
  for (const who of [CLAUDE, CODEX]) {
    const stand = Stand.start(home, work.path, who.kind, sessionId(who));
    await stand.establish(hub);
    await t26.initialize(stand);
    stands.set(who.label, stand);
  }
  return { tmp, home, hub, stands, ask };
}

export const standOf = (w: Opened, who: Who): Stand => w.stands.get(who.label)!;

// ---- deep_* calls through a session's own deep mcp.

/** A tool's input schema as the session's deep mcp lists it, if it lists the tool. */
export async function schemaOf(w: Opened, who: Who, tool: string): Promise<Line | undefined> {
  return (await t26.listTools(standOf(w, who))).find((t) => t.name === tool)?.inputSchema;
}
const typesOf = (schema: Line | undefined, key: string): string[] => {
  const type = (schema?.properties as Line | undefined)?.[key]?.type;
  return Array.isArray(type) ? (type as string[]) : type === undefined ? [] : [String(type)];
};
/**
 * The arguments as sent: an object-valued field goes as its JSON text where the tool's schema types it as a string and not
 * an object (a strict schema can't type an open object; #806's showArgs), and as itself everywhere else.
 */
export function argsFor(args: JsonObject, schema: Line | undefined): Line {
  const out: Line = {};
  for (const [key, value] of Object.entries(args)) {
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    out[key] = isObject && typesOf(schema, key).includes('string') && !typesOf(schema, key).includes('object') ? JSON.stringify(value) : value;
  }
  return out;
}

/** One deep_* call from `who`'s deep mcp, stamped first as its agent stamps it (a Codex call binds by its PreToolUse, #806). */
export async function call(w: Opened, who: Who, tool: string, args: JsonObject): Promise<t26.Outcome> {
  const sent = argsFor(args, await schemaOf(w, who, tool));
  const stand = standOf(w, who);
  await stand.stamp(w.hub, tool, sent);
  return t26.callTool(stand, tool, sent);
}

/** A call's value; a refusal fails the test, naming its code and the path it refused at (error@2's `code` and `path`). */
export function taken(o: t26.Outcome, what: string): JsonObject {
  const v = (o.value ?? {}) as Line;
  const refusal = o.protocolError ? `a JSON-RPC error ${JSON.stringify(v).slice(0, 600)}` : `refused ${String(v.code)} at ${String(v.path)}: ${JSON.stringify(v).slice(0, 600)}`;
  expect(o.isError, `${what}: ${refusal}`).toBe(false);
  expect(typeof o.value === 'object' && o.value !== null && !Array.isArray(o.value), `${what} answers an object: ${JSON.stringify(o.reply).slice(0, 800)}`).toBe(true);
  return o.value as JsonObject;
}

/** `deep mcp` lists `tool`, or the test fails naming it. */
export async function expectListed(w: Opened, who: Who, tool: string): Promise<void> {
  const names = (await t26.listTools(standOf(w, who))).map((t) => t.name);
  expect(names, `${tool} is in deep mcp's tool list (${names.join(', ')}); it is not, so ${tool} can't be called`).toContain(tool);
}

/** `who` draws `document` on `doc` through its deep_show: presented, or the test fails naming the reply. */
export async function draw(w: Opened, who: Who, doc: string, document: JsonObject, include: string[] = ['issues']): Promise<JsonObject> {
  const reply = taken(await call(w, who, 'deep_show', { doc, document, include }), `deep_show of ${doc} by the ${who.name} session`);
  expect(reply['outcome'], `the ${who.name} session's deep_show of ${doc} is presented: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('presented');
  return reply;
}

// ---- The same calls on `deep-show run`: the canvas core the hub runs, its world shaped as the hub shapes it.

/** The canvas core the hub runs (packages/hub/src/canvas.ts: the newer of target/release and target/debug's deep-show). */
export function core(): string {
  const bin = hubCanvasCore();
  expect(bin, 'BLOCKED: the canvas core the hub runs is built: cargo build --locked -p deep-show').toBeDefined();
  return bin!;
}
/** The deep_show call the hub hands its canvas core for `who`'s deep_show of a whole revision. */
export const showCall = (who: Who, doc: string, document: JsonObject, include: string[] = ['issues']): JsonObject =>
  ({ call: 'deep_show', session: sessionId(who), doc, document, include });
/** #411's deep_query call, as the hub forwards `who`'s (README: deep_query in #411's suite). */
export const queryCall = (who: Who, doc: string, fields: JsonObject): JsonObject => ({ call: 'deep_query', session: sessionId(who), doc, ...fields });

/**
 * `calls` played by `deep-show run` in the world the hub gives its canvas core: both sessions with their threads and names, the
 * world file's panels and documents, and the record's asks; a fresh evidence store. One reply per call.
 */
export function onCore(calls: JsonObject[], record: JsonObject = {}): JsonObject[] {
  const evidence = realpathSync(mkdtempSync(join(tmpdir(), 'dh1725-ev-')));
  try {
    const sessions: JsonObject = {};
    for (const who of [CLAUDE, CODEX]) sessions[sessionId(who)] = { thread: threadOf(who), name: who.name, process: { pid: 0, start: 0 } };
    const docs: JsonObject = { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' } };
    return runShow(core(), { evidence, sessions, record, panels: t393.PANELS, docs, calls }) as JsonObject[];
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
/** The record's view of an open ask, as the hub gives it to its canvas core. */
export const openAsk = (ask: string, who: Who): JsonObject => ({ [ask]: { session: sessionId(who), state: 'needs_you' } });

/** A reply without the two fields the criterion sets apart: the core's version and the module-set digest. */
export function unstamped(reply: JsonObject): JsonObject {
  const { core: _core, set_digest: _digest, ...rest } = reply;
  return rest;
}

// ---- Reading replies.

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: unknown, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const HEX64 = /^[0-9a-f]{64}$/;
/** True when the bytes are a PNG. */
export const isPng = (bytes: Buffer): boolean => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
/** |a - b| within `tol`, for numbers and lists of numbers. */
export function within(a: JsonValue | undefined, b: number | number[], tol: number): boolean {
  if (typeof b === 'number') return typeof a === 'number' && Math.abs(a - b) <= tol;
  return Array.isArray(a) && a.length === b.length && b.every((x, i) => within(a[i], x, tol));
}
