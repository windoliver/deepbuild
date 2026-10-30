// AC1–AC4: a plug-in that tries each forbidden thing (the issue's proof line). Its panel's script fetches and runs a
// program (AC1), toasts while the question card shows (AC2), asks for focus, a pop-out and a clipboard write on a
// timer (AC3), and moves a piece you placed (AC4). Driven through `deep-show run` with #400's two displays on the
// virtual display clock (README: The surface under test). At the base `deep-show` has no `install` call and answers
// every scenario here `bad_input`.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALPHA, B, Driver, MS, SEC, SLOTS, at, attemptsOf, click, isObject, obj, overlap, plainTree, rect, serialOf, str, useOut,
  useShow, windowsOf, type Attempt, type JsonObject, type Planted, type Rect,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 2 * SEC;

// ---------------------------------------------------------------------------------------------------
// AC1: the listener a fetch would reach, a child of this test, stopped by its own PID.

let listener: ChildProcess | null = null;
afterEach(() => { if (listener?.pid) listener.kill(); listener = null; });

/** A local HTTP listener that appends one line to `log` per request it gets, and its port. */
async function listen(log: string): Promise<number> {
  if (listener?.pid) listener.kill();
  const code = `const fs=require('fs');const s=require('http').createServer((q,r)=>{fs.appendFileSync(${JSON.stringify(log)},q.url+'\\n');r.end('pong')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  listener = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    listener!.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim())));
    listener!.once('error', reject);
  });
}

describe('AC1 a panel script can\'t fetch or run a program', () => {
  async function run(planted?: Planted): Promise<string[]> {
    const dir = out();
    const log = join(dir, `requests-${planted ?? 'clean'}.log`);
    const marker = join(dir, `ran-${planted ?? 'clean'}`);
    const port = await listen(log);
    const d = new Driver(show(), {
      evidence: dir, panels: { p: SLOTS[0]! }, ...(planted ? { planted } : {}),
      plugins: {
        curious: {
          panels: { p: { tree: plainTree('Curious'), script: { timers: [{ first: T0, every: SEC, until: T0 + 2 * SEC, do: [
            { op: 'fetch', url: `http://127.0.0.1:${port}/from-panel` },
            { op: 'run', argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] },
            { op: 'read', source: 'feed' },
          ] }] } } },
          sources: { feed: { fresh_for: 60 * SEC, replay: [{ value: 7, unit: 'count' }] } },
        },
      },
    });
    // The panel holds a fresh serial of your input in it, so a refusal is the policy's, not the serial's.
    const r = d.step([...click(T0 - 500 * MS, 'p', SLOTS[0]!), at('attempts', T0 + 4 * SEC, { panel: 'p' })], 'the curious panel');
    const tries = attemptsOf(r[2], 'attempts');
    const f: string[] = [];
    const of = (op: string): Attempt[] => tries.filter((t) => t.op === op);
    for (const op of ['fetch', 'run']) {
      if (of(op).length !== 3) f.push(`the panel's ${op} was tried ${of(op).length} times, not 3 (one a second for 3 s)`);
      for (const t of of(op)) if (t.outcome !== 'refused') f.push(`the panel's ${op} at ${t.at} was ${t.outcome}, not refused`);
    }
    const requests = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    if (requests.length > 0) f.push(`the panel's fetch reached the network: the listener got ${requests.length} request(s) ${JSON.stringify(requests)}`);
    if (existsSync(marker)) f.push('the panel ran a program: its marker file exists');
    // The control: reading a source the plug-in declared goes through the hub, which makes the call.
    if (of('read').length === 0 || of('read').some((t) => t.outcome !== 'done')) f.push(`the panel's read of its declared source through the hub did not go through: ${JSON.stringify(of('read'))}`);
    return f;
  }

  it('AC1 a panel script that fetches a local URL and runs a program, each once a second, is refused every time: no request reaches the listener and no program runs', async () => {
    expect(await run(), 'the panel host refuses the fetch and the program').toEqual([]);
    // Wrong program: a panel host whose policy lets the script reach the network and run programs.
    const twin = await run('panel_policy_open');
    expect(twin.some((m) => m.includes('fetch')) && twin.some((m) => m.includes('ran a program')), `the planted panel_policy_open fails, naming the fetch and the program: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});

describe('AC2 a plug-in\'s toast can\'t cover the question card', () => {
  const CARD = { ask: 'ask:01JB401A0000000000000001', question: 'Raise the alert threshold to 250?', options: [{ id: 'yes', label: 'Raise it' }, { id: 'no', label: 'Leave it' }], size: [420, 220], at: T0 + 5 * SEC };

  function run(planted?: Planted): string[] {
    const d = new Driver(show(), {
      evidence: out(), panels: { n: SLOTS[0]! }, card: CARD, ...(planted ? { planted } : {}),
      plugins: { notifier: { panels: { n: { tree: plainTree('Builds'), script: { timers: [{ first: T0 + SEC, every: SEC, until: T0 + 20 * SEC, do: [{ op: 'toast', text: 'build finished' }] }] } } } } },
    });
    const f: string[] = [];
    const toasts = (r: JsonObject | undefined, what: string): JsonObject[] => (Array.isArray(obj(r, what)['toasts']) ? (obj(r, what)['toasts'] as JsonObject[]) : (f.push(`${what}: no toasts list`), []));
    // Your click in the panel lets its toasts show (Panel: toasts need a serial from your input there).
    const r = d.step([
      ...click(T0, 'n', SLOTS[0]!), at('toasts', T0 + 3500 * MS),
      ...click(T0 + 10 * SEC, 'n', SLOTS[0]!),
      ...[8, 12, 18].flatMap((s) => [at('card', T0 + s * SEC + 500 * MS), at('toasts', T0 + s * SEC + 500 * MS)]),
    ], 'toasts and the card');
    // The control: before the ask, the plug-in's toast shows.
    const before = toasts(r[2], 'toasts before the ask').filter((t) => t['shown'] === true && t['plugin'] === 'notifier' && t['text'] === 'build finished');
    if (before.length === 0) f.push(`no toast of notifier's shows before the ask, after your click in its panel: ${JSON.stringify(r[2]).slice(0, 400)}`);
    for (const [k, s] of [8, 12, 18].entries()) {
      const card = obj(obj(r[5 + 2 * k], `the card at ${s}.5 s`)['card'], `the card at ${s}.5 s`);
      const state = str(card['state'], 'card.state');
      if (state !== 'presented' && state !== 'armed') f.push(`the card is ${state} at ${s}.5 s, not presented or armed`);
      const cardRect = rect(card['rect'], 'card.rect');
      for (const t of toasts(r[6 + 2 * k], `toasts at ${s}.5 s`)) {
        if (t['shown'] !== true) continue;
        const tr = isObject(t) && Array.isArray(t['rect']) ? (t['rect'] as Rect) : null;
        const over = tr && t['display'] === card['display'] ? overlap(tr, cardRect) : 0;
        f.push(`${String(t['plugin'])}'s toast "${String(t['text'])}" shows at ${s}.5 s while the card is ${state}${over > 0 ? `, covering ${over} pt² of it` : ''}`);
      }
    }
    return f;
  }

  it('AC2 a toast shown after your click hides while the card shows, also one asked right after a click during the card', () => {
    expect(run(), 'no plug-in toast shows while the card does').toEqual([]);
    // Wrong program: toasts that keep showing whatever the card does.
    const twin = run('toasts_ignore_card');
    expect(twin.some((m) => m.startsWith('notifier\'s toast')), `the planted toasts_ignore_card fails, naming the toast: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 600_000);
});

describe('AC3 a focus request, pop-out or clipboard write without a fresh gesture serial from your input is refused', () => {
  const PESKY = { p: SLOTS[0]!, q: SLOTS[1]! };
  const CLICK_P = T0 + 69 * SEC + 500 * MS;

  function run(planted?: Planted): string[] {
    const d = new Driver(show(), {
      evidence: out(), panels: PESKY, ...(planted ? { planted } : {}),
      plugins: {
        pesky: { panels: { p: { tree: plainTree('Pesky'), script: { timers: [{ first: T0 + 2 * SEC, every: 2 * SEC, until: T0 + 80 * SEC, do: [
          { op: 'focus' }, { op: 'pop_out', display: B.uuid }, { op: 'clipboard', text: 'copied by pesky' },
        ] }] } } } },
        calm: { panels: { q: { tree: plainTree('Calm') } } },
      },
    });
    const f: string[] = [];
    // Your input goes only to the other panel, q, until 69.5 s.
    const r = d.step([
      ...click(T0 + 10 * SEC, 'q', PESKY.q),
      at('focus', T0 + 60 * SEC), at('windows', T0 + 60 * SEC), at('clipboard', T0 + 60 * SEC),
      ...click(CLICK_P, 'p', PESKY.p),
      at('focus', T0 + 70 * SEC + 500 * MS), at('windows', T0 + 70 * SEC + 500 * MS), at('clipboard', T0 + 70 * SEC + 500 * MS),
      at('attempts', T0 + 81 * SEC, { panel: 'p' }),
    ], 'the pesky panel on a timer');
    const tries = attemptsOf(r[10], 'attempts');
    for (const op of ['focus', 'pop_out', 'clipboard']) {
      const early = tries.filter((t) => t.op === op && t.at < CLICK_P);
      if (early.length !== 34) f.push(`the timer tried ${op} ${early.length} times before your click in p, not 34`);
      const through = early.filter((t) => t.outcome !== 'refused');
      if (through.length > 0) f.push(`${op} from the timer with no serial of your input in p went through ${through.length} time(s), first at ${through[0]!.at}: ${through[0]!.outcome}`);
    }
    const focus = obj(r[2], 'focus at 60 s')['kb_focus'];
    if (focus === 'p') f.push('focus: keyboard focus is on p at 60 s, though your input was only ever in q');
    if (windowsOf(r[3], 'windows at 60 s').some((w) => w.view === 'p')) f.push('pop_out: p is in a window of its own at 60 s');
    const clip = obj(r[4], 'clipboard at 60 s')['clipboard'];
    if (isObject(clip) && clip['text'] === 'copied by pesky') f.push('clipboard: the clipboard holds pesky\'s text at 60 s');
    // The control: the timer's next tick after your click in p goes through, all three.
    const next = tries.filter((t) => t.at === T0 + 70 * SEC);
    for (const op of ['focus', 'pop_out', 'clipboard']) {
      if (next.find((t) => t.op === op)?.outcome !== 'done') f.push(`${op} at 70 s, 0.5 s after your click in p, did not go through: ${JSON.stringify(next)}`);
    }
    if (obj(r[7], 'focus at 70.5 s')['kb_focus'] !== 'p') f.push(`focus at 70.5 s is ${JSON.stringify(obj(r[7], 'focus')['kb_focus'])}, not p`);
    if (!windowsOf(r[8], 'windows at 70.5 s').some((w) => w.view === 'p' && w.display === B.uuid)) f.push('p is not popped out onto B at 70.5 s');
    const after = obj(r[9], 'clipboard at 70.5 s')['clipboard'];
    if (!(isObject(after) && after['text'] === 'copied by pesky')) f.push(`the clipboard at 70.5 s holds ${JSON.stringify(after)}, not pesky's text`);
    return f;
  }

  it('AC3 a panel that asks for focus, a pop-out onto B and a clipboard write every 2 s is refused all 34 times while your input is elsewhere, and goes through right after your click in it', () => {
    expect(run(), 'the timer\'s attempts without a serial are refused').toEqual([]);
    // Wrong program: a host that lets a panel script's focus, pop-out and clipboard write through with no serial.
    const twin = run('script_ops_need_no_serial');
    for (const op of ['focus', 'pop_out', 'clipboard']) expect(twin.some((m) => m.startsWith(`${op} from the timer`)), `the planted script_ops_need_no_serial fails on ${op}: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 600_000);
});

describe('AC4 no plug-in or suggestion moves a piece you placed', () => {
  const PANELS = { x: SLOTS[0]!, y: SLOTS[1]!, m: SLOTS[2]! };
  const YOURS: Rect = SLOTS[5]!;

  function run(planted?: Planted): string[] {
    const d = new Driver(show(), {
      evidence: out(), panels: PANELS, ...(planted ? { planted } : {}),
      plugins: {
        home: { panels: { x: { tree: plainTree('Orders') }, y: { tree: plainTree('Refunds') } } },
        mover: { panels: { m: { tree: plainTree('Mover'), script: { timers: [{ first: T0 + 20 * SEC, every: 60 * SEC, do: [
          { op: 'place', piece: 'x', rect: SLOTS[4]! }, { op: 'place', piece: 'm', rect: SLOTS[3]! },
        ] }] } } } },
      },
    });
    const f: string[] = [];
    const sx = serialOf(d.step(click(T0 + 5 * SEC, 'x', PANELS.x), 'your click in x')[0], 'the press in x');
    const mine = d.one({ call: 'place', at: T0 + 6 * SEC, piece: 'x', rect: YOURS, serial: sx }, 'you place x');
    if (isObject(mine) && typeof mine['code'] === 'string') f.push(`your placement of x with your serial was refused: ${JSON.stringify(mine)}`);
    // mover holds a fresh serial of your input in its panel when its script places, so a refusal is about x, not the serial.
    d.step(click(T0 + 15 * SEC, 'm', PANELS.m), 'your click in m');
    const [suggestion, pieces] = d.step([
      { call: 'place', at: T0 + 25 * SEC, piece: 'x', rect: SLOTS[1]!, session: ALPHA.id },
      at('pieces', T0 + 30 * SEC),
    ], 'mover\'s placements and alpha\'s suggestion');
    const list = (Array.isArray(obj(pieces, 'pieces')['pieces']) ? obj(pieces, 'pieces')['pieces'] : []) as JsonObject[];
    const of = (p: string): JsonObject | undefined => list.find((r) => r['piece'] === p);
    const x = of('x');
    if (!x) f.push('x is not among the pieces');
    else {
      if (JSON.stringify(x['rect']) !== JSON.stringify(YOURS)) f.push(`x, which you placed at ${JSON.stringify(YOURS)}, is at ${JSON.stringify(x['rect'])}`);
      if (x['placed_by'] !== 'you') f.push(`x's placed_by is ${JSON.stringify(x['placed_by'])}, not you`);
    }
    if (!(isObject(suggestion) && typeof suggestion['code'] === 'string')) f.push(`alpha's suggestion to move x was not refused: ${JSON.stringify(suggestion)}`);
    // The control: mover's verb puts its own piece where it asked.
    if (JSON.stringify(of('m')?.['rect']) !== JSON.stringify(SLOTS[3])) f.push(`mover's own panel m is at ${JSON.stringify(of('m')?.['rect'])}, not ${JSON.stringify(SLOTS[3])} where its verb put it`);
    return f;
  }

  it('AC4 x, placed by your drag, stays where you put it through a plug-in\'s place verb and an agent\'s suggestion, while the plug-in places its own panel', () => {
    expect(run(), 'x stays where you placed it').toEqual([]);
    // Wrong program: placement verbs that move any piece, yours included.
    const twin = run('placement_moves_yours');
    expect(twin.some((m) => m.startsWith('x, which you placed')), `the planted placement_moves_yours fails, naming x: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});
