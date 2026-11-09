// Test-side tools for the #1546 acceptance tests (README: The surface): the fixture record with a quiet session, the
// replica launched in the mode that draws only when GPUI says the window is dirty, the record events, clock steps,
// hovers and resizes a seeded journey is made of, and the `frames` report its `close` answers. Nothing here stands in for
// the replica: every frame count, comparison, finding and claim comes from the `deep-drive` binary. The binary, its
// temporary homes and its process handling are #124's (../124/helpers.ts), reused by import; every process is stopped by
// its PID, nothing by name or port.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect } from 'vitest';
import { Drive, FLICKS_PER_SECOND, REPO, nodesOf, type Node, type Obj } from '../124/helpers.ts';

export { Drive, REPO, nodesOf, type Node, type Obj };
export { buildDrive, cleanup, requireMacos } from '../124/helpers.ts';

export const HERE = join(REPO, 'tests', 'acceptance', '1546');
/** The record every test launches on (README: The fixture): three sessions, one gone quiet 90 s before the clock's now. */
export const FIXTURE = join(HERE, 'fixtures', 'quiet.events.jsonl');

// ---------------------------------------------------------------------------------------------------
// The clock. A replica's `t` is flicks since its launch; one frame of its clock is a 60th of a second (#124).

export const FLICKS = FLICKS_PER_SECOND; // 705,600,000
export const FRAME = FLICKS / 60; // 11,760,000
/** The views' clock at launch, from a fixture: deep-replica's NOW (crates/deep-replica/src/lib.rs). */
export const NOW = 1_800_000_000_000;
const MS = FLICKS / 1000; // 705,600 flicks a millisecond
/** The quiet session was last seen 90 s before NOW (the fixture's tool.after), so its row reads "1 min" at launch. */
export const QUIET_FOR_MS = 90_000;
/** The replica's `t` at which the quiet row's age reaches `minutes` whole minutes: 30 s, 90 s, 150 s for 2, 3, 4. */
export const minuteAt = (minutes: number): number => (minutes * 60_000 - QUIET_FOR_MS) * MS;

export const SESSION = {
  quiet: '01KBQT5Q8M0000000000000001',
  asks: '01KBAS5K8M0000000000000002',
  reads: '01KBRD5R8M0000000000000003',
} as const;
/** The fixture's two open asks, each a Needs you row named by its question. */
export const FIXTURE_ASKS = ['Which header colour for the 1546 fixture?', 'Keep the 1546 store on SQLite or plain files?'] as const;

// ---------------------------------------------------------------------------------------------------
// The wrong programs (README: The planted programs). Each is read only in a build with the env-plants feature (#1408).

export const PLANT = {
  /** DEEP_HUB_PLANT: the app's views read the record from the reader's thread-local in render, with no notify. */
  readsThreadLocal: 'record-in-thread-local',
  /** DEEP_HUB_PLANT: an age a view shows sets no next tick: the timer removed. */
  noAgeTimer: 'no-age-timer',
  /** DEEP_DRIVE_PLANT: the replica notifies the window's root before every frame it asks GPUI for. */
  everyStep: 'notifies-every-step',
} as const;

export const CLAIMS = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const;

// ---------------------------------------------------------------------------------------------------
// One replica in the mode, and its steps. Every call after `launch` is one step, numbered from 1, as `close`'s
// `journey.steps` names them ("step N: <call>"); `close` is no step.

export interface Step { step: number; call: string; frames: number; drawn: number; equal: boolean; t: number }
export interface Finding { step: number; call: string; view: string; node: Obj; drawn: Obj | null }
export interface Frames { claim: (typeof CLAIMS)[number]; clean: number; steps: Step[]; findings: Finding[] }

export class Replica {
  steps = 0;
  t = 0;
  readonly made: { step: number; call: Obj; reply: Obj }[] = [];
  private constructor(readonly drive: Drive, readonly launched: Obj) {}

  /** A `deep-drive` process (with the plants named, if any) and one replica in it on the fixture, frames: "dirty". */
  static async open(o: { hub?: string; drive?: string } = {}): Promise<Replica> {
    const drive = await Drive.start({ ...(o.drive ? { plant: o.drive } : {}), env: { DEEP_HUB_PLANT: o.hub } });
    const { reply } = await drive.call({ call: 'launch', launch: { from: 'fixture', fixture: FIXTURE, center: 'deepbuild/needs-you', frames: 'dirty' } });
    expect(reply.ok, `launch on the fixture: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    expect(reply.frames, `launch answers frames: "dirty", the mode that draws only when GPUI says the window is dirty: ${JSON.stringify(reply).slice(0, 400)}`).toBe('dirty');
    return new Replica(drive, reply);
  }

  /** One step: its reply, whatever it says. */
  async call(args: Obj): Promise<Obj> {
    const { reply } = await this.drive.call(args, 600_000);
    this.steps += 1;
    if (typeof reply.t === 'number') this.t = reply.t;
    this.made.push({ step: this.steps, call: args, reply });
    return reply;
  }
  /** One step that must succeed. */
  async must(args: Obj, what = String(args.call)): Promise<Obj> {
    const reply = await this.call(args);
    expect(reply.ok, `step ${this.steps} (${what}): ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
    return reply;
  }

  feed(session: string, event: Obj): Promise<Obj> { return this.must({ call: 'feed', feed: { session, event } }, `feed ${String(event.kind)}`); }
  until(t: number): Promise<Obj> { return this.must({ call: 'wait_for', wait_for: { t }, timeout: 600_000 }, `wait_for t ${t}`); }
  by(flicks: number): Promise<Obj> { return this.until(this.t + flicks); }
  hover(locator: Obj): Promise<Obj> { return this.must({ call: 'act', locator, act: { kind: 'hover' } }, `hover ${JSON.stringify(locator)}`); }
  resize(size: [number, number]): Promise<Obj> { return this.must({ call: 'resize', resize: { size } }, `resize ${size.join('x')}`); }
  /** The last frame the window drew, as `see` reads it in this mode. */
  async see(): Promise<Obj> { return (await this.must({ call: 'see', see: { include: ['roles', 'names', 'values', 'bounds'] } }, 'see')).snapshot as Obj; }

  /** Closes the replica: its `frames` report, checked for shape. */
  async close(): Promise<Frames> {
    const { reply } = await this.drive.call({ call: 'close' }, 600_000);
    expect(reply.ok, `close: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    const frames = reply.frames as Frames | undefined;
    expect(frames && typeof frames === 'object', `close answers the mode's frames report: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    expect(CLAIMS, `frames.claim is one of ${CLAIMS.join(', ')}: ${JSON.stringify(frames!.claim)}`).toContain(frames!.claim);
    expect(Array.isArray(frames!.steps) && Array.isArray(frames!.findings), `frames lists its steps and findings: ${JSON.stringify(frames).slice(0, 600)}`).toBe(true);
    expect(frames!.steps.map((s) => s.step), 'frames reports every step, in order, numbered as the journey numbers them').toEqual(this.made.map((m) => m.step));
    expect(frames!.steps.map((s) => s.call), 'each step names its call').toEqual(this.made.map((m) => String(m.call.call)));
    for (const s of frames!.steps) {
      expect(Number.isInteger(s.frames) && Number.isInteger(s.drawn) && s.drawn >= 0 && s.frames >= 0 && typeof s.equal === 'boolean', `step ${s.step}: frames, drawn and equal: ${JSON.stringify(s)}`).toBe(true);
    }
    expect(frames!.clean, 'clean counts the steps in which the clock passed frames and GPUI drew none').toBe(frames!.steps.filter((s) => s.frames > 0 && s.drawn === 0).length);
    for (const f of frames!.findings) {
      expect(Number.isInteger(f.step) && typeof f.call === 'string' && typeof f.view === 'string' && f.view.length > 0, `a finding names its step, call and view: ${JSON.stringify(f)}`).toBe(true);
      expect(typeof f.node?.role === 'string' && Array.isArray(f.node?.bounds) && 'name' in f.node, `a finding names its node as the snapshot does: ${JSON.stringify(f)}`).toBe(true);
      expect(frames!.steps.find((s) => s.step === f.step)?.equal, `a finding's step ${f.step} is not equal`).toBe(false);
    }
    return frames!;
  }
  async stop(): Promise<void> { await this.drive.stop(); }
}

/** Every name in a snapshot, in tree order. */
export const names = (snapshot: Obj): string[] => nodesOf(snapshot).map((n) => n.name ?? '').filter(Boolean);

/** The quiet session's sidebar row in a snapshot: the one button whose name says when it was last seen. */
export function quietRow(snapshot: Obj): Node {
  const rows = nodesOf(snapshot).filter((n) => n.role === 'button' && /quiet/.test(n.name ?? '') && /last seen/.test(n.name ?? ''));
  expect(rows.length, `one quiet session row, reading when it was last seen: ${JSON.stringify(rows.map((r) => r.name))}`).toBe(1);
  return rows[0]!;
}

// ---------------------------------------------------------------------------------------------------
// Record events, as a hub's stream delivers them; the replica gives each its log_pos, ts and session.

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const event = (id: string, kind: string, writer: string, data: Obj, extra: Obj = {}): Obj => ({ v: 1, id, kind, writer, actor: 'you', scope: 'you', ...extra, data });

/** An ask raised by the core: a choice, open for a day. Its Needs you row is named by its question. */
export const askCreated = (id: string, question: string): Obj => event(id, 'ask.created', 'core', {
  kind: 'choice', question, options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
  recommended: 'sqlite', deadline: NOW + 86_400_000, fallback: 'you', default: 'sqlite', provisional: false, owner: 'you', key: sha256(question),
  pinned_to: { kind: 'evidence', ref: sha256(question) },
});
export const askCancelled = (id: string, ask: string): Obj => event(id, 'ask.cancelled', 'core', {}, { subject: `ask:${ask}` });
/** A terminal program's reading (#990): the sidebar shows it under the session's row. */
export const reading = (id: string, text: string): Obj => event(id, 'session.reading', 'core', { reading: text });
export const toolBefore = (id: string): Obj => event(id, 'tool.before', 'hook', {});

/** An event id, unique for a seed and a counter, in ULID's alphabet. */
export const eventId = (seed: number, n: number): string => `01KBJ${String(seed).padStart(6, '0')}${String(n).padStart(15, '0')}`;

// ---------------------------------------------------------------------------------------------------
// The seeded journey (README: The seeded journey).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Spec =
  | { kind: 'feed'; what: 'ask' | 'cancel' | 'reading' | 'tool'; session: string; event: Obj; question?: string }
  | { kind: 'clock'; by: number }
  | { kind: 'hover'; locator: Obj }
  | { kind: 'resize'; size: [number, number] }
  | { kind: 'see' };

/** The first two steps of every journey: half a second of the clock, then one frame, which changes nothing. */
export const IDLE_PROBE = 2;
const CLOCK_STEPS = [FRAME, 2 * FRAME, 6 * FRAME, FLICKS / 2, 2 * FLICKS, 13 * FLICKS, 41 * FLICKS];

/**
 * `n` random steps after the idle probe: record events (a new ask, an ask cancelled, a reading, a tool call), clock
 * steps from a frame to 41 s, hovers on the fixture's two Needs you rows, and resizes from 1100x720 to 1598x998 points.
 * Every 13th step is a new ask, so each journey raises at least ceil(n / 13) of them.
 */
export function journey(seed: number, n = 40): Spec[] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const specs: Spec[] = [{ kind: 'clock', by: FLICKS / 2 }, { kind: 'clock', by: FRAME }];
  const open: string[] = [];
  let k = 0;
  const id = () => eventId(seed, ++k);
  const ask = (): Spec => {
    const ask = id();
    const question = `Seed ${seed}, ask ${k}: ship it?`;
    open.push(ask);
    return { kind: 'feed', what: 'ask', session: pick([SESSION.asks, SESSION.reads]), event: askCreated(ask, question), question };
  };
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (i % 13 === 0) specs.push(ask());
    else if (r < 0.3) {
      const f = rand();
      if (f < 0.4) specs.push(ask());
      else if (f < 0.6 && open.length) specs.push({ kind: 'feed', what: 'cancel', session: SESSION.asks, event: askCancelled(id(), open.splice(Math.floor(rand() * open.length), 1)[0]!) });
      else if (f < 0.85) specs.push({ kind: 'feed', what: 'reading', session: SESSION.reads, event: reading(id(), `its terminal's program reports step ${k}`) });
      else specs.push({ kind: 'feed', what: 'tool', session: SESSION.reads, event: toolBefore(id()) });
    } else if (r < 0.6) specs.push({ kind: 'clock', by: pick(CLOCK_STEPS) });
    else if (r < 0.8) specs.push({ kind: 'hover', locator: { role: 'button', name: pick(FIXTURE_ASKS) } });
    else specs.push({ kind: 'resize', size: [1100 + 2 * Math.floor(rand() * 250), 720 + 2 * Math.floor(rand() * 140)] });
  }
  return specs;
}

/** Runs a journey in `replica`, one step a spec; with `strict`, every step must succeed. Its steps, by spec. */
export async function run(replica: Replica, specs: Spec[], strict = true): Promise<{ spec: Spec; step: number; reply: Obj }[]> {
  const out: { spec: Spec; step: number; reply: Obj }[] = [];
  for (const spec of specs) {
    const args: Obj = spec.kind === 'feed' ? { call: 'feed', feed: { session: spec.session, event: spec.event } }
      : spec.kind === 'clock' ? { call: 'wait_for', wait_for: { t: replica.t + spec.by }, timeout: 600_000 }
        : spec.kind === 'hover' ? { call: 'act', locator: spec.locator, act: { kind: 'hover' } }
          : spec.kind === 'resize' ? { call: 'resize', resize: { size: spec.size } }
            : { call: 'see', see: { include: ['roles', 'names'] } };
    const reply = strict ? await replica.must(args, `${spec.kind} ${JSON.stringify(spec).slice(0, 120)}`) : await replica.call(args);
    out.push({ spec, step: replica.steps, reply });
  }
  return out;
}

/** The steps of a run that fed an event of `what`. */
export const fed = (ran: { spec: Spec; step: number }[], what: string[]): { spec: Extract<Spec, { kind: 'feed' }>; step: number }[] =>
  ran.filter((r): r is { spec: Extract<Spec, { kind: 'feed' }>; step: number; reply: Obj } => r.spec.kind === 'feed' && what.includes(r.spec.what));

export const stepOf = (frames: Frames, step: number): Step => {
  const found = frames.steps.find((s) => s.step === step);
  expect(found, `frames reports step ${step}`).toBeTruthy();
  return found!;
};

/** A finding as a person reads it: the step, the view, and the node a forced frame has where the drawn one differs. */
export const said = (f: Finding): string => `step ${f.step} (${f.call}): ${f.view} drew ${JSON.stringify(f.drawn?.name ?? null)} where a forced frame has ${JSON.stringify(f.node.name)}`;

/**
 * Criterion 1's judge of a seeded journey, the same for the app and for the wrong programs: the claim is PASS, no step's
 * forced frame differs from the last drawn one, the idle probe drew nothing, and every record event that changes Needs
 * you (an ask raised or cancelled) and every resize drew a frame by itself. Each problem names its step.
 */
export function journeyProblems(frames: Frames, ran: { spec: Spec; step: number }[]): string[] {
  const problems: string[] = [];
  if (frames.claim !== 'PASS') problems.push(`the claim is ${frames.claim}, not PASS (${frames.clean} clean steps)`);
  for (const f of frames.findings) problems.push(said(f));
  const probe = stepOf(frames, IDLE_PROBE);
  if (probe.frames < 1 || probe.drawn !== 0) problems.push(`step ${IDLE_PROBE}, one frame of the clock with nothing changed, passed ${probe.frames} frames and drew ${probe.drawn}`);
  for (const r of ran) {
    const s = stepOf(frames, r.step);
    if (!s.equal && !frames.findings.some((f) => f.step === r.step)) problems.push(`step ${r.step} is not equal and has no finding`);
    if (r.spec.kind === 'feed' && (r.spec.what === 'ask' || r.spec.what === 'cancel') && s.drawn < 1) problems.push(`step ${r.step} fed ${String(r.spec.event.kind)} and the window drew no frame by itself`);
    if (r.spec.kind === 'resize' && s.drawn < 1) problems.push(`step ${r.step} resized the window to ${r.spec.size.join('x')} and it drew no frame`);
  }
  return problems;
}
