// Test-side tools for #3525's redrafted acceptance tests (README): a fixture hub (`deep hub run`) in a temp home with
// a library source that serves one model (library.ts, #1731's fill installed through `deep install`, turned on, and a
// standing rule that lets a CC0 fetch land with no ask); a session bound by its hooks (#806's agent stand-in) whose
// own `deep mcp` is spoken to by raw JSON-RPC lines (#2898's Bound), carrying a planted server when a test names one
// (fixtures/plant.mjs, `node --import`); a document with a logic item drawn before any call is judged (the gallery's
// logic counter, its program in the store), so every deep_kinds form has something real to read; the record through
// `events.read`; the store as files on disk; and a stand-in client that runs calls as the facts say Claude Code does.
//
// Imported, not copied: #26's seed and record reader, #806's hub pieces and stand-ins, #2898's Raw and Bound, #1731's
// fill and model bytes. Processes are stopped by PID only (#806's and #26's cleanup), never by name or port.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Bound, Raw, brief, cleanup, t26, type Line } from '../2898/helpers.ts';
import { Stand, World, childEnv, hubCall, makeHome, own, t393, tempDir, uuidOf } from '../806/helpers.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { LIB, MODEL, MODEL_FILES, openLibrary, type Library } from './library.ts';

export { Raw, brief, cleanup, t26, LIB, MODEL, type Line };

// ---- The criteria: `#3525.` and the first 8 hex digits of SHA-256 of each checkbox's text (scripts/proof-change.mjs).
export const AC = {
  listed: '#3525.2c40eb3b',
  forms: '#3525.aacef461',
  plan: '#3525.db140e2e',
  together: '#3525.92738dfb',
} as const;

export const TEST_MS = 900_000;
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const CLI = t26.CLI;
export const PLANT = fileURLToPath(new URL('./fixtures/plant.mjs', import.meta.url));
const GALLERY = join(REPO, 'crates/deep-show/gallery');
/** The hub-minted document the logic counter is drawn on (#393's first document ID). */
export const DOC = t393.DOC.a;
/** The drawn document's logic item, as the gallery's logic counter names it. */
export const ITEM = 'counter';

/** A call's arguments as its listed schema takes them: every listed field, null where the call gives none. */
export function argsFor(schema: Line | undefined, given: Line): Line {
  const props = Object.keys((schema?.properties ?? {}) as Line);
  for (const k of Object.keys(given)) expect(props, `BLOCKED: the listed schema takes ${k}, which this call gives (${brief(given, 200)})`).toContain(k);
  return Object.fromEntries(props.map((k) => [k, given[k] ?? null]));
}
export const schemaOf = (tools: readonly Line[], tool: string): Line | undefined => tools.find((t) => t.name === tool)?.inputSchema as Line | undefined;
export const opsOf = (schema: Line | undefined): string[] => (((schema?.properties as Line | undefined)?.op?.enum ?? []) as unknown[]).map(String);

// ---- The lookups: one call for each form deep_kinds' schema takes, with names that exist at the merge base. A
// form the schema lists and this table misses is a failure, named (forms.test.ts).
const galleryHash = (file: string): string => {
  const g = JSON.parse(readFileSync(join(GALLERY, 'gallery.json'), 'utf8')) as { examples: { file: string; hash: string }[] };
  const hash = g.examples.find((e) => e.file === file)?.hash;
  if (!hash) throw Error(`BLOCKED: crates/deep-show/gallery/gallery.json lists no ${file}`);
  return hash;
};
export function lookups(): Record<string, Line[]> {
  return {
    list: [{}],
    word: [{ word: 'BoxGeometry' }],
    search: [{ query: 'counter' }],
    read: [{ guide: 'logic' }, { example: galleryHash('logic-counter.json') }],
    gallery: [{}],
    sheet: [{}],
    step_ceilings: [{}],
    field: [{ path: 'logic@1' }],
    closure: [{ list: 'camera@1.projection' }],
    bindings: [{ doc: DOC, item: ITEM, language: 'rust' }],
    assets: [{ query: 'chair' }],
  };
}
/** Where the fetch form goes: deep_kinds' fetch at the merge base, by the fields it takes there. */
export const FETCH: Line = { library: LIB, id: MODEL };
/** The four lookups of the plan-mode and side-by-side criteria, in the order the criteria name them. */
export const FOUR: readonly { op: string; given: Line }[] = [
  { op: 'list', given: {} },
  { op: 'field', given: { path: 'logic@1' } },
  { op: 'read', given: { guide: 'logic' } },
  { op: 'word', given: { word: 'BoxGeometry' } },
];

// ---- TLS for the library: a test CA and a leaf for 127.0.0.1 made per world with openssl (#1731's); the hub trusts
// the CA only, through NODE_EXTRA_CA_CERTS.
function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh3525 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}

/** #1731's fill (fixtures/shelf) pointed at the library's host, its digest set, ready for `deep install`. */
async function fill(dir: string, host: string): Promise<string> {
  cpSync(fileURLToPath(new URL('../1731/fixtures/shelf', import.meta.url)), dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.fixture')) renameSync(join(dir, name), join(dir, name.slice(0, -'.fixture'.length)));
  writeFileSync(join(dir, 'probe.json'), JSON.stringify({ host }));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.sources[0].host = host;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await import('../../../packages/extension-host/src/index.ts');
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** `deep hub run` in the home with the confirmation stub, the world file and the test CA; BLOCKED when it doesn't start. */
async function startHub(home: string, env: Record<string, string>): Promise<t26.Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-8000)));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); try { resolve((JSON.parse(first.split('\n')[0]!) as Line).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(-2000)}`);
  return { pid: child.pid!, home, socket: join(t26.rootOf(home), 'hub.sock'), child, output: () => out };
}

// ---- The world.
export interface Planned { label: string; plant?: Line }
export interface Session { id: string; ask: string; stand: Stand; server: Bound }
export interface Lookups {
  tmp: string; home: string; cwd: string; hub: t26.Hub; library: Library;
  sessions: Map<string, Session>;
  /** Every event in the record. */
  events(): Promise<t26.Ev[]>;
  /** Every file the evidence store holds, by its path under the store. */
  store(): string[];
}
const bound = (p: Planned): string[] => p.plant ? [NODE, '--import', PLANT, CLI, 'mcp'] : [NODE, CLI, 'mcp'];

export async function lookupWorld(planned: Planned[] = [{ label: 'agent' }]): Promise<Lookups> {
  const { tmp, home } = makeHome();
  const work = t26.makeWorktree(join(tmp, 'work'));
  mkdirSync(join(tmp, 'tls'));
  const tls = certs(join(tmp, 'tls'));
  const library = await openLibrary(tls);
  const ids = planned.map((p) => uuidOf(`3525:${p.label}`));
  const asks: string[] = [];
  await t26.seed(home, async (s) => {
    for (const id of ids) {
      await s.start(id, work.path);
      asks.push(await s.raise(id, 'taste', 'Which border for the gate?'));
    }
  });
  // The logic counter's program, in the store as you would drop it in, so the gallery's document draws.
  const evidence = join(t26.rootOf(home), 'evidence');
  const put = await (await openEvidenceStore({ root: evidence })).connect({ role: 'you', via: 'drop' }).put({
    bytes: readFileSync(join(GALLERY, 'logic-counter.wasm')), kind: 'program', source: 'tests/acceptance/3525-redraft', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] },
  });
  expect(put.status, `BLOCKED: the store keeps the logic counter's program: ${brief(put)}`).toBe('stored');
  const world = new World(join(tmp, 'world.json'), { names: Object.fromEntries(planned.map((p, i) => [ids[i], `Claude Code: ${p.label}`])), panels: t393.PANELS, docs: { [DOC]: { panel: 'main' } } });
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: world.path, NODE_EXTRA_CA_CERTS: tls.ca });
  const installed = await t26.deep(home, ['install', await fill(join(tmp, 'shelf'), library.host)]);
  expect(installed.code, `BLOCKED: deep install of #1731's fill loads it: ${installed.stdout.slice(-800)} ${installed.stderr.slice(-800)}`).toBe(0);
  await hubCall(hub, 'library.on', { library: LIB });
  await hubCall(hub, 'library.rule', { library: LIB, licenses: ['CC0-1.0'] });

  const sessions = new Map<string, Session>();
  for (const [i, p] of planned.entries()) {
    const stand = Stand.start(home, work.path, 'claude-code', ids[i]!, p.plant ? { PLANT_3525: JSON.stringify(p.plant) } : {});
    await stand.establish(hub);
    const server = new Bound(stand, bound(p));
    await t26.initialize(server);
    sessions.set(p.label, { id: ids[i]!, ask: asks[i]!, stand, server });
  }
  const first = sessions.get(planned[0]!.label)!.server;
  const show = schemaOf(await first.tools(), 'deep_show');
  const document = readFileSync(join(GALLERY, 'logic-counter.json'), 'utf8');
  const drawn = await first.call('deep_show', argsFor(show, { doc: DOC, document, include: ['issues'] }));
  expect(drawn.isError === false && drawn.value?.outcome === 'presented', `BLOCKED: the logic counter is drawn on ${DOC} (deep_show): ${brief(drawn.reply, 1500)}`).toBe(true);

  // A fresh hub installs the packs the release ships on its first lookup, once per store (packages/hub/src/packs.ts,
  // `shipped`): the world makes that first lookup, and waits for the store to settle, before anything is judged.
  const kinds = schemaOf(await first.tools(), 'deep_kinds');
  let warm = await first.call('deep_kinds', argsFor(kinds, { op: 'list' }));
  for (let n = 0; n < 5 && warm.isError; n++) { await t26.sleep(3000); warm = await first.call('deep_kinds', argsFor(kinds, { op: 'list' })); }
  expect(warm.isError, `BLOCKED: the fixture hub answers deep_kinds list: ${brief(warm.reply, 800)}`).toBe(false);

  const store = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => { for (const e of existsSync(dir) ? readdirSync(dir) : []) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else out.push(relative(evidence, p)); } };
    walk(evidence);
    return out.sort();
  };
  for (let seen = -1, n = store().length; n !== seen; seen = n, await t26.sleep(3000), n = store().length);
  return { tmp, home, cwd: work.path, hub, library, sessions, events: () => t26.events(hub), store };
}

// ---- What a call brought in or started: the record's events of these kinds, the store's new files, and the files
// the library served. The record of the call itself (tool.*, mcp.*, source.called) is not among them.
export const CHANGES = /^(ask\.|job\.|run\.started$|evidence\.|asset\.|library\.|doc\.patched$|revision\.|process\.(starting|tracked)$|claim\.made$|open_item\.opened$|action\.|learn\.proposed$|plan\.proposed$|suggestion\.filed$)/;
export interface Changed { events: t26.Ev[]; files: string[]; served: string[] }
export const lastPos = async (w: Lookups): Promise<number> => (await w.events()).reduce((m, e) => Math.max(m, Number(e.log_pos)), 0);
export async function changedSince(w: Lookups, since: { pos: number; files: string[]; log: number }): Promise<Changed> {
  const events = (await w.events()).filter((e) => Number(e.log_pos) > since.pos && CHANGES.test(String(e.kind)));
  const before = new Set(since.files);
  return { events, files: w.store().filter((f) => !before.has(f)), served: w.library.log.slice(since.log).filter((q) => q.path.startsWith('/files/')).map((q) => q.path) };
}
export const mark = async (w: Lookups) => ({ pos: await lastPos(w), files: w.store(), log: w.library.log.length });
/** A store file named by the model it is a file of, when it is one: "pine-chair's /files/pine-chair.gltf (<sha>)". */
export function nameFile(file: string): string {
  const sha = file.replace(/[^0-9a-f]/g, '');
  const of = MODEL_FILES.find((f) => f.sha256 === sha);
  return of ? `${MODEL}'s ${of.path} (${of.sha256})` : `store file ${file}`;
}
export function describeChange(c: Changed): string {
  return [
    ...c.events.map((e) => `${String(e.kind)} ${String(e.id)} ${brief(e.data, 200)}`),
    ...c.files.map((f) => `the store gained ${nameFile(f)}`),
    ...c.served.map((p) => `the library served ${p}`),
  ].join('; ');
}
export const isChange = (c: Changed): boolean => c.events.length > 0 || c.files.length > 0 || c.served.length > 0;

// ---- The stand-in client. A call to a tool listed read-only runs beside any other read-only call; a call to any
// other tool runs alone, after every call before it has ended, and calls after it wait for it (Claude Code 2.1.332:
// isReadOnly and isConcurrencySafe both read readOnlyHint, false when absent). In plan mode a call to a tool not
// listed read-only is held and never reaches the server (adapters/claude-code.facts.json, mods.holdsWhen, case plan:
// "the session is in plan mode and the call isn't read-only").
export type Sent = { held: true; why: string } | { held: false; outcome: t26.Outcome; answeredAt: number };
export class Client {
  private barrier: Promise<void> = Promise.resolve();
  private readonly running = new Set<Promise<void>>();
  constructor(readonly server: Bound, readonly tools: readonly Line[], readonly plan = false) {}
  readOnly(tool: string): boolean { return (this.tools.find((t) => t.name === tool)?.annotations as Line | undefined)?.readOnlyHint === true; }
  hint(tool: string): string { const a = (this.tools.find((t) => t.name === tool)?.annotations as Line | undefined); return `readOnlyHint ${a?.readOnlyHint === undefined ? 'absent' : JSON.stringify(a.readOnlyHint)}`; }
  send(tool: string, args: Line, id?: string): Promise<Sent> {
    if (this.plan && !this.readOnly(tool)) return Promise.resolve({ held: true, why: `plan mode holds ${tool}: it is listed ${this.hint(tool)}` });
    const safe = this.readOnly(tool);
    const before = safe ? this.barrier : Promise.all([this.barrier, ...this.running]).then(() => undefined);
    const p = before.then(async (): Promise<Sent> => { const outcome = await this.server.call(tool, args, id); return { held: false, outcome, answeredAt: performance.now() }; });
    const settled = p.then(() => undefined, () => undefined);
    if (safe) { this.running.add(settled); void settled.then(() => this.running.delete(settled)); } else this.barrier = settled;
    return p;
  }
}

/** A reply's bytes as the client reads them: the result, or the error. */
export const bytesOf = (o: t26.Outcome): string => JSON.stringify(o.reply.result ?? o.reply.error);

// ---- The generated table: scripts/skill.mjs run in a scratch copy of this checkout's scripts/, docs/, skills/,
// packages/hub (its own files) and crates/deep-canvas/src/craft.json, with annotations.json removed first; the
// annotations.json it writes (#2898's way of reading what the generator gives).
export function generatedAnnotations(): { table: Record<string, Line> | null; out: string } {
  const dir = tempDir();
  for (const part of ['scripts', 'docs', 'skills', 'crates/deep-canvas/src/craft.json']) cpSync(join(REPO, part), join(dir, part), { recursive: true });
  cpSync(join(REPO, 'packages/hub'), join(dir, 'packages/hub'), { recursive: true, filter: (src) => !src.includes('/node_modules') });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  const file = join(dir, 'packages/hub/annotations.json');
  rmSync(file, { force: true });
  const r = spawnSync(NODE, ['scripts/skill.mjs'], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
  const out = `exit ${r.status}: ${(r.stdout ?? '').slice(-600)} ${(r.stderr ?? '').slice(-1200)}`;
  return { table: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, Line> : null, out };
}
