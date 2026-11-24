// Test-side tools for the #3035 acceptance tests (README: The surface under test). They reach the conversion the way
// #162's suite reaches the import job: a real hub (`deep hub run`, #1922's world) with the first-party plug-in
// `packages/jobs/import` installed, `deep_job {op: run, kind: import, tool, params: {from: urdf}, inputs: [{name:
// file, path}]}` over `deep mcp`, and the `document` and the `report` the job keeps, read by SHA-256 from the hub's
// evidence store. What a converted world does is read from the base's physics runner `deep-physics` (#191's build):
// its `check` of the world as converted, and its bakes of the world in kinematic mode, where the solve places every
// body from the joints' own frames at the coordinates a scene's channels give. The planted programs are plug-ins made
// here at test time, each one tool for the kind `import` that runs the right tool and makes one thing wrong.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. A hub or a runner that can't start says `BLOCKED:`, a run that
// can't be measured `INCONCLUSIVE:`: nothing missing or unrun passes.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { physicsBin } from '../191/helpers.ts';
import { counted, install, job, openWorld, REPO, type Outcome, type Ran, type Run, type World } from '../1922/helpers.ts';
import { spoil, type PlantedName } from './fixtures/planted/spoil.mjs';
import {
  ANGLE_TOLERANCE, AXES, BENT, GRIPPER, RAD, TIP_TOLERANCE, TRAVEL, YAW_RAD, add, about, apart, apply, dot, far, inPlane, movedInertia, movedPose, norm, rotOf,
  scale, sub, tipAt, tipInPlane, unit, upError, vec3, type Json, type JsonObject, type Mat3, type Vec3,
} from './model.ts';

export { prebuild, TIMEOUT } from '../191/helpers.ts';
export { said, sha256, shown, type Ran, type Run } from '../1922/helpers.ts';
export { FLIPPED, MOVED, UNLISTED, type PlantedName } from './fixtures/planted/spoil.mjs';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: 'AC1 #3035.e8200294', 2: 'AC2 #3035.b3b50392', 3: 'AC3 #3035.2a1744e4', 4: 'AC4 #3035.0abd59c7', 5: 'AC5 #3035.a4b3d8f2', 6: 'AC6 #3035.36c146dd',
} as const;

const HERE = fileURLToPath(new URL('./', import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
/** A fixture file's bytes as text. */
export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

const isObject = (v: Json | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, most = 900): string => (JSON.stringify(v) ?? 'undefined').slice(0, most);
const section = (o: JsonObject, key: string): JsonObject => (isObject(o[key]) ? o[key] : {});
const first = (text: string): string => text.split('\n')[0] ?? '';
const fix = (x: number, digits = 7): string => (Number.isFinite(x) ? String(+x.toFixed(digits)) : String(x));
const at3 = (v: Vec3, digits = 7): string => `(${v.map((x) => fix(x, digits)).join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// The names this suite chooses (README: The surface under test)

/** The first-party plug-in that holds the kind, and the kind, both the base's (#162). */
export const IMPORT_PACKAGE = join(REPO, 'packages', 'jobs', 'import');
export const KIND = 'import';
/** The params of a conversion, as deep_job takes them: the kind's `from` names the format. */
export const PARAMS = '{"from":"urdf"}';
/** The input that holds the file, the kind's own. */
export const INPUT = 'file';
/** The one tool of the kind that converts: its name starts `urdf`, pinned as every job tool is. */
const TOOL_NAME = /^urdf[a-z0-9_-]*@\d+\.\d+\.\d+$/;
/** The planted tools, and the tool that runs the right one as it is: each a name@version of its own. */
const PLANTED_TOOL: Record<PlantedName | 'as_is', string> = {
  flips_one_joint_axis: 'flips-one-joint-axis@1.0.0',
  copies_poses_as_written: 'copies-poses-as-written@1.0.0',
  drops_one_silently: 'drops-one-silently@1.0.0',
  as_is: 'runs-as-is@1.0.0',
};

// ---------------------------------------------------------------------------------------------------
// The hub (#1922's world) with the import plug-in installed

export interface Hub { w: World; tool: string; evidence: string }
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** deep_job's list of the kind's tools, by name@version; or, as text, why there is none. */
async function toolsOf(w: World): Promise<string[] | string> {
  let listed: Outcome;
  try { listed = await job(w, { op: 'list' }); } catch (e) { return `BLOCKED: deep_job {op: list} gave no reply: ${first(message(e))}; this is not a pass`; }
  const kinds = Array.isArray(listed.value['kinds']) ? (listed.value['kinds'] as JsonObject[]) : [];
  const kind = kinds.find((k) => k['kind'] === KIND);
  if (!kind) return `deep_job lists no kind ${KIND}: ${listed.text.slice(0, 600)}`;
  return (Array.isArray(kind['tools']) ? kind['tools'] : []).filter(isObject).map((t) => String(t['tool']));
}

/**
 * A hub with `packages/jobs/import` installed and the kind's one tool that converts a robot description; or, as
 * text, what is missing: a hub that doesn't start (`BLOCKED:`, tried three times, since a loaded machine starts one
 * slowly), an install that is refused, or a kind that lists no such tool or more than one.
 */
export async function openHub(): Promise<Hub | string> {
  if (!existsSync(join(IMPORT_PACKAGE, 'deepbuild.json'))) return `the import plug-in isn't at packages/jobs/import`;
  let w: World | undefined;
  let why = '';
  for (let attempt = 0; attempt < 3 && !w; attempt++) {
    try { w = await openWorld(); } catch (e) { why = first(message(e)); }
  }
  if (!w) return `${why.startsWith('BLOCKED:') ? '' : 'BLOCKED: '}${why}; this is not a pass`;
  let ran: Ran;
  try { ran = await install(w, IMPORT_PACKAGE); } catch (e) { return `BLOCKED: deep install packages/jobs/import couldn't run: ${first(message(e))}; this is not a pass`; }
  if (ran.code !== 0) return `deep install packages/jobs/import didn't load it: exit ${String(ran.code)}: ${`${ran.stdout}\n${ran.stderr}`.trim().slice(-1200)}`;
  const tools = await toolsOf(w);
  if (typeof tools === 'string') return tools;
  const mine = tools.filter((t) => TOOL_NAME.test(t));
  if (mine.length !== 1) return `the kind ${KIND} lists ${mine.length} tools whose name starts urdf, not one (README: The surface under test); its tools: ${tools.join(', ') || 'none'}`;
  return { w, tool: mine[0]!, evidence: join(w.home, '.deepbuild', 'evidence') };
}

/** One deep_job run of the conversion on a fixture file, copied into the project folder under its own name, with the processes it started (#1922's `counted`). */
export async function runFile(hub: Hub, name: string): Promise<Run | string> {
  const path = join(hub.w.project, name);
  writeFileSync(path, readFileSync(join(FIXTURES, name)));
  try {
    return await counted(hub.w, () => job(hub.w, { op: 'run', kind: KIND, tool: hub.tool, params: PARAMS, inputs: [{ name: INPUT, path }] }));
  } catch (e) {
    return `BLOCKED: the run of ${name} gave no reply: ${first(message(e))}; this is not a pass`;
  }
}

/** Bytes the hub's evidence store holds under a SHA-256 (`<2 hex>/<62 hex>`), or null. */
export function stored(hub: Hub, sha: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(hub.evidence, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? readFileSync(path) : null;
}
/** Every file the hub's evidence store holds, by its SHA-256, sorted. */
export function kept(hub: Hub): string[] {
  if (!existsSync(hub.evidence)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(hub.evidence)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const file of readdirSync(join(hub.evidence, dir))) if (/^[0-9a-f]{62}$/.test(file)) out.push(`${dir}${file}`);
  }
  return out.sort();
}

/** A reply's outputs, each by its SHA-256: `outputs.<name>.sha256`. */
export function outputsOf(o: Outcome): Record<string, string> {
  const outputs = isObject(o.value['outputs']) ? (o.value['outputs'] as JsonObject) : {};
  return Object.fromEntries(Object.entries(outputs).map(([n, v]) => [n, isObject(v) && typeof v['sha256'] === 'string' ? v['sha256'] : '']));
}
/** A reply's receipt: `{kind, tool, key, build, cache, inputs}`. */
export const receiptOf = (o: Outcome): JsonObject => (isObject(o.value['receipt']) ? (o.value['receipt'] as JsonObject) : {});
/** How a run read, for a failure's words. */
export const brief = (r: Run): string => `${r.started} process${r.started === 1 ? '' : 'es'} started; reply ${r.outcome.text.slice(0, 900)}`;

/** A conversion that is done: its run, its outputs by hash, and the `document` and `report` as the store holds them. */
export interface Converted {
  run: Run; outputs: Record<string, string>; texts: { document: string; report: string }; document: JsonObject; report: JsonObject;
  /** The document's one world, and its ID. */
  world: JsonObject; worldId: string;
}
/** The document's one world: `worlds` holds exactly one, a JSON object; or, as text, what it holds instead. */
export function worldOf(document: JsonObject): { world: JsonObject; worldId: string } | string {
  const worlds = Object.entries(section(document, 'worlds'));
  if (worlds.length !== 1 || !isObject(worlds[0]![1])) return `the document's worlds hold ${worlds.length} worlds, not the robot's one (README: the document); the document's keys: ${Object.keys(document).join(', ') || 'none'}`;
  return { world: worlds[0]![1], worldId: worlds[0]![0] };
}
/** A run read as a conversion that is done; or, as text, what it answered instead (`BLOCKED:` for a blocked job, never a pass). */
export function convertedOf(hub: Hub, run: Run | string, name: string): Converted | string {
  if (typeof run === 'string') return run;
  const o = run.outcome;
  const status = String(o.value['status'] ?? '');
  if (/blocked/i.test(status)) return `BLOCKED: the conversion of ${name} is blocked: ${o.text.slice(0, 900)}; this is not a pass`;
  if (o.isError || status !== 'done') return `the conversion of ${name} isn't done: ${o.text.slice(0, 900)}`;
  const outputs = outputsOf(o);
  const texts = { document: '', report: '' };
  const read: Record<string, JsonObject> = {};
  for (const n of ['document', 'report'] as const) {
    const bytes = stored(hub, outputs[n] ?? '');
    if (!bytes) return `the conversion of ${name} is done, and the hub's evidence store holds no ${n} under outputs.${n}.sha256 (${show(o.value['outputs'], 300)})`;
    texts[n] = bytes.toString('utf8');
    let v: Json;
    try { v = JSON.parse(texts[n]) as Json; } catch { return `the conversion of ${name}: its ${n} isn't JSON: ${texts[n].slice(0, 200)}`; }
    if (!isObject(v)) return `the conversion of ${name}: its ${n} isn't a JSON object: ${texts[n].slice(0, 200)}`;
    read[n] = v;
  }
  const world = worldOf(read['document']!);
  if (typeof world === 'string') return `the conversion of ${name}: ${world}`;
  return { run, outputs, texts, document: read['document']!, report: read['report']!, ...world };
}
/** One conversion of a fixture file in `hub`; or, as text, why there is none. */
export async function convert(hub: Hub | string, name: string): Promise<Converted | string> {
  if (typeof hub === 'string') return hub;
  return convertedOf(hub, await runFile(hub, name), name);
}

/** What a planted program makes of a right conversion's outputs: the same function its tool runs (fixtures/planted/spoil.mjs). */
export function spoiled(name: PlantedName, c: Converted): { document: JsonObject; report: JsonObject; world: JsonObject } | string {
  const out = spoil(name, c.texts);
  if (out.document === c.texts.document && out.report === c.texts.report) return `INCONCLUSIVE: ${name} changes nothing in this conversion's outputs, so there is no planted conversion to read; this is not a pass`;
  const document = JSON.parse(out.document) as JsonObject;
  const world = worldOf(document);
  return typeof world === 'string' ? world : { document, report: JSON.parse(out.report) as JsonObject, world: world.world };
}

// ---------------------------------------------------------------------------------------------------
// The planted programs: a plug-in made at test time, one tool for the kind `import` (README: The planted programs)

// The extension host's public entry, for `packageDigest` only, as #1922's helpers read it.
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');

/** A tool as a plug-in hands it to `deep.registerJobTool(kind, descriptor)`. */
export interface Registered { kind: string; descriptor: JsonObject }
/**
 * The tools the import plug-in registers, each as `deep.registerJobTool` is handed it: the plug-in's default export
 * called with a `deep` that only records (the Extension API's own contract), no hub involved. Or, as text, why there
 * are none.
 */
export async function registeredTools(): Promise<Registered[] | string> {
  const tools: Registered[] = [];
  const deep = new Proxy({}, {
    get: (_target, name) => {
      if (name === 'then') return undefined;
      if (name === 'registerJobTool') return async (kind: unknown, descriptor: unknown) => { tools.push({ kind: String(kind), descriptor: JSON.parse(JSON.stringify(descriptor ?? {})) as JsonObject }); };
      return async () => undefined;
    },
  });
  try {
    const plugin = await import(pathToFileURL(join(IMPORT_PACKAGE, 'index.ts')).href) as { default?: (deep: unknown) => Promise<void> };
    if (typeof plugin.default !== 'function') return 'packages/jobs/import/index.ts has no default export to register its tools';
    await plugin.default(deep);
  } catch (e) {
    return `packages/jobs/import/index.ts couldn't register its tools: ${first(message(e))}`;
  }
  return tools;
}
/** The one tool among them that converts a robot description, which runs as its own files; or, as text, why there is none. */
async function rightTool(): Promise<Registered | string> {
  const tools = await registeredTools();
  if (typeof tools === 'string') return tools;
  const mine = tools.filter((t) => t.kind === KIND && TOOL_NAME.test(String(t.descriptor['tool'])));
  if (mine.length !== 1) return `the import plug-in registers ${mine.length} tools whose name starts urdf for the kind ${KIND}, not one; it registers: ${tools.map((t) => String(t.descriptor['tool'])).join(', ') || 'none'}`;
  const run = mine[0]!.descriptor['run'];
  if (!isObject(run) || typeof run['dir'] !== 'string' || typeof run['entry'] !== 'string') return `${String(mine[0]!.descriptor['tool'])} doesn't run as its own files (run {dir, entry}), so no planted tool can run it: ${show(run, 200)}`;
  return mine[0]!;
}

/**
 * A plug-in folder that adds one tool to the kind: the right tool's files, with the planted entry, its plan and the
 * spoil module laid beside them, registered under the right tool's own descriptor but for its name and its entry.
 */
export function plantedPlugin(dir: string, right: Registered, name: PlantedName | 'as_is'): void {
  const run = right.descriptor['run'] as JsonObject;
  const tool = join(dir, String(run['dir']));
  mkdirSync(dir, { recursive: true });
  cpSync(join(IMPORT_PACKAGE, String(run['dir'])), tool, { recursive: true });
  writeFileSync(join(tool, 'deep-3035-tool.mjs'), readFileSync(join(FIXTURES, 'planted', 'tool.mjs.fixture')));
  writeFileSync(join(tool, 'deep-3035-spoil.mjs'), readFileSync(join(FIXTURES, 'planted', 'spoil.mjs')));
  writeFileSync(join(tool, 'deep-3035-plan.json'), `${JSON.stringify({ entry: run['entry'], spoil: name })}\n`);
  writeFileSync(join(dir, 'index.ts'), readFileSync(join(FIXTURES, 'planted', 'index.ts.fixture')));
  const descriptor = { ...right.descriptor, tool: PLANTED_TOOL[name], run: { ...run, entry: 'deep-3035-tool.mjs' } };
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ kind: KIND, descriptor }, null, 2)}\n`);
  const manifest: JsonObject = {
    id: `test/${PLANTED_TOOL[name].split('@')[0]!}`, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
    job_tools: [{ kind: KIND, tool: PLANTED_TOOL[name] }], requires: { preview: ['deep.registerJobTool'] },
  };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest['digest'] = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** What the kind's qualification made of one planted tool, and of the tool that runs the right one as it is. */
export interface Planted {
  /** Why nothing was installed; '' when both installs ran. */
  problem: string;
  /** The planted tool's name@version, and that of the tool that runs the right one as it is. */
  tool: string; asIs: string;
  /** `deep install` of the tool that runs the right one as it is, and whether deep_job then lists it. */
  control: Ran | null; controlListed: boolean;
  /** `deep install` of the planted tool, and the kind's tools after it. */
  install: Ran | null; listed: string[];
}
const controls = new WeakMap<Hub, Promise<{ ran: Ran | null; problem: string }>>();
/**
 * Installs a planted tool into `hub`, after the tool that runs the right one as it is, installed once a hub: the
 * kind's qualification, run by `deep install` with no person, is the judge of both.
 */
export async function plantedInstall(hub: Hub | string, name: PlantedName): Promise<Planted> {
  const out: Planted = { problem: '', tool: PLANTED_TOOL[name], asIs: PLANTED_TOOL.as_is, control: null, controlListed: false, install: null, listed: [] };
  if (typeof hub === 'string') return { ...out, problem: hub };
  const right = await rightTool();
  if (typeof right === 'string') return { ...out, problem: right };
  const add = async (which: PlantedName | 'as_is'): Promise<{ ran: Ran | null; problem: string }> => {
    try {
      const dir = join(hub.w.tmp, `planted-${which}`);
      plantedPlugin(dir, right, which);
      return { ran: await install(hub.w, dir), problem: '' };
    } catch (e) {
      return { ran: null, problem: `BLOCKED: the plug-in of ${PLANTED_TOOL[which]} couldn't be made or installed: ${first(message(e))}; this is not a pass` };
    }
  };
  if (!controls.has(hub)) controls.set(hub, add('as_is'));
  const control = await controls.get(hub)!;
  if (control.problem) return { ...out, problem: control.problem };
  out.control = control.ran;
  const after = await toolsOf(hub.w);
  out.controlListed = typeof after !== 'string' && after.includes(out.asIs);
  const planted = await add(name);
  if (planted.problem) return { ...out, problem: planted.problem };
  out.install = planted.ran;
  const tools = await toolsOf(hub.w);
  if (typeof tools === 'string') return { ...out, problem: tools };
  out.listed = tools;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The physics runner: the base's `deep-physics`, one JSON object a stdin line, one reply a line (#191's build).

/** What one process answered: `problem` is '' and `replies` holds one object a call, or `problem` says what it did instead. */
export interface Asked { what: string; problem: string; replies: JsonObject[] }
/** Runs `calls` through one `deep-physics` process of this checkout (#191's `shipped` build). It asserts nothing. */
export function physics(calls: JsonObject[]): Asked {
  const what = 'deep-physics';
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  let bin: string;
  try { bin = physicsBin('shipped'); } catch (e) { return no(`BLOCKED: deep-physics doesn't build: ${message(e).slice(0, 600)}; this is not a pass`); }
  const run = spawnSync(bin, [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') return no(`INCONCLUSIVE: ${what} didn't finish within its timeout; this is not a pass`);
  if (run.error && code !== 'EPIPE') return no(`BLOCKED: ${what} couldn't be run: ${run.error.message}; this is not a pass`);
  const stdout = run.stdout ?? '';
  if (run.status !== 0) return no(`${what} exits ${String(run.status)}, not 0; stdout: ${stdout.trim().slice(0, 600)}; stderr: ${(run.stderr ?? '').trim().slice(-600)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return no(`${what} wrote ${lines.length} replies to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`);
  const replies: JsonObject[] = [];
  for (const [i, line] of lines.entries()) {
    let v: Json;
    try { v = JSON.parse(line) as Json; } catch { return no(`${what}: reply ${i} isn't JSON: ${line.slice(0, 300)}`); }
    if (!isObject(v)) return no(`${what}: reply ${i} isn't an object: ${line.slice(0, 300)}`);
    replies.push(v);
  }
  return { what, problem: '', replies };
}

/** Why a reply isn't what was asked for, in its own words: its issues' codes, paths and sentences. */
function refusal(reply: JsonObject | undefined): string {
  const issues = reply && Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.slice(0, 4).map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what']).slice(0, 240)}`).join('; ') + (issues.length > 4 ? `; and ${issues.length - 4} more` : '') : show(reply, 400);
}

/** The base's `check` of a world document as it is written. */
export const check = (world: JsonObject): JsonObject => ({ call: 'check', world });
/** Everything a check finds wrong with a world: each error it raises, by code and path (a warning is none). */
export function checkFailures(reply: JsonObject | undefined, what: string): string[] {
  if (reply?.['ok'] !== true || !Array.isArray(reply['issues'])) return [`${what}: the check didn't answer {ok: true, issues}: ${show(reply, 400)}`];
  return reply['issues'].filter(isObject).filter((i) => i['severity'] === 'error')
    .map((i) => `${what} isn't accepted at check: ${String(i['code'])} at ${String(i['path'])}: ${String(i['what']).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------------------------------
// Placing a world's joints: the base's kinematic solve, driven from a scene's channels (README: How a joint is put
// at an angle).

const FLICKS = 705_600_000;
const RATE = 120;
const STEP = FLICKS / RATE;
const pad = (n: number): string => String(n).padStart(2, '0');
/** The joints a placement sets, each to its coordinate (a hinge's in degrees, a slider's in metres); one it doesn't name is at 0. */
export type Placement = Record<string, number>;

const bodyIds = (w: JsonObject): string[] => Object.keys(section(w, 'bodies')).sort();
const jointIds = (w: JsonObject): string[] => Object.keys(section(w, 'joints')).sort();
const jointOf = (w: JsonObject, id: string): JsonObject => { const j = section(w, 'joints')[id]; return isObject(j) ? j : {}; };
/** The joints a coordinate places: the world's hinges and sliders, in ID order. */
export const movable = (w: JsonObject): string[] => jointIds(w).filter((id) => ['hinge', 'slider'].includes(String(jointOf(w, id)['kind'])));
const bodyOf = (end: Json | undefined): string => String(end ?? '').split('#')[0]!;

/**
 * One bake that places `world`'s joints at each of `placements` in turn, placement k after step k. The world is a copy
 * of the one given, changed only so the base's kinematic solve places it from its joints' own frames: `mode` is
 * `kinematic` at 120 Hz; each hinge and slider is driven from a channel of the scene the copy is put in (hold keys,
 * each half a step before the step that reads it) and read back as `joint_coordinate`; a link no joint holds is held to
 * the world where it is written by one fixed joint; and what a kinematic world doesn't run, or reads of another
 * document, is left out: each joint's `motor` and the world's own `outputs`. Nothing else of the world changes.
 */
export function placing(world: JsonObject, placements: Placement[]): JsonObject {
  const copy = JSON.parse(JSON.stringify(world)) as JsonObject;
  const bodies = section(copy, 'bodies');
  const joints: JsonObject = {};
  for (const id of jointIds(copy)) { const { motor: _motor, ...rest } = jointOf(copy, id); joints[id] = rest; }
  const heldBodies = new Set(Object.values(joints).map((j) => bodyOf((j as JsonObject)['b'])));
  bodyIds(copy).filter((id) => !heldBodies.has(id) && isObject(bodies[id]) && bodies[id]['kind'] !== 'static').forEach((id, i) => {
    const pose = section(bodies[id] as JsonObject, 'pose');
    joints[`suite_hold_${i}`] = { kind: 'fixed', a: 'world', b: id, frame_a: { anchor: vec3(pose['pos']) ?? [0, 0, 0] }, frame_b: { anchor: [0, 0, 0] } };
  });
  const driven = movable(copy);
  const items: JsonObject = { cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a00', params: { projection: 'perspective', position: [0, 2, 10], target: [0, 0, 0], fov: 40 } } };
  const channels: JsonObject = {};
  const outputs: JsonObject = {};
  driven.forEach((joint, i) => {
    const id = `drive_${pad(i)}`;
    const values = placements.map((p) => p[joint] ?? 0);
    const keys: JsonObject = { k000: { t: 0, value: values[0] ?? 0, interp: 'hold' } };
    values.forEach((value, k) => { if (k > 0 && value !== values[k - 1]) keys[`k${String(k).padStart(3, '0')}`] = { t: (2 * k + 1) * (STEP / 2), value, interp: 'hold' }; });
    items[id] = { id, kind: 'mark.box@1', name: id, order: `a${pad(i + 1)}`, params: { size: [0.1, 0.1, 0.1] }, at: { pos: [values[0] ?? 0, 0, 5 + i] } };
    channels[id] = { target: `items/${id}/at/pos/0`, type: 'f32', keys };
    outputs[`q_${pad(i)}`] = { from: joint, read: 'joint_coordinate' };
  });
  const capacity = section(copy, 'capacity');
  Object.assign(copy, {
    mode: 'kinematic', step_rate: RATE, joints, outputs,
    capacity: { ...capacity, joints: Math.max(typeof capacity['joints'] === 'number' ? capacity['joints'] : 0, Object.keys(joints).length) },
    solve: { drivers: driven.map((joint, i) => ({ joint, channel: `items/drive_${pad(i)}/at/pos/0` })), iterations: 20, tolerance: 1e-5 },
  });
  const scene: JsonObject = {
    format: 1, id: '01JB3035KS0000000000000001', profile: 'scene', title: 'A converted robot, placed',
    description: 'Issue #3035: a converted world in kinematic mode, each of its joints placed from a channel.',
    size: [640, 360], camera: 'cam', transport: { span: '60s', frame_rate: [60, 1] }, requires: { modules: { scene3d: '^1' } },
    items, channels, worlds: { robot: copy },
  };
  return { call: 'bake', scene, world: 'robot', steps: placements.length, frame_rate: `${RATE}/1`, read: bodyIds(copy) };
}

/** Where a placement put the world: each body's origin and orientation, and each hinge's and slider's `joint_coordinate`. */
export interface Placed { pos: Record<string, Vec3>; rot: Record<string, Mat3>; q: Record<string, number> }
/** A `placing` bake read as its placements; or, as text, why it isn't one: the world refused, or a state or a reading missing. */
export function placedOf(world: JsonObject, placements: Placement[], reply: JsonObject | undefined, what: string): Placed[] | string {
  if (reply?.['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const states = section(reply, 'bodies');
  const series = section(section(reply, 'outputs'), 'series');
  const out: Placed[] = [];
  for (let k = 1; k <= placements.length; k++) {
    const placed: Placed = { pos: {}, rot: {}, q: {} };
    for (const id of bodyIds(world)) {
      const s = Array.isArray(states[id]) ? states[id][k] : undefined;
      const pos = isObject(s) ? vec3(s['pos']) : null;
      const rot = isObject(s) && Array.isArray(s['rot']) && s['rot'].length === 4 ? rotOf(s['rot'], 'rot') : null;
      if (!pos || !rot || typeof rot === 'string') return `INCONCLUSIVE: ${what} holds no state {pos, rot} of ${id} after step ${k}; this is not a pass`;
      placed.pos[id] = pos;
      placed.rot[id] = rot;
    }
    for (const [i, joint] of movable(world).entries()) {
      const q = Array.isArray(series[`q_${pad(i)}`]) ? (series[`q_${pad(i)}`] as Json[])[k] : undefined;
      if (typeof q !== 'number' || !Number.isFinite(q)) return `INCONCLUSIVE: ${what} holds no joint_coordinate of ${joint} after step ${k}; this is not a pass`;
      placed.q[joint] = q;
    }
    out.push(placed);
  }
  return out;
}

/**
 * How far apart a joint's two anchors are in a placement, m: each anchor from its body's state and the joint's own
 * frame (the world's own point for an end that is the world). A slider's anchors part along its axis by its travel,
 * so its gap is what is left across the axis, as the base's `physics.articulation_gap` reads one.
 */
export function gap(world: JsonObject, joint: string, placed: Placed): number {
  const j = jointOf(world, joint);
  const end = (side: 'a' | 'b'): { point: Vec3; rot: Mat3 | null } => {
    const name = String(j[side] ?? '');
    const frame = section(j, `frame_${side}`);
    let anchor = vec3(frame['anchor']) ?? [0, 0, 0];
    if (name === 'world') return { point: anchor, rot: null };
    const [id, named] = name.split('#') as [string, string | undefined];
    const body = section(world, 'bodies')[id];
    if (named !== undefined && isObject(body)) anchor = vec3(section(body, 'anchors')[named]) ?? anchor;
    const [pos, rot] = [placed.pos[id], placed.rot[id]];
    return pos && rot ? { point: add(pos, apply(rot, anchor)), rot } : { point: [NaN, NaN, NaN], rot: null };
  };
  const [a, b] = [end('a'), end('b')];
  const d = sub(b.point, a.point);
  if (j['kind'] !== 'slider') return norm(d);
  const axis = vec3(section(j, 'frame_a')['axis']) ?? [1, 0, 0];
  const along = unit(a.rot ? apply(a.rot, axis) : axis);
  return norm(sub(d, scale(along, dot(d, along))));
}

// ---------------------------------------------------------------------------------------------------
// The stated rotation (README: The change of axes)

/**
 * The rotation a report states, `report.rotation`, as a matrix: read as a `rot` is, and held to what the issue and
 * the design fix of it, that the file's +Z is our +Y, within 1e-9. Or, as text, what is wrong with it.
 */
export function rotationOf(report: JsonObject): Mat3 | string {
  if (report['rotation'] === undefined) return `the report states no rotation (report.rotation; README: The change of axes): its keys are ${Object.keys(report).join(', ') || 'none'}`;
  const r = rotOf(report['rotation'], 'report.rotation');
  if (typeof r === 'string') return r;
  const up = apply(r, [0, 0, 1]);
  return upError(r) <= 1e-9 ? r : `report.rotation ${show(report['rotation'], 120)} takes the file's +Z to ${at3(up, 9)}, not to our +Y (0, 1, 0) within 1e-9`;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's judges: the two hinges' limits, and the tip, read from the placed bodies.

/** A joint's `limits` held to `[min, max]` within `tolerance`, in `unit`: a failure naming the joint. */
function limitFailures(world: JsonObject, joint: string, kind: string, [min, max]: [number, number], tolerance: number, unitName: string, printed: string): string[] {
  const j = jointOf(world, joint);
  if (!isObject(section(world, 'joints')[joint])) return [`${joint}: the world holds no joint of that name; its joints: ${jointIds(world).join(', ') || 'none'}`];
  if (j['kind'] !== kind) return [`${joint}: its kind is ${show(j['kind'])}, not ${kind}`];
  const limits = section(j, 'limits');
  const [lo, hi] = [limits['min'], limits['max']];
  if (typeof lo !== 'number' || typeof hi !== 'number') return [`${joint}: it has no limits {min, max} in ${unitName}: ${show(j['limits'] ?? null)}`];
  return Math.abs(lo - min) <= tolerance && Math.abs(hi - max) <= tolerance ? [] : [`${joint}: its limits are ${fix(lo, 9)} to ${fix(hi, 9)} ${unitName}, not ${printed} within ${tolerance} ${unitName}`];
}
/** "Two hinges limited to ±90.000° within 0.001°": a failure for each named joint that isn't one. */
export const hingeFailures = (world: JsonObject, joints: readonly string[]): string[] =>
  joints.flatMap((joint) => limitFailures(world, joint, 'hinge', [-90, 90], ANGLE_TOLERANCE, '°', '−90.000 to 90.000'));

/** The arm's bodies and joints, by the file's names. */
export const ARM_IDS = { base: 'base', tip: 'tip', shoulder: 'shoulder', elbow: 'elbow' } as const;
/** The arm's three placements: both joints at 30°, then each at 30° alone, which is what tells one joint's turn from the other's. */
export const ARM_PLACEMENTS: Placement[] = [{ shoulder: BENT, elbow: BENT }, { shoulder: BENT, elbow: 0 }, { shoulder: 0, elbow: BENT }];
/** The tip from the base in a placement, our axes, m. */
export const tipOf = (placed: Placed): Vec3 => sub(placed.pos[ARM_IDS.tip] ?? [NaN, NaN, NaN], placed.pos[ARM_IDS.base] ?? [NaN, NaN, NaN]);
/**
 * Criterion 1's tip over the arm's three placements under the stated rotation `r`: with both joints at 30° the tip
 * is at 0.5 × (cos 30° + cos 60°) = 0.6830127 m along the arm and 0.5 × (sin 30° + sin 60°) = 0.6830127 m up, within
 * 1e-6 m (a failure starting `tip: `); with one joint at 30° alone it is where that joint's turn alone puts it (a
 * failure starting with the joint, which is how a wrong joint is named); and each joint reads the angle it was set to.
 */
export function tipFailures(placed: Placed[], r: Mat3): string[] {
  const out: string[] = [];
  const cases: { who: string; label: string; s: number; e: number }[] = [
    { who: 'tip', label: 'with both joints at 30°', s: BENT, e: BENT },
    { who: ARM_IDS.shoulder, label: 'turned 30° alone, it puts the tip', s: BENT, e: 0 },
    { who: ARM_IDS.elbow, label: 'turned 30° alone, it puts the tip', s: 0, e: BENT },
  ];
  cases.forEach((c, k) => {
    const p = placed[k];
    if (!p) { out.push(`INCONCLUSIVE: the bake holds no placement ${k + 1}; this is not a pass`); return; }
    for (const [joint, set] of [[ARM_IDS.shoulder, c.s], [ARM_IDS.elbow, c.e]] as const) {
      const q = p.q[joint];
      if (!(q !== undefined && Math.abs(q - set) <= ANGLE_TOLERANCE)) out.push(`${joint}: set to ${set}°, its joint_coordinate reads ${fix(q ?? NaN)}°, so the joint isn't where the measure needs it`);
    }
    const tip = tipOf(p);
    const away = far(tip, tipAt(r, c.s, c.e));
    if (away <= TIP_TOLERANCE) return;
    const [read, want] = [inPlane(r, tip), tipInPlane(c.s, c.e)];
    out.push(`${c.who}: ${c.label} ${c.who === 'tip' ? 'it is ' : ''}at (${fix(read.along)}, ${fix(read.up)}) m from the base in the arm's plane and ${fix(read.off)} m off it, not at (${fix(want[0])}, ${fix(want[1])}) m within 1e-6 m (${fix(away, 9)} m away)`);
  });
  return out;
}

/** The arm's world placed three ways on the base's runner and judged: its failures, and the placements they were read from. */
export function armJudged(world: JsonObject, r: Mat3, what: string): { failures: string[]; placed: Placed[] } {
  const run = physics([placing(world, ARM_PLACEMENTS)]);
  if (run.problem) return { failures: [run.problem], placed: [] };
  const placed = placedOf(world, ARM_PLACEMENTS, run.replies[0], what);
  return typeof placed === 'string' ? { failures: [placed], placed: [] } : { failures: tipFailures(placed, r), placed };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2's judge: the axes fixture, read from the converted document.

/** "within 1e-9". */
export const AXES_TOLERANCE = 1e-9;
/** The axes fixture's links, by the file's names. */
export const AXES_IDS = { base: 'base', mast: 'mast', slab: 'slab' } as const;
/** A body's written `pose.pos`, or null. */
export const posOf = (world: JsonObject, body: string): Vec3 | null => {
  const b = section(world, 'bodies')[body];
  return isObject(b) ? vec3(section(b, 'pose')['pos'] ?? [0, 0, 0]) : null;
};
/**
 * Criterion 2 over the converted axes fixture under its stated rotation `r`, each failure starting with its link:
 * every link is an item and a body under its own name; `mast`, 1 m up the file's Z, stands at (0, 1, 0) m, so at
 * y = 1 m; `slab` keeps its 2 kg and its inertia, whose three moments are the file's about the axes the rotation
 * takes them to (about our Y the file's izz, 0.07, whatever else the rotation does), and stands where the rotation
 * takes its place, turned 30° about our Y as it is about the file's Z. All within 1e-9.
 */
export function axesFailures(document: JsonObject, world: JsonObject, r: Mat3): string[] {
  const out: string[] = [];
  const bodies = section(world, 'bodies');
  for (const link of Object.values(AXES_IDS)) {
    if (!isObject(section(document, 'items')[link])) out.push(`${link}: the document holds no item for the link (items/${link})`);
    if (!isObject(bodies[link])) out.push(`${link}: the world holds no body for the link (bodies/${link}); its bodies: ${bodyIds(world).join(', ') || 'none'}`);
  }
  const mast = posOf(world, AXES_IDS.mast);
  if (mast && !(far(mast, [0, 1, 0]) <= AXES_TOLERANCE)) out.push(`${AXES_IDS.mast}: 1 m up the file's Z, it stands at ${at3(mast, 12)} m, not at y = 1 m, (0, 1, 0), within 1e-9`);
  const slab = bodies[AXES_IDS.slab];
  if (!isObject(slab)) return out;
  const data = AXES.links.find((l) => l.name === AXES_IDS.slab)!;
  if (!(typeof slab['mass'] === 'number' && Math.abs(slab['mass'] - data.mass) <= AXES_TOLERANCE)) out.push(`${AXES_IDS.slab}: its mass is ${show(slab['mass'] ?? null)}, not ${data.mass} kg within 1e-9`);
  const want = movedInertia(data.moments, r);
  const inertia = vec3(slab['inertia']);
  if (want.product > AXES_TOLERANCE) out.push(`${AXES_IDS.slab}: the stated rotation leaves its inertia products of ${fix(want.product, 12)} kg·m² about our axes, which a body's [Ixx, Iyy, Izz] has no place for`);
  else if (!inertia || !inertia.every((x, i) => Math.abs(x - want.moments[i]!) <= AXES_TOLERANCE)) {
    out.push(`${AXES_IDS.slab}: its inertia is ${show(slab['inertia'] ?? null)}, not ${at3(want.moments, 12)} kg·m², the file's (${data.moments.join(', ')}) about the axes the stated rotation takes them to, within 1e-9`);
  }
  const pose = movedPose(AXES, AXES_IDS.slab, r);
  const pos = posOf(world, AXES_IDS.slab);
  if (!pos || !(far(pos, pose.pos) <= AXES_TOLERANCE)) out.push(`${AXES_IDS.slab}: it stands at ${pos ? at3(pos, 12) : 'no written place'} m, not at ${at3(pose.pos, 12)} m, where the stated rotation takes the file's (0.4, 0.3, 0.5), within 1e-9`);
  const rot = rotOf(section(slab, 'pose')['rot'], `${AXES_IDS.slab}'s pose.rot`);
  const turn = about([0, 1, 0], YAW_RAD / RAD);
  if (typeof rot === 'string') out.push(`${AXES_IDS.slab}: ${rot}`);
  else if (!(apart(rot, pose.rot) <= AXES_TOLERANCE) || !(apart(pose.rot, turn) <= AXES_TOLERANCE)) {
    out.push(`${AXES_IDS.slab}: its pose.rot ${show(section(slab, 'pose')['rot'] ?? null)} isn't the file's 30° about Z under the stated rotation, 30° about our Y, within 1e-9`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3's judges: the lift fixture, each joint swept from its lower to its upper limit.

/** "within 1 mm". */
export const GAP_TOLERANCE = 1e-3;
/** The positions a sweep reads of each joint: 21, its lower limit, its upper limit and 19 evenly between. */
export const SWEEP = 20;
/** The lift's bodies and joints, by the file's names. */
export const LIFT_IDS = { sled: 'sled', rail: 'rail', wrist: 'wrist' } as const;
/** Criterion 3's limits: the prismatic joint a slider from 0 to 0.2 m, as the file writes them, and the revolute one a hinge of ±90.000° within 0.001°. */
export const liftLimitFailures = (world: JsonObject): string[] => [
  ...limitFailures(world, LIFT_IDS.rail, 'slider', [0, TRAVEL], AXES_TOLERANCE, 'm', `0 to ${TRAVEL}`),
  ...limitFailures(world, LIFT_IDS.wrist, 'hinge', [-90, 90], ANGLE_TOLERANCE, '°', '−90.000 to 90.000'),
];
/** Each joint a tree's articulation takes that isn't written `articulated: true`: a failure naming it. */
export const articulatedFailures = (world: JsonObject): string[] =>
  jointIds(world).filter((id) => ['fixed', 'hinge', 'slider', 'ball'].includes(String(jointOf(world, id)['kind'])) && jointOf(world, id)['articulated'] !== true)
    .map((id) => `${id}: it isn't written articulated: true, so physics.articulation_gap holds it to nothing`);

/** A sweep of each of a world's limited hinges and sliders in turn, the others at 0: the placements, and each joint's first and last. */
export interface Sweep { placements: Placement[]; of: { joint: string; from: number; to: number; min: number; max: number }[] }
export function sweepOf(world: JsonObject): Sweep {
  const sweep: Sweep = { placements: [], of: [] };
  for (const joint of movable(world)) {
    const limits = section(jointOf(world, joint), 'limits');
    const [min, max] = [limits['min'], limits['max']];
    if (typeof min !== 'number' || typeof max !== 'number') continue;
    const from = sweep.placements.length;
    for (let k = 0; k <= SWEEP; k++) sweep.placements.push({ [joint]: k === SWEEP ? max : min + ((max - min) * k) / SWEEP });
    sweep.of.push({ joint, from, to: from + SWEEP, min, max });
  }
  return sweep;
}
/**
 * Criterion 3 over a world's sweep, each failure starting with its joint: every joint the criterion names was swept;
 * at each of a swept joint's 21 positions every joint's two anchors are within 1 mm; the swept joint reads its lower
 * limit at the first and its upper limit at the last, so it really reaches both; and the prismatic joint's link is
 * 0.2 m up from where it was at the lower limit, along our +Y, the file's +Z, within 1 mm.
 */
export function sweepFailures(world: JsonObject, sweep: Sweep, placed: Placed[], swept: readonly string[]): string[] {
  const out: string[] = [];
  for (const joint of swept) if (!sweep.of.some((s) => s.joint === joint)) out.push(`${joint}: it has no limits to sweep between, so it wasn't swept`);
  for (const s of sweep.of) {
    const kind = String(jointOf(world, s.joint)['kind']);
    const [unitName, tolerance] = kind === 'slider' ? ['m', TIP_TOLERANCE] as const : ['°', ANGLE_TOLERANCE] as const;
    for (const [k, limit, name] of [[s.from, s.min, 'lower'], [s.to, s.max, 'upper']] as const) {
      const q = placed[k]?.q[s.joint];
      if (!(q !== undefined && Math.abs(q - limit) <= tolerance)) out.push(`${s.joint}: at the ${name} end of its sweep its joint_coordinate reads ${fix(q ?? NaN, 9)} ${unitName}, not its ${name} limit ${fix(limit, 9)} ${unitName}, so the sweep doesn't reach it`);
    }
    for (let k = s.from; k <= s.to; k++) {
      const p = placed[k];
      if (!p) { out.push(`INCONCLUSIVE: the bake holds no placement ${k + 1} of ${s.joint}'s sweep; this is not a pass`); break; }
      for (const other of jointIds(world)) {
        const g = gap(world, other, p);
        if (!(g <= GAP_TOLERANCE)) out.push(`${other}: with ${s.joint} at ${fix(p.q[s.joint] ?? NaN)} ${unitName}, position ${k - s.from} of its sweep, its two anchors are ${fix(g * 1000, 4)} mm apart, more than 1 mm`);
      }
    }
  }
  const rail = sweep.of.find((s) => s.joint === LIFT_IDS.rail);
  const [low, high] = [rail && placed[rail.from]?.pos[LIFT_IDS.sled], rail && placed[rail.to]?.pos[LIFT_IDS.sled]];
  if (rail && low && high) {
    const moved = sub(high, low);
    if (!(far(moved, [0, TRAVEL, 0]) <= GAP_TOLERANCE)) out.push(`${LIFT_IDS.rail}: from its lower to its upper limit ${LIFT_IDS.sled} travels ${at3(moved)} m, ${fix(norm(moved))} m, not ${TRAVEL} m up, (0, ${TRAVEL}, 0), within 1 mm`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4's judges: the gripper fixture's `dropped`, as a whole set, and what is kept.

/** A row of `dropped` as its element and its name, or null when it isn't `{element, name}`, both text. */
const rowOf = (v: Json): string | null => (isObject(v) && typeof v['element'] === 'string' && typeof v['name'] === 'string' ? `${v['element']} ${v['name']}` : null);
/**
 * "`dropped` holds exactly those three rows": the report's `dropped` compared as a whole set with the fixture's
 * three, each failure starting with the row's element and name: one for a row of the three that is missing, one for a
 * row that is none of the three, and one for a row held twice or not shaped `{element, name}`.
 */
export function droppedFailures(report: JsonObject): string[] {
  if (!Array.isArray(report['dropped'])) return [`the report holds no dropped list (report.dropped): its keys are ${Object.keys(report).join(', ') || 'none'}`];
  const rows = report['dropped'].map(rowOf);
  const want = GRIPPER.dropped.map((d) => `${d.element} ${d.name}`);
  const out: string[] = [];
  report['dropped'].forEach((v, i) => { if (rows[i] === null) out.push(`dropped[${i}]: it isn't a row {element, name}: ${show(v, 200)}`); });
  const held = rows.filter((x): x is string => x !== null);
  for (const row of want) if (!held.includes(row)) out.push(`${row}: the fixture holds it, it has no place, and dropped holds no row for it; dropped: ${held.join('; ') || 'none'}`);
  for (const row of new Set(held)) {
    if (!want.includes(row)) out.push(`${row}: dropped holds a row for it, and it is none of the fixture's three (${want.join('; ')})`);
    else if (held.filter((x) => x === row).length > 1) out.push(`${row}: dropped holds its row ${held.filter((x) => x === row).length} times, not once`);
  }
  return out;
}
/**
 * What the gripper keeps, so `dropped` isn't everything: its links `palm`, `finger_a`, `knob` and `pad` are bodies,
 * its revolute joint a hinge with limits, its continuous joint a hinge with none and its fixed joint a fixed joint.
 */
export function keptFailures(world: JsonObject): string[] {
  const out: string[] = [];
  for (const link of GRIPPER.kept.links) if (!isObject(section(world, 'bodies')[link])) out.push(`${link}: the world holds no body for the link; its bodies: ${bodyIds(world).join(', ') || 'none'}`);
  const kindOf = (id: string): Json | undefined => jointOf(world, id)['kind'];
  const { hinge, turning, fixed } = GRIPPER.kept;
  if (kindOf(hinge) !== 'hinge' || !isObject(jointOf(world, hinge)['limits'])) out.push(`${hinge}: the revolute joint isn't a hinge with limits: ${show(section(world, 'joints')[hinge] ?? null, 300)}`);
  if (kindOf(turning) !== 'hinge' || jointOf(world, turning)['limits'] !== undefined) out.push(`${turning}: the continuous joint isn't a hinge with no limits: ${show(section(world, 'joints')[turning] ?? null, 300)}`);
  if (kindOf(fixed) !== 'fixed') out.push(`${fixed}: the fixed joint isn't a fixed joint: ${show(section(world, 'joints')[fixed] ?? null, 300)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5's judge: a refusal that names what it refuses and keeps nothing.

/**
 * Everything wrong with a run read as a refusal naming `named`, with nothing written: its status is `refused` and its
 * `reason` holds the name as the file writes it; it returns no output; and the hub's evidence store holds after it
 * exactly the files it held before.
 */
export function refusalFailures(run: Run | string, named: string, before: string[], after: string[]): string[] {
  if (typeof run === 'string') return [run];
  const o = run.outcome;
  const out: string[] = [];
  const status = String(o.value['status'] ?? '');
  if (/blocked/i.test(status)) return [`BLOCKED: the job is blocked, not refused: ${o.text.slice(0, 900)}; this is not a pass`];
  if (status !== 'refused') out.push(`the job isn't refused: its status is ${show(o.value['status'] ?? null)}: ${o.text.slice(0, 600)}`);
  const reason = typeof o.value['reason'] === 'string' ? o.value['reason'] : '';
  if (!reason.includes(named)) out.push(`the refusal doesn't name ${named}: its reason is ${show(o.value['reason'] ?? null, 600)}`);
  const outputs = Object.keys(outputsOf(o));
  if (outputs.length) out.push(`the refused job returns outputs (${outputs.join(', ')})`);
  const added = after.filter((sha) => !before.includes(sha));
  if (added.length) out.push(`the refused job wrote ${added.length} file${added.length === 1 ? '' : 's'} into the hub's evidence store: ${added.join(', ')}`);
  return out;
}
