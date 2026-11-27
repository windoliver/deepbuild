// What #1853's acceptance tests share (README): the hub's extension host composed as the hub composes it (the record,
// the supervisor, project trust, the evidence store), with the asks core the issue wires in; the caller package that
// makes the calls a test names and reports each result; and the walk of every published method, from #348's walk
// package holding every method's grant. #348's helpers (temp folders, the env scrub, the package stamp, the probe
// report) are imported unchanged. Nothing here stands in for the host: every result comes from a sandboxed package's
// real call through it.
import { createHash } from 'node:crypto';
import { cpSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { ApiMethod, ExtensionHost, Plant } from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { extensionApi } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { DAY, host, pkg as pkg348, report, stamp, tempDir, YOU } from '../348/helpers.ts';

export { DAY, tempDir };
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** The host's own error for a published method it has no case for (packages/extension-host/src/host.ts). */
export const NOT_WIRED = "isn't wired into this host yet";

/** Each criterion's ID, as the proof scripts compute it from the issue's checkbox text. */
export const AC1 = '#1853.01b6e40d';
export const AC2 = '#1853.0137571d';
export const AC3 = '#1853.873fd8fa';
export const AC4 = '#1853.de6b19fd';
export const AC5 = '#1853.f5e2722b';

export interface World { home: string; record: RecordStore; asks: Asks; evidence: EvidenceStore; events(kind: string): Promise<Event[]> }
const hosts: ExtensionHost[] = [];
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const c of closers.splice(0)) await c().catch(() => undefined);
});

/** A world and its extension host: core.ts's options (record, supervisor, trust, home, release, evidence) plus the asks core. */
export async function openHost(plant?: string): Promise<{ w: World; h: ExtensionHost }> {
  const dir = tempDir('world1853');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: Date.now });
  closers.push(async () => { await sup.close(); await record.close(); });
  const { openExtensionHost, openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  const home = join(dir, 'deepbuild');
  const h = await openExtensionHost({ record, supervisor: sup, trust, home, release: [], now: Date.now, asks, evidence, ...(plant ? { plant: plant as Plant } : {}) });
  hosts.push(h);
  await h.ready();
  const events = async (kind: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all.filter((e) => e.kind === kind);
  };
  return { w: { home, record, asks, evidence, events }, h };
}

/** Installs, checks and loads a package folder; it must run in the sandbox, as every package outside the release does. */
async function installAndLoad(h: ExtensionHost, from: string, grant?: Record<string, unknown>, approve?: string): Promise<void> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  if (approve) await h.approve(YOU, p.id, 'run_as_you');
  expect((await h.check(p)).passed, 'the test package passes its conformance').toBe(true);
  const load = await h.load(p);
  expect(load.status === 'loaded' && load.place, `the test package runs in the sandbox: ${JSON.stringify(load)}`).toBe('sandbox');
}

export interface Seen { method: string; outcome: 'ok' | 'error' | 'missing' | 'timeout'; value?: unknown; error: string | null }

/** The caller package (fixtures/caller, id test/caller) makes these calls once, through the host, and reports each. */
export async function callAs(h: ExtensionHost, calls: { method: string; args: unknown[] }[]): Promise<Seen[]> {
  const dir = tempDir('pkg-caller');
  cpSync(join(FIXTURES, 'caller'), dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.fixture')) renameSync(join(dir, f), join(dir, f.slice(0, -'.fixture'.length)));
  writeFileSync(join(dir, 'calls.json'), JSON.stringify(calls));
  await stamp(dir);
  await installAndLoad(h, dir);
  return (await report<{ calls: Seen[] }>(h, 'ext.caller.report')).calls;
}

/** A choice ask as ask.created@1 data, every field given. */
export function choiceAsk(question: string): Record<string, unknown> {
  return {
    kind: 'choice', question,
    options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
    recommended: 'files', deadline: Date.now() + 2 * DAY, fallback: 'you', default: 'files', provisional: false, owner: 'you',
    key: sha256(question), pinned_to: { kind: 'evidence', ref: sha256(`pinned ${question}`) },
  };
}

// ---- The walk: #348's walk package (it calls every method methods.json lists, each once, 3 s each), here holding
// every grant a method needs: each access word, a notices block, every record kind, a host, and run-as-you approved.
const PREVIEW = extensionApi().filter((m) => m.stability === 'preview').map((m) => m.method);
export async function walk(schema: readonly ApiMethod[], plant?: string): Promise<Seen[]> {
  const { h } = await openHost(plant);
  const manifest = {
    access: { words: ['record', 'files', 'hosts', 'agent', 'run_as_you', 'canvas'] },
    notices: ['ext.walk.ping'],
    requires: { preview: [...PREVIEW, ...schema.map((m) => m.method).filter((m) => !PREVIEW.includes(m) && m.startsWith('deep.planted.'))] },
  };
  const from = await pkg348('walk', { manifest, files: { 'methods.json': JSON.stringify(schema) } });
  await installAndLoad(h, from, { record: ['*'], hosts: [{ host: '127.0.0.1:9', quota: { calls: 1, per_ms: 3_600_000 } }] }, 'run_as_you');
  return (await report<{ calls: Seen[] }>(h, 'ext.walk.report')).calls;
}

/**
 * The criterion's judge of one walk: every method the schema lists was called and answered (a result or a refusal of
 * its arguments) without the host's not-wired error, a refusal of a grant the walk holds, or no answer in time.
 */
export function walkProblems(schema: readonly ApiMethod[], calls: readonly Seen[]): string[] {
  const problems: string[] = [];
  for (const m of schema) {
    const call = calls.find((c) => c.method === m.method);
    const error = call?.error ?? '';
    if (!call || call.outcome === 'missing') problems.push(`${m.method} wasn't called: the package's deep has no such method`);
    else if (call.outcome === 'timeout') problems.push(`${m.method} didn't answer within the walk's 3 s`);
    else if (error.includes(NOT_WIRED)) problems.push(`${m.method}: ${error}`);
    else if (/needs the grant|preview_unrequested/.test(error)) problems.push(`${m.method} was refused a grant the walk holds: ${error}`);
  }
  return problems;
}
