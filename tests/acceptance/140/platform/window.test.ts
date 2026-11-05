// #140.14: a test window backend that declares no occlusion report makes the question card arm only while its window is
// active and frontmost by the platform's own report; a planted card that treats unknown occlusion as unobscured arms
// under a covering test window and fails, naming the capability. With it, the scope's capability table: the window and
// input seams declare whether a backend can report occlusion, set and read window positions, lock the pointer, warp the
// cursor and compose text through an input method, and every consumer names its behavior when one is absent.
//
// Through `deep-show run` on #400's virtual display clock (README: The surface under test). The test window backend is
// the `test-window` build of deep-show; its platform reports are `activate` (#400's: the window server's report of the
// key window) and `frontmost`; a covering window of another app is `test_window`, which a backend with no occlusion
// report never tells the card about; the capability table is the `window_caps` call. The planted card is the startup
// argument `--planted card_ignores_unknown_occlusion`. At the base deep-show has no `test-window` feature, so the build
// those tests use fails, and the shipped build answers `window_caps` with bad_input.
import { describe, expect, it } from 'vitest';
import {
  arr, backendOf, bool, num, obj, rect, runShow, str, useOut, useShow, type JsonObject, type JsonValue, type Rect,
} from './helpers.ts';

const shows = useShow(['test-window', 'default']);
const out = useOut();

// ---------------------------------------------------------------------------------------------------
// The world: one display, the main window with one panel, one ask (#400's scenario, README).

const FLICKS = 705_600_000;
const MS = FLICKS / 1000;
const F = FLICKS / 120; // one frame of the 120 Hz display
const ARM = 500 * MS; // Question card: arm_after = 500 ms
const A = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: F, color_space: 'p3' };
const DOC = '01JB140WAA0000000000000001';
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1_000 } };
const T0 = 20 * F;
const ASK_AT = T0 + 100 * MS;
const PLANTED = 'card_ignores_unknown_occlusion';
const CAPS = ['occlusion', 'positions', 'pointer_lock', 'warp_cursor', 'ime'] as const;

const VIEW: JsonObject = {
  format: 1, profile: 'board', title: 'Orders by day', description: 'A view beside the question card.', size: [600, 350],
  items: { mark: { id: 'mark', kind: 'rect@1', name: 'Mark', order: 'a0', params: { box: [0, 0, 80, 40], paint: { fill: { role: 'muted' } } }, at: { pos: [20, 20, 0] } } },
};
const ASK: JsonObject = {
  ask: 'ask:01JB140A0000000000000001', question: 'Apply the migration to the staging database?',
  options: [{ id: 'yes', label: 'Apply' }, { id: 'no', label: 'Not now' }], size: [420, 220], at: ASK_AT,
};

function scenario(calls: JsonObject[], withAsk: boolean): JsonObject {
  const all = [{ call: 'deep_show', session: ALPHA.id, doc: DOC, document: VIEW, include: ['issues'], at: 1 }, ...calls]
    .map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'] as JsonValue, 'at') - num(q.c['at'] as JsonValue, 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: out(),
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    clock: { lead: 2 * MS, check: MS / 2 }, displays: [A], window: [1200, 700],
    panels: { x: { rect: [0, 0, 600, 350] } }, docs: { [DOC]: { panel: 'x' } },
    ...(withAsk ? { card: ASK } : {}),
    calls: all,
  };
}

/** Plays one world step by step on the virtual clock, as #400's Driver does: each step replays the whole scenario with its calls added. */
class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly withAsk: boolean, private readonly planted?: string) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario([...this.calls, ...fresh], this.withAsk);
    const replies = runShow(this.bin, s, what, this.planted);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}

const activate = (at: number, window: string | null): JsonObject => ({ call: 'activate', at, window });
const frontmost = (at: number, window: string, front: boolean): JsonObject => ({ call: 'frontmost', at, window, frontmost: front });
const testWindow = (at: number, id: string, r: Rect | null): JsonObject => ({ call: 'test_window', at, id, rect: r });
const cardCall = (at: number): JsonObject => ({ call: 'card', at });

function mainWindow(d: Driver, what: string): string {
  const reply = d.one({ call: 'windows', at: T0 - F }, `${what}: windows`);
  const main = arr(obj(reply, `${what}: windows`)['windows'], `${what}: windows`).map((w, i) => obj(w, `${what}: windows[${i}]`)).find((w) => w['kind'] === 'main');
  expect(main, `${what}: the main window is open`).toBeDefined();
  return str(main!['window'], `${what}: the main window's ID`);
}

interface Card { rect: Rect; window: string; states: { state: string; at: number }[] }
function cardOf(reply: JsonObject | undefined, what: string): Card {
  const c = obj(obj(reply, what)['card'], `${what}: card`);
  return {
    rect: rect(c['rect'], `${what}: card.rect`), window: str(c['window'], `${what}: card.window`),
    states: arr(c['states'], `${what}: card.states`).map((s, i) => {
      const o = obj(s, `${what}: card.states[${i}]`);
      return { state: str(o['state'], `${what}: card.states[${i}].state`), at: num(o['at'], `${what}: card.states[${i}].at`) };
    }),
  };
}
const msOf = (t: number): string => `${((t - ASK_AT) / MS).toFixed(1)} ms after the ask`;
const stateAt = (card: Card, t: number): string => card.states.filter((s) => s.at <= t).at(-1)?.state ?? 'hidden';
const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
};

/** The card's presentation: its first state, presented at a vsync at or after the ask. */
function presented(card: Card, what: string): number {
  const first = card.states[0];
  expect(first?.state, `${what}: the card's first state is presented`).toBe('presented');
  expect(first!.at >= ASK_AT, `${what}: presented at or after the ask`).toBe(true);
  return first!.at;
}

/**
 * The criterion's rule against the card's states, given when the test backend reported its window active and
 * frontmost (each `[from, to)`): it is armed only inside such a span and only 500 ms after the later of the span's
 * start and its presentation, and within a frame of that whenever the span lasts. Each failure names the capability.
 */
function armingFailures(card: Card, cleared: [number, number][], end: number, what: string): string[] {
  const f: string[] = [];
  const P = card.states[0]?.at ?? ASK_AT;
  const allowed = (t: number): boolean => cleared.some(([from, to]) => t >= Math.max(from, P) + ARM && t < to);
  for (const s of card.states.filter((x) => x.state === 'armed')) {
    if (!allowed(s.at)) f.push(`${what}: the card armed at ${msOf(s.at)}, though its window hadn't been active and frontmost by the test backend's report for the 500 ms before; the backend declares no occlusion report (capability occlusion), so nothing else clears it`);
  }
  for (let t = P; t <= end; t += F) {
    if (stateAt(card, t) === 'armed' && !allowed(t)) {
      f.push(`${what}: the card is armed at ${msOf(t)}, while its window isn't active and frontmost by the test backend's report (capability occlusion not declared)`);
      break;
    }
  }
  for (const [from, to] of cleared) {
    const due = Math.max(from, P) + ARM;
    if (Math.min(to, end) <= due + F) continue;
    if (!card.states.some((s) => s.state === 'armed' && s.at >= due && s.at <= due + F)) {
      f.push(`${what}: the card didn't arm within a frame of 500 ms after its window was active and frontmost from ${msOf(Math.max(from, P))}: ${JSON.stringify(card.states.map((s) => [s.state, msOf(s.at)]))}`);
    }
  }
  return f;
}

/** A covering window of another app over the card from `from` to `to`: the card never armed under it. */
function coverFailures(card: Card, cover: { id: string; rect: Rect; from: number; to: number }, what: string): string[] {
  const f: string[] = [];
  const area = overlap(cover.rect, card.rect);
  const under = (t: number): boolean => t >= cover.from && t < cover.to;
  const armedEntry = card.states.find((s) => s.state === 'armed' && under(s.at));
  let armedAt = armedEntry?.at;
  for (let t = cover.from; armedAt === undefined && t < cover.to; t += F) if (stateAt(card, t) === 'armed') armedAt = t;
  if (armedAt !== undefined) {
    f.push(`${what}: the card was armed at ${msOf(armedAt)} under the covering test window ${cover.id} (${area} pt² of the card under it): it treated the unknown occlusion as unobscured, but the window backend declares no occlusion report (capability occlusion), so only its window being active and frontmost may clear it`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------

interface Cap { declared: boolean; consumers: { consumer: string; when_absent: string }[] }
function capsOf(reply: JsonObject | undefined, what: string): { backend: { name: string; version: string }; caps: Record<string, Cap> } {
  const r = obj(reply, what);
  const caps = obj(r['caps'], `${what}: caps`);
  const table: Record<string, Cap> = {};
  for (const name of CAPS) {
    const c = obj(caps[name], `${what}: caps.${name}`);
    table[name] = {
      declared: bool(c['declared'], `${what}: caps.${name}.declared`),
      consumers: arr(c['consumers'], `${what}: caps.${name}.consumers`).map((x, i) => {
        const o = obj(x, `${what}: caps.${name}.consumers[${i}]`);
        return { consumer: str(o['consumer'], `${what}: caps.${name}.consumers[${i}].consumer`), when_absent: str(o['when_absent'], `${what}: caps.${name}.consumers[${i}].when_absent`) };
      }),
    };
  }
  return { backend: backendOf(r['backend'], `${what}: backend`), caps: table };
}

describe('#140.14 the window and input seams declare their capabilities, and every consumer names its behavior when one is absent', () => {
  it('#140.14 the test window backend\'s capability table declares occlusion, positions, pointer lock, cursor warp and input-method composition; it declares no occlusion report, and the question card, among occlusion\'s consumers, names its behavior without one', () => {
    const d = new Driver(shows.bin('test-window'), false);
    const t = capsOf(d.one({ call: 'window_caps', at: T0 }, 'window_caps'), 'the test window backend\'s window_caps');
    expect(t.caps['occlusion']!.declared, 'the test window backend declares no occlusion report').toBe(false);
    const card = t.caps['occlusion']!.consumers.find((c) => c.consumer === 'question_card');
    expect(card, `the question card is a consumer of occlusion: ${JSON.stringify(t.caps['occlusion'])}`).toBeDefined();
    for (const [name, cap] of Object.entries(t.caps).filter(([, c]) => !c.declared)) {
      expect(cap.consumers.length, `${name} is absent, so its consumers are listed`).toBeGreaterThan(0);
      for (const c of cap.consumers) expect(c.when_absent.trim().length, `${name}: ${c.consumer} names its behavior when ${name} is absent`).toBeGreaterThan(0);
    }
    // The shipped build has a table of its own, from its own window backend.
    const shipped = capsOf(new Driver(shows.bin('default'), false).one({ call: 'window_caps', at: T0 }, 'the shipped build\'s window_caps'), 'the shipped build\'s window_caps');
    expect(shipped.backend.name, 'the shipped build\'s window backend is not the test one').not.toBe(t.backend.name);
    for (const [name, cap] of Object.entries(shipped.caps).filter(([, c]) => !c.declared)) {
      for (const c of cap.consumers) expect(c.when_absent.trim().length, `shipped: ${name}: ${c.consumer} names its behavior when ${name} is absent`).toBeGreaterThan(0);
    }
  }, 1_200_000);
});

describe('#140.14 with a test window backend that declares no occlusion report, the question card arms only while its window is active and frontmost by the platform\'s own report', () => {
  it('#140.14 the card arms 500 ms after its window is active and frontmost, never while the test backend reports it inactive or not frontmost, and arms again 500 ms after both hold again', () => {
    const what = 'active and frontmost';
    const d = new Driver(shows.bin('test-window'), true);
    const main = mainWindow(d, what);
    d.step([activate(T0, main), frontmost(T0, main, true)], `${what}: the platform reports the main window active and frontmost`);
    const P = presented(cardOf(d.one(cardCall(ASK_AT + 2 * F), `${what}: the card as presented`), `${what}: the card as presented`), what);
    const X1 = P + 800 * MS; // you switch to another app: inactive, still frontmost
    const X2 = X1 + 1000 * MS; // back: active
    const X3 = X2 + 800 * MS; // a window of another app comes to the front: active, not frontmost
    const X4 = X3 + 1000 * MS; // frontmost again
    const END = X4 + 800 * MS;
    const replies = d.step([activate(X1, null), activate(X2, main), frontmost(X3, main, false), frontmost(X4, main, true), cardCall(END)], `${what}: the reports`);
    const c = cardOf(replies.at(-1), `${what}: the card at the end`);
    expect(c.window, 'the card is in the main window').toBe(main);
    expect(armingFailures(c, [[T0, X1], [X2, X3], [X4, Infinity]], END, what), 'the card arms only while its window is active and frontmost by the test backend\'s report').toEqual([]);
    expect(stateAt(c, X1 + 600 * MS), '600 ms after the app went inactive the card is not armed').not.toBe('armed');
    expect(stateAt(c, X3 + 600 * MS), '600 ms after another window came in front the card is not armed').not.toBe('armed');
  }, 1_200_000);

  it('#140.14 with no report from the test backend that its window is active and frontmost, the card never arms (unknown is not cleared)', () => {
    const what = 'no report';
    const d = new Driver(shows.bin('test-window'), true);
    const END = ASK_AT + 3000 * MS;
    const c = cardOf(d.one(cardCall(END), `${what}: the card 3 s after the ask`), `${what}: the card`);
    presented(c, what);
    expect(c.states.filter((s) => s.state === 'armed').map((s) => msOf(s.at)), 'the card never armed: nothing reported its window active and frontmost, and the backend reports no occlusion').toEqual([]);
  }, 1_200_000);

  for (const planted of [undefined, PLANTED] as const) {
    const label = planted ? `a planted card that treats unknown occlusion as unobscured (--planted ${planted})` : 'the card';
    it(`#140.14 under a covering test window of another app, its window still active but not frontmost, ${label} ${planted ? 'arms under it and fails, naming the capability' : 'stays unarmed, and arms 500 ms after the window leaves and its own is frontmost again'}`, () => {
      const what = planted ? `the covering window, planted ${planted}` : 'the covering window';
      const d = new Driver(shows.bin('test-window'), true, planted);
      const main = mainWindow(d, what);
      d.step([activate(T0, main), frontmost(T0, main, true)], `${what}: the platform reports the main window active and frontmost`);
      const first = cardOf(d.one(cardCall(ASK_AT + 2 * F), `${what}: the card as presented`), `${what}: the card as presented`);
      const P = presented(first, what);
      const R = first.rect;
      // Another app's window over the whole card and 20 points around it; the test backend reports only that the
      // main window is no longer frontmost (it stays the key window: a panel that doesn't activate its app).
      const cover = { id: 'cover', rect: [R[0] - 20, R[1] - 20, R[2] + 40, R[3] + 40] as Rect, from: P + 100 * MS, to: P + 1600 * MS };
      expect(overlap(cover.rect, R), 'the test window lies over the card').toBe(R[2] * R[3]);
      const END = cover.to + 800 * MS;
      const replies = d.step([
        testWindow(cover.from, cover.id, cover.rect), frontmost(cover.from, main, false),
        testWindow(cover.to, cover.id, null), frontmost(cover.to, main, true), cardCall(END),
      ], `${what}: the cover comes and goes`);
      const c = cardOf(replies.at(-1), `${what}: the card at the end`);
      const failures = [...coverFailures(c, cover, what), ...armingFailures(c, [[T0, cover.from], [cover.to, Infinity]], END, what)];
      if (!planted) {
        expect(failures, 'the card never arms under the covering window, and arms 500 ms after it leaves').toEqual([]);
      } else {
        expect(failures.length, `the planted card fails the check: ${JSON.stringify(c.states.map((s) => [s.state, msOf(s.at)]))}`).toBeGreaterThan(0);
        expect(failures.join('\n'), 'the failure names the capability (occlusion) and the covering window').toMatch(/covering test window cover[^\n]*capability occlusion/);
      }
    }, 1_200_000);
  }
});

