// AC7: with two terminal panels and keyboard focus in A, 100 keys from the input seam's test backend reach only A's
// program, also with the pointer over B; a raw-input write from an agent's session is refused, naming the writer; a
// router that sends keys to the panel under the pointer fails, naming B. Real programs on real PTYs (`deep-show serve`,
// README: Two ways to run deep-show) each log every byte they read; keys come through the `seam` call (the input seam's
// test backend, no panel named), your click gives A focus, and the pointer is moved with `input`. At the base `deep-show`
// has no `serve`. The SCOPE test reads what raw input carries (press, repeat and release, text, paste, mouse, focus and
// resize) as the program receives it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALPHA, SLOTS, arr, centre, installCall, openCall, openedOf, program, readBytes, readText, seamKey, setupOf, sleep, str, terminalPlugin, tmp, useShow, waitFor, withServe,
  type JsonObject, type Serve,
} from './helpers.ts';

const show = useShow();
const [SLOT_A, SLOT_B, , , , SLOT_EMPTY] = [SLOTS[0]!, SLOTS[1]!, SLOTS[2]!, SLOTS[3]!, SLOTS[4]!, SLOTS[5]!];
const KEYS = Array.from({ length: 100 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789'[i % 36]!);
/** Where the pointer is for key i: in no panel for the first 40, over A for the next 30, over B for the last 30. */
const pointerFor = (i: number): 'none' | 'A' | 'B' => (i < 40 ? 'none' : i < 70 ? 'A' : 'B');

interface Played { replies: { i: number; key: string; phase: string; pointer: string; reached: string[] }[]; logA: string; logB: string; focus: string | null; agent: JsonObject; logAAfterAgent: string; keyBytes: number }

async function click(s: Serve, panel: string, slot: [number, number, number, number]): Promise<void> {
  const pos = centre(slot);
  await s.ok({ call: 'input', panel, event: { type: 'down', pos } }, `your press in ${panel}`);
  await s.ok({ call: 'input', panel, event: { type: 'up', pos } }, `your release in ${panel}`);
}

async function play(bin: string, planted?: string): Promise<Played> {
  const dir = tmp('input');
  mkdirSync(dir, { recursive: true });
  const logA = join(dir, 'a.log'), logB = join(dir, 'b.log');
  return withServe(bin, setupOf({ evidence: dir, panels: { A: SLOT_A, B: SLOT_B }, ...(planted ? { planted } : {}) }), async (s) => {
    await s.ok(installCall(0, 'terminals', terminalPlugin({ A: 'TA', B: 'TB' })), 'the terminals plug-in installs');
    for (const [panel, terminal, log] of [['A', 'TA', logA], ['B', 'TB', logB]] as const) {
      const o = openedOf(await s.call(openCall(0, terminal, { panel, program: program(dir, 'reader', log) }), 120_000), terminal);
      for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
    }
    await waitFor(() => readBytes(`${logA}.ready`).length + readBytes(`${logB}.ready`).length, (n) => n >= 2, 60_000);
    await click(s, 'A', SLOT_A);
    const focus0 = await s.ok({ call: 'focus' }, 'focus after your click in A');
    expect(focus0['kb_focus'], 'keyboard focus is in A').toBe('A');
    const replies: Played['replies'] = [];
    let at = '';
    for (let i = 0; i < KEYS.length; i++) {
      const want = pointerFor(i);
      if (want !== at) {
        const slot = want === 'A' ? SLOT_A : want === 'B' ? SLOT_B : SLOT_EMPTY;
        const moved = await s.ok({ call: 'pointer', pos: centre(slot) }, `the pointer over ${want}`);
        expect(moved['over'], `the pointer is over ${want}`).toBe(want === 'none' ? null : want);
        at = want;
      }
      for (const phase of ['press', 'release'] as const) {
        const r = await s.ok(seamKey(KEYS[i]!, phase), `key ${i + 1} (${KEYS[i]}) ${phase}`);
        replies.push({ i, key: KEYS[i]!, phase, pointer: want, reached: arr(r['reached'], `key ${i + 1}: reached`).map((v) => str(v, 'a receiver')) });
      }
    }
    const logAText = await waitFor(() => readText(logA), (t) => t.length >= KEYS.length, 10_000);
    await sleep(500);
    const focus = await s.ok({ call: 'focus' }, 'focus after the keys');
    // An agent's session tries to type into A: refused, naming it.
    const before = readText(logA);
    const agent = await s.call({ call: 'raw_input', terminal: 'TA', by: { session: ALPHA.id }, bytes: 'echo from-the-agent\n' }, 30_000);
    await sleep(500);
    return { replies, logA: logAText, logB: readText(logB), focus: focus['kb_focus'] === null ? null : str(focus['kb_focus'], 'kb_focus'), agent, logAAfterAgent: readText(logA), keyBytes: before.length };
  });
}

/** What "100 keys reach only A's program, also with the pointer over B" asks: every key to the focused panel and its program, none to B. */
function routeProblems(p: Played): string[] {
  const f: string[] = [];
  const wrong = p.replies.filter((r) => r.reached.length !== 1 || r.reached[0] !== 'panel:A');
  for (const r of wrong.slice(0, 3)) f.push(`key ${r.i + 1} (${r.key}) ${r.phase} with the pointer over ${r.pointer} reached ${JSON.stringify(r.reached)}, not panel:A${r.reached.includes('panel:B') ? ': the router sends keys to B' : ''}`);
  if (p.logA !== KEYS.join('')) f.push(`A's program read ${JSON.stringify(p.logA.slice(0, 40))}… (${p.logA.length} bytes), not the 100 keys in order`);
  if (p.logB.length > 0) f.push(`B's program read ${p.logB.length} byte(s) it should never see: ${JSON.stringify(p.logB.slice(0, 40))}`);
  if (p.focus !== 'A') f.push(`keyboard focus moved to ${String(p.focus)} while keys were typed`);
  return f;
}
/** What "a raw-input write from an agent's session is refused, naming the writer" asks. */
function agentProblems(p: Played): string[] {
  const f: string[] = [];
  const code = p.agent['code'];
  if (typeof code !== 'string') f.push(`the raw-input write from session ${ALPHA.id} was accepted: ${JSON.stringify(p.agent).slice(0, 200)}`);
  else if (!String(p.agent['writer'] ?? '').includes(ALPHA.id)) f.push(`the refusal doesn't name the writer ${ALPHA.id}: ${JSON.stringify(p.agent).slice(0, 200)}`);
  if (p.logAAfterAgent.includes('from-the-agent')) f.push(`the agent's bytes reached A's program (writer ${ALPHA.id})`);
  return f;
}

describe('AC7 keys reach only the focused terminal, and nothing an agent writes', () => {
  it('AC7 100 keys from the input seam\'s test backend, 40 with the pointer in no panel, 30 over A and 30 over B, reach only A: each key\'s reply and A\'s program say so, and B\'s program reads nothing', async () => {
    const p = await play(show());
    expect(routeProblems(p), 'every key to A and only A').toEqual([]);
    expect(p.replies.length, 'a press and a release for each of the 100 keys').toBe(200);
    expect(p.replies.filter((r) => r.pointer === 'B').length, 'thirty keys were typed with the pointer over B').toBe(60);
  }, 600_000);

  it('AC7 a router that sends keys to the panel under the pointer fails, naming B', async () => {
    const p = await play(show(), 'router_follows_pointer');
    const f = routeProblems(p);
    expect(f.some((m) => m.includes('panel:B')), `the planted router_follows_pointer fails, naming B: ${JSON.stringify(f.slice(0, 3))}`).toBe(true);
    expect(f.some((m) => m.startsWith('B\'s program read')), 'and B\'s program is seen reading keys').toBe(true);
  }, 600_000);

  it('AC7 a raw-input write from an agent\'s session into A is refused, naming the session, and reaches nothing; one the hub accepts fails, naming the writer', async () => {
    const p = await play(show());
    expect(agentProblems(p), 'refused, naming the writer, and no byte reaches A').toEqual([]);
    expect(String(p.agent['writer']), 'the refusal names the writing session').toContain(ALPHA.id);
    const twin = agentProblems(await play(show(), 'agent_raw_input_accepted'));
    expect(twin.some((m) => m.includes(ALPHA.id)), `the planted agent_raw_input_accepted fails, naming the writer: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// SCOPE: what raw input carries, as the program receives it

describe('SCOPE raw input is keys with press, repeat and release, text, paste, mouse, focus and resize', () => {
  it('SCOPE a program that asked for bracketed paste, the mouse and focus events receives each as its escape says; a resize reaches it as a new window size', async () => {
    const dir = tmp('rawscope');
    mkdirSync(dir, { recursive: true });
    const [logA, logB] = [join(dir, 'a.log'), join(dir, 'b.log')];
    writeFileSync(join(dir, 'modes.json'), JSON.stringify({ enable: '\u001b[?2004h\u001b[?1000h\u001b[?1006h\u001b[?1004h' }));
    await withServe(show(), setupOf({ evidence: dir, panels: { A: SLOT_A, B: SLOT_B } }), async (s) => {
      await s.ok(installCall(0, 'terminals', terminalPlugin({ A: 'TA', B: 'TB' })), 'the terminals plug-in installs');
      for (const [panel, terminal, log] of [['A', 'TA', logA], ['B', 'TB', logB]] as const) {
        const o = openedOf(await s.call(openCall(0, terminal, { panel, cols: 80, rows: 24, program: program(dir, 'reader', log, join(dir, 'modes.json')) }), 120_000), terminal);
        for (const p of [o.host, o.program]) if (p) s.known.add(p.pid);
      }
      await waitFor(() => readBytes(`${logA}.ready`).length + readBytes(`${logB}.ready`).length, (n) => n >= 2, 60_000);
      await click(s, 'A', SLOT_A);
      const seam = (event: JsonObject, what: string): Promise<JsonObject> => s.ok({ call: 'seam', event }, what);
      await seam({ type: 'key', key: 'a', phase: 'press', mods: [] }, 'a press');
      await seam({ type: 'key', key: 'a', phase: 'repeat', mods: [] }, 'a repeat');
      await seam({ type: 'key', key: 'a', phase: 'release', mods: [] }, 'a release');
      await seam({ type: 'text', text: 'é' }, 'input-method text');
      await seam({ type: 'paste', text: 'pasted text' }, 'a paste');
      const [x, y] = centre(SLOT_A);
      await seam({ type: 'mouse', pos: [x, y], button: 'left', phase: 'down' }, 'a mouse press');
      await seam({ type: 'mouse', pos: [x, y], button: 'left', phase: 'up' }, 'a mouse release');
      await waitFor(() => readText(logA), (t) => t.includes('\u001b[201~') && /\u001b\[<0;\d+;\d+m/.test(t), 10_000);
      // Focus moves by your click: A is told it lost focus, B that it gained it.
      await click(s, 'B', SLOT_B);
      await waitFor(() => readText(logB), (t) => t.includes('\u001b[I'), 10_000);
      await s.ok({ call: 'terminal_resize', terminal: 'TA', cols: 100, rows: 30 }, 'a resize');
      await waitFor(() => readText(`${logA}.size`), (t) => t.includes('100x30'), 10_000);
    });
    const a = readBytes(logA).toString('utf8');
    // `a` once on press and once on repeat; nothing on release, which a legacy terminal has no escape for.
    expect(a.startsWith('aaé'), `press and repeat send the key, release sends nothing, then the text: ${JSON.stringify(a.slice(0, 20))}`).toBe(true);
    expect(a, 'a paste is bracketed').toContain('\u001b[200~pasted text\u001b[201~');
    expect(a, 'a press and a release of the mouse, in SGR').toMatch(/\u001b\[<0;\d+;\d+M\u001b\[<0;\d+;\d+m/);
    expect(a, 'A is told it lost focus').toContain('\u001b[O');
    expect(readText(logB), 'B is told it gained focus').toContain('\u001b[I');
    expect(readText(`${logA}.size`).trim().split('\n').pop(), 'the program\'s window is now 100 by 30').toBe('100x30');
  }, 600_000);
});

