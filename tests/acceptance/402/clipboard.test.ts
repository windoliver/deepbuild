// AC2: a program in a terminal panel that asks for the clipboard through its escape (OSC 52 with `?`, in each of its
// forms) gets no reply, and no byte of a secret planted on the clipboard reaches it. A real Node program on a real PTY,
// in a real panel host, writes every form of the query (two introducers, seven selections, three terminators, and one
// form a byte at a time) and logs every byte it reads; a secret sits on the test clipboard (`deep-show serve`'s
// `clipboard` setup field, never the system's). The same program then gets a key you type, so a log that stays empty is
// a log that works. A terminal that answers fails, naming the form. At the base `deep-show` has no `serve`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SLOTS, centre, installCall, openCall, openedOf, program, readBytes, setupOf, terminalPlugin, tmp, waitFor, withServe, gridOf, useShow, alive,
  type JsonObject, type Serve,
} from './helpers.ts';

const show = useShow();
const SECRET = 'tok_live_9f3a7c1e5b2d4a68X7';
const INTRODUCERS: Record<string, string> = { 'ESC ]': '\u001b]', 'C1 OSC': 'Â\u009d' };
const SELECTIONS = ['c', 'p', 'q', 's', '0', 'cp', ''];
const TERMINATORS: Record<string, string> = { BEL: '\u0007', 'ESC \\': '\u001b\\', 'C1 ST': 'Â\u009c' };
interface Form { name: string; pieces: string[] }
const FORMS: Form[] = [];
for (const [iname, intro] of Object.entries(INTRODUCERS)) {
  for (const sel of SELECTIONS) {
    for (const [tname, term] of Object.entries(TERMINATORS)) FORMS.push({ name: `${iname} 52 ; ${sel === '' ? '(empty)' : sel} ; ? ${tname}`, pieces: [`${intro}52;${sel};?${term}`] });
  }
}
// One form, a byte at a time, as a slow writer or a pipe in the middle splits it.
FORMS.push({ name: 'ESC ] 52 ; c ; ? BEL (one byte at a time)', pieces: [...'\u001b]52;c;?\u0007'] });

interface Played { segments: Buffer[]; control: Buffer; grid: ReturnType<typeof gridOf>; replyJson: string }

/** One run: every form asked of the terminal's host through the program, then your key typed. */
async function play(bin: string, planted?: string): Promise<Played> {
  const dir = tmp('osc52');
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'stdin.log');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ emit: FORMS.map((f) => f.pieces), gap_ms: 25, tail_ms: 1200 }));
  const setup: JsonObject = { ...setupOf({ evidence: dir, panels: { term: SLOTS[0]! }, ...(planted ? { planted } : {}) }), clipboard: SECRET };
  return withServe(bin, setup, async (s: Serve) => {
    await s.ok(installCall(0, 'terminals', terminalPlugin({ term: 'T1' })), 'the terminals plug-in installs');
    const opened = openedOf(await s.call(openCall(0, 'T1', { panel: 'term', program: program(dir, 'reader', log, join(dir, 'config.json')) })), 'T1');
    for (const p of [opened.host, opened.program]) if (p) s.known.add(p.pid);
    // The program is up; you click its panel, so it holds keyboard focus.
    await waitFor(() => readBytes(`${log}.ready`).length, (n) => n > 0, 60_000);
    const [x, y] = centre(SLOTS[0]!);
    await s.ok({ call: 'input', panel: 'term', event: { type: 'down', pos: [x, y] } }, 'your press in the terminal panel');
    await s.ok({ call: 'input', panel: 'term', event: { type: 'up', pos: [x, y] } }, 'your release');
    await waitFor(() => readBytes(`${log}.done`).length, (n) => n > 0, 120_000);
    // The control: a key from the input seam reaches the program, so the log can show what reaches it.
    await s.ok({ call: 'seam', event: { type: 'key', key: 'x', phase: 'press', mods: [] } }, 'a key from the input seam');
    await waitFor(() => readBytes(log).toString('latin1').split('\n#end#\n')[1] ?? '', (t) => t.includes('x'), 10_000);
    const gridReply = await s.ok({ call: 'cells', terminal: 'T1' }, 'the terminal\'s grid');
    const text = readBytes(log).toString('latin1');
    const afterEnd = text.split('\n#end#\n');
    const body = afterEnd[0] ?? '';
    const parts = body.split(/\n#(\d+)#\n/);
    // parts: [before the first marker, "0", segment 0, "1", segment 1, …]
    const segments: Buffer[] = FORMS.map(() => Buffer.alloc(0));
    for (let i = 1; i + 1 < parts.length; i += 2) segments[Number(parts[i])] = Buffer.from(parts[i + 1] ?? '', 'latin1');
    expect(alive(opened.program?.pid ?? process.pid), 'the program is still running, so a silence is its log\'s').toBe(true);
    return { segments, control: Buffer.from(afterEnd[1] ?? '', 'latin1'), grid: gridOf(gridReply, 'the grid'), replyJson: JSON.stringify(gridReply) };
  });
}

/** The failures: a form answered, the secret reaching the program in any shape, the control not arriving. */
function problems(p: Played): string[] {
  const f: string[] = [];
  const secretShapes = [SECRET, Buffer.from(SECRET).toString('base64'), Buffer.from(SECRET).toString('hex'), Buffer.from(SECRET).toString('base64url')];
  p.segments.forEach((seg, i) => {
    if (seg.length > 0) f.push(`the program got ${seg.length} byte(s) back for ${FORMS[i]!.name}: ${JSON.stringify(seg.toString('latin1').slice(0, 80))}`);
  });
  const all = Buffer.concat([...p.segments, p.control]).toString('latin1');
  for (const shape of secretShapes) if (all.includes(shape) || p.replyJson.includes(shape)) f.push(`a byte of the planted secret reaches the program or the grid (${shape.slice(0, 12)}…)`);
  if (!p.control.includes('x')) f.push('the control failed: the key you typed did not reach the program, so its log shows nothing');
  return f;
}

describe('AC2 a program asking for the clipboard through OSC 52 gets no reply and no byte of the secret', () => {
  it('AC2 each of 43 forms of OSC 52 with `?` (introducers, selections, terminators, one byte at a time) gets no byte back, the secret reaches nothing, and your key does reach the program', async () => {
    const p = await play(show());
    expect(problems(p), 'no form is answered and the secret stays on the clipboard').toEqual([]);
    expect(p.control.toString('latin1'), 'the one key you typed is all the program read after its queries').toBe('x');
  }, 600_000);

  it('AC2 a terminal that answers every form with the secret fails, naming each form; one that answers only the ESC \\ form (with an empty answer) fails, naming that form', async () => {
    const full = problems(await play(show(), 'osc52_replies_secret'));
    expect(full.length, `the planted osc52_replies_secret fails: ${JSON.stringify(full.slice(0, 3))}`).toBeGreaterThan(0);
    for (const form of FORMS.filter((x) => x.name.startsWith('ESC ] 52 ; c ; ? ')).slice(0, 3)) expect(full.some((m) => m.includes(form.name)), `a failure names ${form.name}`).toBe(true);
    expect(full.some((m) => m.includes('planted secret')), 'a failure says the secret reached the program').toBe(true);
    const st = problems(await play(show(), 'osc52_replies_in_st_form'));
    expect(st.some((m) => m.includes('ESC ] 52 ; c ; ? ESC \\')), `the planted osc52_replies_in_st_form fails, naming the form: ${JSON.stringify(st.slice(0, 3))}`).toBe(true);
    expect(st.some((m) => m.includes('ESC ] 52 ; c ; ? BEL') && !m.includes('one byte')), 'it does not fail the BEL form, which that terminal leaves unanswered').toBe(false);
  }, 900_000);

  it('SCOPE clipboard writes are shown and clipboard reads refused: each query counts as a refused read on the terminal, and no write reaches the clipboard without your gesture', async () => {
    const p = await play(show());
    expect(p.grid.clipboard.reads_refused, 'every query is a refused read').toBe(FORMS.length);
    expect(p.grid.clipboard.writes, 'the program wrote nothing to the clipboard').toEqual([]);
  }, 600_000);
});
