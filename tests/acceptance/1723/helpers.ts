// Shared by the #1723 acceptance tests (README): the criteria's IDs, the scene and its planted twin, the repo's spec
// naming a document check, the world (#322's: a temp home, a git repo, the handed definition, the project trusted, the
// real hub), a Claude Code session whose hooks run through the real deep-hook and whose `deep mcp` and `deep show` are
// its children (fixtures/agent.mjs), and the record read back through the hub's socket and evidence store. Nothing
// here stands in for DeepBuild: the hub, deep-hook, `deep mcp`, `deep show` and the canvas core are the real ones.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import {
  CLI, COVERED, DEEP_HOOK, NODE, REPO, childEnv, claimsOf, cleanup, decision, lastPos, makeWorld, must, own, parseObject, req, settle, shown, startHub,
  trustRepo, verdictsOf, type Draft, type Ev, type Hub, type Line, type Ran, type World,
} from '../322/helpers.ts';

/** Stops every process the tests started, by PID (the hubs, the sessions' agents and their children), and removes the worlds. */
export { cleanup, lastPos, must, settle, type Ev, type Line };

// ---- The criteria: `#1723.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`
// (scripts/proof-change.mjs, criterionId); criteria.json holds each with its text.
export const AC1 = '#1723.8ec20125';
export const AC2 = '#1723.ee7e66b6';
export const AC3 = '#1723.ee326673';
export const AC4 = '#1723.bfd5e63a';

export const TEST_MS = 900_000;
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

// ---- The scene (README: The fixture). Metres, +Y up; `mark.box@1` is a unit box centred on `at.pos`, scaled by
// `params.size` (as #405's scenes are written).
type V3 = [number, number, number];
const box = (size: V3, pos: V3): Line => ({ kind: 'mark.box@1', params: { size }, at: { pos } });
function scene(title: string, items: Record<string, Line>): Line {
  const out: Line = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return { format: 1, profile: 'scene', title, description: `${title}: a #1723 acceptance fixture.`, size: [640, 480], requires: { modules: { scene3d: '^1' } }, items: out };
}
/** The crate's centre height resting on the floor: the floor's top at 0.1 m plus half the crate's 0.5 m. */
const RESTING_Y = 0.35;
/** A 4 × 0.1 × 4 m floor (its top at y 0.1 m) and a 0.5 m crate resting on it. */
export const CLEAN = scene('A crate on the floor', { floor: box([4, 0.1, 4], [0, 0.05, 0]), crate: box([0.5, 0.5, 0.5], [0, RESTING_Y, 0]) });
/** The planted twin: the same crate 0.2 m above the floor, its bottom at y 0.3 m, resting on nothing. */
export const TWIN = scene('A crate above the floor', { floor: box([4, 0.1, 4], [0, 0.05, 0]), crate: box([0.5, 0.5, 0.5], [0, RESTING_Y + 0.2, 0]) });
/** The item the twin floats, and the code the geometry audit names it with (canvas primitives: Geometry audit). */
export const FLOATING_ITEM = 'crate';
export const FLOATING_CODE = 'geometry.floating';

/** Documents by doc ID (26 letters and digits, as deep_show takes them): the deliverable, and one no spec names. */
export const DOC1 = `01JB1723D${'0'.repeat(16)}1`;
export const DOC2 = `01JB1723D${'0'.repeat(16)}2`;

// ---- The repo's spec (README: The surface, Pinned here): a check entry naming a document check by its kind from
// check.kind.doc@1, the deliverable by doc ID and the check input's other fields; no `run` line.
export interface DocCheck { name: string; kind: string; doc: string; input: Line }
/** geometry.audit on the deliverable: the floor may float (it is the scene's ground), nothing else. */
export const AUDIT: DocCheck = { name: 'scene-audit', kind: 'geometry.audit', doc: DOC1, input: { scope: 'scene', support: { floating: ['floor'] } } };
/** logic.determinism, the logic module's kind (Check input: logic kinds), on the same deliverable. */
export const DETERMINISM: DocCheck = { name: 'scene-determinism', kind: 'logic.determinism', doc: DOC1, input: { at_times: ['0s'], compare: 'same_machine' } };
/** `.deepbuild/done.yaml`: the claim `done` names each check, each entry its kind, its doc and its input. */
export function specYaml(checks: readonly DocCheck[]): string {
  const lines = ['claims:', '  done:', `    checks: [${checks.map((c) => c.name).join(', ')}]`, 'checks:'];
  for (const c of checks) lines.push(`  ${c.name}:`, `    kind: ${c.kind}`, `    doc: "${c.doc}"`, `    input: ${JSON.stringify(c.input)}`);
  return `${lines.join('\n')}\n`;
}

// ---- The task and its handed definition: R1, judged by a drafted node:test check the hermetic runner counts, which
// fails on the base (no scene file) and passes once the session saves the scene. The document isn't a file, so the
// definition's deliverables name the saved file; the spec's entry names the document (README: Readings).
export const SCENE_FILE = 'scene/release.json';
export const ASK = 'draw the release scene and save it as scene/release.json';
const SAVED_SH = '.deepbuild/checks/scene-saved.sh';
const SAVED_TEST = '.deepbuild/checks/scene-saved.test.js';
const R1_FILES: Record<string, string> = {
  [SAVED_SH]: `#!/bin/sh\n# Drafted check: the release scene is saved as ${SCENE_FILE}.\nnode --test ${SAVED_TEST}\n`,
  [SAVED_TEST]: `const test = require('node:test');\nconst assert = require('node:assert');\ntest('the release scene is saved', () => {\n  assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', '..', 'scene', 'release.json')), '${SCENE_FILE} is not saved');\n});\n`,
};
export const DRAFT: Draft = {
  ask: ASK, requirements: [req('R1', `The release scene is saved as ${SCENE_FILE}`, { check: SAVED_SH, asserts: [`${SAVED_TEST}:4`] })], deliverables: [SCENE_FILE], budget: null,
};

// ---- Prerequisites, and the canvas core the checkout's hub runs.
/** The canvas core `deep hub run` starts from this checkout (packages/hub/src/canvas.ts, canvasCore): the newer of target/release and target/debug's deep-show. */
export function hubCanvasCore(): string | undefined {
  const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-show')).filter((p) => existsSync(p));
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
/** Throws BLOCKED naming each build the tests need that isn't there. */
export function prerequisites(who: string): void {
  must(existsSync(CLI), `BLOCKED: ${who} needs the built CLI ${CLI}: npm run build --workspaces`);
  must(existsSync(DEEP_HOOK), `BLOCKED: ${who} needs ${DEEP_HOOK}, which every hook runs: cargo build --locked -p deep-hook`);
  must(hubCanvasCore() !== undefined, `BLOCKED: ${who} needs the canvas core the hub runs, target/{release,debug}/deep-show: cargo build --locked -p deep-show`);
}
/** The canvas modules a deep-show build seals, from its `registry` call (`deep-show run`, #393's scenario convention). */
export function modulesOf(bin: string): string[] {
  const evidence = mkdtempSync('/tmp/dh1723-r-');
  try {
    const scenario = { evidence, sessions: {}, panels: { main: { rect: [0, 0, 800, 600] } }, docs: {}, calls: [{ call: 'registry' }] };
    const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
    const answer = parseObject((r.stdout ?? '').trim().split('\n').at(-1) ?? '');
    const modules = answer?.replies?.[0]?.modules;
    must(Array.isArray(modules), `BLOCKED: ${bin} run answered no registry: exit ${r.status}, ${(r.stdout ?? '').slice(0, 600)} ${(r.stderr ?? '').slice(-600)}`);
    return (modules as unknown[]).map((m) => (typeof m === 'string' ? m : String((m as Line)?.name ?? JSON.stringify(m))));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

// ---- The world: #322's temp home and repo with the spec given, the handed definition, the project trusted (#348's
// decision, as #322 records it), and the real hub.
export async function openWorld(checks: readonly DocCheck[]): Promise<{ w: World; hub: Hub }> {
  const w = makeWorld({ drafts: [DRAFT], spec: specYaml(checks), files: R1_FILES });
  await trustRepo(w, true);
  return { w, hub: await startHub(w) };
}

// ---- The session's Claude Code (fixtures/agent.mjs): one process, parent of its hooks, its deep mcp and its deep show.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, { done: (v: Line) => void; fail: (e: Error) => void }>();
  constructor(readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if (typeof line.pid === 'number') { own(line.pid); continue; }
        const p = this.pending.get(line.n);
        this.pending.delete(line.n);
        if (line.failed) p?.fail(Error(String(line.failed)));
        else p?.done(line.done as Line);
      }
    });
    child.on('exit', () => {
      for (const [n, p] of [...this.pending]) { this.pending.delete(n); p.fail(Error("the session's agent process exited")); }
    });
  }
  send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((done, fail) => {
      this.pending.set(n, { done, fail });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
}

/** A tool call's outcome through `deep mcp`: isError, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; value: any; reply: Line }
let rpc = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session, as #322's Session plays one (its transcript, hooks through deep-hook), plus its deep mcp and deep show. */
export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly transcript: string;
  private readonly agent: Agent;
  private prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private initialized = false;
  constructor(readonly w: World) {
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    this.agent = new Agent(child);
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own process. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return (await this.agent.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body), timeoutMs })) as Ran;
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    must(r.code === 0, `BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed: its transcript entry and its UserPromptSubmit. */
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    must(r.code === 0 || r.code === 2, `BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /** The agent's Write of a file in the repo: its tool_use, PreToolUse, and when allowed the file, its tool_result and PostToolUse. */
  async write(file: string, content: string): Promise<void> {
    const path = join(this.cwd, file);
    const id = `toolu_${randomBytes(10).toString('hex')}`;
    const input = { file_path: path, content };
    this.entry(assistant([{ type: 'tool_use', id, name: 'Write', input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id });
    must(decision(before) === 'allow', `BLOCKED: the Write of ${file} must be allowed: ${shown(before)}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    const response = { type: 'create', filePath: path, content, structuredPatch: [] };
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: 'Write', tool_input: input, tool_use_id: id, tool_response: response, duration_ms: 40 });
  }
  /** The agent's last words of the turn, then Stop; deep-hook's run, the stop's reply on its stdout. */
  async stop(words: string): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
  private async rpc(method: string, params: Line | undefined, timeoutMs = 300_000): Promise<Line> {
    const line = params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: `${method}#${++rpc}`, method, params };
    const r = await this.agent.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs });
    return (r.reply ?? {}) as Line;
  }
  /** One tool of the session's own `deep mcp`, initialized on first use. */
  async mcp(tool: string, args: Line): Promise<Outcome> {
    if (!this.initialized) {
      const init = await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1723', version: '0' } });
      must(init.result !== undefined, `BLOCKED: deep mcp refused initialize: ${JSON.stringify(init).slice(0, 600)}`);
      await this.rpc('notifications/initialized', undefined);
      this.initialized = true;
    }
    const reply = await this.rpc('tools/call', { name: tool, arguments: args });
    if (reply.error) return { isError: true, value: reply.error, reply };
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    return { isError: result.isError === true, value: result.structuredContent ?? (typeof text === 'string' ? parseObject(text) ?? text : undefined), reply };
  }
  /** deep_show of a whole revision (the document as its JSON text, as the tool's schema asks); presented, or BLOCKED. */
  async show(doc: string, document: Line, who: string): Promise<Line> {
    const o = await this.mcp('deep_show', { doc, document: JSON.stringify(document) });
    must(!o.isError && o.value?.outcome === 'presented', `BLOCKED: ${who} deep_show of doc ${doc} must be presented: ${JSON.stringify(o.value ?? o.reply).slice(0, 1200)}`);
    return o.value as Line;
  }
  /** `deep show --doc … --document <file> --json [--check] [--claim …]`, run in this session's process tree; its JSON reply. */
  async showCli(o: { doc: string; document: Line; check?: boolean; claim?: string }): Promise<{ reply: Line; code: number | null; stderr: string }> {
    const file = join(this.w.tmp, `document-${randomBytes(4).toString('hex')}.json`);
    writeFileSync(file, JSON.stringify(o.document));
    const argv = [NODE, CLI, 'show', '--doc', o.doc, '--document', file, '--json', ...(o.check ? ['--check'] : []), ...(o.claim ? ['--claim', o.claim] : [])];
    const r = await this.agent.send({ op: 'exec', argv, cwd: this.cwd, env: childEnv(this.w.home), timeoutMs: 300_000 });
    const last = String(r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
    must(last !== undefined, `BLOCKED: deep show printed no JSON reply (exit ${String(r.code)}): ${String(r.stdout).slice(0, 400)} ${String(r.stderr).slice(-600)}`);
    return { reply: JSON.parse(last) as Line, code: r.code as number | null, stderr: String(r.stderr ?? '') };
  }
}

// ---- The task: the prompt typed and its handed definition locked; then the scene drawn, saved, and the turn ended.
/** The session started and ASK typed; the task its prompt opened, once its definition locked (BLOCKED otherwise). */
export async function openTask(hub: Hub, s: Session, who: string): Promise<string> {
  await s.start();
  await s.typed(ASK);
  const taskOf = (all: Ev[]): string | undefined => {
    const ask = all.find((e) => e.kind === 'user.ask' && e.session === s.id && e.data.text === ASK);
    return Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
  };
  const locked = (all: Ev[]): boolean => { const ref = taskOf(all); return ref !== undefined && all.some((e) => e.kind === 'definition.locked' && e.data.task_ref === ref); };
  const events = await settle(hub, locked, 90_000);
  const ref = taskOf(events);
  must(ref !== undefined && locked(events), `BLOCKED: ${who} the prompt "${ASK}" must open a task whose handed definition locks: ${ref ?? 'no task'}`);
  return ref;
}
export interface Claimed { claim: string; since: number; shown: Line; stop: Ran }
/** deep_show of `document` as `doc` through the session's deep mcp, the scene saved, the turn ended; its claim (BLOCKED if none). */
export async function drawAndStop(hub: Hub, s: Session, ref: string, doc: string, document: Line, who: string): Promise<Claimed> {
  const since = await lastPos(hub);
  const shownReply = await s.show(doc, document, who);
  await s.write(SCENE_FILE, `${JSON.stringify(document, null, 2)}\n`);
  const stop = await s.stop(`The release scene is drawn as doc ${doc} and saved in ${SCENE_FILE}.`);
  const events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0, 90_000);
  const made = claimsOf(events, ref, since)[0];
  must(made !== undefined, `BLOCKED: ${who} the stop after drawing and saving the scene must make a claim for ${ref}: none was recorded (the stop's reply: ${shown(stop)})`);
  return { claim: `claim:${made.id}`, since, shown: shownReply, stop };
}

// ---- The record.
const FIVE = new Set(['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE']);
export const outcomeOf = (v: Ev | undefined): string => String(v?.data.outcome ?? 'none');
export const judgedBy = (events: readonly Ev[], claim: string): Ev[] => verdictsOf(events, claim).filter((v) => FIVE.has(outcomeOf(v)));
export const sayVerdicts = (vs: readonly Ev[]): string => vs.map((v) => `${outcomeOf(v)} ${JSON.stringify(v.data).slice(0, 900)}`).join(' | ') || 'none';
export interface CheckRun { run: string; started: Ev; finished: Ev | undefined }
/** The runs of a check on a claim, each with its finish: run.started naming the claim, its `check` the spec entry's name. */
export function runsOfCheck(events: readonly Ev[], claim: string, check: string): CheckRun[] {
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && String(e.data.check).includes(check))
    .map((started) => ({ run: String(started.data.run), started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export const sayRuns = (events: readonly Ev[], claim: string): string => events.filter((e) => e.kind === 'run.started' && e.data.claim === claim)
  .map((e) => `${String(e.data.check)} ${String(events.find((f) => f.kind === 'run.finished' && f.data.run === e.data.run)?.data.outcome ?? 'unfinished')}`).join(', ') || 'none';
/**
 * Reads the record until the claim is judged: `check`'s run on it finished with a verdict after the finish, or the
 * newest verdict on it stood `standMs` with nothing after it (a correct hub never judges while a check is pending, so
 * a verdict that stands is the verdict), or `timeoutMs` passed. Resolves with the events read last.
 */
export async function judged(hub: Hub, claim: string, check: string, o: { standMs?: number; timeoutMs?: number } = {}): Promise<Ev[]> {
  let newest = '';
  let seen = 0;
  return settle(hub, (all) => {
    const vs = judgedBy(all, claim);
    const finish = runsOfCheck(all, claim, check).map((r) => r.finished).filter((f): f is Ev => f !== undefined).at(-1);
    if (finish && vs.some((v) => v.log_pos > finish.log_pos)) return true;
    const last = vs.at(-1);
    if (!last) return false;
    if (last.id !== newest) { newest = last.id; seen = Date.now(); }
    return Date.now() - seen > (o.standMs ?? 30_000);
  }, o.timeoutMs ?? 480_000);
}
/** The evidence a run recorded (its finish's `evidence`, by hash), read through the evidence store's public entry, as text. */
export async function evidenceText(w: World, finished: Ev | undefined): Promise<string> {
  const shas = ((finished?.data.evidence ?? []) as unknown[]).map((e) => String(e).replace(/^ev:/, ''));
  if (!shas.length) return '';
  const store = await openEvidenceStore({ root: join(w.root, 'evidence'), readOnly: true });
  const out: string[] = [];
  for (const sha of shas) {
    try { out.push(Buffer.from(await store.read(sha)).toString('utf8')); } catch (error) { out.push(`<evidence ${sha} unreadable: ${(error as Error).message}>`); }
  }
  return out.join('\n');
}
/** Whether text names the floating item with the geometry audit's code. */
export const namesFloating = (text: string): boolean => text.includes(FLOATING_CODE) && new RegExp(`\\b${FLOATING_ITEM}\\b`).test(text);
/** The run's finish as deep_run reports it: its outcome, or, past deep_run's wait, the record's once it lands. */
export async function finishOf(hub: Hub, run: string, timeoutMs = 300_000): Promise<Ev | undefined> {
  const events = await settle(hub, (all) => all.some((e) => e.kind === 'run.finished' && e.data.run === run), timeoutMs);
  return events.find((e) => e.kind === 'run.finished' && e.data.run === run);
}
