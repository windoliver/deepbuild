// A check's held-out variants, kept from the sessions they are held from (#3229; design: Held-out variants). Their files
// are sealed in the evidence store under a key that rests in the OS secret store, unsealed only into the checkout of
// their own run, and gone from it once that run ends. The guard is a first refusal and the record is the proof: a
// recorded call of a session working on a task, or of a session one of them started, that names a variant's digest, or a
// path in a checkout while a variant lies there, spends that variant for that task (variant.spent). The mark is the
// task's, never a session's, nothing takes it back, and a spent variant's runs count neither way for the task's claims.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Sealer } from '@deepbuild/evidence';
import type { SecretStore } from '@deepbuild/extension-host';
import { hubSecrets } from './held.js';
import { derivedId, ulidTime, type Draft, type HookMeta } from './wire.js';

type Obj = Record<string, unknown>;

/** The evidence kind of a variant's files and of its runs' output: both sealed, and never searched. */
export const HELD_OUT = 'held-out';
/** Where the key rests in the OS secret store, as #1606 keeps a channel's token. */
const KEY = 'deepbuild/held-out/key';
const NONCE = 12;
const TAG = 16;
/** How many ended runs' checkouts are kept for a call that reaches the hub late, from deep-hook's spool. */
const LAIN = 1000;

/**
 * The sealer the store keeps held-out variants with: AES-256-GCM, its nonce the bytes' own MAC, so the same bytes seal
 * alike and a check's key still equals another session's (#1018). With no OS secret store (a hub on a root of its own,
 * a test's home) the key lives in this process alone: a variant sealed by an earlier hub then doesn't open, and its run
 * is missing, never passed.
 */
export const variantSealer = (root: string): Sealer => sealerIn(hubSecrets(root));
/** The same, over a secret store given. */
export function sealerIn(store: SecretStore | undefined): Sealer {
  let held: Promise<{ seal: Buffer; nonce: Buffer }> | undefined;
  const read = async (): Promise<{ seal: Buffer; nonce: Buffer }> => {
    let hex = await store?.get(KEY);
    if (hex === undefined) {
      hex = randomBytes(32).toString('hex');
      await store?.set(KEY, hex);
    }
    const of = (use: string): Buffer => Buffer.from(hkdfSync('sha256', Buffer.from(hex, 'hex'), '', `deepbuild held-out ${use}`, 32));
    return { seal: of('seal'), nonce: of('nonce') };
  };
  // A secret store that didn't answer is asked again by the next.
  const keys = (): Promise<{ seal: Buffer; nonce: Buffer }> => (held ??= read().catch((error: unknown) => { held = undefined; throw error; }));
  return {
    async seal(bytes) {
      const k = await keys();
      const nonce = createHmac('sha256', k.nonce).update(bytes).digest().subarray(0, NONCE);
      const cipher = createCipheriv('aes-256-gcm', k.seal, nonce);
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    async unseal(sealed) {
      const k = await keys();
      const bytes = Buffer.from(sealed);
      const open = createDecipheriv('aes-256-gcm', k.seal, bytes.subarray(0, NONCE));
      open.setAuthTag(bytes.subarray(NONCE, NONCE + TAG));
      try {
        return Buffer.concat([open.update(bytes.subarray(NONCE + TAG)), open.final()]);
      } catch {
        throw Error('it was sealed under a key this hub no longer holds');
      }
    },
  };
}

/** One held-out variant of a task's check: its number there and its files' digests, which are what names it. */
export interface Variant { task: string; check: string; n: number; digests: string[] }
/** The call that spent a variant, and its session. */
export interface Spent { n: number; check: string; call: string; session: string }
/** A variant's files in a checkout: from when, and until when once its run ended. */
interface Lying { v: Variant; dir: string; from: number; to?: number }

/** What a variant is named by across definitions and runs: its files' digests, in order. */
export const digestsOf = (files: Record<string, string>): string[] => Object.values(files).sort();
const keyOf = (task: string, digests: readonly string[]): string => `${task}\0${digests.join(' ')}`;

interface VariantsOptions {
  /** The hub's root: its checkouts are `<root>/checkouts`. */
  root: string;
  now: () => number;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  append(session: string, agent: string, input: { v: number; id: string; kind: string; ts: number; data: Obj }): Promise<void>;
  /** A task's claims are judged again: one of its variants was just spent. */
  spent(task: string): Promise<void>;
}

/** Every text a value holds, its keys left out. */
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) texts(x, out);
  return out;
}
/** A call as it is matched: every text of it in lower case, with the quoting a shell drops taken out. */
const said = (call: readonly unknown[]): string => texts(call).join('\n').toLowerCase().replace(/["'\\]/g, '');
/** A digest as a call spells it: whole, split as the store splits it (`ab/cdef…`), or the start of one that a glob completes, of at least this many digits. */
const START = 8;
const SPELLED = /[0-9a-f]{2}\/?[0-9a-f]{6,}/g;

export class Variants {
  /** The variants of definitions, under each file's digest, found by the digest's start. */
  private readonly kept = new Map<string, { digest: string; variants: Variant[] }[]>();
  /** The variants that lie, or lay, in a checkout, by the run they lie there for. */
  private readonly lying = new Map<string, Lying>();
  /** Each spent variant, by its task and digests, with the call that spent it. */
  private readonly marks = new Map<string, Spent>();
  constructor(private readonly o: VariantsOptions) {}

  /** What the record holds: each locked definition's variants, the ones a call spent, and those that lay in a checkout as the last hub ended. */
  async open(left: readonly { run: string; variant: Variant; dir: string }[]): Promise<void> {
    for (const { run, variant, dir } of left) { this.lies(run, variant, dir, ulidTime(run.slice(4))); this.gone(run); }
    for (const row of (await this.o.raw(`SELECT task_ref, requirements FROM definitions WHERE state IN ('locked', 'revised') AND instr(requirements, '"held_out"') > 0`)) as { task_ref: string; requirements: string }[]) {
      this.keeps(row.task_ref, JSON.parse(row.requirements) as Obj[]);
    }
    for (const row of (await this.o.raw(`SELECT session_id, data FROM events WHERE kind = 'variant.spent' ORDER BY log_pos`)) as { session_id: string | null; data: string }[]) {
      const d = JSON.parse(row.data) as { task_ref: string; check: string; variant: number; digests: string[]; call: string };
      this.mark(d.task_ref, d.digests, { n: d.variant, check: d.check, call: d.call, session: row.session_id ?? 'unknown' });
    }
  }
  /** A definition's held-out variants, from the moment the store keeps them. */
  keeps(task: string, requirements: readonly object[]): void {
    for (const r of requirements as readonly { check?: string | null; held_out?: { files: Record<string, string> }[] }[]) {
      if (!r.check) continue;
      for (const [i, { files }] of (r.held_out ?? []).entries()) {
        const v: Variant = { task, check: r.check, n: i + 1, digests: digestsOf(files) };
        for (const digest of v.digests) {
          const start = digest.slice(0, START);
          const near = this.kept.get(start) ?? this.kept.set(start, []).get(start)!;
          let at = near.find((k) => k.digest === digest);
          if (!at) near.push(at = { digest, variants: [] });
          if (!at.variants.some((k) => k.check === v.check && keyOf(k.task, k.digests) === keyOf(task, v.digests))) at.variants.push(v);
        }
      }
    }
  }
  /** A variant's files lie in a checkout from now, or lay there from `from`. */
  lies(run: string, v: Variant, dir: string, from = this.o.now()): void {
    this.lying.set(run, { v, dir, from });
    if (this.lying.size > LAIN) for (const [old, l] of this.lying) if (l.to !== undefined) { this.lying.delete(old); break; }
  }
  /** The run ended, and its variant's files are gone from the checkout. */
  gone(run: string): void {
    const l = this.lying.get(run);
    if (l) l.to = this.o.now();
  }
  /** The call that spent a task's variant, by its files' digests; undefined while none has. */
  spent(task: string, files: Record<string, string>): Spent | undefined {
    return this.marks.get(keyOf(task, digestsOf(files)));
  }

  /**
   * A call the record takes: each variant it names by digest, or whose checkout it names while the variant lies there,
   * is spent for that variant's task when the call's session works on it, or descends from one that does. Whoever sent
   * its hook and whatever a guard said of it: one that was denied named the variant all the same, and a mark only ever
   * lowers a verdict.
   */
  async called(meta: HookMeta, drafts: readonly Draft[]): Promise<void> {
    if (!this.kept.size) return;
    const call = drafts.find((d) => d.kind === 'tool.before' || d.kind === 'tool.after');
    if (!call || !meta.session) return;
    const text = said([call.data, meta.call?.input]);
    const reached = new Map<string, { v: Variant; named: 'digest' | 'checkout' }>();
    const add = (v: Variant, named: 'digest' | 'checkout'): void => { reached.set(keyOf(v.task, v.digests), { v, named }); };
    for (const l of this.lying.values()) if (call.ts >= l.from && (l.to === undefined || call.ts <= l.to) && this.inside(text, l.dir)) add(l.v, 'checkout');
    for (const [run] of text.matchAll(SPELLED)) {
      const hex = run.replace('/', '');
      for (const { digest, variants } of this.kept.get(hex.slice(0, START)) ?? []) if (digest.startsWith(hex) || hex.startsWith(digest)) for (const v of variants) add(v, 'digest');
    }
    for (const [key, { v, named }] of reached) {
      if (this.marks.has(key) || !(await this.worksOn(meta.session, v.task))) continue;
      const id = meta.toolUse ?? call.id;
      this.mark(v.task, v.digests, { n: v.n, check: v.check, call: id, session: meta.session });
      await this.o.append(meta.session, meta.agent, {
        v: 1, id: derivedId(call.ts, `${call.id}:${key}:spent`), kind: 'variant.spent', ts: this.o.now(),
        data: { task_ref: v.task, check: v.check, variant: v.n, digests: v.digests, call: id, named },
      });
      await this.o.spent(v.task);
    }
  }
  private mark(task: string, digests: readonly string[], by: Spent): void {
    const key = keyOf(task, digests);
    if (!this.marks.has(key)) this.marks.set(key, by);
  }
  /** Whether a call names a path in this checkout: its own folder's name, or the checkouts' with no other folder named in it. */
  private inside(text: string, dir: string): boolean {
    if (text.includes(basename(dir).toLowerCase())) return true;
    for (const root of [join(this.o.root, 'checkouts').toLowerCase(), '.deepbuild/checkouts']) {
      for (let at = text.indexOf(root); at >= 0; at = text.indexOf(root, at + 1)) {
        const next = /^\/*([^\s/;|&)]*)/.exec(text.slice(at + root.length))![1]!;
        if (!next || /[*?[{$]/.test(next)) return true;
      }
    }
    return false;
  }
  /** Whether a session works on a task, or a session it descends from does: by its thread, a claim or a prompt that named it. */
  private async worksOn(session: string, task: string): Promise<boolean> {
    return (await this.o.raw(`WITH RECURSIVE up(id) AS (SELECT ? UNION SELECT s.parent_id FROM up JOIN sessions s ON s.id = up.id WHERE s.parent_id IS NOT NULL)
      SELECT 1 FROM up WHERE EXISTS (SELECT 1 FROM tasks t LEFT JOIN sessions s ON s.id = up.id WHERE t.task_ref = ? AND t.thread IN (up.id, s.thread_id))
        OR EXISTS (SELECT 1 FROM claims c WHERE c.subject_ref = ? AND c.session_id = up.id)
        OR EXISTS (SELECT 1 FROM events e, json_each(e.data, '$.tasks') t WHERE e.session_id = up.id AND e.kind = 'user.ask' AND t.value = ?) LIMIT 1`, [session, task, task, task])).length > 0;
  }
}
