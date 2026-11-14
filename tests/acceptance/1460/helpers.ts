// Test-side tools for #1460 (README). The replica is the real `deep-drive`, driven over its stdin as the hub's
// deep_drive tool drives it, built from the checkout (a plant is a Cargo feature of deep-app) and copied out of the
// target folder under its own name. The real app is the real `deep-app` on a real hub, read from outside its process
// by #1459's probe, as an assistive client reads it; `deep open` is the checkout's built CLI. The judges each
// criterion's failure message comes from are here too. Nothing here stands in for the app, the replica or the hub.
//
// Reused by import: #1459's replica driver (`Drive`), snapshot shape and real-app reader (`RealApp`, probe.swift); #16's
// temp folders and PID cleanup, through them.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was started
// with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Drive, flat, REPO, type SNode, type Snapshot } from '../1459/helpers.ts';

export { Drive, flat, REPO, type SNode, type Snapshot };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const RECORD = join(SUITE, 'fixtures', 'record.events.jsonl');
export const MIN = 60_000;
/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs). */
const FLICKS = 705_600_000;

/** The criteria, by `#1460.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  doors: '#1460.2a9c7aec',
  walk: '#1460.d705eebf',
  unarmed: '#1460.e8743dab',
  unresolved: '#1460.e6caebd8',
  drive: '#1460.b224c18f',
  lint: '#1460.939ea70f',
  receipt: '#1460.4b8e8988',
  terminal: '#1460.dea93c6a',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

// ---- The fixture record (README, The fixture): seven sessions, one open ask and one answered from the card, one notice.

const session = (n: number): string => `1460e55a-7c1d-4f3e-9b2a-00000000000${n}`;
export const SESSIONS = {
  A: { id: session(1), title: 'Cart totals' },
  B: { id: session(2), title: 'Release notes' },
  C: { id: session(3), title: 'Search index' },
  D: { id: session(4), title: 'Docs refresh' },
  E: { id: session(5), title: 'Billing page' },
  F: { id: session(6), title: 'Login flow' },
  G: { id: session(7), title: 'Header colours' },
} as const;
export const OPEN_ASK = { handle: 'ask:01KB1460AK0000000000000001', question: 'Which header colour on the login page?' } as const;
export const CLOSED_ASK = { handle: 'ask:01KB1460AK0000000000000002', question: 'Which font for the printed receipt?', answer: 'Serif receipt' } as const;

// ---- Addresses (README, Pinned 1): a record ID or a registered name, never a position.

export const sessionAt = (id: string): string => `session/${id}`;
export const askAt = (handle: string): string => `ask/${handle.slice('ask:'.length)}`;
/** Any address: its kind, then what names it, with an optional parameter. */
export const ADDRESS = /^(ask|session|project|page)\/\S+$/;
/** A claim's page (README, Pinned 9): its session's page at the claim, the claim's ID its parameter. */
export const claimAt = (session: string, claim: string): string => `session/${session}/${claim.replace(/^claim:/, '')}`;
/** The receipt part of a verdict line (README, Pinned 9): that address with the session's ID cut to its first 8 characters. */
export const receiptOf = (session: string, claim: string): string => `session/${session.slice(0, 8)}/${claim.replace(/^claim:/, '')}`;
export const RECEIPT = /^session\/[0-9a-f]{8}\/[0-9A-HJKMNP-TV-Z]{26}$/;

// ---- Builds (README, How to run). #1459's and #1172's build environment, so one target folder serves the suites.

/** Cargo features of deep-app this suite builds (README, Pinned 11), in no shipped build. */
export type Plant = 'plant-row-skips-open' | 'plant-open-writes-event';
const BIN = join(tmpdir(), `dd1460-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
const cargo = (args: string[]): Promise<{ code: number; stderr: string }> => new Promise((resolve) => {
  execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stderr: String(stderr) + (error && typeof error.code !== 'number' ? ` ${error.message}` : '') });
  });
});
async function build(args: string[], plant?: Plant): Promise<void> {
  const r = await cargo(args);
  if (r.code === 0) return;
  if (plant && new RegExp(`feature[^\\n]*${plant}|${plant}[^\\n]*feature`).test(r.stderr)) {
    throw Error(`crates/deep-app/Cargo.toml has no feature ${plant} (README, Pinned 11), so this wrong program can't be built: ${r.stderr.trim().slice(0, 300)}`);
  }
  blocked(`cargo build ${args.join(' ')} failed: ${r.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || r.stderr.slice(-600)}`);
}
/** `name` from `pkg`, plain or with a plant, copied out of the target folder; a plant's build is followed by the plain one. */
function binary(pkg: string, name: string, feature: (plant: Plant) => string, plant?: Plant): Promise<string> {
  const key = `${name}-${plant ?? 'plain'}`;
  let made = built.get(key);
  if (!made) {
    made = (async () => {
      mkdirSync(BIN, { recursive: true });
      if (plant) await binary(pkg, name, feature);
      await build(['-p', pkg, '--bin', name, ...(plant ? ['--features', feature(plant)] : [])], plant);
      const out = join(BIN, key);
      copyFileSync(target(name), out);
      if (plant) await build(['-p', pkg, '--bin', name]);
      return out;
    })();
    built.set(key, made);
  }
  return made;
}
export const driveBinary = (plant?: Plant): Promise<string> => binary('deep-replica', 'deep-drive', (p) => `deep-app/${p}`, plant);
export const appBinary = (plant?: Plant): Promise<string> => binary('deep-app', 'deep-app', (p) => p, plant);
/** What `deep setup` installs as the hooks' program, where #83's world runs it from. */
export const hookBinary = (): Promise<void> => build(['-p', 'deep-hook', '--bin', 'deep-hook']);

// ---- Reading a snapshot (README, Pinned 2): the page region is one node whose `id` is the address it shows.

/** The nodes of a snapshot whose `id` is an address: the page region, one per window. */
export const pageNodes = (s: Snapshot): SNode[] => flat(s.tree).filter((n) => typeof n.id === 'string' && ADDRESS.test(n.id));
const said = (n: SNode): string => `${n.role} ${JSON.stringify(n.name).slice(0, 100)}`;
/** The words a subtree holds: every node's name and value, in order. */
export const words = (n: SNode): string[] => flat(n).flatMap((x) => [x.name, typeof x.value === 'string' ? x.value : null]).filter((w): w is string => !!w);
/** The first place two subtrees differ on role, name, value, id, bounds or children; null when equal. */
export function difference(a: SNode, b: SNode, at = 'the page'): string | null {
  for (const key of ['role', 'name', 'value', 'id', 'bounds'] as const) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return `${at} (${said(a)}) differs in ${key}: ${JSON.stringify(a[key] ?? null)} vs ${JSON.stringify(b[key] ?? null)}`;
  }
  if (a.children.length !== b.children.length) return `${at} (${said(a)}) has ${a.children.length} children and ${b.children.length}`;
  for (let i = 0; i < a.children.length; i++) {
    const d = difference(a.children[i]!, b.children[i]!, `${at} › ${i}`);
    if (d) return d;
  }
  return null;
}

/** A replica, as an agent drives it: each call's reply, or the failure it gave, in words a test reports. */
export class Replica {
  private constructor(readonly drive: Drive) {}
  /** A fresh `deep-drive` of `bin`, launched on the fixture with Needs you showing. */
  static async on(bin: string, fixture = RECORD): Promise<Replica> {
    const drive = await Drive.start(bin);
    const r = new Replica(drive);
    const launched = await drive.call({ call: 'launch', launch: { from: 'fixture', fixture, center: 'deepbuild/needs-you' } });
    if (launched.ok !== true) blocked(`the replica didn't launch on the fixture: ${JSON.stringify(launched).slice(0, 400)}`);
    return r;
  }
  /** One call; its reply, or a thrown failure naming `what` and the replica's error. */
  async must(what: string, call: Record<string, unknown>): Promise<Record<string, any>> {
    const reply = await this.drive.call(call);
    if (reply.ok !== true) throw Error(`${what}: ${JSON.stringify(reply.error ?? reply).slice(0, 400)}`);
    return reply;
  }
  open(address: string): Promise<Record<string, any>> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  link(url: string): Promise<Record<string, any>> { return this.must(`deep_drive's open of the link ${url}`, { call: 'open', open: { url } }); }
  press(keys: string): Promise<Record<string, any>> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  click(id: string, what = `a click on {id: "${id}"}`): Promise<Record<string, any>> { return this.must(what, { call: 'act', locator: { id }, act: { kind: 'click' } }); }
  type(text: string): Promise<Record<string, any>> { return this.must(`typing "${text}"`, { call: 'act', act: { kind: 'type', text } }); }
  feed(session: string, event: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  /** A click on the replica's `n`th notification, as the platform's click handler would make it (README, Pinned 3). */
  async notification(n: number): Promise<Record<string, any>> {
    return (await this.must(`a click on notification ${n}`, { call: 'notification', notification: { click: n } })).notification as Record<string, any>;
  }
  async window(): Promise<Snapshot> { return (await this.must('see', { call: 'see' })).snapshot as Snapshot; }
  /** The address the window shows, read from its page node; null, with why, when it has none or several. */
  async address(): Promise<{ address: string | null; why: string }> {
    const pages = pageNodes(await this.window());
    if (pages.length === 1) return { address: pages[0]!.id as string, why: '' };
    return { address: null, why: pages.length ? `the window has ${pages.length} page nodes: ${pages.map((p) => String(p.id)).join(', ')}` : 'no node of the window has an address for its id (README, Pinned 2)' };
  }
  /** The page `address` shows: `see` scoped to its node. */
  async page(address: string): Promise<SNode> {
    return (await this.must(`see scoped to the page {id: "${address}"}`, { call: 'see', locator: { id: address }, see: { scope: 'locator' } })).snapshot.tree as SNode;
  }
  /** The keyboard's holder, as the snapshot says it (#1459's `focus`). */
  async focus(): Promise<unknown> { return (await this.must('see', { call: 'see' })).snapshot.focus; }
  stop(): Promise<void> { return this.drive.stop(); }
}

/** What's wrong with the window's address now: it must be `want`. `after` says what led here. */
export async function addressFailures(r: Replica, want: string, after: string): Promise<string[]> {
  const { address, why } = await r.address();
  if (address === want) return [];
  return [address === null ? `after ${after} the window shows no one address (${why}); it should show ${want}` : `after ${after} the window shows ${address}, not ${want}`];
}

// ---- The doors (AC1, AC5). Each runs in a fresh replica: session B's page opened by deep_drive's open, then session
// A's by the door, then ⌘[ back to B and ⌘] forward to A. A route that skips `open` puts nothing in back and forward.

export type Door = 'row click' | '⌘K' | 'notification click' | 'deepbuild:// link' | 'deep_drive open';
export const DOORS: readonly Door[] = ['row click', '⌘K', 'notification click', 'deepbuild:// link', 'deep_drive open'];
export interface Landed { door: Door; failures: string[]; page: SNode | null }

async function through(r: Replica, door: Door, to: { id: string; title: string }): Promise<void> {
  switch (door) {
    case 'row click': await r.click(`session:${to.id}`, `the row click on session ${to.id}'s row`); return;
    case '⌘K': await r.press('cmd-k'); await r.type(to.title); await r.press('enter'); return;
    case 'notification click': {
      // A tenth of a second of the replica's clock, so the notice the fixture holds has posted (the asks' wait a second).
      await r.must('waiting a tenth of a second', { call: 'wait_for', wait_for: { t: FLICKS / 10 } });
      const clicked = await r.notification(0);
      if (clicked?.session !== to.id || clicked?.ask) throw Error(`the replica's first notification isn't session ${to.id}'s notice: ${JSON.stringify(clicked)}`);
      return;
    }
    case 'deepbuild:// link': await r.link(`deepbuild://${sessionAt(to.id)}`); return;
    case 'deep_drive open': await r.open(sessionAt(to.id)); return;
  }
}

/** Session A opened through `door` in a fresh replica of `bin`: what's wrong, each failure naming the door, and A's page. */
export async function land(bin: string, door: Door): Promise<Landed> {
  const { A, B } = SESSIONS;
  const r = await Replica.on(bin);
  const failures: string[] = [];
  let page: SNode | null = null;
  try {
    await r.open(sessionAt(B.id));
    await through(r, door, A);
    const shown = await addressFailures(r, sessionAt(A.id), `the ${door} for session A`);
    if (shown.length) return { door, failures: shown, page };
    page = await r.page(sessionAt(A.id));
    await r.press('cmd-[');
    if ((await addressFailures(r, sessionAt(B.id), `the ${door} for session A, then ⌘[`)).length) {
      failures.push(`the ${door} opened ${sessionAt(A.id)} without open: ⌘[ from it doesn't go back to ${sessionAt(B.id)}, which open opened before it (${(await r.address()).address ?? 'no address'})`);
    } else {
      await r.press('cmd-]');
      for (const f of await addressFailures(r, sessionAt(A.id), `the ${door} for session A, ⌘[ and ⌘]`)) failures.push(`the ${door} opened ${sessionAt(A.id)} without open: ${f}`);
    }
  } catch (error) {
    failures.push(`the ${door} for session A: ${(error as Error).message}`);
  } finally {
    await r.stop();
  }
  return { door, failures, page };
}

// ---- The real app's record (AC3): what an open wrote.

export interface Ev { id: string; kind: string; log_pos: number; writer: string; subject?: string; session?: string; data?: Record<string, unknown> }
/** The events after `before` that an open on `handle` could have written: the app's or the CLI's, or any about the ask. */
export function writtenByOpen(events: readonly Ev[], before: number, handle: string): string[] {
  return events
    .filter((e) => e.log_pos > before)
    .filter((e) => e.writer === 'app' || e.writer === 'cli' || e.subject === handle || e.data?.ask === handle)
    .map((e) => `${e.kind} (log_pos ${e.log_pos}, written by ${e.writer}${e.subject ? `, about ${e.subject}` : ''})`);
}

// ---- The receipt (AC7, README Pinned 9): the line's last part.

/** What's wrong with a verdict line's receipt part: it must be the address of `claim`'s page in `session`. */
export function receiptFailures(line: string, session: string, claim: string): string[] {
  const parts = line.split(' · ');
  const last = parts[parts.length - 1] ?? '';
  const want = receiptOf(session, claim);
  if (last === want) return [];
  if (/^[A-Za-z]+$/.test(last)) return [`the line ${JSON.stringify(line)} ends in the bare word "${last}", not the address of the claim's page (${want}) that deep open takes`];
  if (RECEIPT.test(last)) return [`the line's receipt part ${last} is an address of the pinned form but not ${want}, the page of ${claim}`];
  return [`the line ${JSON.stringify(line)} ends in ${JSON.stringify(last)}, not the address of the claim's page (${want})`];
}
