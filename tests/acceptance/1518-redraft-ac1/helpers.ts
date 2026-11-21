// Test-side tools for the blind redraft of #1518's criterion 1 (README): the hub world under /tmp/dh1518r-*, made in two
// steps (its folders first, its hub and deep mcp only once the cuts are presented, so nothing the criterion states
// waits on a hub); the cut item's expansion row, read for what the criterion needs (its strips and `removed`); a cut
// film presented with its first verdict, then heard back by the real transcriber; and this job's reading of a
// transcript against the words it should hold, which sets aside the words the transcriber adds (README: Readings).
//
// Reused by import: the first draft's take, words records, film, cut.heard row readers, `media_mix` of a strip list and
// `playedAs` (tests/acceptance/1518/helpers.ts); #509's scenario run, deep_job transcription and the World its model-host
// helpers read; #501's build and readers. Nothing here stands in for the recipe, the mixer, the transcriber, the
// normalizer or cut.heard: every reading is what deep-show or the hub answers, and every expected value comes from the
// issue, the design or where the fixture put each sample.
//
// Safety: the world lives under /tmp/dh1518r-* and is removed after the file; the hub and deep mcp run with HOME in the
// world's folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; every process is one this file started,
// stopped by its PID (the model host by #509's helpers, by the process group it leads); nothing is stopped by name or
// port.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { ITEM, KIND, heardEntries, heardRow, isObject, presented, withAttached, type HeardEntry, type Strip } from '../1518/helpers.ts';
import { REPO, filmRun, int, readJson, show, transcribe, verdictCall, type JsonObject, type JsonValue, type Line, type World } from '../509/helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The world: its folders, then a real hub (DEEP_HUB_TEST_CONFIRM stubs the OS confirming you) and a deep mcp in a project
// folder. deep-show run's `evidence` is the hub's store throughout, so a PCM a verdict keeps is what deep_job takes by
// hash. Its shape is #509's World, so #509's withPlugin and transcribe read it as their own.

const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
const made: string[] = [];
const owned = new Set<number>();
const sleep = (n: number) => new Promise<void>((resolve) => setTimeout(resolve, n));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 30_000);
const track = (child: ChildProcess): void => {
  const pid = child.pid;
  if (!pid) return;
  owned.add(pid);
  child.once('exit', () => owned.delete(pid));
};
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|GIT_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}

export interface Folders { tmp: string; home: string; project: string; evidence: string }
/** The world's folders under /tmp/dh1518r-*: a home whose evidence store the scenarios use, and a project folder. */
export function openFolders(): Folders {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1518r-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  const evidence = join(home, '.deepbuild', 'evidence');
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  mkdirSync(project);
  return { tmp, home, project, evidence };
}

async function startHub(home: string, env: Record<string, string>): Promise<{ pid: number; socket: string; root: string }> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  track(child);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.['ready'] !== true) throw Error(`BLOCKED: the hub didn't start in the world's home: ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready['socket'] === 'string' ? ready['socket'] : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 1_800_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.['id'] === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
/** The world's hub and deep mcp, started in its folders. */
export async function startWorld(f: Folders): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the hub runs ${CLI.slice(REPO.length)}, which isn't built; run npm run build --workspaces (README: Run it)`);
  writeFileSync(join(f.tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(f.home, { DEEP_HUB_TEST_CONFIRM: join(f.tmp, 'confirm') });
  const child = spawn(NODE, [CLI, 'mcp'], { cwd: f.project, env: childEnv(f.home), stdio: ['pipe', 'pipe', 'ignore'] });
  track(child);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1518-redraft-ac1', version: '0' } });
  if (!init['result']) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return { ...f, hub, mcp, hosts: new Map() } as unknown as World;
}

// ---------------------------------------------------------------------------------------------------
// The expansion's row (design: "the expansion's row in `deep show`'s `expansions`"): the entry whose `instance` is the
// item, read for its strips (each `{track, src: {asset}, start, in, out, fade_in, fade_out}` in flicks, a fade
// `{length, curve}` and none where the strip starts or ends at its source's own start or end; a map by ID or a list of
// entries with `id`, read either way) and `removed`. A missing field fails, naming it.

export interface CutRow { row: JsonObject; strips: Strip[]; removed: number[] }
const fadeLength = (v: JsonValue | undefined, what: string): number => {
  if (v === undefined || v === null) return 0;
  expect(isObject(v), `${what} is {length, curve}, got ${show(v)}`).toBe(true);
  return int((v as JsonObject)['length'], `${what}.length (flicks)`);
};
const assetOf = (s: JsonObject): string => (typeof s['src'] === 'string' ? s['src'] : isObject(s['src']) && typeof s['src']['asset'] === 'string' ? s['src']['asset'] : '');
export function cutRowOf(reply: JsonObject, what: string): CutRow {
  const list = Array.isArray(reply['expansions']) ? reply['expansions'] : [];
  const rows = list.filter((r): r is JsonObject => isObject(r) && r['instance'] === ITEM);
  expect(rows.length, `${what}: deep show's \`expansions\` holds one row for the ${KIND} item \`${ITEM}\` (design: As built (#1518)); it holds ${show(list.map((r) => (isObject(r) ? { instance: r['instance'] ?? null, kind: r['kind'] ?? null } : r)), 800)}`).toBe(1);
  const row = rows[0]!;
  const v = row['strips'];
  const listed: [string, JsonValue][] = isObject(v) ? Object.entries(v) : Array.isArray(v) ? v.map((e) => [isObject(e) && typeof e['id'] === 'string' ? e['id'] : '', e]) : [];
  expect(listed.length > 0 && listed.every(([id, s]) => id !== '' && isObject(s)), `${what}: the row's \`strips\` are its strips by ID (a map, or a list of entries with \`id\`): ${show(v ?? null, 800)}`).toBe(true);
  const strips = listed.map(([id, e]) => {
    const s = e as JsonObject;
    return {
      id, track: int(s['track'], `${what}: strip ${id}.track`), asset: assetOf(s),
      start: int(s['start'], `${what}: strip ${id}.start (flicks)`), in: int(s['in'], `${what}: strip ${id}.in (flicks)`), out: int(s['out'], `${what}: strip ${id}.out (flicks)`),
      fadeIn: fadeLength(s['fade_in'], `${what}: strip ${id}.fade_in`), fadeOut: fadeLength(s['fade_out'], `${what}: strip ${id}.fade_out`), raw: s,
    };
  }).sort((a, b) => a.start - b.start);
  const removed = row['removed'];
  expect(Array.isArray(removed) && removed.every((n) => Number.isSafeInteger(n)), `${what}: the row's \`removed\` is a list of word indexes: ${show(removed ?? null)}`).toBe(true);
  return { row, strips, removed: removed as number[] };
}

// ---------------------------------------------------------------------------------------------------
// cut.heard (design): a film presented by you and a claim's verdict; the default row `<claim>#cut.heard` BLOCKED with one
// `cut.heard_unrun` entry while no transcript of the cut result is attached; that PCM transcribed by the real
// `narration.transcript` job on whisper-cpp@1.9.5 through deep_job (#509's `transcribe`); the record listed in the
// recording asset's `attached`; and the verdict again, under the same planted program.

export interface Unheard { what: string; planted: string | undefined; document: JsonObject; cut: CutRow; first: JsonObject; entry: HeardEntry }
export function unheard(bin: string, evidence: string, document: JsonObject, what: string, planted?: string): Unheard {
  const [shown, v0] = filmRun(bin, evidence, document, [verdictCall], `${what}, before any transcript`, planted ? { planted } : {});
  presented(shown, what);
  const cut = cutRowOf(shown!, what);
  const first = heardRow(v0!, `${what}, before any transcript`);
  expect(first['result'], `${what}: with no transcript of the cut result attached, the cut.heard row is BLOCKED (design): ${show(first, 2000)}`).toBe('BLOCKED');
  const entries = heardEntries(first, what);
  expect(entries.length, `${what}: the BLOCKED row holds one cut.heard_unrun entry, for the item \`${ITEM}\`: ${show(entries.map((e) => e.raw), 1500)}`).toBe(1);
  return { what, planted, document, cut, first, entry: entries[0]! };
}
export interface Heard extends Unheard { record: string; transcript: Line; verdict: JsonObject; row: JsonObject }
export async function heardBack(bin: string, w: World, u: Unheard): Promise<Heard> {
  const e = u.entry;
  const { record } = await transcribe(w, { line: ITEM, scope: u.what, pcm: e.pcm, sample_rate: e.sample_rate, channels: e.channels, locale: e.locale, raw: e.raw }, []);
  const transcript = readJson(w.evidence, record, `${u.what}: the transcript of the cut result`);
  const [shown, verdict] = filmRun(bin, w.evidence, withAttached(u.document, [record]), [verdictCall], `${u.what}, heard back`, u.planted ? { planted: u.planted } : {});
  presented(shown, `${u.what}, with its transcript attached`);
  return { ...u, record, transcript, verdict: verdict!, row: heardRow(verdict!, `${u.what}, heard back`) };
}

// ---------------------------------------------------------------------------------------------------
// This job's reading of a transcript (README: Readings), on normalizer@1's tokens of both sides as media_heard answers
// them: a longest-common-subsequence alignment of the words it should hold with the words heard. `lost` lists each
// expected word left unmatched, by its place among `expected`: missing, or heard as another. The heard words left over
// are `spoken` when some word of the recording reads as them (a removed word heard, a kept word heard again), and `added`
// when none does: a word that was never in the recording, so no cut played it, which the transcriber added.

export interface Reading { lost: number[]; spoken: string[]; added: string[] }
export function readHeard(expected: readonly string[], heard: readonly string[], recording: ReadonlySet<string>): Reading {
  const n = expected.length;
  const m = heard.length;
  const after = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) after[i]![j] = expected[i] === heard[j] ? after[i + 1]![j + 1]! + 1 : Math.max(after[i + 1]![j]!, after[i]![j + 1]!);
  }
  const lost: number[] = [];
  const left: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === heard[j]) { i++; j++; }
    else if (after[i + 1]![j]! >= after[i]![j + 1]!) lost.push(i++);
    else left.push(heard[j++]!);
  }
  while (i < n) lost.push(i++);
  while (j < m) left.push(heard[j++]!);
  return { lost, spoken: left.filter((t) => recording.has(t)), added: left.filter((t) => !recording.has(t)) };
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line, for this criterion), rewritten each run under $TMPDIR/deep-1518-redraft-ac1-proof/.

const PROOF_DIR = join(tmpdir(), 'deep-1518-redraft-ac1-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
