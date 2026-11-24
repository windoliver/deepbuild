import type { HubEvents } from './hub-capabilities.js';
import type { SessionStatePort } from './hub-ports.js';

import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';

import { relative, resolve } from 'node:path';

import { type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { citedEvidence } from '@deepbuild/extension-host';
import { openSlicer } from '@deepbuild/reading/slices';
import { type RecordStore } from '@deepbuild/record';
import { type Checkouts } from '@deepbuild/gate';

import type { WorkspaceService } from './workspaces-port.js';

import { retain } from './retention.js';

import { HELD_OUT } from './variants.js';

import { LogReads } from './log-reads.js';

import type { Root } from './paths.js';

import { type Durable } from './vfs.js';
import { refuse, Refused, refusal, type CoreOptions } from './wire.js';

import { type Obj, isObj, isUnder } from "./hub-shared.js";

export interface EvidenceAccessOptions {
 settings: CoreOptions;
 services: {
readonly log: LogReads;
readonly root: Root;
readonly store: EvidenceStore;
readonly durable: Durable;
readonly record: RecordStore;
readonly raw: RecordStore['raw'];
readonly checkouts: Checkouts;
readonly now: () => number;
readonly spaces: WorkspaceService;
 };
 events: Pick<HubEvents, "appendCore">;

state: () => Pick<SessionStatePort, "sessions">;
}

export class EvidenceAccess {
 constructor(private readonly options: EvidenceAccessOptions) {}

  /** evidence/:sha: what the store holds of one file, never its bytes. */
  evidence(params: Obj): Promise<Obj> {
    const sha = typeof params.sha === 'string' && /^[0-9a-f]{64}$/.test(params.sha) ? params.sha : undefined;
    if (!sha) throw new Refused(refusal('pattern', '/params/sha', 'Name the evidence by its SHA-256, in lower-case hex.', params.sha));
    return this.options.services.log.reflecting(async () => {
      const evidence = await this.options.services.store.get(sha);
      if (!evidence) throw new Refused(refusal('not_found', '/params/sha', `The store holds no evidence ${sha}.`, sha));
      if (evidence.sealed) throw new Refused(refusal('denied', '/params/sha', `${sha} is ${evidence.source}, held out from the sessions its check judges: no read by handle opens it.`, sha));
      return { evidence: JSON.parse(JSON.stringify(evidence)) as Obj };
    });
  }

  /** `deep read` and `deep find` for a process that can't open the store itself (#3229): the same slices, from the store the hub holds. */
  async handle(params: Obj): Promise<Obj> {
    const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
    const file = isObj(params.file) && typeof params.file.path === 'string' ? { path: params.file.path, ...(typeof params.file.cwd === 'string' ? { cwd: params.file.cwd } : {}) } : undefined;
    const sha = this.options.settings.plant === 'answers-variant-bytes' ? /^ev:([0-9a-f]{64})$/.exec(String(params.read))?.[1] : undefined;
    if (sha && (await this.options.services.store.get(sha))?.sealed) return { handle: String(params.read), covers: 'the whole file', text: Buffer.from(await this.options.services.store.unseal(sha)).toString('utf8') };
    const slicer = await openSlicer(this.options.services.root.dir, this.options.services.store);
    try {
      return { ...(typeof params.find === 'string' ? await slicer.find(params.find, cursor, undefined, file) : await slicer.read(String(params.read), cursor)) };
    } catch (error) {
      throw new Refused(refusal('not_found', '/params', error instanceof Error ? error.message : String(error), params.find ?? params.read));
    } finally {
      slicer.close();
    }
  }

  /** The peer a store writer is bound to: from the connection's credential, never from what the payload says. */
  private peer(fromCredential: Peer, claimed: unknown, session?: string): Peer {
    if (this.options.settings.plant !== 'origin-from-payload') return fromCredential;
    if (claimed === 'deepbuild') return { role: 'deepbuild', via: 'job' };
    if (claimed === 'you') return { role: 'you', via: 'paste' };
    if (claimed === 'agent' && session) return { role: 'agent', session };
    return fromCredential;
  }

  /** A drafted check's bytes as approved at its definition's lock, kept by digest for the claim's checks to run; a held-out variant's sealed (#3229). */
  async keep(bytes: Uint8Array, source: string, sealed?: true): Promise<string> {
    const put = await this.options.services.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: sealed ? HELD_OUT : 'file', source, redaction: 'unknown', license: { name: 'session', allows: [] }, ...(sealed ? { sealed } : {}) });
    return (await this.stored(put, source)).sha256;
  }

  async stored(put: PutResult, what: string): Promise<Evidence> {
    if (put.status !== 'stored') throw new Refused(refusal('unavailable', '', `The evidence store refused ${what}: ${put.reason}`, what, true));
    this.options.services.durable.point('evidence_rename');
    const ev = put.evidence;
    await this.options.events.appendCore('evidence.stored', {
      sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [],
    }).catch(() => undefined);
    return ev;
  }

  async paste(params: Obj): Promise<Obj> {
    if (typeof params.bytes !== 'string' || !params.bytes) throw new Refused(refusal('required', '/params/bytes', 'Send the pasted image as base64 in bytes.', params.bytes));
    const bytes = new Uint8Array(Buffer.from(params.bytes, 'base64'));
    const declares = params.type === 'png' || params.type === 'jpeg' ? params.type : undefined;
    const writer = this.options.services.store.connect(this.peer({ role: 'you', via: 'paste' }, params.origin));
    const put = await writer.put({ bytes, kind: 'image', source: 'app:paste', redaction: 'unknown', license: { name: 'yours', allows: [] }, ...(declares ? { declares } : {}) });
    return { sha256: (await this.stored(put, 'the pasted image')).sha256 };
  }

  /**
   * deep_evidence: a file in the session's working folder, read only once `..` and every link in its path are
   * resolved and it is still inside; any other path is answered exactly as one that doesn't exist.
   */
  async attach(session: string, args: Obj): Promise<Obj> {
    const folder = realpathSync(this.options.state().sessions.get(session)!.cwd);
    const sent = String(args.path);
    const missing = () => refuse('not_found', '/params/arguments/path', `No file ${sent} in this session's working folder; name a file inside it.`, sent);
    let path = resolve(folder, sent);
    if (this.options.settings.plant !== 'evidence-checks-path-first') path = await realpath(path).catch(() => '');
    if (!path || !isUnder(path, folder)) throw missing();
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw missing();
    }
    const claimed = typeof args.origin === 'string' ? args.origin : undefined;
    const writer = this.options.services.store.connect(this.peer({ role: 'agent', session }, claimed, session));
    const put = await writer.put({
      bytes: new Uint8Array(bytes), kind: typeof args.kind === 'string' && args.kind ? args.kind : 'file', source: relative(folder, path),
      redaction: 'unknown', license: { name: 'session', allows: [] }, ...(claimed && ['deepbuild', 'you', 'agent'].includes(claimed) ? { origin: claimed as Origin } : {}),
    });
    return { sha256: (await this.stored(put, relative(folder, path))).sha256 };
  }

  // ---- Spool, retention and the test load.

  /** The retention pass (retention.ts). */
  async retain(): Promise<void> {
    await retain({
      raw: this.options.services.raw, store: this.options.services.store, checkouts: this.options.services.checkouts, cited: async () => new Set([...await citedEvidence(this.options.services.record, this.options.services.now()), ...await this.options.services.spaces.pinned()]), keepNothing: this.options.settings.plant === 'empty-cited',
      removed: (sha256) => this.options.events.appendCore('evidence.removed', { sha256 }),
    });
  }

}
