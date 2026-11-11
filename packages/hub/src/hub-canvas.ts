
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { CheckResult } from '@deepbuild/conformance';
import { canvasClaim, docCheckOf, docResult, revisionLine, shownResult, worst, type DocCheck, type DocSpec, type Revision } from './doc-checks.js';

import { join } from 'node:path';

import { type JsonValue } from '@deepbuild/contracts';
import { type Evidence, type EvidenceStore, type PutResult } from '@deepbuild/evidence';

import { type Connection, type EventInput, type RecordStore } from '@deepbuild/record';

import { type Root } from './paths.js';

import { Canvas, nameOf, renderStill, showCall, waitForApp, WorldFile, type CanvasWorld } from './canvas.js';

import { type Plant } from './plant.js';

import { Libraries, LibraryRefused, LIMIT_MAX, type AssetKind } from './libraries.js';

import { refuse, ulid } from './wire.js';

import type { Session, CallContext } from './session-types.js';
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface HubCanvasOptions {
  root: Root; now: () => number; plant: Plant | undefined;
  record: () => RecordStore; store: () => EvidenceStore; libraries: () => Libraries | undefined;
  sessions: () => ReadonlyMap<string, Session>;
  evidence: { stored(put: PutResult, what: string): Promise<Evidence> };
  events: { append(connection: Connection, input: EventInput): Promise<void>; connection(writer: string, extra?: Partial<Connection>): Connection; agentConnection(session: string): Connection };
  agentAbove(peer: CallContext['peer']): Promise<string | undefined>;
}
export class HubCanvas {
  constructor(private readonly options: HubCanvasOptions) {}
  private readonly docRevisions = new Map<string, Set<string>>();

  // ---- The canvas side (#806): deep_show, `deep show`, render-back, and what the app draws.

  /** The canvas core, started at the first canvas call; the world file a test gives it; the app's presentations. */
  private canvasCore?: Canvas;

  private readonly worldFile = new WorldFile(process.env.DEEP_HUB_TEST_SHOW);

  /** Each presented revision for the app, in order; an app's `canvas.drawn` takes those after the last it took. */
  private readonly presented: Obj[] = [];

  /** The documents deep_show has named, each on the app's canvas panel. */
  private readonly shownDocs = new Set<string>();

  private readonly drawnUpTo = new Map<string, number>();

  /** When an app last took what was presented: an app that took it within the last 250 ms is open (it asks every 100 ms), and draws it. */
  private appSeen = 0;

  private readonly appOpen = (): boolean => Date.now() - this.appSeen < 250;

  /** The world the canvas core reads: the hub's live sessions, the record's asks and readings, and the world file. */
  private async canvasWorld(): Promise<CanvasWorld> {
    const file = { ...this.worldFile.read(), packs: this.options.libraries()?.packs.all() ?? [] };
    const sessions = [...this.options.sessions().values()].filter((s) => !s.ended).map((s) => ({ id: s.id, thread: s.thread, name: nameOf(file, s.id, s.agent) }));
    const record: Obj = {};
    const asks = (await this.options.record().raw('SELECT id, session_id, status FROM asks')) as { id: string; session_id: string | null; status: string }[];
    for (const a of asks) record[`ask:${a.id}`] = { session: a.session_id, state: a.status === 'open' || a.status === 'later' ? 'needs_you' : 'done' };
    const readings = (await this.options.record().raw("SELECT e.session_id AS session, e.data AS data FROM events e WHERE e.kind = 'reading.recorded' ORDER BY e.log_pos")) as { session: string | null; data: string }[];
    for (const r of readings) {
      const d = JSON.parse(r.data) as Obj;
      if (typeof d.reading === 'string' && typeof d.value === 'number') record[d.reading] = { session: r.session, value: d.value, as_of: Number(d.as_of ?? 0) };
    }
    return { sessions, record, file, docs: [...this.shownDocs] };
  }

  private canvas(): Canvas {
    return (this.canvasCore ??= new Canvas(this.options.root.evidence));
  }

  async canvasCall(call: Obj): Promise<Obj> {
    return (await this.canvas().call(await this.canvasWorld(), call)).reply;
  }

  /**
   * deep_show for a session, or for none (the call binds to no session), or `deep show` from the CLI acting as the
   * session the peer check found, or as you: the writer is the binding's, never the payload's.
   */
  async show(as: { session: string | null } | { you: true }, call: Obj): Promise<Obj> {
    if (typeof call.doc === 'string') this.shownDocs.add(call.doc);
    // The planted hub stamps the writer the payload claims (#806's wrong program): a session whose thread it names.
    if (this.options.plant === 'deep-show-writer-from-payload' && 'session' in as && isObj(call.document) && typeof call.document.writer === 'string') {
      const claimed = [...this.options.sessions().values()].find((s) => `agent:${s.thread}` === (call.document as Obj).writer);
      if (claimed) {
        const { writer: _writer, ...document } = call.document;
        as = { session: claimed.id };
        call = { ...call, document };
      }
    }
    if (call.call === 'render_back') {
      // Render-back of a revision the document has had, at a time: the session's own, never one bound to none.
      if (!('session' in as) || !as.session) return { outcome: 'refused', code: 'no_session', issues: [], snapshots: [] };
      let rev = call.rev;
      if (rev === null) rev = ((await this.canvasCall({ call: 'revisions', doc: call.doc })).revisions as { rev: number; state: string }[] | undefined)?.find((r) => r.state === 'current')?.rev ?? 0;
      return this.canvasCall({ ...call, rev, session: as.session });
    }
    if (isObj(call.document)) {
      const held = await this.preparePackAssets(call.document);
      if (held) return held;
    }
    // An asset.game@1 item naming an asset by hash (#1066's from: {asset}, #1731) takes the license kept with it.
    const game = await this.gameAssets(call);
    if (game.refused) return game.refused;
    call = game.call;
    const via = 'you' in as ? { peer: { pid: 0, start: 0 } } : { session: as.session };
    const name = 'you' in as ? 'deep show' : 'deep_show';
    // A hub claim is judged by its recorded runs, not by world-file fixtures (#1723).
    const world = await this.canvasWorld();
    const ofHub = typeof call.claim === 'string' && !(isObj(world.file.claims) && call.claim in world.file.claims) ? call.claim : undefined;
    if (ofHub) { const { claim: _claim, ...rest } = call; call = rest; }
    const { reply: drawn, presented } = await this.canvas().call(world, { call: name, ...via, ...call });
    const reply = game.assets.length ? { ...drawn, assets: game.assets } : drawn;
    if (presented) await this.recordRevision(as, presented, reply);
    if (call.check === true && typeof reply.result === 'string') {
      const hash = typeof presented?.hash === 'string' ? presented.hash : (await this.docRevision(String(call.doc)))?.hash;
      reply.result = worst([reply.result, hash ? await this.recordedResult(String(call.doc), hash, ofHub) : 'INCONCLUSIVE']);
    }
    // The planted hub waits for an app to draw the revision instead of rendering back headless.
    if (this.options.plant === 'deep-show-waits-for-app' && reply.outcome === 'presented' && !(await waitForApp(this.appOpen))) {
      return { ...reply, outcome: 'not_presented', reason: 'timeout', snapshots: [] };
    }
    return reply;
  }

  /**
   * The asset.game@1 items of a document that name an asset by hash (#1731; #1066's `from: {asset}`): each expands to
   * the mesh.asset@1 it draws, with the license the asset was kept with at fetch, listed in the reply's `assets`. An
   * asset no fetch kept with its license is BLOCKED, naming the item and the asset, so the revision is refused.
   */
  private async gameAssets(call: Obj): Promise<{ call: Obj; assets: Obj[]; refused?: Obj }> {
    const doc = call.document;
    if (!isObj(doc) || !isObj(doc.items)) return { call, assets: [] };
    const items: Obj = {};
    const assets: Obj[] = [];
    const issues: Obj[] = [];
    for (const [key, item] of Object.entries(doc.items)) {
      const sha = isObj(item) && item.kind === 'asset.game@1' && isObj(item.from) ? item.from.asset : undefined;
      if (typeof sha !== 'string') { items[key] = item; continue; }
      const it = item as Obj;
      const id = typeof it.id === 'string' ? it.id : key;
      const pinned = this.options.libraries()?.packs.byHash(doc.packs, sha);
      let kept = this.options.libraries()?.asset(sha, pinned?.pack);
      if (pinned && (!kept || !await this.options.store().verify(sha))) {
        const fetched = await this.options.libraries()!.fetchPack(pinned.pack, pinned.asset.path);
        if (fetched.status !== 'fetched') return { call, assets, refused: { ...fetched, outcome: 'refused', code: 'asset_blocked', issues: [{ severity: 'error', code: 'asset.blocked', ids: [id], message: `BLOCKED: ${JSON.stringify(fetched)}` }], snapshots: [] } };
        kept = fetched.asset;
      }
      if (kept?.pack && (!pinned || pinned.pack !== kept.pack)) kept = undefined;
      if (!kept) {
        issues.push({ severity: 'error', code: 'asset.unlicensed', ids: [id], path: `/items/${key}/from/asset`, message: `BLOCKED: ${id} names asset ${sha}, which no fetch kept with a license; fetch it from a library first` });
        continue;
      }
      assets.push({ item: id, asset: sha, license: kept.license, upstream: kept.upstream, ...(kept.pack ? { pack: kept.pack } : { library: kept.library }) });
      const { from: _from, budget: _budget, params: _params, ...rest } = it;
      items[key] = { ...rest, kind: 'mesh.asset@1', order: typeof rest.order === 'string' ? rest.order : `a${assets.length - 1}`, params: { sha256: sha, node: 0 } };
    }
    if (issues.length) return { call, assets, refused: { outcome: 'refused', code: 'asset_blocked', issues, snapshots: [] } };
    if (!assets.length) return { call, assets };
    // What the expansion draws with is scene3d's, so the document requires it, as one that wrote mesh.asset@1 would.
    const requires = isObj(doc.requires) ? doc.requires : {};
    const modules = isObj(requires.modules) ? requires.modules : {};
    const needs = 'scene3d' in modules ? requires : { ...requires, modules: { ...modules, scene3d: '^1' } };
    return { call: { ...call, document: { ...doc, requires: needs, items } }, assets };
  }

  /**
   * deep_kinds (#412): the canvas core's listing, words, guides and gallery. It reads and changes nothing, so it needs
   * no session; a refusal is the canvas core's error@2, at its path under the call's arguments.
   */
  async kinds(args: Obj): Promise<Obj> {
    // Asset search and fetch (#1731) span the enabled libraries, which the hub reads; the canvas core holds none.
    if (args.op === 'assets' || args.op === 'fetch') return this.assets(args);
    const call: Obj = { call: 'deep_kinds' };
    for (const [k, v] of Object.entries(args)) if (v !== null) call[k] = v;
    const reply = await this.canvasCall(call);
    const e = reply.error;
    if (isObj(e)) throw refuse(String(e.code), `/params/arguments${String(e.path)}`, String(e.remediation), e.actual);
    return reply;
  }

  /**
   * deep_kinds `assets` and `fetch` (#1731): one ranked list over the enabled libraries' rows, and a fetch of one row
   * by its library and id, held on your answer, refused naming why, or BLOCKED with one unblock ask.
   */
  private async assets(args: Obj): Promise<Obj> {
    const libraries = this.options.libraries();
    if (!libraries) throw refuse('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'deep_kinds', true);
    for (const k of Object.keys(args)) {
      const takes = args.op === 'assets' ? ['op', 'query', 'kind', 'size_m', 'license', 'limit'] : ['op', 'library', 'id', 'pack', 'asset'];
      if (args[k] !== null && args[k] !== undefined && !takes.includes(k)) throw refuse('unlisted_field', `/params/arguments/${k}`, `Leave out ${k}: ${String(args.op)} takes only ${takes.slice(1).join(', ')}.`, k);
    }
    try {
      if (args.op === 'fetch') {
        if (typeof args.pack === 'string') {
          if (typeof args.asset !== 'string' || args.library || args.id) throw refuse('required', '/params/arguments/asset', 'Give pack@version and one asset path, without library or id.', args.asset);
          return { ...(await libraries.fetchPack(args.pack, args.asset)) };
        }
        if (typeof args.library !== 'string' || typeof args.id !== 'string') throw refuse('required', `/params/arguments/${typeof args.library === 'string' ? 'id' : 'library'}`, 'Give library and id, as a search row names them.', null);
        return { ...(await libraries.fetch(args.library, args.id)) };
      }
      if (typeof args.query !== 'string' || !args.query.trim()) throw refuse('required', '/params/arguments/query', 'Give query, the words to search the libraries for.', args.query ?? null);
      const size = args.size_m as number[] | null;
      if (size !== null && (size.length !== 2 || !(size[0]! >= 0 && size[0]! <= size[1]!))) throw refuse('type', '/params/arguments/size_m', 'Give size_m as [least, most] in metres.', size);
      const limit = (args.limit as number | null) ?? LIMIT_MAX;
      if (limit < 1 || limit > LIMIT_MAX) throw refuse('maximum', '/params/arguments/limit', `Give limit from 1 to ${LIMIT_MAX}.`, limit);
      return { ...(await libraries.search({ words: args.query, kind: (args.kind as AssetKind | null) ?? null, size_m: size ? [size[0]!, size[1]!] : null, license: (args.license as string[] | null) ?? null, limit })) };
    } catch (e) {
      if (e instanceof LibraryRefused) return { status: 'refused', reason: e.message };
      throw e;
    }
  }

  /** A revision the canvas core made current: recorded by its hash, its canonical document in evidence, and presented to the app. */
  private async recordRevision(as: { session: string | null } | { you: true }, p: Obj, reply: Obj): Promise<void> {
    const session = 'session' in as ? as.session : null;
    const writer = p.writer as { kind: string; id: string };
    const hash = String(p.hash);
    // The canvas core wrote the canonical document under its hash; the store's index takes it, origin from the binding.
    await this.options.evidence.stored(await this.options.store().connect(session ? { role: 'agent', session } : { role: 'deepbuild', via: 'job' }).put({
      bytes: new Uint8Array(readFileSync(join(this.options.root.evidence, hash.slice(0, 2), hash.slice(2)))), kind: 'canvas.revision', source: `doc:${String(p.doc)}`,
      redaction: 'complete', license: { name: 'session', allows: [] },
    }), "the revision's canonical document");
    const ts = this.options.now();
    const agent = session ? this.options.sessions().get(session)?.agent : undefined;
    const connection = session ? this.options.events.agentConnection(session) : this.options.events.connection('cli');
    const count = (k: string) => ((reply[k] as unknown[] | undefined) ?? []).length;
    await this.options.events.append({ ...connection, ...(agent ? { agent } : {}) }, {
      v: 2, id: ulid(ts), kind: 'doc.patched', ts, subject: `doc:${String(p.doc)}`, evidence: [hash],
      data: {
        doc: `doc:${String(p.doc)}`, rev: Number(p.rev), patch: null, writer: writer.kind,
        achieved: { created: {}, updated: count('changed'), deleted: {}, unchanged: count('changed') + count('created') + count('removed') === 0 },
        hash, layer: String(p.layer), thread: writer.kind === 'agent' ? writer.id : null,
      } as JsonValue,
    });
    this.presented.push({ doc: p.doc, rev: p.rev, rect: p.rect, layers: p.layers, session });
    await this.staleOnRevision(String(p.doc), { rev: Number(p.rev), hash });
  }

  /** The document checks a worktree's spec names (#1723). */
  docChecksOf(worktree: string): Map<string, DocCheck> {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return new Map(); }
    const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
    return new Map(Object.entries(checks).flatMap(([name, c]) => { const d = docCheckOf(c); return d ? [[name, d] as const] : []; }));
  }
  /** A document's newest recorded revision. */
  async docRevision(doc: string): Promise<Revision | undefined> {
    const [row] = (await this.options.record().raw(`SELECT json_extract(data, '$.rev') AS rev, json_extract(data, '$.hash') AS hash FROM events WHERE kind = 'doc.patched' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [`doc:${doc}`])) as { rev: number; hash: string }[];
    return row ? { rev: Number(row.rev), hash: String(row.hash) } : undefined;
  }
  /** The canvas verdict for a claim holding just this document check, with the revision in its key. */
  async documentCheck(run: { run: string; check: string; claim: string }, spec: DocSpec): Promise<CheckResult & { stdout: string }> {
    const [owner] = (await this.options.record().raw(`SELECT session_id FROM claims WHERE id = ?`, [run.claim.slice(6)])) as { session_id: string | null }[];
    const world = await this.canvasWorld();
    const handle = `${run.claim}#${run.check}`;
    world.file = { ...world.file, claims: { ...(isObj(world.file.claims) ? world.file.claims : {}), [handle]: canvasClaim(owner?.session_id ?? '', run.check, spec) } };
    let reply: Obj;
    try {
      reply = (await this.canvas().call(world, { call: 'verdict', claim: handle })).reply;
    } catch (error) {
      reply = { result: 'BLOCKED', requirements: [{ result: 'BLOCKED', blocked: [{ code: 'canvas_unavailable', ask: error instanceof Error ? error.message : String(error) }] }] };
    }
    const result = docResult(spec, reply);
    const line = result.evidence[0];
    if (line) this.docRevisions.set(run.claim, new Set([...(this.docRevisions.get(run.claim) ?? []), line]));
    return result;
  }
  /** The revisions this claim's document checks read, retained for its verdict's key. */
  revisionsOf(claim: string): ReadonlySet<string> | undefined { return this.docRevisions.get(claim); }
  /** A new revision makes verdicts keyed by another revision stale. */
  private async staleOnRevision(doc: string, at: Revision): Promise<void> {
    const rows = (await this.options.record().raw(`SELECT v.handle AS verdict, f.value AS line FROM verdicts v JOIN json_each(v.key, '$.doc_revisions') f WHERE v.stale = 0 AND f.value LIKE ?`, [`doc:${doc}@%`])) as { verdict: string; line: string }[];
    for (const r of rows.filter((x) => x.line !== revisionLine(doc, at))) {
      const ts = this.options.now();
      await this.options.events.append(this.options.events.connection('core'), { v: 1, id: ulid(ts), kind: 'verdict.stale', ts, subject: r.verdict, data: { verdict: r.verdict, because: `doc:${doc} has a new revision, ${at.rev}; the verdict covers ${r.line}` } });
    }
  }
  /** The worst recorded outcome on this revision; never PASS with no run. */
  private async recordedResult(doc: string, hash: string, claim: string | undefined): Promise<string> {
    const ofClaim = claim ? ` AND json_extract(e.data, '$.run') IN (SELECT json_extract(data, '$.run') FROM events WHERE kind = 'run.started' AND json_extract(data, '$.claim') = ?)` : '';
    const rows = (await this.options.record().raw(`SELECT json_extract(e.data, '$.outcome') AS outcome FROM events e JOIN json_each(e.data, '$.findings') f WHERE e.kind = 'run.finished' AND f.value LIKE ?${ofClaim}`, [`doc:${doc}@% ${hash}`, ...(claim ? [claim] : [])])) as { outcome: string }[];
    return shownResult(rows.map((r) => r.outcome));
  }

  /** The same first-use gate for a shown document and its exports, for every asset-reading kind. */
  private async preparePackAssets(document: Obj): Promise<Obj | undefined> {
    const libraries = this.options.libraries();
    if (!libraries) return { status: 'BLOCKED', outcome: 'refused', cause: 'The asset host is not ready.', snapshots: [] };
    for (const pack of Array.isArray(document.packs) ? document.packs : []) if (typeof pack !== 'string' || !libraries.packs.get(pack)) {
      return { status: 'BLOCKED', outcome: 'refused', cause: `pack_missing: ${String(pack)}`, snapshots: [] };
    }
    for (const { pack, asset } of libraries.packs.used(document)) {
      const fetched = await libraries.fetchPack(pack, asset.path);
      if (fetched.status !== 'fetched') return { ...fetched, outcome: 'refused', code: 'asset_blocked', issues: [{ severity: 'error', code: 'asset.blocked', ids: [asset.path], message: `BLOCKED: ${JSON.stringify(fetched)}` }], snapshots: [] };
    }
    return undefined;
  }

  /** The hub resolves a pack export through its pinned store. The CLI writes only the returned PNG bytes. */
  async exportStill(params: Obj): Promise<Obj> {
    if (!isObj(params.document) || typeof params.still !== 'string') throw refuse('type', '/params', 'Give document and still, a frame or marker.', params);
    const held = await this.preparePackAssets(params.document);
    if (held) return held;
    const game = await this.gameAssets({ document: params.document });
    if (game.refused) return game.refused;
    const packs = this.options.libraries()!.packs.all();
    const rendered = await renderStill(game.call.document, params.still, this.options.root.evidence, packs);
    const hash = (rendered.snapshots as Obj[] | undefined)?.[0]?.sha256;
    if (rendered.outcome !== 'presented' || typeof hash !== 'string') return { status: 'BLOCKED', cause: `No still could be drawn: ${JSON.stringify(rendered)}` };
    // The canvas store's bytes are rehashed before they leave the hub; neither an input path nor an output path
    // is accepted here, so an agent cannot make the hub read or write outside its own evidence folder.
    const bytes = await this.options.store().read(hash);
    return { status: 'exported', sha256: hash, png: Buffer.from(bytes).toString('base64') };
  }

  /** `deep show` from the CLI: the peer check makes it the agent's whose process tree runs it, never by PID alone; else yours. */
  async showCli(params: Obj, context: CallContext): Promise<Obj> {
    const session = await this.options.agentAbove(context.peer);
    return this.show(session ? { session } : { you: true }, showCall(params));
  }

  /** The user's side the app plays (#384, #393): its input, asks and window, through the canvas core. */
  async canvasUser(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'app') throw refuse('role', '/method', 'Only the app plays your input on the canvas.', 'canvas.user');
    const call = isObj(params.call) ? params.call : {};
    return this.canvasCall(call);
  }

  /** What the app has yet to draw: every revision presented after the last it took. */
  drawnBy(context: CallContext): Obj {
    this.appSeen = Date.now();
    const key = context.role;
    const from = this.drawnUpTo.get(key) ?? 0;
    this.drawnUpTo.set(key, this.presented.length);
    return { presented: this.presented.slice(from) };
  }
  close(): void { this.canvasCore?.close(); }
}
