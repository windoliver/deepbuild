
import { readFileSync } from 'node:fs';
import type { CheckResult } from '@deepbuild/conformance';
import { docChecksIn } from './spec-entries.js';
import { canvasClaim, docResult, revisionLine, shownResult, worst, type DocCheck, type DocSpec, type Revision } from './doc-checks.js';

import { join } from 'node:path';

import { isRecord as isObj, type JsonValue } from '@deepbuild/contracts';
import { type Evidence, type EvidenceStore, type PutResult } from '@deepbuild/evidence';
import { type ExtensionHost } from '@deepbuild/extension-host';

import { type Connection, type EventInput, type RecordStore } from '@deepbuild/record';

import { type Root } from './paths.js';

import { Canvas, nameOf, renderStill, showCall, waitForApp, WorldFile, type CanvasWorld } from './canvas.js';

import { type Plant } from './plant.js';

import { Libraries, LibraryRefused, LIMIT_MAX, type AssetKind } from './libraries.js';

import { refuse, ulid } from './wire.js';

import type { Session, CallContext } from './session-types.js';
type Obj = Record<string, unknown>;
/** A handle's ID, as the record's tables keep it. */
const bare = (handle: string): string => handle.replace(/^[a-z_]+:/, '');
/** Whether a document pins a pack, the only way it reaches what a pack fills. */
const pinsPacks = (document: unknown): boolean => isObj(document) && Array.isArray(document.packs) && document.packs.length > 0;
export interface HubCanvasOptions {
  doneSpec(cwd: string): unknown;
  root: Root; now: () => number; plant: Plant | undefined;
  record: () => RecordStore; store: () => EvidenceStore; libraries: () => Libraries | undefined;
  /** The plug-ins' host, whose check kinds deep_kinds lists as the hub slot check.kind@1's fills (#1415). */
  extensions: () => ExtensionHost | undefined;
  sessions: () => ReadonlyMap<string, Session>;
  evidence: { stored(put: PutResult, what: string): Promise<Evidence> };
  events: { append(connection: Connection, input: EventInput): Promise<void>; connection(writer: string, extra?: Partial<Connection>): Connection; agentConnection(session: string): Connection };
  agentAbove(peer: CallContext['peer']): Promise<string | undefined>;
}
/** How many app connections' places are kept: one let go takes each document's newest revision again. */
const APPS_KEPT = 16;

export class HubCanvas {
  constructor(private readonly options: HubCanvasOptions) {}
  private readonly docRevisions = new Map<string, Set<string>>();

  // ---- The canvas side (#806): deep_show, `deep show`, render-back, and what the app draws.

  /** The canvas core, started at the first canvas call; the world file a test gives it; the app's presentations. */
  private canvasCore?: Canvas;

  private readonly worldFile = new WorldFile(process.env.DEEP_HUB_TEST_SHOW);

  /**
   * Each shown document's newest revision for the app, the last presented last, each with its place in what was presented
   * (#1866): what an app takes as it connects, and what one that fell behind has missed.
   */
  private readonly presented = new Map<string, { n: number; revision: Obj }>();
  private presentations = 0;
  /** Every revision presented since an open app last asked: what its next `canvas.drawn` takes. Nothing while none is open. */
  private untaken: Obj[] = [];
  private untakenFrom = 0;

  /** The documents deep_show has named, each on the app's canvas panel. */
  private readonly shownDocs = new Set<string>();
  private readonly unshown = new Set<string>();

  /** How far each app connection has taken, the newest to ask last. */
  private readonly drawnUpTo = new Map<number, number>();

  /** When an app last took what was presented: an app that took it within the last 250 ms is open (it asks every 100 ms), and draws it. */
  private appSeen = 0;

  private readonly appOpen = (): boolean => Date.now() - this.appSeen < 250;

  /**
   * The record's part of the world (#1868): each ask's state and each reading's latest value, of those the canvas core's
   * documents and calls name (#1866), by handle. Each is read from the record when first named; an appended event marks
   * the one it changed, and the next canvas call reads only that, so a call with nothing new reads no event and no ask.
   */
  private readonly worldRecord: Obj = {};
  /** Counts each change to `worldRecord`, so the canvas core is sent the world again only when it changed. */
  private worldRev = 0;
  /** The handles read, whether or not the record held them. */
  private readonly worldRead = new Set<string>();
  private recording: Promise<void> = Promise.resolve();

  /** An event the record took: what it changes in the world is read at the next canvas call. */
  appended(input: EventInput): void {
    // The planted world is built once: what the record gained since is never read (#1868's wrong program).
    if (this.options.plant === 'canvas-world-built-once') return;
    const { kind, data } = input;
    const of = isObj(data) ? data : {};
    if (kind === 'reading.recorded') this.worldRead.delete(String(of.reading));
    else if (kind === 'ask.created') this.worldRead.delete(`ask:${input.id}`);
    else if (kind === 'ask.batched') { for (const a of Array.isArray(of.asks) ? of.asks : []) if (isObj(a)) this.worldRead.delete(`ask:${bare(String(a.ask))}`); }
    else if (kind === 'decision.applied') this.worldRead.delete(`ask:${bare(String(of.ask))}`);
    else if ((kind.startsWith('ask.') || kind === 'card.taken_over' || kind === 'default.undone' || kind === 'approval.withdrawn') && typeof input.subject === 'string') this.worldRead.delete(`ask:${bare(input.subject)}`);
  }

  /** The objects named, each read again where it changed. The canvas makes one call at a time, so no two read here at once. */
  private async worldOf(named: ReadonlySet<string>): Promise<{ objects: Obj; rev: number }> {
    const raw = (sql: string, ...params: string[]): Promise<unknown[]> => this.options.record().raw(sql, params);
    const once = this.options.plant === 'canvas-world-built-once';
    if (once) named = this.worldRev ? this.worldRead : new Set((await raw(`SELECT 'ask:' || id AS handle FROM asks UNION SELECT json_extract(data, '$.reading') FROM events WHERE kind = 'reading.recorded'`) as { handle: string }[]).map((r) => r.handle));
    // A canvas core started again was given only what its documents name.
    for (const h of [...this.worldRead, ...Object.keys(this.worldRecord)]) if (!named.has(h)) { this.worldRead.delete(h); delete this.worldRecord[h]; }
    const handles = [...named].filter((h) => !this.worldRead.has(h));
    // What is marked from here on is read by the next call: an event that lands during these reads is read twice at worst.
    for (const h of handles) this.worldRead.add(h);
    const put = (handle: string, is: Obj): void => {
      // An event that leaves an ask as it read (shown again, put off) changes nothing the canvas core is sent.
      if (JSON.stringify(this.worldRecord[handle]) === JSON.stringify(is)) return;
      this.worldRecord[handle] = is;
      this.worldRev++;
    };
    try {
      const asks = handles.filter((h) => h.startsWith('ask:')).map(bare), readings = handles.filter((h) => h.startsWith('reading:'));
      for (const a of (asks.length ? await raw('SELECT id, session_id, status FROM asks WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(asks)) : []) as { id: string; session_id: string | null; status: string }[]) {
        put(`ask:${a.id}`, { session: a.session_id, state: a.status === 'open' || a.status === 'later' ? 'needs_you' : 'done' });
      }
      for (const r of (readings.length ? await raw("SELECT session_id AS session, data FROM (SELECT value AS handle FROM json_each(?)) JOIN events e INDEXED BY events_reading ON e.kind = 'reading.recorded' AND json_extract(e.data, '$.reading') = handle ORDER BY e.log_pos", JSON.stringify(readings)) : []) as { session: string | null; data: string }[]) {
        const d = JSON.parse(r.data) as Obj;
        if (typeof d.value === 'number') put(String(d.reading), { session: r.session, value: d.value, as_of: Number(d.as_of ?? 0) });
      }
    } catch (error) {
      // A read that fails leaves its objects marked, for the next call.
      for (const h of handles) this.worldRead.delete(h);
      throw error;
    }
    return { objects: this.worldRecord, rev: this.worldRev };
  }

  /**
   * Whether a call has needed a pack (#3044): deep_kinds, or a document that pins one. Until then the canvas core holds
   * no pack, so no call waits for the release's pack check, seconds of the core's time; a document that pins no pack
   * reads nothing a pack fills (Registry: entries resolve per document through the pinned pack), so it answers the
   * same with or without them.
   */
  private packsNeeded = false;

  /** The world the canvas core reads: the hub's live sessions, the record's asks and readings, and the world file. */
  private async canvasWorld(): Promise<CanvasWorld> {
    const store = this.packsNeeded ? this.options.libraries()?.packs : undefined;
    const packs = await store?.installed(this.canvas());
    const file: Obj = { ...this.worldFile.read(), packs: packs ?? [], pack_checks: store?.checks };
    // The hub slot check.kind@1's fills deep_kinds lists: each check kind a plug-in registered, with its kit at install (#1415).
    const host = this.options.extensions();
    const kits = (await host?.installed() ?? []).flatMap((p) => p.kits).filter((k) => k.slot === 'check.kind@1');
    const fills = (await host?.checks() ?? []).map((c) => ({ slot: 'check.kind@1', fill: c.kind, kit: { verdict: kits.find((k) => k.fill === c.kind)?.verdict ?? null } }));
    if (fills.length) file.installed = [...(Array.isArray(file.installed) ? file.installed : []), ...fills];
    const sessions = [...this.options.sessions().values()].filter((s) => !s.ended).map((s) => ({ id: s.id, thread: s.thread, name: nameOf(file, s.id, s.agent) }));
    return {
      sessions, record: (named) => this.worldOf(named), file, docs: [...this.shownDocs], recorded: (doc) => this.recordedRevisions(doc),
      text: (hash) => this.options.store().read(hash).then((bytes) => Buffer.from(bytes).toString('utf8'), () => ''),
    };
  }

  /**
   * A document's revisions in the record as the canvas core opens it from them after a restart (#1721). A call that drew
   * the current revision again recorded it again; and a hub before #1721 counted from 1 after each restart, so only the
   * last count is the document's.
   */
  private async recordedRevisions(doc: string): Promise<Obj[]> {
    const rows = (await this.options.record().raw(`SELECT data FROM events WHERE kind = 'doc.patched' AND v >= 2 AND subject = ? ORDER BY log_pos`, [`doc:${doc}`])) as { data: string }[];
    let out: (Obj & { rev: number; hash: string })[] = [];
    for (const row of rows) {
      const d = JSON.parse(row.data) as { rev: number; patch: string | null; writer: string; hash: string; thread: string | null };
      const last = out.at(-1);
      if (last?.rev === d.rev && last.hash === d.hash) continue;
      if (last && d.rev <= last.rev) out = [];
      out.push({ rev: d.rev, writer: `${d.writer}:${d.thread ?? d.writer}`, patch: d.patch, hash: d.hash });
    }
    return out;
  }

  /** A document the record holds is one the canvas core holds too, whichever call names it first (#1721); looked up once. */
  private async named(doc: unknown): Promise<void> {
    if (typeof doc !== 'string' || this.shownDocs.has(doc) || this.unshown.has(doc)) return;
    if (await this.docRevision(doc)) this.shownDocs.add(doc);
    else this.unshown.add(doc);
  }

  private canvas(): Canvas {
    return (this.canvasCore ??= new Canvas(this.options.root.evidence));
  }

  /** The documents the hub minted for a claim or an ask (`handle`), as the world file names them (`on`, or `for`). */
  private mintedOn(handle: string): string[] {
    const docs = this.worldFile.read().docs;
    return Object.entries(isObj(docs) ? docs : {}).filter(([, d]) => isObj(d) && (d.on === handle || d.for === handle)).map(([id]) => id);
  }

  /**
   * #504's planted hubs: one that puts an agent's figure or film in Needs you, raising an ask for you that names it,
   * and one that takes it as proof, recording a verdict on the claim it was shown on.
   */
  private async plantedFigure(doc: string, rev: number, hash: string): Promise<void> {
    const plant = this.options.plant;
    if (plant !== 'figure-in-needs-you' && plant !== 'figure-feeds-verdict') return;
    const docs = this.worldFile.read().docs;
    const spec = isObj(docs) ? docs[doc] : undefined;
    const on = isObj(spec) ? String(spec.on ?? spec.for ?? '') : '';
    if (!on) return;
    const ts = this.options.now();
    if (plant === 'figure-in-needs-you') {
      const [asked] = (await this.options.record().raw(`SELECT v, data FROM events WHERE kind = 'ask.created' ORDER BY log_pos DESC LIMIT 1`)) as { v: number; data: string }[];
      if (!asked) return;
      const data = { ...(JSON.parse(asked.data) as Obj), question: `Look at doc:${doc} before it goes on` };
      await this.options.events.append(this.options.events.connection('core'), { v: Number(asked.v), id: ulid(ts), kind: 'ask.created', ts, data: data as JsonValue });
    } else if (on.startsWith('claim:')) {
      const id = ulid(ts);
      const commit = '0'.repeat(40);
      await this.options.events.append(this.options.events.connection('core'), {
        v: 1, id, kind: 'verdict.made', ts, subject: on,
        data: { outcome: 'PASS', verdict: `verdict:${id}`, claim: on, reasons: [], requirements: [], smallest: null, points_to: null, commit,
          key: { commit, doc_revisions: [`doc:${doc}@${rev}:${hash}`], check_digests: [], state_digests: [], environment: 'test', tools: [] } } as JsonValue,
      });
    }
  }

  /**
   * The documents an agent drew through deep_show on those the hub minted for a claim or an ask (`handle`), each at
   * its latest revision (#504): a figure or a film explains and never proves, so this list sits in a receipt's
   * explains-never-proves section and beside an opened ask, and never in Needs you or a verdict.
   */
  async explainsOf(handle: string): Promise<{ doc: string; rev: number; hash: string }[]> {
    const minted = new Set(this.mintedOn(handle).map((id) => `doc:${id}`));
    if (!minted.size) return [];
    const rows = (await this.options.record().raw(`SELECT data FROM events WHERE kind = 'doc.patched' ORDER BY log_pos`)) as { data: string | Obj }[];
    const latest = new Map<string, { doc: string; rev: number; hash: string }>();
    for (const { data } of rows) {
      const d = (typeof data === 'string' ? JSON.parse(data) : data) as { doc?: string; rev?: number; hash?: string; writer?: string };
      if (d.writer !== 'agent' || typeof d.doc !== 'string' || !minted.has(d.doc)) continue;
      latest.set(d.doc, { doc: d.doc.slice(4), rev: Number(d.rev), hash: String(d.hash) });
    }
    return [...latest.values()];
  }

  async canvasCall(call: Obj): Promise<Obj> {
    await this.named(call.doc);
    return (await this.canvas().call(await this.canvasWorld(), call)).reply;
  }

  /**
   * A job kind's qualification of one tool by the canvas core (#518): the call, in a world that also holds the
   * `job_tools` it names, the encode tools of the plug-in being installed, each as its host would run it.
   */
  async qualifyTool(call: Obj): Promise<Obj> {
    const { job_tools: tools, ...rest } = call;
    const world = await this.canvasWorld();
    const file = Array.isArray(tools) && tools.length ? { ...world.file, job_tools: tools } : world.file;
    return (await this.canvas().call({ ...world, file }, rest)).reply;
  }

  /**
   * deep_show for a session, or for none (the call binds to no session), or `deep show` from the CLI acting as the
   * session the peer check found, or as you: the writer is the binding's, never the payload's.
   */
  async show(as: { session: string | null } | { you: true }, call: Obj): Promise<Obj> {
    if (typeof call.doc === 'string') this.shownDocs.add(call.doc);
    if (pinsPacks(call.document) || (call.patch !== undefined && JSON.stringify(call.patch).includes('packs'))) this.packsNeeded = true;
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
    // A diagnostic mode of the current revision is a render-back too: the session's own (#411).
    if (typeof call.mode === 'string' && !('document' in call) && !('patch' in call) && !('session' in as && as.session)) {
      return { outcome: 'refused', code: 'no_session', mode: call.mode, issues: [], snapshots: [], drawn: [] };
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
    // In the canvas core's order: the record's order is the one a restart opens the document in (#1721).
    if (presented) await (this.recording = this.recording.catch(() => undefined).then(() => this.recordRevision(as, presented, reply)));
    // A claim the world file defines keeps the canvas core's verdict on its deliverables (#393 AC3, which #806's
    // replay holds the hub to): that verdict is the check the core just ran, and no spec gives the claim a run (#3044).
    const fixture = typeof call.claim === 'string';
    if (call.check === true && typeof reply.result === 'string' && !fixture) {
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
   * deep_query (#411, #1725): a revision's evaluated rows, its summary or the why behind a value, read by the session
   * the call binds to, as deep_show binds; bound to none, the canvas core answers no_session.
   */
  async query(session: string | null, args: Obj): Promise<Obj> {
    const call: Obj = { call: 'deep_query', session };
    for (const [k, v] of Object.entries(args)) if (v !== null && v !== undefined) call[k] = v;
    return this.canvasCall(call);
  }

  /**
   * deep_kinds (#412): the canvas core's listing, words, guides and gallery. It reads and changes nothing, so it needs
   * no session; a refusal is the canvas core's error@2, at its path under the call's arguments.
   */
  async kinds(args: Obj): Promise<Obj> {
    // Asset search (#1731) spans the enabled libraries, which the hub reads; the canvas core holds none.
    if (args.op === 'assets') return this.assets(args);
    this.packsNeeded = true;
    const call: Obj = { call: 'deep_kinds' };
    for (const [k, v] of Object.entries(args)) if (v !== null) call[k] = v;
    const reply = await this.canvasCall(call);
    const e = reply.error;
    if (isObj(e)) throw refuse(String(e.code), `/params/arguments${String(e.path)}`, String(e.remediation), e.actual);
    return reply;
  }

  /**
   * deep_kinds `assets` and deep_job `fetch` (#1731, #3525): one ranked list over the enabled libraries' rows, and a
   * fetch of one row by its library and id, held on your answer, refused naming why, or BLOCKED with one unblock ask.
   */
  async assets(args: Obj): Promise<Obj> {
    const libraries = this.options.libraries();
    if (!libraries) throw refuse('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', args.op === 'fetch' ? 'deep_job' : 'deep_kinds', true);
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
        doc: `doc:${String(p.doc)}`, rev: Number(p.rev), patch: typeof p.patch === 'string' ? p.patch : null, writer: writer.kind,
        achieved: isObj(reply.achieved) ? reply.achieved : { created: {}, updated: count('changed'), deleted: {}, unchanged: count('changed') + count('created') + count('removed') === 0 },
        hash, layer: String(p.layer), thread: writer.kind === 'agent' ? writer.id : null,
      } as JsonValue,
    });
    this.present({ doc: p.doc, rev: p.rev, rect: p.rect, layers: p.layers, session });
    if (writer.kind === 'agent') await this.plantedFigure(String(p.doc), Number(p.rev), hash);
    await this.staleOnRevision(String(p.doc), { rev: Number(p.rev), hash });
  }

  /** The document checks a worktree's spec names (#1723). */
  docChecksOf(worktree: string): Map<string, DocCheck> {
    return docChecksIn(this.options.doneSpec(worktree));
  }
  /** A document's newest recorded revision. */
  async docRevision(doc: string): Promise<Revision | undefined> {
    const [row] = (await this.options.record().raw(`SELECT json_extract(data, '$.rev') AS rev, json_extract(data, '$.hash') AS hash FROM events WHERE kind = 'doc.patched' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [`doc:${doc}`])) as { rev: number; hash: string }[];
    return row ? { rev: Number(row.rev), hash: String(row.hash) } : undefined;
  }
  /** The canvas verdict for a claim holding just this document check, with the revision in its key. */
  async documentCheck(run: { run: string; check: string; claim: string }, spec: DocSpec): Promise<CheckResult & { stdout: string }> {
    const [owner] = (await this.options.record().raw(`SELECT session_id FROM claims WHERE id = ?`, [run.claim.slice(6)])) as { session_id: string | null }[];
    await this.named(spec.doc);
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
  /** A claim let go (#1866): the revisions its checks read are its verdict's, in the record. */
  letGo(claim: string): void { this.docRevisions.delete(claim); }
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
    // #1958: a pack version the store lacks doesn't refuse the document; the canvas core opens it, its instances kept and skipped.
    if (pinsPacks(document)) await libraries.packs.shipped(this.canvas());
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
    const store = this.options.libraries()!.packs;
    const rendered = await renderStill(game.call.document, params.still, this.options.root.evidence, store.all(), store.checks);
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

  /** A revision for the app to draw: its document's newest, and one more an open app takes. */
  private present(revision: Obj): void {
    if (!this.appOpen()) {
      this.untaken = [];
      this.untakenFrom = this.presentations;
    }
    const doc = String(revision.doc);
    this.presented.delete(doc);
    this.presented.set(doc, { n: ++this.presentations, revision });
    if (this.appOpen()) this.untaken.push(revision);
    else this.untakenFrom = this.presentations;
  }

  /**
   * What the app has yet to draw: every revision presented since it last asked; or, as it connects or once it fell
   * behind, the newest of each document it hasn't taken, never the history (#1866).
   */
  drawnBy(context: CallContext): Obj {
    this.appSeen = Date.now();
    const app = context.conn ?? 0;
    const from = this.drawnUpTo.get(app) ?? -1;
    this.drawnUpTo.delete(app);
    this.drawnUpTo.set(app, this.presentations);
    for (const oldest of this.drawnUpTo.keys()) { if (this.drawnUpTo.size <= APPS_KEPT) break; this.drawnUpTo.delete(oldest); }
    if (from === this.presentations) return { presented: [] };
    const presented = from === this.untakenFrom ? this.untaken : [...this.presented.values()].filter((p) => p.n > from).map((p) => p.revision);
    this.untaken = [];
    this.untakenFrom = this.presentations;
    return { presented };
  }
  close(): void { this.canvasCore?.close(); }
}
